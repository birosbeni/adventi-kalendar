-- ============================================================
--  Adventi kalendár – Supabase adatbázis
--  Másold be az egészet a Supabase "SQL Editor"-ába és futtasd (Run).
--  Többször is lefuttatható, nem töröl adatot.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Táblák ----------
create table if not exists public.people (
  id           serial primary key,
  name         text not null unique,
  pin_hash     text,
  recipient_id int references public.people(id),
  drawn        boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.gifts (
  giver_id   int not null references public.people(id) on delete cascade,
  day        int not null check (day between 1 and 24),
  body       text,
  image      text,
  updated_at timestamptz not null default now(),
  primary key (giver_id, day)
);

create table if not exists public.opens (
  person_id int not null references public.people(id) on delete cascade,
  day       int not null check (day between 1 and 24),
  opened_at timestamptz not null default now(),
  primary key (person_id, day)
);

-- Közvetlen hozzáférés tiltva: minden csak a lenti függvényeken keresztül megy.
alter table public.people enable row level security;
alter table public.gifts  enable row level security;
alter table public.opens  enable row level security;
revoke all on public.people, public.gifts, public.opens from anon, authenticated;

-- ---------- Belső segédfüggvények ----------
-- Az advent éve. Ha jövőre is használnátok, csak ezt írd át.
create or replace function public._advent_year() returns int
language sql immutable as $$ select 2026 $$;

create or replace function public._today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Budapest')::date $$;

create or replace function public._unlocked(p_day int) returns boolean
language sql stable as $$
  select public._today() >= make_date(public._advent_year(), 12, p_day)
$$;

create or replace function public._auth(p_id int, p_pin text) returns public.people
language plpgsql stable security definer set search_path = public, extensions as $$
declare p public.people;
begin
  select * into p from public.people where id = p_id;
  if not found then raise exception 'NO_PERSON'; end if;
  if p.pin_hash is null then raise exception 'NO_PIN'; end if;
  if p.pin_hash <> crypt(coalesce(p_pin, ''), p.pin_hash) then raise exception 'BAD_PIN'; end if;
  return p;
end $$;

-- ---------- Nyilvános függvények (RPC) ----------

-- Kik vannak benne (a bejelentkező képernyőhöz)
create or replace function public.list_people()
returns table (id int, name text, has_pin boolean)
language sql stable security definer set search_path = public as $$
  select id, name, pin_hash is not null from public.people order by id
$$;

-- Első indítás: a nevek felvétele (csak amíg üres a tábla)
create or replace function public.setup(p_names text[]) returns void
language plpgsql security definer set search_path = public as $$
declare n text; cleaned text[] := '{}';
begin
  lock table public.people in exclusive mode;
  if exists (select 1 from public.people) then raise exception 'ALREADY_SETUP'; end if;
  foreach n in array p_names loop
    n := btrim(n);
    if n <> '' then cleaned := cleaned || left(n, 40); end if;
  end loop;
  if array_length(cleaned, 1) is null or array_length(cleaned, 1) < 2 then
    raise exception 'NEED_2_NAMES';
  end if;
  if (select count(distinct lower(x)) from unnest(cleaned) x) <> array_length(cleaned, 1) then
    raise exception 'DUPLICATE_NAME';
  end if;
  insert into public.people(name) select unnest(cleaned);
end $$;

-- Belépés. Ha még nincs PIN-je az illetőnek, ezzel állítja be.
create or replace function public.login(p_id int, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people; r text;
begin
  select * into p from public.people where id = p_id for update;
  if not found then raise exception 'NO_PERSON'; end if;
  if p.pin_hash is null then
    if p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN_FORMAT'; end if;
    update public.people set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_id;
  else
    p := public._auth(p_id, p_pin);
  end if;
  if p.drawn then select name into r from public.people where id = p.recipient_id; end if;
  return json_build_object('id', p.id, 'name', p.name, 'drawn', p.drawn,
                           'recipient', r, 'today', public._today(),
                           'year', public._advent_year());
end $$;

-- Sorsolás. Az első húzáskor mindenkinek egyszerre kisorsol valakit (egy nagy kör,
-- így senki nem húzza saját magát), utána mindenki csak "felfedi" a sajátját.
create or replace function public.draw(p_id int, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people; ids int[]; n int; i int; r text;
begin
  p := public._auth(p_id, p_pin);
  lock table public.people in exclusive mode;
  if exists (select 1 from public.people where recipient_id is null) then
    select array_agg(id order by random()) into ids from public.people;
    n := array_length(ids, 1);
    for i in 1..n loop
      update public.people set recipient_id = ids[(i % n) + 1] where id = ids[i];
    end loop;
  end if;
  update public.people set drawn = true where id = p_id;
  select r2.name into r from public.people me join public.people r2 on r2.id = me.recipient_id
   where me.id = p_id;
  return json_build_object('recipient', r);
end $$;

-- A saját naptáram: melyik nap nyitható, van-e benne valami, kinyitottam-e már
create or replace function public.my_calendar(p_id int, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people;
begin
  p := public._auth(p_id, p_pin);
  return json_build_object(
    'today', public._today(),
    'days', (
      select json_agg(json_build_object(
        'day', d,
        'unlocked', public._unlocked(d),
        'has_gift', exists (
          select 1 from public.gifts g join public.people giver on giver.id = g.giver_id
           where giver.recipient_id = p.id and g.day = d
             and (coalesce(g.body, '') <> '' or g.image is not null)),
        'opened', exists (select 1 from public.opens o where o.person_id = p.id and o.day = d)
      ) order by d)
      from generate_series(1, 24) d));
end $$;

-- Egy nap kinyitása (csak ha már eljött a napja)
create or replace function public.open_day(p_id int, p_pin text, p_day int) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people; g public.gifts;
begin
  p := public._auth(p_id, p_pin);
  if p_day not between 1 and 24 then raise exception 'BAD_DAY'; end if;
  if not public._unlocked(p_day) then raise exception 'LOCKED'; end if;
  insert into public.opens(person_id, day) values (p.id, p_day) on conflict do nothing;
  select g2.* into g from public.gifts g2 join public.people giver on giver.id = g2.giver_id
   where giver.recipient_id = p.id and g2.day = p_day;
  return json_build_object('day', p_day, 'body', g.body, 'image', g.image);
end $$;

-- Amit én töltök a sorsolt embernek: áttekintés
create or replace function public.given_list(p_id int, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people;
begin
  p := public._auth(p_id, p_pin);
  if not p.drawn then raise exception 'NOT_DRAWN'; end if;
  return (
    select json_agg(json_build_object(
      'day', d,
      'locked', public._unlocked(d),
      'has_text', coalesce(g.body, '') <> '',
      'has_image', g.image is not null) order by d)
    from generate_series(1, 24) d
    left join public.gifts g on g.giver_id = p.id and g.day = d);
end $$;

create or replace function public.given_day(p_id int, p_pin text, p_day int) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people; g public.gifts;
begin
  p := public._auth(p_id, p_pin);
  select * into g from public.gifts where giver_id = p.id and day = p_day;
  return json_build_object('day', p_day, 'body', g.body, 'image', g.image,
                           'locked', public._unlocked(p_day));
end $$;

-- Mentés (csak amíg az a nap még nem nyílt ki)
create or replace function public.save_gift(p_id int, p_pin text, p_day int, p_body text, p_image text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare p public.people;
begin
  p := public._auth(p_id, p_pin);
  if not p.drawn then raise exception 'NOT_DRAWN'; end if;
  if p_day not between 1 and 24 then raise exception 'BAD_DAY'; end if;
  if public._unlocked(p_day) then raise exception 'ALREADY_OPEN'; end if;
  if length(coalesce(p_body, '')) > 5000 then raise exception 'TEXT_TOO_LONG'; end if;
  if p_image is not null and (p_image !~ '^data:image/(jpeg|png|webp|gif);base64,'
                              or length(p_image) > 4000000) then
    raise exception 'BAD_IMAGE';
  end if;
  if coalesce(btrim(p_body), '') = '' and p_image is null then
    delete from public.gifts where giver_id = p.id and day = p_day;
  else
    insert into public.gifts(giver_id, day, body, image, updated_at)
    values (p.id, p_day, p_body, p_image, now())
    on conflict (giver_id, day) do update
      set body = excluded.body, image = excluded.image, updated_at = now();
  end if;
end $$;

-- ---------- Jogosultságok ----------
grant usage on schema public to anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.list_people(), public.setup(text[]), public.login(int, text), public.draw(int, text),
  public.my_calendar(int, text), public.open_day(int, text, int),
  public.given_list(int, text), public.given_day(int, text, int),
  public.save_gift(int, text, int, text, text)
to anon, authenticated;
