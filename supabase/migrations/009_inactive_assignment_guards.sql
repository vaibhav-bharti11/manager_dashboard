-- Guard inactive manager assignments across policy versions.
create function public.require_active_policy_manager() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.enabled and not exists(select 1 from profiles where id=new.manager_id and role='manager' and active and restaurant_id=new.restaurant_id) then raise exception 'Assign an active manager from this restaurant';end if;
 return new;
end$$;
create trigger active_manager_policy_guard before insert or update on public.policies for each row execute function public.require_active_policy_manager();
create function public.stop_deactivated_manager_schedules() returns trigger language plpgsql security definer set search_path=public as $$begin
 if old.active and not new.active then
  update policies set enabled=false where manager_id=new.id and enabled;
  update occurrences set enabled=false where manager_id=new.id and submitted_at is null and missed_at is null and deadline>clock_timestamp();
  update score_alerts set active=false where manager_id=new.id;
 end if;
 return new;
end$$;
create trigger stop_deactivated_manager after update of active on public.profiles for each row execute function public.stop_deactivated_manager_schedules();
revoke all on function public.require_active_policy_manager(),public.stop_deactivated_manager_schedules() from public,anon,authenticated;
update public.policies set enabled=false where enabled and manager_id in(select id from public.profiles where not active);
update public.occurrences set enabled=false where enabled and submitted_at is null and missed_at is null and deadline>clock_timestamp() and manager_id in(select id from public.profiles where not active);
