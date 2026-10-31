-- Reports/ledger history are retained. No account, report or score history is deleted.
alter table public.policies add column missed_penalty integer not null default 20 check(missed_penalty>=0);
alter table public.policies add column daily_required_from date not null default ((now() at time zone 'Asia/Kolkata')::date);
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.policies'::regclass and contype='c' and pg_get_constraintdef(oid) like '%reset_time%' loop
  execute format('alter table public.policies drop constraint %I',c.conname);
 end loop;
end$$;
alter table public.policies add constraint enabled_daily_policy_fields check(not enabled or(start_time is not null and end_time is not null and start_time<>end_time and timezone is not null and manager_id is not null and reward is not null and effective_from is not null));

create table public.score_cycles(
 id uuid primary key default gen_random_uuid(),restaurant_id text not null references public.restaurants,
 starts_at timestamptz not null,ends_at timestamptz not null,manual boolean not null default false,
 created_at timestamptz not null default now(),check(ends_at>starts_at),unique(restaurant_id,starts_at)
);
create table public.score_settings(
 restaurant_id text primary key references public.restaurants,reset_every_days integer not null check(reset_every_days>0),
 minimum_benchmark integer check(minimum_benchmark>=0),current_cycle_id uuid references public.score_cycles,
 updated_at timestamptz not null default now()
);
alter table public.score_ledger alter column week_id drop not null;
alter table public.score_ledger add column cycle_id uuid references public.score_cycles;
alter table public.score_ledger drop constraint score_ledger_check;
alter table public.score_ledger add constraint score_ledger_amount_direction check((reason='missed' and amount<=0)or(reason='submitted' and amount>=0));
create index score_cycle_manager on public.score_ledger(cycle_id,manager_id);
alter table public.score_cycles enable row level security;
alter table public.score_settings enable row level security;
create policy scoped_read on public.score_cycles for select to authenticated using(public.has_scope(restaurant_id));
create policy scoped_read on public.score_settings for select to authenticated using(public.has_scope(restaurant_id));
grant select on public.score_cycles,public.score_settings to authenticated;

create view public.current_score_totals with(security_invoker=true) as
 select p.id as manager_id,p.restaurant_id,s.minimum_benchmark,s.current_cycle_id,
 greatest(0,coalesce(sum(l.amount) filter(where c.ends_at>clock_timestamp()),0))::integer as points
 from public.profiles p left join public.score_settings s on s.restaurant_id=p.restaurant_id
 left join public.score_cycles c on c.id=s.current_cycle_id
 left join public.score_ledger l on l.cycle_id=c.id and l.manager_id=p.id
 where p.role='manager' group by p.id,p.restaurant_id,s.minimum_benchmark,s.current_cycle_id;
grant select on public.current_score_totals to authenticated;

create function public.configure_scoring(p_restaurant text,p_days integer,p_benchmark integer default null) returns void
 language plpgsql security definer set search_path=public as $$begin
 if not is_admin() then raise exception 'Administrator access required';end if;
 if p_days is null or p_days<1 or p_benchmark<0 then raise exception 'Use a positive reset interval and a nonnegative benchmark';end if;
 insert into score_settings(restaurant_id,reset_every_days,minimum_benchmark) values(p_restaurant,p_days,p_benchmark)
 on conflict(restaurant_id) do update set reset_every_days=excluded.reset_every_days,minimum_benchmark=excluded.minimum_benchmark,updated_at=clock_timestamp();
 insert into audit_log(actor,action,restaurant_id,after_value) values(auth.uid(),'configure_scoring',p_restaurant,jsonb_build_object('reset_every_days',p_days,'minimum_benchmark',p_benchmark));
end$$;

create function public.ensure_score_cycle(p_restaurant text,p_at timestamptz) returns uuid
 language plpgsql security definer set search_path=public as $$
