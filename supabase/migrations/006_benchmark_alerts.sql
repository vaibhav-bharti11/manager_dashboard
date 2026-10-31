create table public.score_alerts(
 id uuid primary key default gen_random_uuid(),manager_id uuid not null references public.profiles,
 restaurant_id text not null references public.restaurants,cycle_id uuid not null references public.score_cycles,
 kind text not null check(kind in('below_benchmark','approaching_benchmark')),
 benchmark integer not null,points integer not null,next_deduction integer not null default 0,
 active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(manager_id,cycle_id,kind)
);
alter table public.score_alerts enable row level security;
create policy own_score_alerts on public.score_alerts for select to authenticated using(
 (manager_id=auth.uid()) or(kind='below_benchmark' and public.is_admin())
);
grant select on public.score_alerts to authenticated;

create function public.refresh_benchmark_alerts(p_restaurant text) returns void language plpgsql security definer set search_path=public as $$
declare m record;penalty integer;alert_kind text;begin
 update score_alerts set active=false,updated_at=clock_timestamp() where restaurant_id=p_restaurant and active;
 for m in select * from current_score_totals where restaurant_id=p_restaurant and minimum_benchmark is not null and current_cycle_id is not null loop
  select coalesce(max(missed_penalty),0) into penalty from policies where restaurant_id=p_restaurant and manager_id=m.manager_id and current and enabled;
  alert_kind:=case when m.points<m.minimum_benchmark then 'below_benchmark'
    when penalty>0 and greatest(0,m.points-penalty)<m.minimum_benchmark then 'approaching_benchmark' else null end;
  if alert_kind is not null then
   insert into score_alerts(manager_id,restaurant_id,cycle_id,kind,benchmark,points,next_deduction)
   values(m.manager_id,p_restaurant,m.current_cycle_id,alert_kind,m.minimum_benchmark,m.points,penalty)
   on conflict(manager_id,cycle_id,kind) do update set active=true,points=excluded.points,benchmark=excluded.benchmark,next_deduction=excluded.next_deduction,updated_at=clock_timestamp();
  end if;
 end loop;
end$$;
create function public.update_benchmark_alerts() returns trigger language plpgsql security definer set search_path=public as $$begin
 perform refresh_benchmark_alerts(new.restaurant_id);return new;
end$$;
create trigger score_alert_after_ledger after insert on public.score_ledger for each row execute function public.update_benchmark_alerts();
create trigger score_alert_after_settings after insert or update on public.score_settings for each row execute function public.update_benchmark_alerts();
create trigger score_alert_after_policy after insert or update on public.policies for each row execute function public.update_benchmark_alerts();
revoke all on function public.refresh_benchmark_alerts(text),public.update_benchmark_alerts() from public,anon,authenticated;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='score_alerts') then
  alter publication supabase_realtime add table public.score_alerts;
 end if;
end$$;
