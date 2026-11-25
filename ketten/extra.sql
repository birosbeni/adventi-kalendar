-- ============================================================
--  Kétszemélyes naptár – extra funkciók (válasz, zene, emlékkönyv)
--  CSAK a kétszemélyes Supabase projektben futtasd, a supabase.sql UTÁN.
--  (Ha később újra lefuttatod a supabase.sql-t, ezt is futtasd le utána.)
--  Többször is lefuttatható, nem töröl adatot.
-- ============================================================

-- Reakció / válasz egy kinyitott napra (a címzett írja)
create table if not exists public.reactions (
  person_id  int not null references public.people(id) on delete cascade,
  day        int not null check (day between 1 and 24),
  emoji      text,
  reply      text,
  updated_at timestamptz not null default now(),
  primary key (person_id, day)
);

-- Zene egy naphoz (az ajándékozó adja meg)
create table if not exists public.music (
  giver_id int not null references public.people(id) on delete cascade,
  day      int not null check (day between 1 and 24),
  url      text not null,
  primary key (giver_id, day)
);

alter table public.reactions enable row level security;
alter table public.music     enable row level security;
revoke all on public.reactions, public.music from anon, authenticated;

-- Egy nap akkor sem üres, ha csak zene van benne
create or replace function public._has_gift(p_recipient int, p_day int) returns boolean
language sql stable as $$
  select exists (
    select 1 from public.gifts g join public.people giver on giver.id = g.giver_id
     where giver.recipient_id = p_recipient and g.day = p_day
       and (coalesce(g.body, '') <> '' or g.image is not null))
  or exists (
    select 1 from public.music m join public.people giver on giver.id = m.giver_id
     where giver.recipient_id = p_recipient and m.day = p_day)
$$;

-- Válasz / reakció mentése (csak kinyitott napra)
create or replace function public.react(p_id int, p_pin text, p_day int, p_emoji text, p_reply text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people;
begin
  p := public._auth(p_id, p_pin);
  if p_day not between 1 and 24 then raise exception 'BAD_DAY'; end if;
  if not public._opened(p.id, p_day) then raise exception 'NOT_OPENED'; end if;
  if length(coalesce(p_emoji, '')) > 16 or length(coalesce(p_reply, '')) > 1000 then
    raise exception 'TEXT_TOO_LONG';
  end if;
  if coalesce(p_emoji, '') = '' and coalesce(btrim(p_reply), '') = '' then
    delete from public.reactions where person_id = p.id and day = p_day;
  else
    insert into public.reactions(person_id, day, emoji, reply, updated_at)
    values (p.id, p_day, nullif(p_emoji, ''), nullif(btrim(p_reply), ''), now())
    on conflict (person_id, day) do update
      set emoji = excluded.emoji, reply = excluded.reply, updated_at = now();
  end if;
end $$;

-- Zene mentése (amíg a címzett ki nem nyitotta). Üres link = törlés.
create or replace function public.save_music(p_id int, p_pin text, p_day int, p_url text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people;
begin
  p := public._auth(p_id, p_pin);
  if not p.drawn then raise exception 'NOT_DRAWN'; end if;
  if p_day not between 1 and 24 then raise exception 'BAD_DAY'; end if;
  if public._opened(p.recipient_id, p_day) then raise exception 'ALREADY_OPEN'; end if;
  if coalesce(btrim(p_url), '') = '' then
    delete from public.music where giver_id = p.id and day = p_day;
    return;
  end if;
  if btrim(p_url) !~ '^https://(open\.spotify\.com|(www\.|m\.|music\.)?youtube\.com|youtu\.be)/[^\s<>"]+$' or length(p_url) > 300 then
    raise exception 'BAD_MUSIC';
  end if;
  insert into public.music(giver_id, day, url) values (p.id, p_day, btrim(p_url))
  on conflict (giver_id, day) do update set url = excluded.url;
end $$;

-- Ajándékozói nézet: melyik napra adtam zenét, és mit reagált rá a másik
create or replace function public.extras_given(p_id int, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people;
begin
  p := public._auth(p_id, p_pin);
  if not p.drawn then raise exception 'NOT_DRAWN'; end if;
  return (
    select json_agg(json_build_object('day', d, 'music', m.url, 'emoji', r.emoji, 'reply', r.reply) order by d)
    from generate_series(1, 24) d
    left join public.music m on m.giver_id = p.id and m.day = d
    left join public.reactions r on r.person_id = p.recipient_id and r.day = d);
end $$;

-- Címzetti nézet egy kinyitott napra: zene + a saját válaszom
create or replace function public.extras_day(p_id int, p_pin text, p_day int) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people; v_url text; r public.reactions;
begin
  p := public._auth(p_id, p_pin);
  if not public._opened(p.id, p_day) then raise exception 'NOT_OPENED'; end if;
  select m.url into v_url from public.music m join public.people giver on giver.id = m.giver_id
   where giver.recipient_id = p.id and m.day = p_day;
  select * into r from public.reactions where person_id = p.id and day = p_day;
  return json_build_object('day', p_day, 'music', v_url, 'emoji', r.emoji, 'reply', r.reply);
end $$;

-- Emlékkönyv: minden kinyitott nap mindkét irányban
create or replace function public.memories(p_id int, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people; v_giver int;
begin
  p := public._auth(p_id, p_pin);
  select id into v_giver from public.people where recipient_id = p.id;
  return coalesce((
    select json_agg(x order by (x->>'day')::int) from (
      select json_build_object(
        'day', d,
        'received', case when public._opened(p.id, d) then json_build_object(
            'body', g1.body, 'image', g1.image, 'music', m1.url, 'emoji', r1.emoji, 'reply', r1.reply) end,
        'given', case when p.recipient_id is not null and public._opened(p.recipient_id, d) then json_build_object(
            'body', g2.body, 'image', g2.image, 'music', m2.url, 'emoji', r2.emoji, 'reply', r2.reply) end
      ) as x
      from generate_series(1, 24) d
      left join public.gifts g1     on g1.giver_id = v_giver and g1.day = d
      left join public.music m1     on m1.giver_id = v_giver and m1.day = d
      left join public.reactions r1 on r1.person_id = p.id and r1.day = d
      left join public.gifts g2     on g2.giver_id = p.id and g2.day = d
      left join public.music m2     on m2.giver_id = p.id and m2.day = d
      left join public.reactions r2 on r2.person_id = p.recipient_id and r2.day = d
      where public._opened(p.id, d) or (p.recipient_id is not null and public._opened(p.recipient_id, d))
    ) s), '[]'::json);
end $$;

revoke execute on function public.react(int, text, int, text, text), public.save_music(int, text, int, text),
  public.extras_given(int, text), public.extras_day(int, text, int), public.memories(int, text)
  from public, anon, authenticated;
grant execute on function public.react(int, text, int, text, text), public.save_music(int, text, int, text),
  public.extras_given(int, text), public.extras_day(int, text, int), public.memories(int, text)
  to anon, authenticated;
