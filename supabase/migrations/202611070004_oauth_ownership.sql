begin;
-- Preserve existing anonymous rows, but do not assign them to an arbitrary account.
-- The API denies ownerless legacy interviews; their normal expiry cleanup still applies.
alter table public.interview_sessions add column owner_id uuid references auth.users(id) on delete cascade;
create index interview_sessions_owner on public.interview_sessions(owner_id,created_at desc);
-- NOT VALID preserves existing rows, while enforcing ownership on new inserts/updates.
alter table public.interview_sessions add constraint interview_session_owner_required check(owner_id is not null) not valid;

create or replace function public.create_interview(p_s jsonb,p_q jsonb) returns void language plpgsql set search_path=public as $$
begin
  if nullif(p_s->>'ownerId','') is null then raise exception 'UNAUTHORIZED'; end if;
  insert into interview_sessions(id,owner_id,company_id,role_id,interview_mode,difficulty,total_turns,session_token_hash,audio_processing_consent,data_mode,expires_at)
  values((p_s->>'id')::uuid,(p_s->>'ownerId')::uuid,p_s->>'companyId',p_s->>'roleId',p_s->>'round',p_s->>'difficulty',(p_s->>'totalTurns')::integer,p_s->>'tokenHash',(p_s->>'audioProcessingConsent')::boolean,p_s->>'dataMode',(p_s->>'expiresAt')::timestamptz);
  perform save_question((p_s->>'id')::uuid,0,p_q);
  update interview_sessions set current_question_id=(p_q->>'id')::uuid where id=(p_s->>'id')::uuid;
end $$;
revoke all on function public.create_interview(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_interview(jsonb,jsonb) to service_role;
-- RLS remains enabled with no direct browser reads/writes of private interview data.
commit;
