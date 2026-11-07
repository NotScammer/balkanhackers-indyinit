begin;
create table public.topic_trend_snapshots (
  id uuid primary key default gen_random_uuid(),
  query_key text not null, geo text not null default '', period date not null,
  method_version text not null, provider text not null check(provider='serpapi'),
  status text not null check(status in ('available','insufficient_data')),
  score integer check(score between 0 and 100), assessment jsonb not null,
  created_at timestamptz not null default now(),
  unique(query_key,geo,period,method_version),
  check(extract(day from period)=1),
  check((status='available')=(score is not null))
);
alter table public.topic_trend_snapshots enable row level security;
revoke all on public.topic_trend_snapshots from public,anon,authenticated;
grant all on public.topic_trend_snapshots to service_role;
alter table public.topic_forecasts add column trend_snapshot jsonb;

create function public.read_topic_trends(p_query_key text,p_geo text,p_period date,p_method text) returns jsonb language sql stable set search_path=public as $$
  select assessment from topic_trend_snapshots where query_key=p_query_key and geo=p_geo and period=p_period and method_version=p_method
$$;
create function public.latest_topic_trends(p_query_key text,p_geo text,p_method text,p_period date) returns jsonb language sql stable set search_path=public as $$
  select assessment from topic_trend_snapshots where query_key=p_query_key and geo=p_geo and method_version=p_method and period<=p_period and status='available' order by period desc limit 1
$$;
create function public.save_topic_trends(p_assessment jsonb) returns void language plpgsql set search_path=public as $$
begin
  insert into topic_trend_snapshots(query_key,geo,period,method_version,provider,status,score,assessment)
  values(lower(regexp_replace(trim(p_assessment->>'query'),'\s+',' ','g')),p_assessment->>'geo',(p_assessment->>'period')::date,p_assessment->>'methodVersion',p_assessment->>'provider',p_assessment->>'status',(p_assessment->>'score')::integer,p_assessment)
  on conflict(query_key,geo,period,method_version) do nothing;
end $$;
revoke all on function public.read_topic_trends(text,text,date,text),public.save_topic_trends(jsonb),public.latest_topic_trends(text,text,text,date) from public,anon,authenticated;
grant execute on function public.read_topic_trends(text,text,date,text),public.save_topic_trends(jsonb),public.latest_topic_trends(text,text,text,date) to service_role;

create or replace function public.save_forecast(p_forecast jsonb,p_evidence jsonb,p_run_id uuid default null) returns uuid language plpgsql set search_path=public as $$
declare fid uuid; e jsonb; begin
  if p_run_id is not null and not exists(select 1 from research_runs where id=p_run_id and status='running' and lease_until>now()) then raise exception 'RESEARCH_IN_PROGRESS'; end if;
  if jsonb_array_length(p_evidence)=0 then raise exception 'Missing forecast evidence'; end if;
  if p_forecast->>'dataMode'='verified' and exists(select 1 from jsonb_array_elements(p_evidence) x join research_sources s on s.id=(x->>'sourceId')::uuid where s.source_type='illustrative') then raise exception 'Illustrative evidence cannot support verified forecasts'; end if;
  insert into topic_forecasts(run_id,topic,explanation,predicted_skills,target_roles,time_horizon_months,preparation_score,evidence_confidence,rubric_version,dimensions,data_mode,trend_snapshot)
  values(p_run_id,p_forecast->>'topic',p_forecast->>'explanation',array(select jsonb_array_elements_text(p_forecast->'predictedSkills')),array(select jsonb_array_elements_text(p_forecast->'targetRoles')),(p_forecast->>'timeHorizonMonths')::integer,(p_forecast->>'preparationScore')::integer,p_forecast->>'evidenceConfidence',p_forecast->>'rubricVersion',p_forecast->'dimensions',p_forecast->>'dataMode',p_forecast->'trendSnapshot') returning id into fid;
  for e in select * from jsonb_array_elements(p_evidence) loop
    insert into forecast_evidence(forecast_id,research_source_id,relationship_type,explanation,stance)
    values(fid,(e->>'sourceId')::uuid,e->>'relationshipType',e->>'explanation',e->>'stance');
  end loop;
  return fid;
end $$;
revoke all on function public.save_forecast(jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_forecast(jsonb,jsonb,uuid) to service_role;

-- Append a no-age-penalty version of the latest v1 forecast for each topic/mode.
-- Preserve the original rows/citations and all already saved question snapshots.
-- No Trends measurement is claimed until the monthly job actually retrieves it.
do $$ declare f record; new_id uuid; dims jsonb; priority integer; begin
  for f in select * from (
    select distinct on (lower(trim(topic)),data_mode) * from topic_forecasts
    order by lower(trim(topic)),data_mode,created_at desc,id desc
  ) latest where rubric_version='preparation-v1'
    and dimensions ?& array['industryMomentum','academicMomentum','roleRelevance','technicalMaturity']
  loop
    dims=(f.dimensions-'recency')||jsonb_build_object('topicRelevance',100);
    priority=round(
      least(100,greatest(0,(dims->>'industryMomentum')::numeric))*0.25+
      least(100,greatest(0,(dims->>'academicMomentum')::numeric))*0.20+
      least(100,greatest(0,(dims->>'roleRelevance')::numeric))*0.30+
      least(100,greatest(0,(dims->>'technicalMaturity')::numeric))*0.15+10
    );
    insert into topic_forecasts(topic,explanation,predicted_skills,target_roles,time_horizon_months,preparation_score,evidence_confidence,rubric_version,dimensions,data_mode,trend_snapshot)
    values(f.topic,f.explanation,f.predicted_skills,f.target_roles,f.time_horizon_months,priority,f.evidence_confidence,'preparation-v2-trends',dims,f.data_mode,
      jsonb_build_object('status','not_checked','score',null,'query',f.topic,'reasonCode','AWAITING_MONTHLY_TRENDS','previousForecastId',f.id)) returning id into new_id;
    insert into forecast_evidence(forecast_id,research_source_id,relationship_type,explanation,stance)
      select new_id,research_source_id,relationship_type,explanation,stance from forecast_evidence where forecast_id=f.id;
  end loop;
end $$;
commit;
