-- TEMPORARY live-QA helpers. Install only for the owner's requested QA workflow,
-- run cleanup, then remove helpers. Never seed real business schedules.
create or replace function public.qa_prepare(p_run uuid,p_managers uuid[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare m profiles; k report_kind; pid uuid; oid uuid; v integer; d date:=(now() at time zone 'Asia/Kolkata')::date; w date; ids jsonb:='[]'; begin
 if cardinality(p_managers)<>4 or (select count(*) from profiles where id=any(p_managers) and role='manager' and email like 'qa-'||p_run::text||'-%@example.invalid')<>4 then raise exception 'Only the four temporary QA managers are allowed';end if;
 if exists(select 1 from occurrences where restaurant_id in(select restaurant_id from profiles where id=any(p_managers)) and not(manager_id=any(p_managers))) then raise exception 'Refusing to mix QA with existing restaurant reporting data';end if;
 w:=d-extract(dow from d)::integer;
 for m in select * from profiles where id=any(p_managers) order by restaurant_id loop
  insert into score_weeks(manager_id,restaurant_id,starts_on,baseline,timezone,reset_time) values(m.id,m.restaurant_id,w,100,'Asia/Kolkata','00:00') on conflict(manager_id,starts_on) do nothing;
  foreach k in array enum_range(null::report_kind) loop
   select coalesce(max(version),0)+1 into v from policies where restaurant_id=m.restaurant_id and type=k;
   insert into policies(restaurant_id,type,version,current,enabled,timezone,manager_id,reward,baseline,reset_time,approvals) values(m.restaurant_id,k,v,false,false,'Asia/Kolkata',m.id,10,100,'00:00','{"incident_rule":"daily_declaration","handover_rule":"previous_service_day"}') returning id into pid;
   insert into occurrences(restaurant_id,type,business_date,shift,manager_id,policy_id,policy_snapshot,opens_at,deadline)
   select m.restaurant_id,k,d,case when k='opening' then 'Morning' else 'Evening' end,m.id,pid,to_jsonb(p)||jsonb_build_object('__qa_run',p_run),clock_timestamp()-interval '30 minutes',clock_timestamp()+interval '4 hours' from policies p where p.id=pid returning id into oid;
   ids:=ids||jsonb_build_array(jsonb_build_object('manager_id',m.id,'restaurant_id',m.restaurant_id,'type',k,'occurrence_id',oid));
  end loop;
 end loop;
 return ids;
end$$;
create or replace function public.qa_summary(p_run uuid) returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object('managers',(select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'restaurant_id',p.restaurant_id,'reports',(select count(*) from reports r where r.manager_id=p.id),'score',100+coalesce((select sum(amount) from score_ledger l where l.manager_id=p.id),0),'ledger_entries',(select count(*) from score_ledger l where l.manager_id=p.id))) from profiles p where p.email like 'qa-'||p_run::text||'-%@example.invalid'),
'evidence',coalesce((select jsonb_agg(to_jsonb(e)) from evidence e join profiles p on p.id=e.uploaded_by where p.email like 'qa-'||p_run::text||'-%@example.invalid'),'[]'::jsonb),
'cron',(select jsonb_build_object('status',status,'message',return_message) from cron.job_run_details where jobid=(select jobid from cron.job where jobname='restaurant-report-reconciliation') order by start_time desc limit 1))
$$;
create or replace function public.qa_miss(p_run uuid,p_manager uuid) returns integer language plpgsql security definer set search_path=public as $$
declare m profiles; k report_kind; pid uuid;v integer;begin
 select * into m from profiles where id=p_manager and email like 'qa-'||p_run::text||'-%@example.invalid';if m.id is null then raise exception 'QA manager required';end if;
 foreach k in array array['opening','closing','incident']::report_kind[] loop
  select coalesce(max(version),0)+1 into v from policies where restaurant_id=m.restaurant_id and type=k;
  insert into policies(restaurant_id,type,version,current,enabled) values(m.restaurant_id,k,v,false,false) returning id into pid;
  insert into occurrences(restaurant_id,type,business_date,shift,manager_id,policy_id,policy_snapshot,opens_at,deadline) values(m.restaurant_id,k,(now() at time zone 'Asia/Kolkata')::date-2,'QA expired',m.id,pid,jsonb_build_object('__qa_run',p_run,'baseline',100,'reward',10,'timezone','Asia/Kolkata','reset_time','00:00'),clock_timestamp()-interval '2 days 2 hours',clock_timestamp()-interval '2 days 1 hour');
 end loop;
 perform reconcile_reports();perform reconcile_reports();
 return (select count(*) from score_ledger where manager_id=m.id and reason='missed');
end$$;
create or replace function public.qa_cleanup(p_run uuid) returns integer language plpgsql security definer set search_path=public as $$
declare ids uuid[]; n integer;begin
 select array_agg(id),count(*) into ids,n from profiles where email like 'qa-'||p_run::text||'-%@example.invalid';if ids is null then return 0;end if;
 delete from highlights where manager_id=any(ids);
 delete from incident_records where report_id in(select id from reports where manager_id=any(ids));
 delete from score_ledger where manager_id=any(ids);
 delete from evidence where uploaded_by=any(ids);
 delete from drafts where manager_id=any(ids);
 delete from reports where manager_id=any(ids);
 delete from audit_log where actor=any(ids) or after_value->>'employee_id'=any(ids::text[]);
 delete from occurrences where manager_id=any(ids) and policy_snapshot->>'__qa_run'=p_run::text;
 delete from score_weeks where manager_id=any(ids);
 delete from policies where manager_id=any(ids);
 delete from profiles where id=any(ids);
 return n;
end$$;
revoke all on function public.qa_prepare(uuid,uuid[]),public.qa_summary(uuid),public.qa_miss(uuid,uuid),public.qa_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.qa_prepare(uuid,uuid[]),public.qa_summary(uuid),public.qa_miss(uuid,uuid),public.qa_cleanup(uuid) to service_role;
