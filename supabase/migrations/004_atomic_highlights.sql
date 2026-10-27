-- A selected director point is committed with its source report, never in a
-- second browser request that could fail after the report is already accepted.
create function public.capture_report_highlights() returns trigger language plpgsql security definer set search_path=public as $$
declare rows jsonb; selected text; idx integer; note text;begin
 if new.type not in ('opening','closing') then return new;end if;
 select t.rows into rows from report_templates t where t.restaurant_id=new.restaurant_id and t.type=new.type order by version desc limit 1;
 for selected in select jsonb_array_elements_text(coalesce(new.data->'flags','[]')) loop
  if selected !~ '^[0-9]+$' then raise exception 'Invalid director highlight row';end if;
  idx:=selected::integer;
  if idx<0 or idx>=jsonb_array_length(rows) then raise exception 'Invalid director highlight row';end if;
  note:=trim(coalesce(new.data->'highlight_notes'->>idx::text,''));
  insert into highlights(report_id,restaurant_id,type,manager_id,manager_name,row_number,text) values(new.id,new.restaurant_id,new.type,new.manager_id,new.manager_name,idx,left((rows->>idx)||case when note='' then '' else ' — '||note end,2000)) on conflict(report_id,row_number) do nothing;
 end loop;
 return new;
end$$;
create trigger report_highlights after insert on public.reports for each row execute function public.capture_report_highlights();
revoke all on function public.capture_report_highlights() from public,anon,authenticated;
