alter table public.profiles add column active boolean not null default true;
alter table public.profiles add column phone text unique check(phone ~ '^\+[1-9][0-9]{7,14}$');
alter table public.profiles add column pin_ready boolean not null default false;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and role='admin' and active)$$;
create or replace function public.has_scope(r text) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and active and(role='admin' or restaurant_id=r))$$;
drop policy own_score_alerts on public.score_alerts;
create policy own_score_alerts on public.score_alerts for select to authenticated using(public.has_scope(restaurant_id) and(manager_id=auth.uid() or(kind='below_benchmark' and public.is_admin())));
create or replace view public.current_score_totals with(security_invoker=true) as
 select p.id as manager_id,p.restaurant_id,s.minimum_benchmark,s.current_cycle_id,
 greatest(0,coalesce(sum(l.amount) filter(where c.ends_at>clock_timestamp()),0))::integer as points
 from public.profiles p left join public.score_settings s on s.restaurant_id=p.restaurant_id
 left join public.score_cycles c on c.id=s.current_cycle_id
 left join public.score_ledger l on l.cycle_id=c.id and l.manager_id=p.id
 where p.role='manager' and p.active group by p.id,p.restaurant_id,s.minimum_benchmark,s.current_cycle_id;

create table public.private_pin_credentials(
 user_id uuid primary key references public.profiles,phone text not null unique,
 pin_hash text check(pin_hash ~ '^[0-9a-f]{64}$'),pin_salt text,
 activation_hash text,activation_expires_at timestamptz,updated_at timestamptz not null default now()
);
create table public.private_auth_attempts(key text primary key,window_start timestamptz not null,attempts integer not null);
alter table public.private_pin_credentials enable row level security;
alter table public.private_auth_attempts enable row level security;
revoke all on public.private_pin_credentials,public.private_auth_attempts from anon,authenticated;
grant select,insert,update,delete on public.private_pin_credentials,public.private_auth_attempts to service_role;

create function public.claim_auth_attempt(p_key text,p_limit integer) returns boolean language plpgsql security definer set search_path=public as $$
declare stamp timestamptz:=to_timestamp(floor(extract(epoch from clock_timestamp())/900)*900);n integer;begin
 if length(p_key)>100 or p_limit<1 or p_limit>100 then raise exception 'Invalid authentication request';end if;
 insert into private_auth_attempts(key,window_start,attempts) values(p_key,stamp,1)
 on conflict(key) do update set window_start=excluded.window_start,attempts=case when private_auth_attempts.window_start=excluded.window_start then private_auth_attempts.attempts+1 else 1 end returning attempts into n;
 return n<=p_limit;
end$$;

create function public.issue_phone_setup(p_actor uuid,p_user uuid,p_phone text,p_hash text) returns void language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active) then raise exception 'Administrator access required';end if;
 perform 1 from profiles where id=p_user and active for update;
 if not found then raise exception 'Active account required';end if;
 if exists(select 1 from private_pin_credentials where user_id=p_user and pin_hash is not null) then raise exception 'PIN is already set; only the person can change it inside their dashboard';end if;
 if p_phone !~ '^\+[1-9][0-9]{7,14}$' or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid setup details';end if;
 update profiles set phone=p_phone where id=p_user;
 insert into private_pin_credentials(user_id,phone,activation_hash,activation_expires_at) values(p_user,p_phone,p_hash,clock_timestamp()+interval '24 hours')
 on conflict(user_id) do update set phone=excluded.phone,activation_hash=excluded.activation_hash,activation_expires_at=excluded.activation_expires_at,updated_at=clock_timestamp();
 insert into audit_log(actor,action,restaurant_id,after_value) select p_actor,'issue_phone_setup',restaurant_id,jsonb_build_object('employee_id',p_user) from profiles where id=p_user;
end$$;
create function public.provision_phone_employee(p_actor uuid,p_user uuid,p_name text,p_email text,p_restaurant text,p_phone text,p_hash text) returns void language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from profiles where id=p_actor and role='admin' and active) then raise exception 'Administrator access required';end if;
 if length(trim(p_name))<2 or length(trim(p_name))>120 then raise exception 'Enter the employee name';end if;
 insert into profiles(id,name,email,role,restaurant_id) values(p_user,trim(p_name),p_email,'manager',p_restaurant);
 perform issue_phone_setup(p_actor,p_user,p_phone,p_hash);
 insert into audit_log(actor,action,restaurant_id,after_value) values(p_actor,'create_phone_employee',p_restaurant,jsonb_build_object('employee_id',p_user));
