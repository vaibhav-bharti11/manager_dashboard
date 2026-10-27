-- No accounts, active policies, occurrences or real scores are seeded.
create type public.report_kind as enum ('opening','closing','incident','briefing');
create table public.restaurants(id text primary key,name text not null unique,location text not null,short text not null,color text not null);
insert into public.restaurants values
 ('embassy-vasant','Embassy Vasant Kunj','New Delhi','EV','#a66443'),
 ('embassy-elan','Embassy Elan Epic','Gurugram','EE','#788369'),
 ('kampai','Kampai Aerocity','New Delhi','KA','#92727e'),
 ('basque','Basque Dehradun','Dehradun','BD','#7e839d');
create table public.profiles(id uuid primary key references auth.users(id),name text not null,role text not null check(role in ('manager','admin')),restaurant_id text references public.restaurants,check((role='manager' and restaurant_id is not null) or (role='admin' and restaurant_id is null)));
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and role='admin')$$;
create function public.has_scope(r text) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and (role='admin' or restaurant_id=r))$$;
create table public.policies(
 id uuid primary key default gen_random_uuid(),restaurant_id text not null references public.restaurants,type public.report_kind not null,version integer not null,current boolean not null default true,enabled boolean not null default false,
 start_time time,end_time time,timezone text,manager_id uuid references public.profiles,reward integer check(reward>=0),baseline integer,score_floor integer,reset_time time,
 effective_from date,operating_days integer[],closed_dates date[] not null default '{}',approvals jsonb not null default '{}',created_by uuid references public.profiles,created_at timestamptz not null default now(),
 unique(restaurant_id,type,version),check(not enabled or(start_time is not null and end_time is not null and start_time<>end_time and timezone is not null and manager_id is not null and reward is not null and baseline is not null and reset_time is not null and effective_from is not null and cardinality(operating_days)>0))
);
create unique index one_current_policy on public.policies(restaurant_id,type) where current;
create table public.audit_log(id bigint generated always as identity primary key,actor uuid references public.profiles,action text not null,restaurant_id text references public.restaurants,before_value jsonb,after_value jsonb,created_at timestamptz not null default now());
create table public.occurrences(
 id uuid primary key default gen_random_uuid(),restaurant_id text not null references public.restaurants,type public.report_kind not null,business_date date not null,shift text not null,
 manager_id uuid not null references public.profiles,policy_id uuid not null references public.policies,policy_snapshot jsonb not null,opens_at timestamptz not null,deadline timestamptz not null,
 enabled boolean not null default true,submitted_at timestamptz,missed_at timestamptz,unique(restaurant_id,type,business_date),check(deadline>opens_at),check(not(submitted_at is not null and missed_at is not null))
);
create table public.drafts(occurrence_id uuid primary key references public.occurrences,restaurant_id text not null references public.restaurants,manager_id uuid not null references public.profiles,data jsonb not null,updated_at timestamptz not null default now());
create table public.reports(id uuid primary key default gen_random_uuid(),occurrence_id uuid not null unique references public.occurrences,restaurant_id text not null references public.restaurants,type public.report_kind not null,manager_id uuid not null references public.profiles,manager_name text not null,business_date date not null,shift text not null,submitted_at timestamptz not null,data jsonb not null,version integer not null default 1);
create table public.incident_records(id uuid primary key default gen_random_uuid(),report_id uuid not null references public.reports,restaurant_id text not null references public.restaurants,record jsonb not null);
create table public.highlights(id uuid primary key default gen_random_uuid(),report_id uuid not null references public.reports,restaurant_id text not null references public.restaurants,type public.report_kind not null,manager_id uuid not null references public.profiles,manager_name text not null,row_number integer not null,text text not null,created_at timestamptz not null default now(),unique(report_id,row_number));
create table public.score_weeks(id uuid primary key default gen_random_uuid(),manager_id uuid not null references public.profiles,restaurant_id text not null references public.restaurants,starts_on date not null,baseline integer not null,score_floor integer,timezone text not null,reset_time time not null,unique(manager_id,starts_on));
create table public.score_ledger(id uuid primary key default gen_random_uuid(),occurrence_id uuid not null unique references public.occurrences,restaurant_id text not null references public.restaurants,manager_id uuid not null references public.profiles,week_id uuid not null references public.score_weeks,policy_id uuid not null references public.policies,business_date date not null,reason text not null check(reason in ('submitted','missed')),amount integer not null,created_at timestamptz not null default now(),check((reason='missed' and amount=-20) or(reason='submitted' and amount>=0)));
create table public.report_templates(restaurant_id text not null references public.restaurants,type public.report_kind not null,version integer not null default 1,rows jsonb not null,primary key(restaurant_id,type,version));

alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
alter table public.restaurants enable row level security;
create policy restaurant_read on public.restaurants for select to authenticated using(public.has_scope(id));
do $$declare t text;begin foreach t in array array['policies','occurrences','drafts','reports','incident_records','highlights','score_weeks','score_ledger','report_templates'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy scoped_read on public.%I for select to authenticated using(public.has_scope(restaurant_id))',t);
 end loop;end$$;
alter table public.audit_log enable row level security;
create policy admin_audit on public.audit_log for select to authenticated using(public.is_admin());
-- No client write policies. All mutations pass through validated RPCs.

create function public.configure_policy(p_policy jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare previous policies; next_id uuid; v integer; r text:=p_policy->>'restaurant_id'; k report_kind:=(p_policy->>'type')::report_kind; a jsonb:=coalesce(p_policy->'approvals','{}'); activate boolean:=coalesce((p_policy->>'enabled')::boolean,false); reset time:=(p_policy->>'reset_time')::time; begin
 if not is_admin() then raise exception 'Administrator access required';end if;
 perform pg_advisory_xact_lock(hashtextextended(r||k::text,0));
 select * into previous from policies where restaurant_id=r and type=k and current for update;
 if (p_policy->>'effective_from')::date < (now() at time zone coalesce(p_policy->>'timezone','Asia/Kolkata'))::date+1 then raise exception 'Policy changes must take effect on a future service day';end if;
 if not exists(select 1 from pg_timezone_names where name=p_policy->>'timezone') then raise exception 'Invalid timezone';end if;
 if activate then
  if exists(select 1 from unnest(array['calendar','points','reset','responsibility','incident','handover','director','retention']) x where coalesce((a->>x)::boolean,false) is not true) then raise exception 'Every production policy approval must be confirmed before activation';end if;
  if not exists(select 1 from profiles where id=(p_policy->>'manager_id')::uuid and restaurant_id=r and role='manager') then raise exception 'Assign a manager from this restaurant';end if;
  if reset is null or p_policy->>'baseline' is null or p_policy->>'reward' is null then raise exception 'Score and reset policies are required';end if;
  if exists(select 1 from policies where restaurant_id=r and current and enabled and type<>k and (baseline is distinct from (p_policy->>'baseline')::integer or reset_time is distinct from reset or timezone is distinct from p_policy->>'timezone' or score_floor is distinct from (p_policy->>'score_floor')::integer)) then raise exception 'Use consistent weekly rules within a restaurant';end if;
  if k='incident' and p_policy->>'incident_rule' is distinct from 'daily_declaration' then raise exception 'Approve daily incident / no-incident declaration policy';end if;
 end if;
 v:=coalesce(previous.version,0)+1;
 update policies set current=false where id=previous.id;
 insert into policies(restaurant_id,type,version,enabled,start_time,end_time,timezone,manager_id,reward,baseline,score_floor,reset_time,effective_from,operating_days,closed_dates,approvals,created_by)
 values(r,k,v,activate,(p_policy->>'start_time')::time,(p_policy->>'end_time')::time,p_policy->>'timezone',nullif(p_policy->>'manager_id','')::uuid,(p_policy->>'reward')::integer,(p_policy->>'baseline')::integer,(p_policy->>'score_floor')::integer,reset,(p_policy->>'effective_from')::date,array(select jsonb_array_elements_text(p_policy->'operating_days')::integer),array(select jsonb_array_elements_text(p_policy->'closed_dates')::date),a||jsonb_build_object('incident_rule',p_policy->>'incident_rule','handover_rule',p_policy->>'handover_rule'),auth.uid()) returning id into next_id;
 insert into audit_log(actor,action,restaurant_id,before_value,after_value) values(auth.uid(),'configure_policy',r,to_jsonb(previous),p_policy||jsonb_build_object('policy_id',next_id));
 return next_id;end$$;

create function public.record_score(o public.occurrences,why text) returns void language plpgsql security definer set search_path=public as $$
declare p jsonb:=o.policy_snapshot; shifted timestamp; sunday date; wid uuid; begin
 shifted:=(o.opens_at at time zone (p->>'timezone'))-((p->>'reset_time')::time-time '00:00');
 sunday:=shifted::date-extract(dow from shifted)::integer;
 insert into score_weeks(manager_id,restaurant_id,starts_on,baseline,score_floor,timezone,reset_time) values(o.manager_id,o.restaurant_id,sunday,(p->>'baseline')::integer,(p->>'score_floor')::integer,p->>'timezone',(p->>'reset_time')::time) on conflict(manager_id,starts_on) do nothing;
 select id into wid from score_weeks where manager_id=o.manager_id and starts_on=sunday;
 insert into score_ledger(occurrence_id,restaurant_id,manager_id,week_id,policy_id,business_date,reason,amount) values(o.id,o.restaurant_id,o.manager_id,wid,o.policy_id,o.business_date,why,case when why='missed' then -20 else (p->>'reward')::integer end) on conflict(occurrence_id) do nothing;
end$$;

create function public.validate_report(k public.report_kind,p_data jsonb,r text) returns void language plpgsql security definer set search_path=public as $$
declare rows jsonb; n integer; response jsonb; item jsonb; i integer; begin
 if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>262144 then raise exception 'Invalid or oversized report';end if;
 if coalesce((p_data->>'manager_ack')::boolean,false) is not true then raise exception 'Explicit manager verification is required';end if;
 if k in ('opening','closing') then
  select t.rows into rows from report_templates t where restaurant_id=r and type=k order by version desc limit 1;
  if rows is null then raise exception 'Report template is missing';end if;
  for i in 0..jsonb_array_length(rows)-1 loop
   response:=p_data->'responses'->i::text;
   if response is null or coalesce(response->>'status','') not in ('D','I','NA') or length(trim(coalesce(response->>'initials','')))=0 then raise exception 'Every checklist row needs status and checker initials';end if;
   if response->>'status'='I' and (length(trim(coalesce(response->>'action','')))=0 or length(trim(coalesce(response->>'owner','')))=0 or coalesce(response->>'due','')='') then raise exception 'Issues require action, owner and due time';end if;
  end loop;
  if length(trim(coalesce(p_data->>'completed_by','')))=0 or coalesce(p_data->>'completed_time','')='' or coalesce(p_data->>'verified_time','')='' then raise exception 'Staff completion and manager verification are required';end if;
 elsif k='briefing' then
  for i in 0..13 loop
   if coalesce((p_data->'responses'->i::text->>'done')::boolean,false) is not true then raise exception 'Every briefing point must be completed';end if;
  end loop;
  if coalesce(p_data->>'shift','') not in ('Lunch','Dinner') or coalesce(p_data->>'briefing_by','')='' or coalesce(p_data->>'start_time','')='' or coalesce(p_data->>'ended_time','')='' then raise exception 'Briefing facilitator, shift and times are required';end if;
 elsif k='incident' and not coalesce((p_data->>'no_incident')::boolean,false) then
  for item in select p_data union all select value from jsonb_array_elements(coalesce(p_data->'incidents','[]')) loop
   if coalesce(item->>'incident_time','')='' or coalesce(item->>'incident_type','')='' or coalesce(item->>'area','')='' or coalesce(item->>'reported_by','')='' or coalesce(item->>'manager_on_duty','')='' or coalesce(item->>'narrative0','')='' or coalesce(item->>'narrative1','')='' or coalesce(item->>'answer0','') not in ('Yes','No') or coalesce(item->>'answer1','') not in ('Yes','No') then raise exception 'Complete incident time, type, area, people, facts, action and resolution';end if;
  end loop;
 end if;
 -- Client cannot create another person's signature or management review.
 if p_data ? 'management_review' or p_data ? 'staff_signature' or exists(select 1 from jsonb_array_elements(coalesce(p_data->'staff','[]')) s where coalesce((s->>'acknowledged')::boolean,false)) then raise exception 'Independent staff signatures and management reviews require separate authorised actors';end if;
end$$;

create function public.submit_report(p_occurrence uuid,p_data jsonb) returns public.reports language plpgsql security definer set search_path=public as $$
declare o occurrences; actor profiles; result reports; server_time timestamptz; begin
 select * into actor from profiles where id=auth.uid();
 if actor.id is null or actor.role<>'manager' then raise exception 'A restaurant manager session is required';end if;
 select * into o from occurrences where id=p_occurrence and restaurant_id=actor.restaurant_id and manager_id=actor.id for update;
 if o.id is null then raise exception 'Report unavailable';end if;
 select * into result from reports where occurrence_id=o.id;
 if result.id is not null then return result;end if;
 server_time:=clock_timestamp();
 if not o.enabled or server_time<o.opens_at or server_time>=o.deadline or o.missed_at is not null then raise exception 'Submission window is closed';end if;
 perform validate_report(o.type,p_data,o.restaurant_id);
 insert into reports(occurrence_id,restaurant_id,type,manager_id,manager_name,business_date,shift,submitted_at,data) values(o.id,o.restaurant_id,o.type,actor.id,actor.name,o.business_date,o.shift,server_time,p_data||jsonb_build_object('verified_by',actor.name,'manager_verified_at',server_time)) returning * into result;
 if o.type='incident' and not coalesce((p_data->>'no_incident')::boolean,false) then
  insert into incident_records(report_id,restaurant_id,record) values(result.id,o.restaurant_id,p_data-'incidents');
  insert into incident_records(report_id,restaurant_id,record) select result.id,o.restaurant_id,value from jsonb_array_elements(coalesce(p_data->'incidents','[]'));
 end if;
 update occurrences set submitted_at=server_time where id=o.id;
 perform record_score(o,'submitted');
 insert into audit_log(actor,action,restaurant_id,after_value) values(actor.id,'submit_report',o.restaurant_id,jsonb_build_object('report_id',result.id,'occurrence_id',o.id,'submitted_at',server_time));
 return result;end$$;

create function public.save_draft(p_occurrence uuid,p_data jsonb) returns void language plpgsql security definer set search_path=public as $$
declare o occurrences; begin
 select * into o from occurrences where id=p_occurrence and manager_id=auth.uid() and has_scope(restaurant_id) for update;
 if o.id is null or not o.enabled or clock_timestamp()<o.opens_at or clock_timestamp()>=o.deadline or o.submitted_at is not null then raise exception 'Draft window is closed';end if;
 if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>262144 then raise exception 'Invalid draft';end if;
 insert into drafts(occurrence_id,restaurant_id,manager_id,data) values(o.id,o.restaurant_id,auth.uid(),p_data) on conflict(occurrence_id) do update set data=excluded.data,updated_at=now();
end$$;

create function public.highlight_report(p_report uuid,p_row integer,p_text text) returns void language plpgsql security definer set search_path=public as $$
declare r reports; actor profiles; max_row integer; begin
 select * into actor from profiles where id=auth.uid();
 select * into r from reports where id=p_report and restaurant_id=actor.restaurant_id and manager_id=actor.id;
 if r.id is null or actor.role<>'manager' or r.type not in ('opening','closing') then raise exception 'Report unavailable';end if;
 select jsonb_array_length(rows) into max_row from report_templates where restaurant_id=r.restaurant_id and type=r.type order by version desc limit 1;
 if p_row<0 or p_row>=max_row or length(trim(p_text))=0 or length(p_text)>2000 then raise exception 'Invalid highlight';end if;
 insert into highlights(report_id,restaurant_id,type,manager_id,manager_name,row_number,text) values(r.id,r.restaurant_id,r.type,actor.id,actor.name,p_row,p_text) on conflict(report_id,row_number) do nothing;
end$$;

create function public.reconcile_reports() returns void language plpgsql security definer set search_path=public as $$
declare p policies; d date; local_today date; start_at timestamptz; end_at timestamptz; o occurrences;begin
 -- A durable cron job owns this RPC. Authenticated clients cannot invoke it.
 for p in select * from policies where enabled loop
  local_today:=(now() at time zone p.timezone)::date;
  for d in select generate_series(greatest(p.effective_from,coalesce((select max(business_date)+1 from occurrences where policy_id=p.id),p.effective_from)),local_today+1,interval '1 day')::date loop
   if extract(dow from d)::integer=any(p.operating_days) and not(d=any(p.closed_dates)) and not exists(select 1 from policies newer where newer.restaurant_id=p.restaurant_id and newer.type=p.type and newer.version>p.version and newer.effective_from<=d) then
    start_at:=(d+p.start_time) at time zone p.timezone;
    end_at:=((d+case when p.end_time<=p.start_time then 1 else 0 end)+p.end_time) at time zone p.timezone;
    insert into occurrences(restaurant_id,type,business_date,shift,manager_id,policy_id,policy_snapshot,opens_at,deadline) values(p.restaurant_id,p.type,d,case when p.type='opening' then 'Morning' else 'Evening' end,p.manager_id,p.id,to_jsonb(p),start_at,end_at) on conflict(restaurant_id,type,business_date) do nothing;
   end if;
  end loop;
 end loop;
 for o in select * from occurrences where enabled and deadline<=clock_timestamp() and submitted_at is null and missed_at is null for update skip locked loop
  if not exists(select 1 from reports where occurrence_id=o.id) then
   update occurrences set missed_at=clock_timestamp() where id=o.id;
   perform record_score(o,'missed');
  end if;
 end loop;
end$$;

-- Narrow grants: internal helpers are never callable as public RPCs.
revoke all on all tables in schema public from anon,authenticated;
grant select on all tables in schema public to authenticated;
revoke execute on function public.record_score(public.occurrences,text),public.validate_report(public.report_kind,jsonb,text),public.reconcile_reports() from public,anon,authenticated;
revoke execute on function public.configure_policy(jsonb),public.submit_report(uuid,jsonb),public.save_draft(uuid,jsonb),public.highlight_report(uuid,integer,text),public.is_admin(),public.has_scope(text) from public,anon;
grant execute on function public.configure_policy(jsonb),public.submit_report(uuid,jsonb),public.save_draft(uuid,jsonb),public.highlight_report(uuid,integer,text),public.is_admin(),public.has_scope(text) to authenticated;
grant execute on function public.reconcile_reports() to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('incident-evidence','incident-evidence',false,10485760,array['image/jpeg','image/png','application/pdf']) on conflict(id) do nothing;
-- Upload intentionally disabled pending evidence retention / authorised uploader policy.
create policy scoped_evidence_read on storage.objects for select to authenticated using(bucket_id='incident-evidence' and public.has_scope((storage.foldername(name))[1]));
