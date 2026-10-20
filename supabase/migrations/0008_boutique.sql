-- Boutique : couleurs et effets de pseudo, skins des jeux à deux (visibles par l'adversaire), titres.
--
-- Le prix et la disponibilité de chaque objet sont ici, pas dans le client : public.shop_buy
-- vérifie tout et débite le portefeuille. L'apparence de chaque objet (couleurs, symboles) est
-- dans src/net/shop.ts, avec les mêmes identifiants.
-- Ordre de grandeur des gains : 1 500 points par heure de jeu environ. Tout est volontairement très cher.
-- À exécuter une fois, après 0007_points_casino.sql.

set client_encoding = 'UTF8';

alter table public.point_events drop constraint point_events_kind_check;
alter table public.point_events add constraint point_events_kind_check
  check (kind in ('game', 'record', 'bonus', 'casino', 'shop'));

create table public.shop_items (
  id text primary key,
  -- name_color, name_effect, title, ou skin:<jeu> (connect4, tictactoe, chess, checkers, quoridor)
  slot text not null check (slot in ('name_color', 'name_effect', 'title') or slot like 'skin:%'),
  price bigint not null check (price > 0),
  active boolean not null default true -- false : invisible et impossible à acheter
);

insert into public.shop_items (id, slot, price) values
  -- Couleurs de pseudo
  ('nc-ruby', 'name_color', 5000),
  ('nc-emerald', 'name_color', 5000),
  ('nc-sapphire', 'name_color', 5000),
  ('nc-amethyst', 'name_color', 8000),
  ('nc-gold', 'name_color', 20000),
  ('nc-ice', 'name_color', 35000),
  ('nc-sunset', 'name_color', 50000),
  ('nc-rainbow', 'name_color', 150000),
  -- Effets de pseudo
  ('ne-glow', 'name_effect', 15000),
  ('ne-pulse', 'name_effect', 25000),
  ('ne-shine', 'name_effect', 60000),
  ('ne-glitch', 'name_effect', 90000),
  ('ne-sparkle', 'name_effect', 120000),
  ('ne-fire', 'name_effect', 250000),
  -- Skins : Puissance 4
  ('c4-neon', 'skin:connect4', 30000),
  ('c4-gold', 'skin:connect4', 20000),
  ('c4-planet', 'skin:connect4', 40000),
  -- Skins : Morpion
  ('ttt-hearts', 'skin:tictactoe', 10000),
  ('ttt-stars', 'skin:tictactoe', 10000),
  ('ttt-bolt', 'skin:tictactoe', 25000),
  ('ttt-crown', 'skin:tictactoe', 60000),
  -- Skins : Échecs
  ('ch-ruby', 'skin:chess', 40000),
  ('ch-ice', 'skin:chess', 40000),
  ('ch-neon', 'skin:chess', 40000),
  ('ch-gold', 'skin:chess', 60000),
  -- Skins : Dames
  ('dm-wood', 'skin:checkers', 20000),
  ('dm-neon', 'skin:checkers', 30000),
  ('dm-gold', 'skin:checkers', 50000),
  -- Skins : Quoridor
  ('qd-diamond', 'skin:quoridor', 30000),
  ('qd-ember', 'skin:quoridor', 30000),
  ('qd-galaxy', 'skin:quoridor', 60000);

-- Titres : à compléter. Chaque titre doit aussi exister dans TITLES (src/net/shop.ts).
-- Laisser `active` à false tant que le titre ne doit être ni visible ni achetable.
-- insert into public.shop_items (id, slot, price, active) values
--   ('title-exemple-1', 'title', 100000, false),
--   ('title-exemple-2', 'title', 250000, false);

create table public.inventory (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.shop_items (id),
  bought_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- Ce que chacun porte : visible par tous (pseudos colorés, skins vus par l'adversaire).
create table public.cosmetics (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  name_color text references public.shop_items (id),
  name_effect text references public.shop_items (id),
  title text references public.shop_items (id),
  skins jsonb not null default '{}', -- {"chess": "ch-gold", …}
  updated_at timestamptz not null default now()
);

alter table public.shop_items enable row level security;
alter table public.inventory enable row level security;
alter table public.cosmetics enable row level security;
create policy "catalogue visible" on public.shop_items for select to anon, authenticated using (active);
create policy "son inventaire" on public.inventory for select to authenticated using (user_id = auth.uid());
create policy "apparences visibles" on public.cosmetics for select to anon, authenticated using (true);
revoke all on public.shop_items, public.inventory, public.cosmetics from anon, authenticated;
grant select on public.shop_items, public.cosmetics to anon, authenticated;
grant select on public.inventory to authenticated;

create function public.shop_buy(item text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  it public.shop_items;
  bal bigint;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  select * into it from public.shop_items where id = item and active;
  if not found then raise exception 'objet introuvable' using errcode = 'P0002'; end if;
  if exists (select 1 from public.inventory where user_id = uid and item_id = it.id) then
    raise exception 'déjà acheté' using errcode = 'P0001';
  end if;
  perform public.points_open(uid);
  select balance into bal from public.wallets where user_id = uid for update;
  if bal < it.price then raise exception 'pas assez de points' using errcode = 'P0001'; end if;
  update public.wallets set balance = balance - it.price, updated_at = now() where user_id = uid returning balance into bal;
  insert into public.inventory (user_id, item_id) values (uid, it.id);
  insert into public.point_events (user_id, amount, reason, kind) values (uid, -it.price, 'Boutique : ' || it.id, 'shop');
  return jsonb_build_object('balance', bal);
end $$;

-- Porte un objet acheté (ou retire celui de l'emplacement si `item` est null).
create function public.shop_equip(slot text, item text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  it public.shop_items;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if slot is null or not (slot in ('name_color', 'name_effect', 'title') or slot ~ '^skin:[a-z0-9]+$') then
    raise exception 'emplacement inconnu' using errcode = '22023';
  end if;
  if item is not null then
    select * into it from public.shop_items where id = item;
    if not found or it.slot <> shop_equip.slot then raise exception 'objet incompatible' using errcode = '22023'; end if;
    if not exists (select 1 from public.inventory where user_id = uid and item_id = item) then
      raise exception 'objet non acheté' using errcode = 'P0001';
    end if;
  end if;
  insert into public.cosmetics (user_id) values (uid) on conflict do nothing;
  if slot = 'name_color' then update public.cosmetics set name_color = item, updated_at = now() where user_id = uid;
  elsif slot = 'name_effect' then update public.cosmetics set name_effect = item, updated_at = now() where user_id = uid;
  elsif slot = 'title' then update public.cosmetics set title = item, updated_at = now() where user_id = uid;
  else
    update public.cosmetics
       set skins = case when item is null then skins - substr(slot, 6) else skins || jsonb_build_object(substr(slot, 6), item) end,
           updated_at = now()
     where user_id = uid;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.cosmetics;
  end if;
end $$;

revoke execute on function public.shop_buy(text), public.shop_equip(text, text) from public, anon;
grant execute on function public.shop_buy(text), public.shop_equip(text, text) to authenticated;
