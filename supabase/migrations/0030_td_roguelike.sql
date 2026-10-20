-- Tower defense roguelike : nouvelles règles, collection de tours et d'améliorations, skins de
-- tours et d'ennemis, caisses payées en points (◆).
--
-- Les vagues ne sont plus rejouées en SQL : la fonction serveur supabase/functions/td (Edge
-- Function, même code TypeScript que le jeu) rejoue chaque vague et met à jour td_sessions avec
-- la clé service_role. Les points restent attribués par le déclencheur points_on_td (2 × n par
-- vague n). Les anciennes parties (règles 1) restent en base mais ne sont plus classées.
--
-- Catalogue à garder identique à src/games/towerdefense/engine/data.ts (FREE_ITEMS) et
-- src/games/towerdefense/catalog.ts (contenu des caisses, finitions).
-- À exécuter une fois, après 0012_rotation.sql (0013 à 0029 sont réservés à l'appart).

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- Parties
-- ---------------------------------------------------------------------------

alter table public.td_sessions
  add column rules int not null default 1,
  add column seed bigint,
  add column deck text[],
  add column state jsonb,
  add column step int not null default 0;
create index td_sessions_rules on public.td_sessions (rules, wave desc);

-- Les anciennes fonctions de jeu sont fermées (mêmes signatures, pour ne gêner aucun « grant »).
create or replace function public.td_start() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'le tower defense a changé : recharge la page' using errcode = 'P0001';
end $$;

create or replace function public.td_wave(session_id uuid, actions text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'le tower defense a changé : recharge la page' using errcode = 'P0001';
end $$;

create or replace view public.leaderboard_td with (security_invoker = true) as
select p.id as user_id, p.username, max(s.wave) as best, max(s.kills) as kills, count(*) as games
  from public.td_sessions s
  join public.profiles p on p.id = s.user_id
 where s.rules = 2 and s.wave > 0 and p.verified and public.listed(p.id)
 group by p.id, p.username;

-- Records : comparés seulement aux parties jouées avec les mêmes règles.
create or replace function public.points_on_td() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev int; world int;
begin
  if new.wave <= old.wave then return new; end if;
  perform public.points_add(new.user_id, public.points_td(old.wave, new.wave), 'Tower defense : vague ' || new.wave);
  select max(wave) into prev from public.td_sessions where user_id = new.user_id and id <> new.id and rules = new.rules;
  select max(wave) into world from public.td_sessions where id <> new.id and rules = new.rules;
  if world is not null and new.wave > world and old.wave <= world then
    perform public.points_add(new.user_id, 500, 'Record absolu au Tower defense !', 'record');
  elsif prev is not null and new.wave > prev and old.wave <= prev and new.wave >= 5 then
    perform public.points_add(new.user_id, 100, 'Record personnel au Tower defense', 'record');
  end if;
  return new;
end $$;

-- Meilleure vague (nouvelles règles) : débloque les caisses Argent et Or et les emplacements de deck.
create function public.td_best_wave(uid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(max(wave), 0) from public.td_sessions where user_id = uid and rules = 2
$$;

-- ---------------------------------------------------------------------------
-- Caisses et catalogue
-- ---------------------------------------------------------------------------

create table public.td_crates (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('unlock', 'skin')),
  price bigint not null check (price > 0),
  min_wave int not null default 0, -- meilleure vague nécessaire pour l'ouvrir
  sort int not null default 0,
  active boolean not null default true
);
insert into public.td_crates (id, name, kind, price, min_wave, sort) values
  ('bronze', 'Caisse Bronze', 'unlock', 500, 0, 1),
  ('silver', 'Caisse Argent', 'unlock', 1500, 15, 2),
  ('gold', 'Caisse Or', 'unlock', 4000, 30, 3),
  ('tower_skins', 'Skins de tours', 'skin', 1000, 0, 4),
  ('enemy_skins', 'Skins d’ennemis', 'skin', 1000, 0, 5);

create table public.td_crate_odds (
  crate_id text not null references public.td_crates (id),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')),
  weight int not null check (weight > 0),
  primary key (crate_id, rarity)
);
insert into public.td_crate_odds (crate_id, rarity, weight)
select c, r, w
  from (values ('tower_skins'), ('enemy_skins')) as cr(c)
 cross join (values ('common', 600), ('rare', 250), ('epic', 110), ('legendary', 35), ('mythic', 5)) as o(r, w);

-- Tout ce qu'on peut obtenir. Tours et améliorations : `requires` = objet à posséder avant
-- (les tours de départ et leur U1 sont offerts, voir td_free_items). Skins : `slot` = emplacement.
create table public.td_catalog (
  id text primary key,
  crate_id text not null references public.td_crates (id),
  rarity text check (rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')),
  requires text,
  slot text
);

insert into public.td_catalog (id, crate_id, requires) values
  ('alchemist', 'bronze', null), ('alchemist_u1', 'bronze', 'alchemist'), ('alchemist_u2', 'bronze', 'alchemist_u1'),
  ('crossbow_u2', 'bronze', 'crossbow_u1'), ('cannon_u2', 'bronze', 'cannon_u1'), ('frost_u2', 'bronze', 'frost_u1'),
  ('tesla', 'silver', null), ('tesla_u1', 'silver', 'tesla'), ('tesla_u2', 'silver', 'tesla_u1'),
  ('sniper', 'silver', null), ('sniper_u1', 'silver', 'sniper'), ('sniper_u2', 'silver', 'sniper_u1'),
  ('flamer', 'silver', null), ('flamer_u1', 'silver', 'flamer'), ('flamer_u2', 'silver', 'flamer_u1'),
  ('bank', 'silver', null), ('bank_u1', 'silver', 'bank'), ('bank_u2', 'silver', 'bank_u1'),
  ('railgun', 'gold', null), ('railgun_u1', 'gold', 'railgun'), ('railgun_u2', 'gold', 'railgun_u1'),
  ('singularity', 'gold', null), ('singularity_u1', 'gold', 'singularity'), ('singularity_u2', 'gold', 'singularity_u1');

-- Skins de tours : ts:<tour>:<finition>
insert into public.td_catalog (id, crate_id, rarity, slot)
select 'ts:' || t || ':' || f, 'tower_skins', r, 'ts:' || t
  from unnest(array['crossbow', 'cannon', 'frost', 'alchemist', 'tesla', 'sniper', 'flamer', 'bank', 'railgun', 'singularity']) as t
 cross join (values
   ('wood', 'common'), ('stone', 'common'), ('copper', 'common'), ('jade', 'rare'), ('ruby', 'rare'),
   ('gold', 'epic'), ('obsidian', 'epic'), ('neon', 'legendary'), ('lava', 'legendary'), ('prism', 'mythic')
 ) as f(f, r);

-- Skins d'ennemis : es:<ennemi>:<finition>
insert into public.td_catalog (id, crate_id, rarity, slot)
select 'es:' || e || ':' || f, 'enemy_skins', r, 'es:' || e
  from unnest(array['prowler', 'runner', 'brute', 'larva', 'bat', 'armored', 'shade', 'healer', 'shieldbearer', 'splitter',
                    'troll', 'shaman', 'burrower', 'colossus', 'specter', 'golem', 'wyvern', 'necromancer', 'titan', 'devourer']) as e
 cross join (values
   ('mud', 'common'), ('ash', 'common'), ('moss', 'common'), ('toxic', 'rare'), ('frost', 'rare'),
   ('gilded', 'epic'), ('blood', 'epic'), ('ghost', 'legendary'), ('ember', 'legendary'), ('cosmic', 'mythic')
 ) as f(f, r);

create function public.td_free_items() returns text[]
language sql immutable set search_path = '' as $$
  select array['crossbow', 'cannon', 'frost', 'crossbow_u1', 'cannon_u1', 'frost_u1']
$$;

-- ---------------------------------------------------------------------------
-- Possession et skins portés
-- ---------------------------------------------------------------------------

create table public.td_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.td_catalog (id),
  source text not null default 'crate' check (source in ('crate', 'admin')),
  obtained_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index td_items_recent on public.td_items (user_id, obtained_at desc);

create table public.td_equipped (
  user_id uuid not null references public.profiles (id) on delete cascade,
  slot text not null,
  item_id text not null references public.td_catalog (id),
  primary key (user_id, slot)
);

alter table public.td_crates enable row level security;
alter table public.td_crate_odds enable row level security;
alter table public.td_catalog enable row level security;
alter table public.td_items enable row level security;
alter table public.td_equipped enable row level security;
create policy "caisses td" on public.td_crates for select to anon, authenticated using (true);
create policy "chances td" on public.td_crate_odds for select to anon, authenticated using (true);
create policy "catalogue td" on public.td_catalog for select to anon, authenticated using (true);
create policy "sa collection td" on public.td_items for select to authenticated using (user_id = auth.uid());
create policy "ses skins td" on public.td_equipped for select to authenticated using (user_id = auth.uid());
revoke all on public.td_crates, public.td_crate_odds, public.td_catalog, public.td_items, public.td_equipped from anon, authenticated;
grant select on public.td_crates, public.td_crate_odds, public.td_catalog to anon, authenticated;
grant select on public.td_items, public.td_equipped to authenticated;

-- Ouvre une caisse : jamais de doublon. Caisses de tours : objet tiré au hasard parmi ceux
-- qu'on peut recevoir (amélioration seulement si la tour, ou l'U1, est possédée). Caisses de
-- skins : rareté tirée selon les chances, parmi les raretés où il reste quelque chose.
create function public.td_crate_open(crate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.td_crates;
  owned text[];
  total int;
  r int;
  o record;
  rar text;
  item text;
  bal bigint;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  select * into c from public.td_crates where id = crate and active;
  if not found then raise exception 'caisse inconnue' using errcode = 'P0002'; end if;
  if public.td_best_wave(uid) < c.min_wave then
    raise exception 'caisse débloquée en atteignant la vague %', c.min_wave using errcode = 'P0001';
  end if;
  if (select count(*) from public.td_items where user_id = uid and obtained_at > now() - interval '5 seconds') >= 3 then
    raise exception 'doucement : réessaie dans quelques secondes' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(item_id), '{}') || public.td_free_items() into owned from public.td_items where user_id = uid;

  if c.kind = 'unlock' then
    select k.id into item from public.td_catalog k
     where k.crate_id = c.id and not (k.id = any (owned)) and (k.requires is null or k.requires = any (owned))
     order by random() limit 1;
  else
    select sum(d.weight) into total from public.td_crate_odds d
     where d.crate_id = c.id
       and exists (select 1 from public.td_catalog k where k.crate_id = c.id and k.rarity = d.rarity and not (k.id = any (owned)));
    if total is not null then
      r := floor(random() * total)::int;
      for o in select d.rarity, d.weight from public.td_crate_odds d
                where d.crate_id = c.id
                  and exists (select 1 from public.td_catalog k where k.crate_id = c.id and k.rarity = d.rarity and not (k.id = any (owned)))
                order by d.weight desc, d.rarity loop
        r := r - o.weight;
        if r < 0 then rar := o.rarity; exit; end if;
      end loop;
      select k.id into item from public.td_catalog k
       where k.crate_id = c.id and k.rarity = rar and not (k.id = any (owned))
       order by random() limit 1;
    end if;
  end if;
  if item is null then raise exception 'caisse complète : tu as déjà tout' using errcode = 'P0001'; end if;

  bal := public.points_spend(uid, c.price, c.name, 'crate');
  insert into public.td_items (user_id, item_id) values (uid, item);
  -- Un nouveau skin est porté tout de suite si rien ne l'était à cet emplacement.
  insert into public.td_equipped (user_id, slot, item_id)
  select uid, k.slot, k.id from public.td_catalog k where k.id = item and k.slot is not null
  on conflict do nothing;
  return jsonb_build_object('item', item, 'rarity', (select rarity from public.td_catalog where id = item), 'balance', bal);
end $$;

-- Porte un skin possédé (item_id) à son emplacement, ou retire celui qui y est (item_id null).
create function public.td_equip(slot_id text, item text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if item is null then
    delete from public.td_equipped where user_id = uid and slot = slot_id;
    return;
  end if;
  if not exists (select 1 from public.td_items i join public.td_catalog k on k.id = i.item_id
                  where i.user_id = uid and i.item_id = item and k.slot = slot_id) then
    raise exception 'skin non possédé' using errcode = 'P0001';
  end if;
  insert into public.td_equipped (user_id, slot, item_id) values (uid, slot_id, item)
  on conflict (user_id, slot) do update set item_id = excluded.item_id;
end $$;

revoke execute on function public.td_best_wave(uuid), public.td_free_items(), public.td_crate_open(text), public.td_equip(text, text)
  from public, anon, authenticated;
grant execute on function public.td_crate_open(text), public.td_equip(text, text) to authenticated;
