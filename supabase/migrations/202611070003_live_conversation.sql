begin;
create table public.live_interviews (
  session_id uuid primary key references public.interview_sessions(id) on delete cascade,
  state jsonb not null, lease_token uuid, lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create table public.live_requests (
  session_id uuid not null references public.live_interviews(session_id) on delete cascade,
  request_id uuid not null, payload_hash text not null, response jsonb,
  attempts integer not null default 1, primary key(session_id,request_id)
);
alter table public.live_interviews enable row level security;
alter table public.live_requests enable row level security;
revoke all on public.live_interviews, public.live_requests from public, anon, authenticated;
grant all on public.live_interviews, public.live_requests to service_role;
create function public.read_live(p_session_id uuid) returns jsonb language sql set search_path=public as $$
  select state from live_interviews where session_id=p_session_id
$$;
create function public.init_live(p_session_id uuid,p_state jsonb) returns jsonb language plpgsql set search_path=public as $$
declare s interview_sessions; result jsonb;
begin
  select * into s from interview_sessions where id=p_session_id for update;
  if not found or s.expires_at<=now() then raise exception 'SESSION_UNAVAILABLE'; end if;
  select state into result from live_interviews where session_id=s.id;
  if result is not null then return result; end if;
  if s.status<>'active' or exists(select 1 from interview_answers where session_id=s.id) then raise exception 'QUESTION_OUT_OF_ORDER'; end if;
  insert into live_interviews(session_id,state) values(s.id,p_state);
  return p_state;
end $$;
create function public.claim_live(p_session_id uuid,p_request_id uuid,p_hash text,p_revision integer,p_lease uuid) returns jsonb language plpgsql set search_path=public as $$
declare s interview_sessions; l live_interviews; r live_requests;
begin
  select * into s from interview_sessions where id=p_session_id for update;
  if not found or s.expires_at<=now() or s.status='cancelled' then raise exception 'SESSION_UNAVAILABLE'; end if;
  select * into l from live_interviews where session_id=s.id for update;
  if not found then raise exception 'QUESTION_OUT_OF_ORDER'; end if;
  select * into r from live_requests where session_id=s.id and request_id=p_request_id;
  if found then
    if r.payload_hash<>p_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if r.response is not null then return jsonb_build_object('response',r.response); end if;
    if r.attempts>=4 then raise exception 'ATTEMPT_LIMIT'; end if;
  end if;
  if l.lease_until>now() then raise exception 'EVALUATION_IN_PROGRESS'; end if;
  if (l.state->>'revision')::integer<>p_revision then raise exception 'QUESTION_OUT_OF_ORDER'; end if;
  if (select count(*) from live_requests where session_id=s.id)>=80 and r.request_id is null then raise exception 'ATTEMPT_LIMIT'; end if;
  insert into live_requests(session_id,request_id,payload_hash) values(s.id,p_request_id,p_hash)
    on conflict(session_id,request_id) do update set attempts=live_requests.attempts+1;
  update live_interviews set lease_token=p_lease,lease_until=now()+interval '180 seconds' where session_id=s.id;
  return jsonb_build_object('state',l.state);
end $$;
create function public.finish_live(p_session_id uuid,p_request_id uuid,p_lease uuid,p_state jsonb,p_response jsonb,p_report jsonb default null) returns void language plpgsql set search_path=public as $$
declare s interview_sessions; l live_interviews;
begin
  select * into s from interview_sessions where id=p_session_id for update;
  if not found or s.expires_at<=now() or s.status='cancelled' then raise exception 'SESSION_UNAVAILABLE'; end if;
  select * into l from live_interviews where session_id=s.id for update;
  if l.lease_token is distinct from p_lease or l.lease_until<=now() then raise exception 'EVALUATION_IN_PROGRESS'; end if;
  update live_interviews set state=p_state,lease_token=null,lease_until=null,updated_at=now() where session_id=s.id;
  update live_requests set response=p_response where session_id=s.id and request_id=p_request_id;
  if p_report is not null then
    insert into session_reports(session_id,report_data,overall_score) values(s.id,p_report,(p_report->>'overallScore')::integer)
      on conflict(session_id) do update set report_data=excluded.report_data,overall_score=excluded.overall_score;
    update interview_sessions set status='completed',current_turn_index=total_turns,current_question_id=null,completed_at=coalesce(completed_at,now()) where id=s.id;
  end if;
end $$;
create function public.release_live(p_session_id uuid,p_lease uuid) returns void language sql set search_path=public as $$
  update live_interviews set lease_token=null,lease_until=null where session_id=p_session_id and lease_token=p_lease
$$;
-- Prevent the older turn endpoint from advancing a live interview independently.
create function public.guard_live_answer() returns trigger language plpgsql set search_path=public as $$
begin
  perform 1 from interview_sessions where id=new.session_id for update;
  if exists(select 1 from live_interviews where session_id=new.session_id) then raise exception 'QUESTION_OUT_OF_ORDER'; end if;
  return new;
end $$;
create trigger guard_live_answer before insert on public.interview_answers for each row execute function public.guard_live_answer();
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('read_live','init_live','claim_live','finish_live','release_live','guard_live_answer') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
commit;
