-- Économie à grande échelle : jusqu'au milliard, il reste toujours quelque chose à viser.
-- * Casino : la mise maximale par tour suit le solde (20 % du solde, au moins 500, au plus 100 millions).
-- * Boutique : couleurs, effets et titres de 500 000 à 1 milliard de points.
-- * Meubles : rareté Divin (revenu × 60) avec deux finitions, Cosmos et Aurore, qu'on ne trouve que
--   dans deux nouvelles caisses : Royale (1 million) et Divine (10 millions).
-- À exécuter une fois (appliquée automatiquement par le workflow Supabase).

set client_encoding = 'UTF8';

-- --- Casino ------------------------------------------------------------------
create or replace function public.casino_max(bal bigint) returns bigint
language sql immutable set search_path = '' as $$
  select greatest(500, least(100000000, coalesce(bal, 0) / 5))::bigint
$$;

create or replace function public.casino_check(stake bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  bal bigint;
  cap bigint;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if stake is null or stake < 1 then raise exception 'mise invalide' using errcode = '22023'; end if;
  perform public.points_open(uid);
  select balance into bal from public.wallets where user_id = uid for update;
  cap := public.casino_max(bal);
  if stake > cap then
    raise exception 'mise maximale : % points (20 %% de ton solde)', to_char(cap, 'FM999G999G999G999') using errcode = '22023';
  end if;
  if bal < stake then raise exception 'pas assez de points' using errcode = 'P0001'; end if;
  if (select count(*) from public.point_events where user_id = uid and kind = 'casino' and created_at > now() - interval '10 seconds') >= 12 then
    raise exception 'doucement : trop de mises d’un coup' using errcode = 'P0001';
  end if;
  return uid;
end $$;
revoke execute on function public.casino_max(bigint), public.casino_check(bigint) from public, anon, authenticated;

-- --- Boutique ----------------------------------------------------------------
insert into public.shop_items (id, slot, price) values
  ('nc-platinum', 'name_color', 500000),
  ('nc-obsidian', 'name_color', 2000000),
  ('nc-aurora', 'name_color', 10000000),
  ('nc-cosmos', 'name_color', 50000000),
  ('nc-diamond', 'name_color', 250000000),
  ('ne-holo', 'name_effect', 1000000),
  ('ne-storm', 'name_effect', 5000000),
  ('ne-aura', 'name_effect', 25000000),
  ('ne-nova', 'name_effect', 100000000),
  ('ne-divine', 'name_effect', 500000000),
  ('title-millionnaire', 'title', 1000000),
  ('title-rentier', 'title', 5000000),
  ('title-magnat', 'title', 20000000),
  ('title-nabab', 'title', 75000000),
  ('title-cresus', 'title', 200000000),
  ('title-milliardaire', 'title', 1000000000);

-- --- Meubles : rareté Divin --------------------------------------------------
alter table public.furniture_finishes drop constraint furniture_finishes_rarity_check;
alter table public.furniture_finishes add constraint furniture_finishes_rarity_check
  check (rarity in ('standard', 'common', 'rare', 'epic', 'legendary', 'mythic', 'divine'));
insert into public.furniture_finishes (id, rarity) values ('cosmos', 'divine'), ('aurore', 'divine');

create or replace function public.apartment_rarity_mult(rarity text) returns numeric
language sql immutable set search_path = '' as $$
  select case rarity when 'common' then 1.5 when 'rare' then 2.5 when 'epic' then 4 when 'legendary' then 8
                     when 'mythic' then 20 when 'divine' then 60 else 1 end
$$;

insert into public.crates (id, price) values ('royale', 1000000), ('divine', 10000000);
insert into public.crate_odds (crate_id, rarity, weight) values
  ('royale', 'legendary', 700), ('royale', 'mythic', 260), ('royale', 'divine', 40),
  ('divine', 'mythic', 600), ('divine', 'divine', 400);
