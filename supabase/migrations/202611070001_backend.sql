-- Apply through Supabase SQL Editor or `supabase db push`. No browser policies are granted.
begin;
create table public.research_runs (
  id uuid primary key default gen_random_uuid(), started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null check (status in ('running','succeeded','partial','failed')),
  window_start timestamptz not null, window_end timestamptz not null, lease_until timestamptz not null,
  processed_counts jsonb not null default '{}', error_summaries jsonb not null default '[]', created_at timestamptz not null default now(),
  check (window_end > window_start)
);
create unique index one_running_research on public.research_runs ((status)) where status='running';
create table public.research_sources (
  id uuid primary key default gen_random_uuid(), source_type text not null check(source_type in ('industry','academic','illustrative')),
  publisher text not null, title text not null, url text not null unique, published_at timestamptz not null,
  retrieved_at timestamptz not null default now(), metadata jsonb not null default '{}'
);
create table public.industry_signals (
  id uuid primary key default gen_random_uuid(), research_source_id uuid not null references public.research_sources(id) on delete cascade,
  organization text not null, signal_type text not null, description text not null, technologies text[] not null default '{}',
  evidence text not null, signal_date timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(research_source_id, signal_type, description)
);
create table public.research_papers (
  id uuid primary key default gen_random_uuid(), arxiv_id text unique, doi text unique, openalex_id text unique,
  title text not null, abstract text not null, authors jsonb not null default '[]', institutions jsonb not null default '[]',
  published_at timestamptz not null, updated_at timestamptz not null default now(), source_url text not null unique,
  fulltext_url text, publication_status text not null check(publication_status in ('preprint','published','unknown')),
  research_source_id uuid not null references public.research_sources(id) on delete cascade
);
create table public.paper_analyses (
  id uuid primary key default gen_random_uuid(), research_paper_id uuid not null references public.research_papers(id) on delete cascade,
  relevance integer not null check(relevance between 0 and 100), findings jsonb not null, limitations jsonb not null,
  technical_concepts text[] not null, engineering_applications jsonb not null, model_version text not null,
  analysis_scope text not null check(analysis_scope in ('abstract','fulltext')), created_at timestamptz not null default now(),
  unique(research_paper_id, model_version, analysis_scope)
);
create table public.topic_forecasts (
  id uuid primary key default gen_random_uuid(), run_id uuid references public.research_runs(id) on delete set null,
  topic text not null, explanation text not null, predicted_skills text[] not null, target_roles text[] not null,
  time_horizon_months integer not null check(time_horizon_months between 1 and 60),
  preparation_score integer not null check(preparation_score between 0 and 100),
  evidence_confidence text not null check(evidence_confidence in ('weak','moderate','strong')),
  rubric_version text not null, dimensions jsonb not null, data_mode text not null check(data_mode in ('verified','illustrative')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.forecast_evidence (
  id uuid primary key default gen_random_uuid(), forecast_id uuid not null references public.topic_forecasts(id) on delete cascade,
  research_source_id uuid not null references public.research_sources(id),
  relationship_type text not null check(relationship_type in ('industry','academic','illustrative')),
  explanation text not null, stance text not null check(stance in ('support','contradiction')),
  created_at timestamptz not null default now(), unique(forecast_id,research_source_id)
);
create table public.interview_sessions (
  id uuid primary key, company_id text not null, role_id text not null,
  interview_mode text not null check(interview_mode in ('behavioral','technical','system_design','mixed')),
  difficulty text not null check(difficulty in ('beginner','intermediate','advanced')),
  status text not null default 'active' check(status in ('active','completed','cancelled')),
  current_turn_index integer not null default 0 check(current_turn_index >= 0), current_question_id uuid,
  total_turns integer not null check(total_turns between 1 and 10),
  session_token_hash text not null check(session_token_hash ~ '^[a-f0-9]{64}$'), audio_processing_consent boolean not null,
  data_mode text not null check(data_mode in ('verified','illustrative')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), expires_at timestamptz not null,
  completed_at timestamptz, check(expires_at > created_at), check(current_turn_index <= total_turns)
);
create table public.session_questions (
  id uuid primary key, session_id uuid not null references public.interview_sessions(id) on delete cascade,
  turn_index integer not null check(turn_index >= 0), question_text text not null,
  question_kind text not null check(question_kind in ('behavioral','technical','system_design')),
  topic text not null, difficulty text not null check(difficulty in ('beginner','intermediate','advanced')),
  forecast_id uuid references public.topic_forecasts(id), forecast_snapshot jsonb,
  assessment_guidance text not null, expected_concepts text[] not null,
  evidence_ids uuid[] not null default '{}', generation_model text not null,
  is_follow_up boolean not null, parent_question_id uuid references public.session_questions(id) on delete cascade,
  created_at timestamptz not null default now(), unique(session_id,turn_index), unique(session_id,id),
  check(is_follow_up = (parent_question_id is not null))
);
alter table public.interview_sessions add constraint current_question_owned foreign key(id,current_question_id) references public.session_questions(session_id,id) deferrable initially deferred;
create table public.interview_answers (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.interview_sessions(id) on delete cascade,
  question_id uuid not null, client_answer_id uuid not null, payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  transcript text not null check(length(transcript) between 1 and 10000), input_mode text not null check(input_mode in ('text','voice')),
  duration_seconds numeric check(duration_seconds between 0 and 3600),
  processing_status text not null check(processing_status in ('processing','failed','done')),
  lease_token uuid not null, lease_until timestamptz not null, attempts integer not null default 1,
  next_question_checkpoint jsonb, response_data jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(session_id,client_answer_id), unique(session_id,question_id),
  foreign key(session_id,question_id) references public.session_questions(session_id,id) on delete cascade
);
create table public.answer_evaluations (
  id uuid primary key default gen_random_uuid(), answer_id uuid not null unique references public.interview_answers(id) on delete cascade,
  rubric_version text not null, category_scores jsonb not null, overall_score integer not null check(overall_score between 0 and 100),
  evaluation_data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.session_reports (
  session_id uuid primary key references public.interview_sessions(id) on delete cascade,
  report_data jsonb not null, overall_score integer not null check(overall_score between 0 and 100), completed_at timestamptz not null default now()
);
create table public.rate_buckets (key text primary key, count integer not null check(count>0), expires_at timestamptz not null);
create index sessions_expiry on public.interview_sessions(expires_at);
create index question_session on public.session_questions(session_id);
create index answer_session on public.interview_answers(session_id);
create index forecasts_ranking on public.topic_forecasts(data_mode,preparation_score desc,created_at desc);
create index forecast_roles on public.topic_forecasts using gin(target_roles);
create index evidence_source on public.forecast_evidence(research_source_id);
create index paper_date on public.research_papers(published_at desc);
create index signal_date on public.industry_signals(signal_date desc);

create function public.touch_updated_at() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['industry_signals','research_papers','topic_forecasts','interview_sessions','interview_answers','answer_evaluations'] loop
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()',t);
  end loop;
  foreach t in array array['research_runs','research_sources','industry_signals','research_papers','paper_analyses','topic_forecasts','forecast_evidence','interview_sessions','session_questions','interview_answers','answer_evaluations','session_reports','rate_buckets'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

-- Helpers execute with caller rights. Only service_role can invoke backend functions.
create function public.save_question(p_session_id uuid, p_turn integer, p_q jsonb) returns void language plpgsql set search_path=public as $$
begin
  insert into session_questions(id,session_id,turn_index,question_text,question_kind,topic,difficulty,forecast_id,forecast_snapshot,assessment_guidance,expected_concepts,evidence_ids,generation_model,is_follow_up,parent_question_id)
  values ((p_q->>'id')::uuid,p_session_id,p_turn,p_q->>'text',p_q->>'kind',p_q->>'topic',p_q->>'difficulty',(p_q->>'forecastId')::uuid,p_q->'forecastSnapshot',p_q->>'assessmentGuidance',array(select jsonb_array_elements_text(p_q->'expectedConcepts')),array(select jsonb_array_elements_text(p_q->'evidenceIds'))::uuid[],p_q->>'generationModel',(p_q->>'isFollowUp')::boolean,(p_q->>'parentQuestionId')::uuid);
end $$;
create function public.create_interview(p_s jsonb,p_q jsonb) returns void language plpgsql set search_path=public as $$
begin
  insert into interview_sessions(id,company_id,role_id,interview_mode,difficulty,total_turns,session_token_hash,audio_processing_consent,data_mode,expires_at)
  values((p_s->>'id')::uuid,p_s->>'companyId',p_s->>'roleId',p_s->>'round',p_s->>'difficulty',(p_s->>'totalTurns')::integer,p_s->>'tokenHash',(p_s->>'audioProcessingConsent')::boolean,p_s->>'dataMode',(p_s->>'expiresAt')::timestamptz);
  perform save_question((p_s->>'id')::uuid,0,p_q);
  update interview_sessions set current_question_id=(p_q->>'id')::uuid where id=(p_s->>'id')::uuid;
end $$;
create function public.interview_snapshot(p_session_id uuid) returns jsonb language sql stable set search_path=public as $$
  select jsonb_build_object('session',to_jsonb(s),'questions',coalesce((select jsonb_agg(q order by turn_index) from session_questions q where q.session_id=s.id),'[]'),
    'answers',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('evaluation',e.evaluation_data) order by a.created_at) from interview_answers a left join answer_evaluations e on e.answer_id=a.id where a.session_id=s.id),'[]'),
    'report',(select report_data from session_reports where session_id=s.id)) from interview_sessions s where s.id=p_session_id
$$;
create function public.claim_answer(p_session_id uuid,p_input jsonb,p_hash text,p_lease uuid) returns jsonb language plpgsql set search_path=public as $$
declare s interview_sessions; a interview_answers; begin
  select * into s from interview_sessions where id=p_session_id for update;
  if not found or s.expires_at<=now() then raise exception 'SESSION_UNAVAILABLE'; end if;
  select * into a from interview_answers where session_id=s.id and client_answer_id=(p_input->>'clientAnswerId')::uuid;
  if found then
    if a.payload_hash<>p_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if a.processing_status='done' then return to_jsonb(a); end if;
    if s.status<>'active' then raise exception 'SESSION_INCOMPLETE'; end if;
    if a.processing_status='processing' and a.lease_until>now() then raise exception 'EVALUATION_IN_PROGRESS'; end if;
    if a.attempts>=4 then raise exception 'ATTEMPT_LIMIT'; end if;
    update interview_answers set lease_token=p_lease,lease_until=now()+interval '180 seconds',processing_status='processing',attempts=attempts+1 where id=a.id returning * into a;
    return to_jsonb(a);
  end if;
  if s.status<>'active' or s.current_question_id<>(p_input->>'questionId')::uuid then raise exception 'QUESTION_OUT_OF_ORDER'; end if;
  if (p_input->>'inputMode')='voice' and not s.audio_processing_consent then raise exception 'AUDIO_CONSENT_REQUIRED'; end if;
  if exists(select 1 from interview_answers where session_id=s.id and question_id=s.current_question_id) then raise exception 'EVALUATION_IN_PROGRESS'; end if;
  insert into interview_answers(session_id,question_id,client_answer_id,payload_hash,transcript,input_mode,duration_seconds,processing_status,lease_token,lease_until)
  values(s.id,s.current_question_id,(p_input->>'clientAnswerId')::uuid,p_hash,p_input->>'transcript',p_input->>'inputMode',(p_input->>'durationSeconds')::numeric,'processing',p_lease,now()+interval '180 seconds') returning * into a;
  return to_jsonb(a);
end $$;
create function public.checkpoint_answer(p_answer_id uuid,p_lease uuid,p_evaluation jsonb default null,p_next jsonb default null) returns void language plpgsql set search_path=public as $$
declare a interview_answers; begin
  select * into a from interview_answers where id=p_answer_id for update;
  if not found or a.lease_token<>p_lease or a.processing_status<>'processing' or a.lease_until<=now() then raise exception 'EVALUATION_IN_PROGRESS'; end if;
  if p_evaluation is not null then
    insert into answer_evaluations(answer_id,rubric_version,category_scores,overall_score,evaluation_data)
    values(a.id,p_evaluation->>'rubricVersion',p_evaluation->'scores',(p_evaluation->>'overallScore')::integer,p_evaluation) on conflict(answer_id) do nothing;
  end if;
  if p_next is not null then update interview_answers set next_question_checkpoint=p_next where id=a.id; end if;
end $$;
create function public.finish_answer(p_answer_id uuid,p_lease uuid,p_response jsonb,p_report jsonb default null) returns void language plpgsql set search_path=public as $$
declare a interview_answers; s interview_sessions; n integer; begin
  -- Always lock session before answer, matching claim/end lock order.
  select s0.* into s from interview_sessions s0 join interview_answers a0 on a0.session_id=s0.id where a0.id=p_answer_id for update of s0;
  select * into a from interview_answers where id=p_answer_id for update;
  if not found or a.lease_token<>p_lease or a.processing_status<>'processing' or a.lease_until<=now() then raise exception 'EVALUATION_IN_PROGRESS'; end if;
  if s.status<>'active' or s.expires_at<=now() or s.current_question_id<>a.question_id then raise exception 'QUESTION_OUT_OF_ORDER'; end if;
  if not exists(select 1 from answer_evaluations where answer_id=a.id) then raise exception 'SESSION_INCOMPLETE'; end if;
  n=s.current_turn_index+1;
  if n=s.total_turns then
    if p_report is null or (select count(*) from answer_evaluations e join interview_answers a1 on a1.id=e.answer_id where a1.session_id=s.id)<>s.total_turns then raise exception 'SESSION_INCOMPLETE'; end if;
    insert into session_reports(session_id,report_data,overall_score) values(s.id,p_report,(p_report->>'overallScore')::integer);
    update interview_sessions set status='completed',current_turn_index=n,current_question_id=null,completed_at=now() where id=s.id;
  else
    if a.next_question_checkpoint is null then raise exception 'SESSION_INCOMPLETE'; end if;
    perform save_question(s.id,n,a.next_question_checkpoint);
    update interview_sessions set current_turn_index=n,current_question_id=(a.next_question_checkpoint->>'id')::uuid where id=s.id;
  end if;
  update interview_answers set processing_status='done',response_data=p_response where id=a.id;
end $$;
create function public.fail_answer(p_answer_id uuid,p_lease uuid) returns void language sql set search_path=public as $$
  update interview_answers set processing_status='failed',lease_until=now() where id=p_answer_id and lease_token=p_lease and processing_status='processing'
$$;
create function public.end_interview(p_session_id uuid) returns void language plpgsql set search_path=public as $$
declare s interview_sessions; begin
  select * into s from interview_sessions where id=p_session_id for update;
  if s.expires_at<=now() then raise exception 'SESSION_UNAVAILABLE'; end if;
  if s.status='active' then
    if exists(select 1 from interview_answers where session_id=s.id and processing_status='processing' and lease_until>now()) then raise exception 'EVALUATION_IN_PROGRESS'; end if;
    update interview_sessions set status='cancelled',current_question_id=null where id=s.id;
  end if;
end $$;
create function public.consume_rate(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql set search_path=public as $$
declare c integer; begin
  insert into rate_buckets(key,count,expires_at) values(p_key,1,now()+make_interval(secs=>p_seconds))
  on conflict(key) do update set count=case when rate_buckets.expires_at<=now() then 1 else rate_buckets.count+1 end,
    expires_at=case when rate_buckets.expires_at<=now() then excluded.expires_at else rate_buckets.expires_at end returning count into c;
  return c<=p_limit;
end $$;
create function public.acquire_research_run(p_seconds integer default 240) returns jsonb language plpgsql set search_path=public as $$
declare last_end timestamptz; r research_runs; begin
  perform pg_advisory_xact_lock(863526);
  if exists(select 1 from research_runs where status='running' and lease_until>now()) then raise exception 'RESEARCH_IN_PROGRESS'; end if;
  update research_runs set status='partial',finished_at=now(),error_summaries=error_summaries||'["Previous invocation lease expired"]'::jsonb where status='running';
  select max(window_end) into last_end from research_runs where status='succeeded';
  insert into research_runs(status,window_start,window_end,lease_until)
  values('running',coalesce(last_end,now()-interval '30 days')-interval '3 days',now(),now()+make_interval(secs=>p_seconds)) returning * into r;
  return to_jsonb(r);
end $$;
create function public.cleanup_expired() returns void language sql set search_path=public as $$
  delete from interview_sessions where expires_at<=now();
  delete from rate_buckets where expires_at<=now();
$$;
-- Revoke default EXECUTE grants on every function introduced here, including helper functions.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('touch_updated_at','save_question','create_interview','interview_snapshot','claim_answer','checkpoint_answer','finish_answer','fail_answer','end_interview','consume_rate','acquire_research_run','cleanup_expired') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
commit;