declare s score_settings;c score_cycles;start_at timestamptz;cid uuid;begin
 select * into s from score_settings where restaurant_id=p_restaurant for update;
 if s.current_cycle_id is null then return null;end if;
 select * into c from score_cycles where id=s.current_cycle_id;
 if p_at<c.ends_at then return c.id;end if;
 start_at:=c.ends_at+floor(extract(epoch from(p_at-c.ends_at))/(s.reset_every_days::numeric*86400))*s.reset_every_days*interval '1 day';
 insert into score_cycles(restaurant_id,starts_at,ends_at) values(p_restaurant,start_at,start_at+s.reset_every_days*interval '1 day') returning id into cid;
 update score_settings set current_cycle_id=cid,updated_at=clock_timestamp() where restaurant_id=p_restaurant;
 insert into audit_log(action,restaurant_id,after_value) values('automatic_points_reset',p_restaurant,jsonb_build_object('cycle_id',cid));
 return cid;
end$$;

create function public.reset_points(p_restaurant text) returns uuid language plpgsql security definer set search_path=public as $$
declare s score_settings;stamp timestamptz:=clock_timestamp();cid uuid;begin
 if not is_admin() then raise exception 'Administrator access required';end if;
 select * into s from score_settings where restaurant_id=p_restaurant for update;
 if s.restaurant_id is null then raise exception 'Save the reset interval first';end if;
 if s.current_cycle_id is not null then
  update score_cycles set ends_at=greatest(starts_at+interval '1 microsecond',least(ends_at,stamp)) where id=s.current_cycle_id;
 end if;
 insert into score_cycles(restaurant_id,starts_at,ends_at,manual) values(p_restaurant,stamp,stamp+s.reset_every_days*interval '1 day',true) returning id into cid;
 update score_settings set current_cycle_id=cid,updated_at=stamp where restaurant_id=p_restaurant;
 insert into audit_log(actor,action,restaurant_id,after_value) values(auth.uid(),'manual_points_reset',p_restaurant,jsonb_build_object('cycle_id',cid,'starting_score',0));
 return cid;
end$$;

create or replace function public.record_score(o public.occurrences,why text) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid;balance integer;delta integer;begin
 if why not in('submitted','missed') then raise exception 'Invalid score reason';end if;
 cid:=ensure_score_cycle(o.restaurant_id,clock_timestamp());
 if exists(select 1 from score_ledger where occurrence_id=o.id) then return;end if;
 if cid is null then delta:=0;
 elsif why='submitted' then delta:=coalesce((o.policy_snapshot->>'reward')::integer,0);
 else
  select greatest(0,coalesce(sum(amount),0)) into balance from score_ledger where cycle_id=cid and manager_id=o.manager_id;
  delta:=-least(balance,coalesce((o.policy_snapshot->>'missed_penalty')::integer,20));
 end if;
 insert into score_ledger(occurrence_id,restaurant_id,manager_id,cycle_id,policy_id,business_date,reason,amount)
 values(o.id,o.restaurant_id,o.manager_id,cid,o.policy_id,o.business_date,why,delta) on conflict(occurrence_id) do nothing;
end$$;

