-- Advance cycles even when nobody submits at the reset boundary.
create or replace function public.reconcile_reports() returns void language plpgsql security definer set search_path=public as $$
declare p policies;s score_settings;d date;local_today date;start_at timestamptz;end_at timestamptz;o occurrences;begin
 -- Lock score settings in a stable order. Occurrence locks below skip busy submissions.
 for s in select * from score_settings where current_cycle_id is not null order by restaurant_id loop
  perform ensure_score_cycle(s.restaurant_id,clock_timestamp());
 end loop;
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

create or replace function public.refresh_benchmark_alerts(p_restaurant text) returns void language plpgsql security definer set search_path=public as $$
declare m record;penalty integer;alert_kind text;begin
 update score_alerts set active=false,updated_at=clock_timestamp() where restaurant_id=p_restaurant and active;
 for m in select * from current_score_totals where restaurant_id=p_restaurant and minimum_benchmark is not null and current_cycle_id is not null loop
  select coalesce(max(value),0) into penalty from (
   select missed_penalty as value from policies where restaurant_id=p_restaurant and manager_id=m.manager_id and current and enabled
   union all
   select coalesce((policy_snapshot->>'missed_penalty')::integer,20) from occurrences where restaurant_id=p_restaurant and manager_id=m.manager_id and enabled and submitted_at is null and missed_at is null and deadline>clock_timestamp()
  ) pending;
  alert_kind:=case when m.points<m.minimum_benchmark then 'below_benchmark'
    when penalty>0 and greatest(0,m.points-penalty)<m.minimum_benchmark then 'approaching_benchmark' else null end;
  if alert_kind is not null then
   insert into score_alerts(manager_id,restaurant_id,cycle_id,kind,benchmark,points,next_deduction)
   values(m.manager_id,p_restaurant,m.current_cycle_id,alert_kind,m.minimum_benchmark,m.points,penalty)
   on conflict(manager_id,cycle_id,kind) do update set active=true,points=excluded.points,benchmark=excluded.benchmark,next_deduction=excluded.next_deduction,updated_at=clock_timestamp();
  end if;
 end loop;
end$$;
