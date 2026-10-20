-- Tower defense : campagne de 20 niveaux, mode infini, héros.
--
-- * Parties (règles 3) : `mode` campagne ou infini, `level` (1 à 20), `hero` et son niveau,
--   `won` (niveau réussi). La fonction serveur `td` les crée et les rejoue, comme avant.
-- * Les tours et leurs améliorations se débloquent en terminant les niveaux de la campagne (voir
--   src/games/towerdefense/engine/data.ts) : les caisses de tours sont retirées. Les caisses ne
--   contiennent plus que des skins et des héros ; un héros déjà possédé monte d'un niveau (5 max).
-- * Points : le mode infini rapporte comme avant (2 × n par vague n) et seul lui est classé. Un
--   niveau de la campagne réussi rapporte 100 + 40 × niveau la première fois, 5 × niveau ensuite.
-- À exécuter une fois, après 0030_td_roguelike.sql (et 0017_amis.sql).

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- Parties
-- ---------------------------------------------------------------------------

alter table public.td_sessions
  add column mode text check (mode in ('campaign', 'infinite')),
  add column level int check (level between 1 and 20),
  add column hero text,
  add column hero_level int,
  add column won boolean not null default false;
create index td_sessions_campaign on public.td_sessions (user_id, level) where rules = 3 and won;

-- Niveaux de la campagne terminés (ils se débloquent dans l'ordre : c'est le plus haut réussi).
create function public.td_cleared(uid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(max(level), 0) from public.td_sessions where user_id = uid and rules = 3 and mode = 'campaign' and won
$$;

create or replace function public.td_best_wave(uid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(max(wave), 0) from public.td_sessions where user_id = uid and rules = 3 and mode = 'infinite'
$$;

create or replace view public.leaderboard_td with (security_invoker = true) as
select p.id as user_id, p.username, max(s.wave) as best, max(s.kills) as kills, count(*) as games
  from public.td_sessions s
  join public.profiles p on p.id = s.user_id
 where s.rules = 3 and s.mode = 'infinite' and s.wave > 0 and p.verified and public.listed(p.id)
 group by p.id, p.username;

create or replace function public.points_on_td() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev int; world int; first boolean;
begin
  -- Campagne : des points seulement quand le niveau est réussi.
  if new.mode = 'campaign' then
    if new.won and not old.won then
      first := not exists (select 1 from public.td_sessions
                            where user_id = new.user_id and id <> new.id and rules = new.rules and mode = 'campaign' and level = new.level and won);
      perform public.points_add(new.user_id, case when first then 100 + 40 * new.level else 5 * new.level end,
        'Tower defense : niveau ' || new.level || case when first then ' terminé !' else ' rejoué' end);
    end if;
    return new;
  end if;
  if new.wave <= old.wave then return new; end if;
  perform public.points_add(new.user_id, public.points_td(old.wave, new.wave), 'Tower defense : vague ' || new.wave);
  -- Records : comparés aux parties jouées avec les mêmes règles, dans le même mode.
  select max(wave) into prev from public.td_sessions
   where user_id = new.user_id and id <> new.id and rules = new.rules and mode is not distinct from new.mode;
  select max(wave) into world from public.td_sessions
   where id <> new.id and rules = new.rules and mode is not distinct from new.mode;
  if world is not null and new.wave > world and old.wave <= world then
    perform public.points_add(new.user_id, 500, 'Record absolu au Tower defense !', 'record');
  elsif prev is not null and new.wave > prev and old.wave <= prev and new.wave >= 5 then
    perform public.points_add(new.user_id, 100, 'Record personnel au Tower defense', 'record');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Héros
-- ---------------------------------------------------------------------------

create table public.td_heroes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  hero_id text not null,
  level int not null default 1 check (level between 1 and 5),
  obtained_at timestamptz not null default now(),
  primary key (user_id, hero_id)
);
alter table public.td_heroes enable row level security;
create policy "ses héros td" on public.td_heroes for select to authenticated using (user_id = auth.uid());
revoke all on public.td_heroes from anon, authenticated;
grant select on public.td_heroes to authenticated;

-- Les caisses de tours disparaissent ; la caisse de héros arrive.
alter table public.td_crates drop constraint td_crates_kind_check;
alter table public.td_crates add constraint td_crates_kind_check check (kind in ('unlock', 'skin', 'hero'));
update public.td_crates set active = false where kind = 'unlock';
insert into public.td_crates (id, name, kind, price, min_wave, sort) values ('heroes', 'Caisse de héros', 'hero', 1500, 0, 0);

-- Héros : à garder identique à HEROES (engine/data.ts).
insert into public.td_catalog (id, crate_id)
select 'hero:' || h, 'heroes'
  from unnest(array['bricolette', 'frigo', 'turbo', 'cogneur', 'grippesou', 'pansement', 'longuevue', 'laprime']) as h;

-- Ouvre une caisse. Héros : tiré au hasard parmi ceux qui ne sont pas au niveau 5 ; nouveau, il
-- arrive au niveau 1, sinon il monte d'un niveau. Skins : comme avant (jamais de doublon).
create or replace function public.td_crate_open(crate text) returns jsonb
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
  lvl int;
  bal bigint;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  select * into c from public.td_crates where id = crate and active;
  if not found then raise exception 'caisse inconnue' using errcode = 'P0002'; end if;
  if public.td_best_wave(uid) < c.min_wave then
    raise exception 'caisse débloquée en atteignant la vague %', c.min_wave using errcode = 'P0001';
  end if;
  if (select count(*) from public.td_items where user_id = uid and obtained_at > now() - interval '5 seconds')
     + (select count(*) from public.td_heroes where user_id = uid and obtained_at > now() - interval '5 seconds') >= 3 then
    raise exception 'doucement : réessaie dans quelques secondes' using errcode = 'P0001';
  end if;

  if c.kind = 'hero' then
    select k.id into item from public.td_catalog k
      left join public.td_heroes h on h.user_id = uid and h.hero_id = substr(k.id, 6)
     where k.crate_id = c.id and coalesce(h.level, 0) < 5
     order by random() limit 1;
    if item is null then raise exception 'caisse complète : tous tes héros sont au niveau 5' using errcode = 'P0001'; end if;
    bal := public.points_spend(uid, c.price, c.name, 'crate');
    insert into public.td_heroes (user_id, hero_id) values (uid, substr(item, 6))
    on conflict (user_id, hero_id) do update set level = public.td_heroes.level + 1, obtained_at = now()
    returning level into lvl;
    return jsonb_build_object('item', item, 'rarity', null, 'level', lvl, 'balance', bal);
  end if;

  select coalesce(array_agg(item_id), '{}') into owned from public.td_items where user_id = uid;
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
  if item is null then raise exception 'caisse complète : tu as déjà tout' using errcode = 'P0001'; end if;

  bal := public.points_spend(uid, c.price, c.name, 'crate');
  insert into public.td_items (user_id, item_id) values (uid, item);
  insert into public.td_equipped (user_id, slot, item_id)
  select uid, k.slot, k.id from public.td_catalog k where k.id = item and k.slot is not null
  on conflict do nothing;
  return jsonb_build_object('item', item, 'rarity', (select rarity from public.td_catalog where id = item), 'balance', bal);
end $$;

revoke execute on function public.td_cleared(uuid), public.td_best_wave(uuid) from public, anon, authenticated;
grant execute on function public.td_crate_open(text) to authenticated;
-- Utilisée par la fonction serveur td (clé service_role).
grant execute on function public.td_cleared(uuid) to service_role;
