alter table public.profiles add column if not exists email text;
create or replace function public.register_employee(p_id uuid,p_name text,p_email text,p_restaurant text,p_actor uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from profiles where id=p_actor and role='admin') then raise exception 'Administrator access required';end if;
 if not exists(select 1 from restaurants where id=p_restaurant) then raise exception 'Unknown restaurant';end if;
 if length(trim(p_name))<2 then raise exception 'Employee name required';end if;
 insert into profiles(id,name,email,role,restaurant_id) values(p_id,trim(p_name),lower(trim(p_email)),'manager',p_restaurant);
 insert into audit_log(actor,action,restaurant_id,after_value) values(p_actor,'create_employee',p_restaurant,jsonb_build_object('employee_id',p_id,'name',trim(p_name),'role','manager'));
end$$;
revoke all on function public.register_employee(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.register_employee(uuid,text,text,text,uuid) to service_role;
-- The project disables automatic table grants. The backend needs only these.
grant select,insert on public.profiles to service_role;
grant select on public.restaurants to service_role;