end$$;
create function public.consume_phone_setup(p_user uuid,p_code_hash text,p_pin_hash text,p_salt text) returns void language plpgsql security definer set search_path=public as $$
declare c private_pin_credentials;begin
 select * into c from private_pin_credentials where user_id=p_user for update;
 if c.user_id is null or c.pin_hash is not null or c.activation_hash is distinct from p_code_hash or c.activation_expires_at<=clock_timestamp() or not exists(select 1 from profiles where id=p_user and active) then raise exception 'Invalid or expired activation code';end if;
 if p_pin_hash !~ '^[0-9a-f]{64}$' or length(p_salt)<32 or length(p_salt)>128 then raise exception 'Invalid PIN setup';end if;
 update private_pin_credentials set pin_hash=p_pin_hash,pin_salt=p_salt,activation_hash=null,activation_expires_at=null,updated_at=clock_timestamp() where user_id=p_user;
 update profiles set pin_ready=true where id=p_user;
 insert into audit_log(actor,action,after_value) values(p_user,'set_initial_pin',jsonb_build_object('employee_id',p_user));
end$$;
create function public.change_phone_pin(p_user uuid,p_previous_hash text,p_new_hash text,p_salt text) returns void language plpgsql security definer set search_path=public as $$begin
 if p_new_hash !~ '^[0-9a-f]{64}$' or length(p_salt)<32 or length(p_salt)>128 or not exists(select 1 from profiles where id=p_user and active) then raise exception 'Invalid PIN change';end if;
 update private_pin_credentials set pin_hash=p_new_hash,pin_salt=p_salt,updated_at=clock_timestamp() where user_id=p_user and pin_hash=p_previous_hash;
 if not found then raise exception 'PIN changed; please try again';end if;
 insert into audit_log(actor,action,after_value) values(p_user,'change_pin',jsonb_build_object('employee_id',p_user));
end$$;

create function public.set_account_active(p_user uuid,p_active boolean) returns void language plpgsql security definer set search_path=public as $$
declare target profiles;begin
 if not is_admin() then raise exception 'Administrator access required';end if;
 if p_user=auth.uid() then raise exception 'You cannot deactivate your own account';end if;
 if p_active is null then raise exception 'Choose the account status';end if;
 perform pg_advisory_xact_lock(hashtextextended('account-status',0));
 select * into target from profiles where id=p_user for update;
 if target.id is null then raise exception 'Account unavailable';end if;
 if not p_active and target.role='admin' and (select count(*) from profiles where role='admin' and active)<=1 then raise exception 'At least one active administrator is required';end if;
 update profiles set active=p_active where id=p_user;
 if not p_active then
  update policies set enabled=false where manager_id=p_user and current;
  update occurrences set enabled=false where manager_id=p_user and submitted_at is null and missed_at is null and deadline>clock_timestamp();
  update score_alerts set active=false where manager_id=p_user;
 end if;
 insert into audit_log(actor,action,restaurant_id,after_value) values(auth.uid(),case when p_active then 'reactivate_account' else 'deactivate_account' end,target.restaurant_id,jsonb_build_object('employee_id',p_user,'history_preserved',true));
end$$;

alter function public.submit_report(uuid,jsonb) rename to submit_report_internal;
revoke all on function public.submit_report_internal(uuid,jsonb) from public,anon,authenticated;
create function public.submit_report(p_occurrence uuid,p_data jsonb) returns public.reports language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from profiles where id=auth.uid() and active) then raise exception 'Account deactivated';end if;
 return submit_report_internal(p_occurrence,p_data);
end$$;
alter function public.highlight_report(uuid,integer,text) rename to highlight_report_internal;
revoke all on function public.highlight_report_internal(uuid,integer,text) from public,anon,authenticated;
create function public.highlight_report(p_report uuid,p_row integer,p_text text) returns void language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from profiles where id=auth.uid() and active) then raise exception 'Account deactivated';end if;
 perform highlight_report_internal(p_report,p_row,p_text);
end$$;
alter function public.register_evidence(uuid,uuid,text,text,text,bigint,text) rename to register_evidence_internal;
revoke all on function public.register_evidence_internal(uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated,service_role;
create function public.register_evidence(p_actor uuid,p_occurrence uuid,p_path text,p_name text,p_mime text,p_size bigint,p_sha256 text) returns uuid language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from profiles where id=p_actor and active) then raise exception 'Account deactivated';end if;
 return register_evidence_internal(p_actor,p_occurrence,p_path,p_name,p_mime,p_size,p_sha256);
end$$;
revoke all on function public.claim_auth_attempt(text,integer),public.issue_phone_setup(uuid,uuid,text,text),public.provision_phone_employee(uuid,uuid,text,text,text,text,text),public.consume_phone_setup(uuid,text,text,text),public.change_phone_pin(uuid,text,text,text),public.set_account_active(uuid,boolean),public.submit_report(uuid,jsonb),public.highlight_report(uuid,integer,text),public.register_evidence(uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.claim_auth_attempt(text,integer),public.issue_phone_setup(uuid,uuid,text,text),public.provision_phone_employee(uuid,uuid,text,text,text,text,text),public.consume_phone_setup(uuid,text,text,text),public.change_phone_pin(uuid,text,text,text),public.register_evidence(uuid,uuid,text,text,text,bigint,text) to service_role;
grant execute on function public.set_account_active(uuid,boolean),public.submit_report(uuid,jsonb),public.highlight_report(uuid,integer,text) to authenticated;
