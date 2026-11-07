begin;
-- Persist each forecast and all its citations together. History is append-only by run.
create function public.save_forecast(p_forecast jsonb,p_evidence jsonb,p_run_id uuid default null) returns uuid language plpgsql set search_path=public as $$
declare fid uuid; e jsonb; begin
  if p_run_id is not null and not exists(select 1 from research_runs where id=p_run_id and status='running' and lease_until>now()) then raise exception 'RESEARCH_IN_PROGRESS'; end if;
  if jsonb_array_length(p_evidence)=0 then raise exception 'Missing forecast evidence'; end if;
  if p_forecast->>'dataMode'='verified' and exists(select 1 from jsonb_array_elements(p_evidence) x join research_sources s on s.id=(x->>'sourceId')::uuid where s.source_type='illustrative') then raise exception 'Illustrative evidence cannot support verified forecasts'; end if;
  insert into topic_forecasts(run_id,topic,explanation,predicted_skills,target_roles,time_horizon_months,preparation_score,evidence_confidence,rubric_version,dimensions,data_mode)
  values(p_run_id,p_forecast->>'topic',p_forecast->>'explanation',array(select jsonb_array_elements_text(p_forecast->'predictedSkills')),array(select jsonb_array_elements_text(p_forecast->'targetRoles')),(p_forecast->>'timeHorizonMonths')::integer,(p_forecast->>'preparationScore')::integer,p_forecast->>'evidenceConfidence',p_forecast->>'rubricVersion',p_forecast->'dimensions',p_forecast->>'dataMode') returning id into fid;
  for e in select * from jsonb_array_elements(p_evidence) loop
    insert into forecast_evidence(forecast_id,research_source_id,relationship_type,explanation,stance)
    values(fid,(e->>'sourceId')::uuid,e->>'relationshipType',e->>'explanation',e->>'stance');
  end loop;
  return fid;
end $$;
revoke all on function public.save_forecast(jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_forecast(jsonb,jsonb,uuid) to service_role;
commit;
