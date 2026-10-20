-- Administration, appartement, meubles et caisses.
--
-- * Admins : table public.admins. Un admin gère les points, renomme, donne des objets,
--   « maudit » un joueur (screamer) et ajoute les photos à accrocher dans les cadres.
--   Chaque action d'admin est notée dans public.admin_log.
-- * Appartement : un mur (cadres, fenêtres…) et un sol en grille où l'on pose ses meubles.
--   Pour l'instant réservé aux admins : voir public.apartment_allowed(), à changer quand ce sera prêt.
-- * Meubles : chaque meuble existe en finition « standard » (achetable) et en finitions rares,
--   qu'on n'obtient qu'en ouvrant des caisses. Apparence dans src/net/apartment.ts (mêmes identifiants).
-- À exécuter une fois, après 0008_boutique.sql.

set client_encoding = 'UTF8';

alter table public.point_events drop constraint point_events_kind_check;
alter table public.point_events add constraint point_events_kind_check
  check (kind in ('game', 'record', 'bonus', 'casino', 'shop', 'admin', 'crate', 'furniture'));

-- ===========================================================================
-- Admins
-- ===========================================================================

create table public.admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
create policy "chacun sait s'il est admin" on public.admins for select to authenticated using (user_id = auth.uid());
revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;

insert into public.admins (user_id)
select id from public.profiles where id = '8d86e772-0f91-4972-a32b-2b8ca2fe9882'
on conflict do nothing;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

