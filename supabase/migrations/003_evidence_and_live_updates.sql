create table public.evidence(
 id uuid primary key default gen_random_uuid(),occurrence_id uuid not null references public.occurrences,
 restaurant_id text not null references public.restaurants,uploaded_by uuid not null references public.profiles,
 object_path text not null unique,file_name text not null,mime_type text not null check(mime_type in ('image/png','image/jpeg','application/pdf')),
 byte_size bigint not null check(byte_size>0 and byte_size<=10485760),sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),created_at timestamptz not null default now()
);
alter table public.evidence enable row level security;
create policy scoped_evidence_metadata on public.evidence for select to authenticated using(public.has_scope(restaurant_id));
revoke all on public.evidence from anon,authenticated;
grant select on public.evidence to authenticated;
grant select on public.occurrences to service_role;
create function public.register_evidence(p_actor uuid,p_occurrence uuid,p_path text,p_name text,p_mime text,p_size bigint,p_sha256 text) returns uuid language plpgsql security definer set search_path=public as $$
declare o occurrences; eid uuid;begin
 select * into o from occurrences where id=p_occurrence and manager_id=p_actor for update;
 if o.id is null or not exists(select 1 from profiles where id=p_actor and role='manager' and restaurant_id=o.restaurant_id) then raise exception 'Report unavailable';end if;
 if not o.enabled or o.submitted_at is not null or o.missed_at is not null or clock_timestamp()<o.opens_at or clock_timestamp()>=o.deadline then raise exception 'Upload window is closed';end if;
 if p_path not like o.restaurant_id||'/'||o.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='incident-evidence' and name=p_path) then raise exception 'Uploaded object is unavailable';end if;
 insert into evidence(occurrence_id,restaurant_id,uploaded_by,object_path,file_name,mime_type,byte_size,sha256) values(o.id,o.restaurant_id,p_actor,p_path,left(p_name,180),p_mime,p_size,p_sha256) returning id into eid;
 insert into audit_log(actor,action,restaurant_id,after_value) values(p_actor,'upload_evidence',o.restaurant_id,jsonb_build_object('evidence_id',eid,'occurrence_id',o.id,'byte_size',p_size));
 return eid;
end$$;
revoke all on function public.register_evidence(uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.register_evidence(uuid,uuid,text,text,text,bigint,text) to service_role;
do $$declare t text;begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['reports','score_ledger','occurrences','highlights'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;
  end loop;
 end if;
end$$;