create or replace function public.configure_policy(p_policy jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare previous policies;next_id uuid;v integer;r text:=p_policy->>'restaurant_id';k report_kind:=(p_policy->>'type')::report_kind;
 a jsonb:=coalesce(p_policy->'approvals','{}');activate boolean:=coalesce((p_policy->>'enabled')::boolean,false);penalty integer:=(p_policy->>'missed_penalty')::integer;begin
 if not is_admin() then raise exception 'Administrator access required';end if;
 perform pg_advisory_xact_lock(hashtextextended(r||k::text,0));
 select * into previous from policies where restaurant_id=r and type=k and current for update;
 if (p_policy->>'effective_from')::date<(now() at time zone coalesce(p_policy->>'timezone','Asia/Kolkata'))::date+1 then raise exception 'Policy changes must take effect on a future service day';end if;
 if not exists(select 1 from pg_timezone_names where name=p_policy->>'timezone') then raise exception 'Invalid timezone';end if;
 if penalty is null or penalty<0 then raise exception 'Enter the missed report deduction (zero or more)';end if;
 if activate then
  if exists(select 1 from unnest(array['calendar','points','reset','responsibility','incident','handover','director','retention']) x where coalesce((a->>x)::boolean,false) is not true) then raise exception 'Confirm all reporting rules before activation';end if;
  if not exists(select 1 from profiles where id=(p_policy->>'manager_id')::uuid and restaurant_id=r and role='manager') then raise exception 'Assign a manager from this restaurant';end if;
  if not exists(select 1 from score_settings where restaurant_id=r and current_cycle_id is not null) then raise exception 'Start the restaurant points cycle first';end if;
  if k='incident' and p_policy->>'incident_rule' is distinct from 'daily_declaration' then raise exception 'Confirm daily incident reporting, including days with no incidents';end if;
 end if;
 v:=coalesce(previous.version,0)+1;
 update policies set current=false where id=previous.id;
 insert into policies(restaurant_id,type,version,enabled,start_time,end_time,timezone,manager_id,reward,missed_penalty,effective_from,operating_days,closed_dates,approvals,created_by)
 values(r,k,v,activate,(p_policy->>'start_time')::time,(p_policy->>'end_time')::time,p_policy->>'timezone',nullif(p_policy->>'manager_id','')::uuid,(p_policy->>'reward')::integer,penalty,(p_policy->>'effective_from')::date,array[0,1,2,3,4,5,6],array[]::date[],a||jsonb_build_object('incident_rule',p_policy->>'incident_rule','handover_rule',p_policy->>'handover_rule'),auth.uid()) returning id into next_id;
 insert into audit_log(actor,action,restaurant_id,before_value,after_value) select auth.uid(),'configure_policy',r,to_jsonb(previous),to_jsonb(p) from policies p where id=next_id;
 return next_id;
end$$;

create or replace function public.reconcile_reports() returns void language plpgsql security definer set search_path=public as $$
declare p policies;d date;local_today date;start_at timestamptz;end_at timestamptz;o occurrences;begin
 for p in select * from policies where enabled loop
  local_today:=(now() at time zone p.timezone)::date;
  for d in select generate_series(greatest(p.effective_from,least(coalesce((select max(business_date)+1 from occurrences where policy_id=p.id),p.effective_from),p.daily_required_from)),local_today+1,interval '1 day')::date loop
   if (d>=p.daily_required_from or(extract(dow from d)::integer=any(p.operating_days) and not(d=any(p.closed_dates)))) and not exists(select 1 from policies newer where newer.restaurant_id=p.restaurant_id and newer.type=p.type and newer.version>p.version and newer.effective_from<=d) then
    start_at:=(d+p.start_time) at time zone p.timezone;
    end_at:=((d+case when p.end_time<=p.start_time then 1 else 0 end)+p.end_time) at time zone p.timezone;
    insert into occurrences(restaurant_id,type,business_date,shift,manager_id,policy_id,policy_snapshot,opens_at,deadline) values(p.restaurant_id,p.type,d,case when p.type='opening' then 'Morning' else 'Evening' end,p.manager_id,p.id,to_jsonb(p),start_at,end_at) on conflict(restaurant_id,type,business_date) do nothing;
   end if;
  end loop;
 end loop;
 for o in select * from occurrences where enabled and deadline<=clock_timestamp() and submitted_at is null and missed_at is null order by deadline,id for update skip locked loop
  if not exists(select 1 from reports where occurrence_id=o.id) then
   update occurrences set missed_at=clock_timestamp() where id=o.id;perform record_score(o,'missed');
  end if;
 end loop;
end$$;
revoke all on function public.configure_scoring(text,integer,integer),public.reset_points(text),public.ensure_score_cycle(text,timestamptz) from public,anon,authenticated;
grant execute on function public.configure_scoring(text,integer,integer),public.reset_points(text) to authenticated;