create table public.admin_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  target uuid references public.profiles (id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.admin_log enable row level security;
create policy "journal réservé aux admins" on public.admin_log for select to authenticated using (public.is_admin());
revoke all on public.admin_log from anon, authenticated;
grant select on public.admin_log to authenticated;

create function public.admin_check() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'réservé aux admins' using errcode = '42501'; end if;
  return auth.uid();
end $$;

create function public.admin_note(action text, target uuid, detail text) returns void
language sql security definer set search_path = '' as $$
  insert into public.admin_log (admin_id, action, target, detail) values (auth.uid(), action, target, detail)
$$;

-- ---------------------------------------------------------------------------
-- Malédiction (screamer) : le client du joueur maudit affiche un screamer de temps en temps.
-- level : 1 rare (toutes les 8 à 15 min), 2 normal (3 à 8 min), 3 fréquent (1 à 3 min).
-- scare_at : un admin peut déclencher un screamer immédiatement.
-- ---------------------------------------------------------------------------

create table public.curses (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  active boolean not null default true,
  level int not null default 2 check (level between 1 and 3),
  scare_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.curses enable row level security;
-- Le joueur ne voit que sa propre ligne (son client en a besoin) ; personne ne voit qui est maudit.
create policy "sa propre malédiction" on public.curses for select to authenticated using (user_id = auth.uid());
revoke all on public.curses from anon, authenticated;
grant select on public.curses to authenticated;

-- Le screamer était réservé au pseudo LuTz_67 dans le code : il passe sous le contrôle des admins.
insert into public.curses (user_id) select id from public.profiles where lower(username) = 'lutz_67' on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Outils d'admin
-- ---------------------------------------------------------------------------

create function public.admin_find_players(search text) returns table (
  id uuid, username text, verified boolean, balance bigint, earned bigint, cursed boolean, curse_level int, is_admin boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_check();
  return query
  select p.id, p.username, p.verified, coalesce(w.balance, 0), coalesce(w.earned, 0),
         coalesce(c.active, false), coalesce(c.level, 2), exists (select 1 from public.admins a where a.user_id = p.id)
    from public.profiles p
    left join public.wallets w on w.user_id = p.id
    left join public.curses c on c.user_id = p.id
   where search is null or search = '' or p.username ilike '%' || search || '%' or p.id::text = search
   order by coalesce(w.balance, 0) desc
   limit 50;
end $$;

-- Ajoute (amount > 0) ou retire (amount < 0) des points. Le solde ne descend jamais sous zéro.
create function public.admin_points(target uuid, amount bigint, reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  bal bigint;
  delta bigint;
begin
  perform public.admin_check();
  if amount is null or amount = 0 then raise exception 'montant invalide' using errcode = '22023'; end if;
  perform public.points_open(target);
  select balance into bal from public.wallets where user_id = target for update;
  delta := greatest(amount, -bal);
  update public.wallets set balance = balance + delta, updated_at = now() where user_id = target returning balance into bal;
  insert into public.point_events (user_id, amount, reason, kind)
  values (target, delta, coalesce(nullif(btrim(reason), ''), case when delta > 0 then 'Cadeau d''un admin' else 'Retrait par un admin' end), 'admin');
  perform public.admin_note('points', target, delta::text || ' : ' || coalesce(reason, ''));
  return bal;
end $$;

create function public.admin_rename(target uuid, name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_check();
  update public.profiles set username = btrim(name) where id = target;
  if not found then raise exception 'joueur inconnu' using errcode = 'P0002'; end if;
  perform public.admin_note('rename', target, name);
end $$;

create function public.admin_curse(target uuid, enabled boolean, lvl int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_check();
  if lvl is null or lvl not between 1 and 3 then raise exception 'niveau invalide (1 à 3)' using errcode = '22023'; end if;
  insert into public.curses (user_id, active, level) values (target, enabled, lvl)
  on conflict (user_id) do update set active = enabled, level = lvl, updated_at = now();
  perform public.admin_note(case when enabled then 'curse' else 'uncurse' end, target, 'niveau ' || lvl);
end $$;

-- Screamer immédiat (le joueur doit avoir le site ouvert).
create function public.admin_scare(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_check();
  insert into public.curses (user_id, active, scare_at) values (target, false, now())
  on conflict (user_id) do update set scare_at = now(), updated_at = now();
  perform public.admin_note('scare', target, null);
end $$;

-- ===========================================================================
-- Meubles
-- ===========================================================================

create table public.furniture_bases (
  id text primary key,
  place text not null check (place in ('floor', 'wall')),
  w int not null check (w between 1 and 4),
  h int not null check (h between 1 and 4),
  price bigint not null check (price > 0) -- prix de la finition standard
);

create table public.furniture_finishes (
  id text primary key,
  rarity text not null check (rarity in ('standard', 'common', 'rare', 'epic', 'legendary', 'mythic'))
);

insert into public.furniture_bases (id, place, w, h, price) values
  ('chair', 'floor', 1, 1, 800),
  ('plant', 'floor', 1, 1, 600),
  ('teddy', 'floor', 1, 1, 700),
  ('lamp', 'floor', 1, 1, 900),
  ('books', 'floor', 1, 1, 1500),
  ('guitar', 'floor', 1, 1, 2000),
  ('tv', 'floor', 1, 1, 2500),
  ('computer', 'floor', 1, 1, 3500),
  ('aquarium', 'floor', 1, 1, 3500),
  ('arcade', 'floor', 1, 1, 5000),
  ('trophy', 'floor', 1, 1, 8000),
  ('sofa', 'floor', 2, 1, 3000),
  ('bath', 'floor', 2, 1, 4500),
  ('piano', 'floor', 2, 1, 6000),
  ('bed', 'floor', 2, 2, 4000),
  ('frame', 'wall', 1, 1, 1500),
  ('window', 'wall', 1, 1, 2000),
  ('clock', 'wall', 1, 1, 1200),
  ('mirror', 'wall', 1, 1, 1500);

insert into public.furniture_finishes (id, rarity) values
  ('standard', 'standard'),
  ('ruby', 'common'), ('ocean', 'common'), ('jade', 'common'),
  ('pastel', 'rare'), ('night', 'rare'),
  ('gold', 'epic'), ('neon', 'epic'),
  ('diamond', 'legendary'), ('obsidian', 'legendary'),
  ('rainbow', 'mythic'), ('ghost', 'mythic');

-- Un meuble = une base et une finition : « sofa:gold ».
create view public.furniture_items as
select b.id || ':' || f.id as id, b.id as base, f.id as finish, f.rarity, b.place, b.w, b.h,
       case when f.rarity = 'standard' then b.price end as price
  from public.furniture_bases b cross join public.furniture_finishes f;

-- Meubles possédés (on peut avoir plusieurs exemplaires du même).
create table public.furniture_owned (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null,
  source text not null default 'shop' check (source in ('shop', 'crate', 'admin')),
  acquired_at timestamptz not null default now()
);
create index furniture_owned_user on public.furniture_owned (user_id);

-- Caisses : probabilité de chaque rareté (sur 1 000), puis un meuble au hasard de cette rareté.
create table public.crates (
  id text primary key,
  price bigint not null check (price > 0)
);
create table public.crate_odds (
  crate_id text not null references public.crates (id),
  rarity text not null,
  weight int not null check (weight > 0),
  primary key (crate_id, rarity)
);
insert into public.crates (id, price) values ('classic', 5000), ('prestige', 25000);
insert into public.crate_odds (crate_id, rarity, weight) values
  ('classic', 'common', 750), ('classic', 'rare', 180), ('classic', 'epic', 55), ('classic', 'legendary', 14), ('classic', 'mythic', 1),
  ('prestige', 'rare', 600), ('prestige', 'epic', 280), ('prestige', 'legendary', 100), ('prestige', 'mythic', 20);

create table public.crate_openings (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  crate_id text not null references public.crates (id),
  item_id text not null,
  opened_at timestamptz not null default now()
);
create index crate_openings_user on public.crate_openings (user_id, opened_at desc);

-- ===========================================================================
-- Appartement
-- ===========================================================================

-- Qui peut voir et meubler un appartement. Pour ouvrir à tous : remplacer par `select auth.uid() is not null`.
create function public.apartment_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
$$;

-- Mur : 12 × 2 emplacements. Sol : 12 × 7 cases.
-- layout = {"floor": [{"o": id possédé, "i": meuble, "x": 0, "y": 0}], "wall": [{"o": …, "i": …, "x": 3, "y": 0, "art": photo}]}
create table public.apartments (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  layout jsonb not null default '{"floor": [], "wall": []}',
  updated_at timestamptz not null default now()
);

-- Photos à accrocher dans les cadres (ajoutées par les admins, fichiers dans le stockage « artworks »).
create table public.artworks (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 80),
  url text not null,
  path text, -- chemin dans le stockage, pour pouvoir supprimer le fichier
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.furniture_bases enable row level security;
alter table public.furniture_finishes enable row level security;
alter table public.furniture_owned enable row level security;
alter table public.crates enable row level security;
alter table public.crate_odds enable row level security;
alter table public.crate_openings enable row level security;
alter table public.apartments enable row level security;
alter table public.artworks enable row level security;
create policy "catalogue des meubles" on public.furniture_bases for select to authenticated using (public.apartment_allowed());
create policy "finitions" on public.furniture_finishes for select to authenticated using (public.apartment_allowed());
create policy "caisses" on public.crates for select to authenticated using (public.apartment_allowed());
create policy "chances des caisses" on public.crate_odds for select to authenticated using (public.apartment_allowed());
create policy "ses meubles" on public.furniture_owned for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "ses ouvertures" on public.crate_openings for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "appartements visibles" on public.apartments for select to authenticated using (public.apartment_allowed());
create policy "photos visibles" on public.artworks for select to authenticated using (public.apartment_allowed());
revoke all on public.furniture_bases, public.furniture_finishes, public.furniture_owned, public.crates, public.crate_odds,
  public.crate_openings, public.apartments, public.artworks from anon, authenticated;
grant select on public.furniture_bases, public.furniture_finishes, public.furniture_owned, public.crates, public.crate_odds,
  public.crate_openings, public.apartments, public.artworks to authenticated;
grant select on public.furniture_items to authenticated;

create function public.apartment_check() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if not public.apartment_allowed() then raise exception 'l''appartement n''est pas encore ouvert' using errcode = '42501'; end if;
  return auth.uid();
end $$;

-- Débite le portefeuille (erreur si le solde ne suffit pas).
create function public.points_spend(uid uuid, amount bigint, reason text, kind text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  bal bigint;
begin
  perform public.points_open(uid);
  select balance into bal from public.wallets where user_id = uid for update;
  if bal < amount then raise exception 'pas assez de points' using errcode = 'P0001'; end if;
  update public.wallets set balance = balance - amount, updated_at = now() where user_id = uid returning balance into bal;
  insert into public.point_events (user_id, amount, reason, kind) values (uid, -amount, reason, kind);
  return bal;
end $$;

-- Achat d'un meuble en finition standard.
create function public.furniture_buy(base_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  b public.furniture_bases;
  bal bigint;
  oid bigint;
begin
  select * into b from public.furniture_bases where id = base_id;
  if not found then raise exception 'meuble inconnu' using errcode = 'P0002'; end if;
  bal := public.points_spend(uid, b.price, 'Meuble : ' || b.id || ':standard', 'furniture');
  insert into public.furniture_owned (user_id, item_id) values (uid, b.id || ':standard') returning id into oid;
  return jsonb_build_object('balance', bal, 'owned', oid, 'item', b.id || ':standard');
end $$;

-- Ouverture d'une caisse : tirage de la rareté, puis d'un meuble de cette rareté.
create function public.crate_open(crate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  c public.crates;
  total int;
  r int;
  acc int := 0;
  o record;
  picked_rarity text;
  item text;
  bal bigint;
  oid bigint;
begin
  select * into c from public.crates where id = crate;
  if not found then raise exception 'caisse inconnue' using errcode = 'P0002'; end if;
  if (select count(*) from public.crate_openings where user_id = uid and opened_at > now() - interval '5 seconds') >= 3 then
    raise exception 'doucement : une caisse à la fois' using errcode = 'P0001';
  end if;
  bal := public.points_spend(uid, c.price, 'Caisse : ' || c.id, 'crate');
  select sum(weight) into total from public.crate_odds where crate_id = c.id;
  r := floor(random() * total)::int;
  for o in select rarity, weight from public.crate_odds where crate_id = c.id order by weight desc, rarity loop
    acc := acc + o.weight;
    if r < acc then picked_rarity := o.rarity; exit; end if;
  end loop;
  select i.id into item from public.furniture_items i where i.rarity = picked_rarity order by random() limit 1;
  insert into public.furniture_owned (user_id, item_id, source) values (uid, item, 'crate') returning id into oid;
  insert into public.crate_openings (user_id, crate_id, item_id) values (uid, c.id, item);
  return jsonb_build_object('balance', bal, 'owned', oid, 'item', item, 'rarity', picked_rarity);
end $$;

-- Enregistre l'aménagement. Le serveur vérifie tout : meubles possédés et utilisés une seule fois,
-- bon emplacement (mur ou sol), dans les limites, sans chevauchement, photos existantes.
create function public.apartment_save(layout jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  zone text;
  cols int := 12;
  rows_ int;
  grid boolean[];
  e jsonb;
  oid bigint;
  it record;
  x int; y int; dx int; dy int;
  art bigint;
  used bigint[] := '{}';
  clean jsonb := '{"floor": [], "wall": []}';
  entry jsonb;
begin
  if layout is null or jsonb_typeof(layout) <> 'object' then raise exception 'aménagement invalide' using errcode = '22023'; end if;
  foreach zone in array array['floor', 'wall'] loop
    rows_ := case when zone = 'floor' then 7 else 2 end;
    grid := array_fill(false, array[cols * rows_]);
    if layout -> zone is not null and jsonb_typeof(layout -> zone) <> 'array' then
      raise exception 'aménagement invalide' using errcode = '22023';
    end if;
    if jsonb_array_length(coalesce(layout -> zone, '[]')) > 84 then raise exception 'trop de meubles' using errcode = '22023'; end if;
    for e in select * from jsonb_array_elements(coalesce(layout -> zone, '[]')) loop
      if jsonb_typeof(e -> 'o') <> 'number' or jsonb_typeof(e -> 'x') <> 'number' or jsonb_typeof(e -> 'y') <> 'number' then
        raise exception 'aménagement invalide' using errcode = '22023';
      end if;
      oid := (e ->> 'o')::bigint;
      x := (e ->> 'x')::int;
      y := (e ->> 'y')::int;
      if oid = any(used) then raise exception 'meuble placé deux fois' using errcode = '22023'; end if;
      used := used || oid;
      select f.item_id, i.place, i.w, i.h, i.base into it
        from public.furniture_owned f join public.furniture_items i on i.id = f.item_id
       where f.id = oid and f.user_id = uid;
      if not found then raise exception 'meuble non possédé' using errcode = 'P0001'; end if;
      if it.place <> zone then raise exception 'ce meuble ne va pas là' using errcode = '22023'; end if;
      if x < 0 or y < 0 or x + it.w > cols or y + it.h > rows_ then raise exception 'meuble hors de la pièce' using errcode = '22023'; end if;
      for dy in 0..it.h - 1 loop
        for dx in 0..it.w - 1 loop
          if grid[(y + dy) * cols + x + dx + 1] then raise exception 'deux meubles au même endroit' using errcode = '22023'; end if;
          grid[(y + dy) * cols + x + dx + 1] := true;
        end loop;
      end loop;
      entry := jsonb_build_object('o', oid, 'i', it.item_id, 'x', x, 'y', y);
      if it.base = 'frame' and e ? 'art' and jsonb_typeof(e -> 'art') = 'number' then
        art := (e ->> 'art')::bigint;
        if not exists (select 1 from public.artworks where id = art) then raise exception 'photo inconnue' using errcode = 'P0002'; end if;
        entry := entry || jsonb_build_object('art', art);
      end if;
      clean := jsonb_set(clean, array[zone], (clean -> zone) || jsonb_build_array(entry));
    end loop;
  end loop;
  insert into public.apartments (user_id, layout, updated_at) values (uid, clean, now())
  on conflict (user_id) do update set layout = clean, updated_at = now();
  return clean;
end $$;

-- ---------------------------------------------------------------------------
-- Outils d'admin : photos et objets
-- ---------------------------------------------------------------------------

create function public.admin_artwork_add(title text, url text, path text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  aid bigint;
begin
  perform public.admin_check();
  if url is null or url !~ '^https://' then raise exception 'adresse invalide' using errcode = '22023'; end if;
  insert into public.artworks (title, url, path, created_by) values (btrim(title), url, path, auth.uid()) returning id into aid;
  perform public.admin_note('artwork_add', null, title);
  return aid;
end $$;

create function public.admin_artwork_delete(artwork bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare
  p text;
begin
  perform public.admin_check();
  delete from public.artworks where id = artwork returning path into p;
  -- Les cadres qui montraient cette photo redeviennent vides.
  update public.apartments a
     set layout = jsonb_set(a.layout, '{wall}', coalesce((
           select jsonb_agg(case when (w ->> 'art')::bigint = artwork then w - 'art' else w end)
             from jsonb_array_elements(a.layout -> 'wall') w), '[]'))
   where a.layout -> 'wall' @> jsonb_build_array(jsonb_build_object('art', artwork));
  perform public.admin_note('artwork_delete', null, artwork::text);
  return p;
end $$;

-- Donne un objet : boutique (« nc-gold »…) ou meuble (« sofa:gold »).
create function public.admin_give(target uuid, item text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_check();
  if exists (select 1 from public.shop_items where id = item) then
    insert into public.inventory (user_id, item_id) values (target, item) on conflict do nothing;
  elsif exists (select 1 from public.furniture_items where id = item) then
    insert into public.furniture_owned (user_id, item_id, source) values (target, item, 'admin');
  else
    raise exception 'objet inconnu' using errcode = 'P0002';
  end if;
  perform public.admin_note('give', target, item);
end $$;

-- ---------------------------------------------------------------------------
-- Stockage des photos (Supabase Storage) : lecture publique, écriture par les admins.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('artworks', 'artworks', true) on conflict (id) do nothing;
    execute $p$create policy "photos : lecture" on storage.objects for select to anon, authenticated using (bucket_id = 'artworks')$p$;
    execute $p$create policy "photos : ajout par les admins" on storage.objects for insert to authenticated
      with check (bucket_id = 'artworks' and public.is_admin())$p$;
    execute $p$create policy "photos : suppression par les admins" on storage.objects for delete to authenticated
      using (bucket_id = 'artworks' and public.is_admin())$p$;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.curses, public.apartments;
  end if;
end $$;

-- ===========================================================================
-- Classements sans les admins
-- Les vues sont lues avec les droits du visiteur, qui ne voit pas la table des admins :
-- le tri passe par une fonction qui, elle, peut la lire.
-- ===========================================================================

create function public.listed(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.admins where user_id = uid)
$$;

create or replace view public.leaderboard_2048 with (security_invoker = true) as
select p.id as user_id, p.username, max(s.score) as best, max(s.max_tile) as max_tile, count(*) as games
  from public.g2048_sessions s
  join public.profiles p on p.id = s.user_id
 where s.finished_at is not null and p.verified and public.listed(p.id)
 group by p.id, p.username;

create or replace view public.leaderboard_tetris with (security_invoker = true) as
select p.id as user_id, p.username, max(s.score) as best, max(s.lines) as lines, count(*) as games
  from public.tetris_sessions s
  join public.profiles p on p.id = s.user_id
 where s.finished_at is not null and p.verified and public.listed(p.id)
 group by p.id, p.username;

create or replace view public.leaderboard_td with (security_invoker = true) as
select p.id as user_id, p.username, max(s.wave) as best, max(s.kills) as kills, count(*) as games
  from public.td_sessions s
  join public.profiles p on p.id = s.user_id
 where s.wave > 0 and p.verified and public.listed(p.id)
 group by p.id, p.username;

create or replace view public.leaderboard_flappy with (security_invoker = true) as
select p.id as user_id, p.username, max(s.score) as best, count(*) as games
  from public.flappy_sessions s
  join public.profiles p on p.id = s.user_id
 where s.finished_at is not null and p.verified and public.listed(p.id)
 group by p.id, p.username;

create or replace view public.leaderboard_wordle as
select p.id as user_id, p.username,
       count(*) filter (where w.solved) as solved,
       count(*) as games,
       round(avg(array_length(w.guesses, 1)) filter (where w.solved), 2) as average
  from public.wordle_games w
  join public.profiles p on p.id = w.user_id
 where w.finished and p.verified and public.listed(p.id)
 group by p.id, p.username;

create or replace view public.leaderboard_c4 with (security_invoker = true) as
select * from public.leaderboard_duel('connect4');

create or replace view public.leaderboard_ttt with (security_invoker = true) as
select * from public.leaderboard_duel('tictactoe');

create or replace function public.leaderboard_duel(game_id text)
returns table (user_id uuid, username text, wins bigint, losses bigint, draws bigint)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.username,
         count(*) filter (where (m.winner = 1 and m.p1 = p.id) or (m.winner = 2 and m.p2 = p.id)),
         count(*) filter (where m.winner is not null and not ((m.winner = 1 and m.p1 = p.id) or (m.winner = 2 and m.p2 = p.id))),
         count(*) filter (where m.status = 'draw')
    from public.profiles p
    join public.matches m on p.id in (m.p1, m.p2)
   where m.game = game_id and m.status in ('won', 'draw', 'forfeit', 'timeout') and p.verified and public.listed(p.id)
   group by p.id, p.username
$$;

create or replace view public.leaderboard_points with (security_invoker = true) as
select p.id as user_id, p.username, w.balance, w.earned
  from public.wallets w
  join public.profiles p on p.id = w.user_id
 where p.verified and public.listed(p.id);

-- ===========================================================================
-- Droits d'exécution
-- ===========================================================================

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.g2048_start(), public.g2048_finish(uuid, text),
  public.tetris_start(), public.tetris_finish(uuid, text),
  public.flappy_start(), public.flappy_finish(uuid, text),
  public.td_start(), public.td_wave(uuid, text),
  public.wordle_today(), public.wordle_guess(text),
  public.room_say(text, text),
  public.match_challenge(uuid, text, text), public.match_respond(uuid, boolean), public.match_play(uuid, int),
  public.match_move(uuid, text),
  public.match_forfeit(uuid), public.match_claim_timeout(uuid), public.match_rematch(uuid),
  public.points_wallet(), public.casino_roulette(jsonb), public.casino_slots(bigint),
  public.shop_buy(text), public.shop_equip(text, text),
  public.furniture_buy(text), public.crate_open(text), public.apartment_save(jsonb),
  public.admin_find_players(text), public.admin_points(uuid, bigint, text), public.admin_rename(uuid, text),
  public.admin_curse(uuid, boolean, int), public.admin_scare(uuid),
  public.admin_artwork_add(text, text, text), public.admin_artwork_delete(bigint), public.admin_give(uuid, text)
  to authenticated;
grant execute on function public.leaderboard_duel(text), public.listed(uuid) to anon, authenticated;
-- Utilisées par les règles d'accès (RLS) et le stockage.
grant execute on function public.is_admin(), public.apartment_allowed() to authenticated;
