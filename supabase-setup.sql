create extension if not exists pgcrypto;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_date date not null,
  slot text not null check(slot in ('day','evening')),
  name text not null check(char_length(trim(name)) between 1 and 80),
  email text not null check(char_length(trim(email)) between 3 and 160),
  purpose text,
  series_id uuid,
  created_at timestamptz not null default now(),
  constraint one_booking_per_slot unique(booking_date,slot)
);

alter table public.bookings enable row level security;
revoke all on table public.bookings from anon, authenticated;

drop view if exists public.public_bookings;
create view public.public_bookings with (security_invoker=false) as
select id,booking_date,slot,name,purpose,series_id,created_at
from public.bookings;

revoke all on table public.public_bookings from anon, authenticated;
grant select on table public.public_bookings to anon, authenticated;

create or replace function public.create_booking_series(
  p_name text,
  p_email text,
  p_purpose text,
  p_start_date date,
  p_slot text,
  p_repeat_weekly boolean default false,
  p_end_date date default null
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  d date;
  final_date date;
  sid uuid:=gen_random_uuid();
  count_added integer:=0;
begin
  if trim(coalesce(p_name,''))='' then raise exception 'Name is required'; end if;
  if trim(coalesce(p_email,''))='' then raise exception 'Email is required'; end if;
  if p_slot not in ('day','evening','full_day') then raise exception 'Invalid slot'; end if;
  if p_start_date<current_date then raise exception 'Bookings cannot start in the past'; end if;

  final_date:=case when p_repeat_weekly then coalesce(p_end_date,p_start_date) else p_start_date end;
  if final_date<p_start_date then raise exception 'End date must be on or after the start date'; end if;
  if final_date>p_start_date+interval '2 years' then raise exception 'Recurring bookings can run for at most 2 years'; end if;

  d:=p_start_date;
  while d<=final_date loop
    if p_slot='full_day' then
      if exists(select 1 from public.bookings b where b.booking_date=d and b.slot in ('day','evening')) then
        raise exception 'The full day on % is not available because at least one slot is already booked',to_char(d,'DD Mon YYYY');
      end if;
    else
      if exists(select 1 from public.bookings b where b.booking_date=d and b.slot=p_slot) then
        raise exception 'The % slot on % is already booked',p_slot,to_char(d,'DD Mon YYYY');
      end if;
    end if;
    exit when not p_repeat_weekly;
    d:=d+7;
  end loop;

  d:=p_start_date;
  while d<=final_date loop
    if p_slot='full_day' then
      insert into public.bookings(booking_date,slot,name,email,purpose,series_id)
      values
        (d,'day',trim(p_name),trim(p_email),nullif(trim(coalesce(p_purpose,'')),''),sid),
        (d,'evening',trim(p_name),trim(p_email),nullif(trim(coalesce(p_purpose,'')),''),sid);
    else
      insert into public.bookings(booking_date,slot,name,email,purpose,series_id)
      values(d,p_slot,trim(p_name),trim(p_email),nullif(trim(coalesce(p_purpose,'')),''),case when p_repeat_weekly then sid else null end);
    end if;
    count_added:=count_added+1;
    exit when not p_repeat_weekly;
    d:=d+7;
  end loop;

  return count_added;
end;
$$;

revoke all on function public.create_booking_series(text,text,text,date,text,boolean,date) from public;
grant execute on function public.create_booking_series(text,text,text,date,text,boolean,date) to anon, authenticated;

create or replace function public.edit_booking(
  p_booking_id uuid,
  p_email text,
  p_new_name text,
  p_new_purpose text,
  p_new_date date,
  p_new_slot text
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  target public.bookings%rowtype;
  target_ids uuid[];
  pair_count integer:=0;
  stored_email text;
  new_sid uuid;
begin
  select * into target from public.bookings where id=p_booking_id;
  if not found then raise exception 'Booking not found'; end if;

  if lower(trim(coalesce(p_email,''))) <> lower(trim(target.email)) then
    raise exception 'Email does not match this booking';
  end if;

  if trim(coalesce(p_new_name,''))='' then raise exception 'Name is required'; end if;
  if p_new_slot not in ('day','evening','full_day') then raise exception 'Invalid booking type'; end if;
  if p_new_date<current_date then raise exception 'Bookings cannot be moved into the past'; end if;

  stored_email:=target.email;
  target_ids:=array[target.id];

  if target.series_id is not null then
    select count(*), array_agg(id)
      into pair_count, target_ids
    from public.bookings
    where booking_date=target.booking_date
      and series_id=target.series_id
      and slot in ('day','evening');

    if pair_count<>2 then
      target_ids:=array[target.id];
    end if;
  end if;

  if p_new_slot='full_day' then
    if exists(
      select 1 from public.bookings b
      where b.booking_date=p_new_date
        and b.slot in ('day','evening')
        and not (b.id=any(target_ids))
    ) then
      raise exception 'That full day is not available';
    end if;
  else
    if exists(
      select 1 from public.bookings b
      where b.booking_date=p_new_date
        and b.slot=p_new_slot
        and not (b.id=any(target_ids))
    ) then
      raise exception 'That slot is already booked';
    end if;
  end if;

  delete from public.bookings where id=any(target_ids);

  if p_new_slot='full_day' then
    new_sid:=gen_random_uuid();
    insert into public.bookings(booking_date,slot,name,email,purpose,series_id)
    values
      (p_new_date,'day',trim(p_new_name),stored_email,nullif(trim(coalesce(p_new_purpose,'')),''),new_sid),
      (p_new_date,'evening',trim(p_new_name),stored_email,nullif(trim(coalesce(p_new_purpose,'')),''),new_sid);
  else
    insert into public.bookings(booking_date,slot,name,email,purpose,series_id)
    values(p_new_date,p_new_slot,trim(p_new_name),stored_email,nullif(trim(coalesce(p_new_purpose,'')),''),null);
  end if;

  return 1;
end;
$$;

revoke all on function public.edit_booking(uuid,text,text,text,date,text) from public;
grant execute on function public.edit_booking(uuid,text,text,text,date,text) to anon, authenticated;
