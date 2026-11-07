begin;
alter table public.interview_sessions add column personalization jsonb;
create table public.candidate_profiles (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 profile jsonb not null, updated_at timestamptz not null default now()
);
alter table public.candidate_profiles enable row level security;
revoke all on public.candidate_profiles from public,anon,authenticated;
grant all on public.candidate_profiles to service_role;
create function public.candidate_profile(p_owner uuid, p_action text, p_profile jsonb default null) returns jsonb language plpgsql set search_path=public as $$
declare result jsonb;
begin
 if p_action = 'save' then
  insert into candidate_profiles(owner_id,profile) values(p_owner,p_profile)
  on conflict(owner_id) do update set profile=excluded.profile,updated_at=now();
 elsif p_action = 'delete' then delete from candidate_profiles where owner_id=p_owner;
 elsif p_action <> 'get' then raise exception 'INVALID_REQUEST'; end if;
 select profile into result from candidate_profiles where owner_id=p_owner;
 return result;
end $$;
revoke all on function public.candidate_profile(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.candidate_profile(uuid,text,jsonb) to service_role;
create or replace function public.create_interview(p_s jsonb,p_q jsonb) returns void language plpgsql set search_path=public as $$
begin
  if nullif(p_s->>'ownerId','') is null then raise exception 'UNAUTHORIZED'; end if;
  insert into interview_sessions(id,owner_id,company_id,role_id,interview_mode,difficulty,total_turns,session_token_hash,audio_processing_consent,data_mode,expires_at,personalization)
  values((p_s->>'id')::uuid,(p_s->>'ownerId')::uuid,p_s->>'companyId',p_s->>'roleId',p_s->>'round',p_s->>'difficulty',(p_s->>'totalTurns')::integer,p_s->>'tokenHash',(p_s->>'audioProcessingConsent')::boolean,p_s->>'dataMode',(p_s->>'expiresAt')::timestamptz,p_s->'personalization');
  perform save_question((p_s->>'id')::uuid,0,p_q);
  update interview_sessions set current_question_id=(p_q->>'id')::uuid where id=(p_s->>'id')::uuid;
end $$;
revoke all on function public.create_interview(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_interview(jsonb,jsonb) to service_role;

commit;
