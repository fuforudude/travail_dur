-- Plinko au casino (spec docs/specs/2026-11-13-plinko.md).
-- * Une bille tombe de rangée en rangée (8 à 16), à gauche ou à droite avec une chance sur deux ;
--   la case d'arrivée est le nombre de rebonds à droite et multiplie la mise.
-- * Les multiplicateurs sont dans plinko_payouts (en centièmes : ×0,2 = 20), lus par le site : une
--   seule source, pas de copie en TypeScript. Tables symétriques, retour au joueur entre 96,5 % et
--   97,5 % pour chaque nombre de rangées et chaque risque (vérifié par scripts/sql-test.mjs).
-- * casino_plinko tire le chemin au serveur, paie floor(mise × mult / 100) et note la bille dans
--   casino_spins pour les amis qui regardent.
-- À exécuter une fois, après 0051_classement_td_chapitre2.sql.

set client_encoding = 'UTF8';

create table public.plinko_payouts (
  rows smallint not null check (rows between 8 and 16),
  risk text not null check (risk in ('low', 'medium', 'high')),
  slot smallint not null check (slot between 0 and rows),
  mult_x100 int not null check (mult_x100 >= 0),
  primary key (rows, risk, slot)
);
alter table public.plinko_payouts enable row level security;
create policy "lecture pour tous" on public.plinko_payouts for select to anon, authenticated using (true);
revoke all on public.plinko_payouts from anon, authenticated;
grant select on public.plinko_payouts to anon, authenticated;

insert into public.plinko_payouts (rows, risk, slot, mult_x100) values
  -- 8 rangées, risque bas : retour 96,99 %
  (8, 'low', 0, 550), (8, 'low', 1, 210), (8, 'low', 2, 110), (8, 'low', 3, 100), (8, 'low', 4, 43), (8, 'low', 5, 100), (8, 'low', 6, 110), (8, 'low', 7, 210), (8, 'low', 8, 550),
  -- 8 rangées, risque moyen : retour 97,13 %
  (8, 'medium', 0, 1300), (8, 'medium', 1, 290), (8, 'medium', 2, 130), (8, 'medium', 3, 68), (8, 'medium', 4, 39), (8, 'medium', 5, 68), (8, 'medium', 6, 130), (8, 'medium', 7, 290), (8, 'medium', 8, 1300),
  -- 8 rangées, risque haut : retour 96,95 %
  (8, 'high', 0, 2800), (8, 'high', 1, 390), (8, 'high', 2, 150), (8, 'high', 3, 29), (8, 'high', 4, 19), (8, 'high', 5, 29), (8, 'high', 6, 150), (8, 'high', 7, 390), (8, 'high', 8, 2800),
  -- 9 rangées, risque bas : retour 96,98 %
  (9, 'low', 0, 550), (9, 'low', 1, 200), (9, 'low', 2, 160), (9, 'low', 3, 100), (9, 'low', 4, 66), (9, 'low', 5, 66), (9, 'low', 6, 100), (9, 'low', 7, 160), (9, 'low', 8, 200), (9, 'low', 9, 550),
  -- 9 rangées, risque moyen : retour 96,82 %
  (9, 'medium', 0, 1800), (9, 'medium', 1, 390), (9, 'medium', 2, 170), (9, 'medium', 3, 87), (9, 'medium', 4, 48), (9, 'medium', 5, 48), (9, 'medium', 6, 87), (9, 'medium', 7, 170), (9, 'medium', 8, 390), (9, 'medium', 9, 1800),
  -- 9 rangées, risque haut : retour 96,84 %
  (9, 'high', 0, 4200), (9, 'high', 1, 690), (9, 'high', 2, 200), (9, 'high', 3, 57), (9, 'high', 4, 19), (9, 'high', 5, 19), (9, 'high', 6, 57), (9, 'high', 7, 200), (9, 'high', 8, 690), (9, 'high', 9, 4200),
  -- 10 rangées, risque bas : retour 97,05 %
  (10, 'low', 0, 870), (10, 'low', 1, 290), (10, 'low', 2, 140), (10, 'low', 3, 110), (10, 'low', 4, 100), (10, 'low', 5, 43), (10, 'low', 6, 100), (10, 'low', 7, 110), (10, 'low', 8, 140), (10, 'low', 9, 290), (10, 'low', 10, 870),
  -- 10 rangées, risque moyen : retour 96,99 %
  (10, 'medium', 0, 2200), (10, 'medium', 1, 490), (10, 'medium', 2, 200), (10, 'medium', 3, 140), (10, 'medium', 4, 57), (10, 'medium', 5, 38), (10, 'medium', 6, 57), (10, 'medium', 7, 140), (10, 'medium', 8, 200), (10, 'medium', 9, 490), (10, 'medium', 10, 2200),
  -- 10 rangées, risque haut : retour 97,17 %
  (10, 'high', 0, 7400), (10, 'high', 1, 980), (10, 'high', 2, 290), (10, 'high', 3, 89), (10, 'high', 4, 30), (10, 'high', 5, 20), (10, 'high', 6, 30), (10, 'high', 7, 89), (10, 'high', 8, 290), (10, 'high', 9, 980), (10, 'high', 10, 7400),
  -- 11 rangées, risque bas : retour 97,07 %
  (11, 'low', 0, 820), (11, 'low', 1, 290), (11, 'low', 2, 190), (11, 'low', 3, 130), (11, 'low', 4, 100), (11, 'low', 5, 66), (11, 'low', 6, 66), (11, 'low', 7, 100), (11, 'low', 8, 130), (11, 'low', 9, 190), (11, 'low', 10, 290), (11, 'low', 11, 820),
  -- 11 rangées, risque moyen : retour 96,83 %
  (11, 'medium', 0, 2400), (11, 'medium', 1, 590), (11, 'medium', 2, 290), (11, 'medium', 3, 180), (11, 'medium', 4, 68), (11, 'medium', 5, 48), (11, 'medium', 6, 48), (11, 'medium', 7, 68), (11, 'medium', 8, 180), (11, 'medium', 9, 290), (11, 'medium', 10, 590), (11, 'medium', 11, 2400),
  -- 11 rangées, risque haut : retour 97,21 %
  (11, 'high', 0, 12000), (11, 'high', 1, 1400), (11, 'high', 2, 510), (11, 'high', 3, 140), (11, 'high', 4, 37), (11, 'high', 5, 19), (11, 'high', 6, 19), (11, 'high', 7, 37), (11, 'high', 8, 140), (11, 'high', 9, 510), (11, 'high', 10, 1400), (11, 'high', 11, 12000),
  -- 12 rangées, risque bas : retour 97,11 %
  (12, 'low', 0, 980), (12, 'low', 1, 290), (12, 'low', 2, 160), (12, 'low', 3, 140), (12, 'low', 4, 110), (12, 'low', 5, 100), (12, 'low', 6, 42), (12, 'low', 7, 100), (12, 'low', 8, 110), (12, 'low', 9, 140), (12, 'low', 10, 160), (12, 'low', 11, 290), (12, 'low', 12, 980),
  -- 12 rangées, risque moyen : retour 97,01 %
  (12, 'medium', 0, 3200), (12, 'medium', 1, 1100), (12, 'medium', 2, 390), (12, 'medium', 3, 200), (12, 'medium', 4, 110), (12, 'medium', 5, 57), (12, 'medium', 6, 28), (12, 'medium', 7, 57), (12, 'medium', 8, 110), (12, 'medium', 9, 200), (12, 'medium', 10, 390), (12, 'medium', 11, 1100), (12, 'medium', 12, 3200),
  -- 12 rangées, risque haut : retour 96,79 %
  (12, 'high', 0, 17000), (12, 'high', 1, 2300), (12, 'high', 2, 790), (12, 'high', 3, 200), (12, 'high', 4, 68), (12, 'high', 5, 19), (12, 'high', 6, 19), (12, 'high', 7, 19), (12, 'high', 8, 68), (12, 'high', 9, 200), (12, 'high', 10, 790), (12, 'high', 11, 2300), (12, 'high', 12, 17000),
  -- 13 rangées, risque bas : retour 96,99 %
  (13, 'low', 0, 790), (13, 'low', 1, 390), (13, 'low', 2, 290), (13, 'low', 3, 190), (13, 'low', 4, 120), (13, 'low', 5, 87), (13, 'low', 6, 68), (13, 'low', 7, 68), (13, 'low', 8, 87), (13, 'low', 9, 120), (13, 'low', 10, 190), (13, 'low', 11, 290), (13, 'low', 12, 390), (13, 'low', 13, 790),
  -- 13 rangées, risque moyen : retour 97,03 %
  (13, 'medium', 0, 4200), (13, 'medium', 1, 1300), (13, 'medium', 2, 590), (13, 'medium', 3, 290), (13, 'medium', 4, 130), (13, 'medium', 5, 68), (13, 'medium', 6, 39), (13, 'medium', 7, 39), (13, 'medium', 8, 68), (13, 'medium', 9, 130), (13, 'medium', 10, 290), (13, 'medium', 11, 590), (13, 'medium', 12, 1300), (13, 'medium', 13, 4200),
  -- 13 rangées, risque haut : retour 97,09 %
  (13, 'high', 0, 25000), (13, 'high', 1, 3600), (13, 'high', 2, 1100), (13, 'high', 3, 390), (13, 'high', 4, 100), (13, 'high', 5, 19), (13, 'high', 6, 19), (13, 'high', 7, 19), (13, 'high', 8, 19), (13, 'high', 9, 100), (13, 'high', 10, 390), (13, 'high', 11, 1100), (13, 'high', 12, 3600), (13, 'high', 13, 25000),
  -- 14 rangées, risque bas : retour 97,10 %
  (14, 'low', 0, 700), (14, 'low', 1, 390), (14, 'low', 2, 190), (14, 'low', 3, 140), (14, 'low', 4, 130), (14, 'low', 5, 110), (14, 'low', 6, 100), (14, 'low', 7, 41), (14, 'low', 8, 100), (14, 'low', 9, 110), (14, 'low', 10, 130), (14, 'low', 11, 140), (14, 'low', 12, 190), (14, 'low', 13, 390), (14, 'low', 14, 700),
  -- 14 rangées, risque moyen : retour 97,12 %
  (14, 'medium', 0, 5700), (14, 'medium', 1, 1500), (14, 'medium', 2, 690), (14, 'medium', 3, 390), (14, 'medium', 4, 190), (14, 'medium', 5, 100), (14, 'medium', 6, 47), (14, 'medium', 7, 19), (14, 'medium', 8, 47), (14, 'medium', 9, 100), (14, 'medium', 10, 190), (14, 'medium', 11, 390), (14, 'medium', 12, 690), (14, 'medium', 13, 1500), (14, 'medium', 14, 5700),
  -- 14 rangées, risque haut : retour 97,18 %
  (14, 'high', 0, 41000), (14, 'high', 1, 5500), (14, 'high', 2, 1800), (14, 'high', 3, 490), (14, 'high', 4, 190), (14, 'high', 5, 28), (14, 'high', 6, 19), (14, 'high', 7, 19), (14, 'high', 8, 19), (14, 'high', 9, 28), (14, 'high', 10, 190), (14, 'high', 11, 490), (14, 'high', 12, 1800), (14, 'high', 13, 5500), (14, 'high', 14, 41000),
  -- 15 rangées, risque bas : retour 96,95 %
  (15, 'low', 0, 1500), (15, 'low', 1, 780), (15, 'low', 2, 290), (15, 'low', 3, 200), (15, 'low', 4, 150), (15, 'low', 5, 110), (15, 'low', 6, 100), (15, 'low', 7, 65), (15, 'low', 8, 65), (15, 'low', 9, 100), (15, 'low', 10, 110), (15, 'low', 11, 150), (15, 'low', 12, 200), (15, 'low', 13, 290), (15, 'low', 14, 780), (15, 'low', 15, 1500),
  -- 15 rangées, risque moyen : retour 96,87 %
  (15, 'medium', 0, 8600), (15, 'medium', 1, 1800), (15, 'medium', 2, 1100), (15, 'medium', 3, 490), (15, 'medium', 4, 290), (15, 'medium', 5, 130), (15, 'medium', 6, 48), (15, 'medium', 7, 29), (15, 'medium', 8, 29), (15, 'medium', 9, 48), (15, 'medium', 10, 130), (15, 'medium', 11, 290), (15, 'medium', 12, 490), (15, 'medium', 13, 1100), (15, 'medium', 14, 1800), (15, 'medium', 15, 8600),
  -- 15 rangées, risque haut : retour 96,94 %
  (15, 'high', 0, 61000), (15, 'high', 1, 8100), (15, 'high', 2, 2600), (15, 'high', 3, 780), (15, 'high', 4, 290), (15, 'high', 5, 51), (15, 'high', 6, 20), (15, 'high', 7, 20), (15, 'high', 8, 20), (15, 'high', 9, 20), (15, 'high', 10, 51), (15, 'high', 11, 290), (15, 'high', 12, 780), (15, 'high', 13, 2600), (15, 'high', 14, 8100), (15, 'high', 15, 61000),
  -- 16 rangées, risque bas : retour 97,03 %
  (16, 'low', 0, 1600), (16, 'low', 1, 880), (16, 'low', 2, 200), (16, 'low', 3, 140), (16, 'low', 4, 140), (16, 'low', 5, 120), (16, 'low', 6, 110), (16, 'low', 7, 100), (16, 'low', 8, 40), (16, 'low', 9, 100), (16, 'low', 10, 110), (16, 'low', 11, 120), (16, 'low', 12, 140), (16, 'low', 13, 140), (16, 'low', 14, 200), (16, 'low', 15, 880), (16, 'low', 16, 1600),
  -- 16 rangées, risque moyen : retour 97,25 %
  (16, 'medium', 0, 11000), (16, 'medium', 1, 4000), (16, 'medium', 2, 980), (16, 'medium', 3, 490), (16, 'medium', 4, 290), (16, 'medium', 5, 150), (16, 'medium', 6, 100), (16, 'medium', 7, 48), (16, 'medium', 8, 29), (16, 'medium', 9, 48), (16, 'medium', 10, 100), (16, 'medium', 11, 150), (16, 'medium', 12, 290), (16, 'medium', 13, 490), (16, 'medium', 14, 980), (16, 'medium', 15, 4000), (16, 'medium', 16, 11000),
  -- 16 rangées, risque haut : retour 96,86 %
  (16, 'high', 0, 98000), (16, 'high', 1, 13000), (16, 'high', 2, 2500), (16, 'high', 3, 880), (16, 'high', 4, 390), (16, 'high', 5, 200), (16, 'high', 6, 19), (16, 'high', 7, 19), (16, 'high', 8, 19), (16, 'high', 9, 19), (16, 'high', 10, 19), (16, 'high', 11, 200), (16, 'high', 12, 390), (16, 'high', 13, 880), (16, 'high', 14, 2500), (16, 'high', 15, 13000), (16, 'high', 16, 98000);

alter table public.casino_spins
  drop constraint casino_spins_game_check,
  add constraint casino_spins_game_check check (game in ('roulette', 'slots', 'plinko'));

-- Une bille : rangées et risque vérifiés avant tout débit, puis un rebond tiré par rangée.
create function public.casino_plinko(bet bigint, rows int, risk text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  path int[] := '{}';
  s int := 0;
  b int;
  i int;
  mult int;
  payout bigint;
  bal bigint;
begin
  if casino_plinko.rows is null or casino_plinko.rows not between 8 and 16 then
    raise exception 'nombre de rangées invalide (8 à 16)' using errcode = '22023';
  end if;
  if casino_plinko.risk is null or casino_plinko.risk not in ('low', 'medium', 'high') then
    raise exception 'risque inconnu' using errcode = '22023';
  end if;
  uid := public.casino_check(bet);
  for i in 1..casino_plinko.rows loop
    b := (random() < 0.5)::int; -- 0 = gauche, 1 = droite
    path := path || b;
    s := s + b;
  end loop;
  select p.mult_x100 into mult from public.plinko_payouts p
   where p.rows = casino_plinko.rows and p.risk = casino_plinko.risk and p.slot = s;
  if mult is null then
    raise exception 'table du Plinko incomplète' using errcode = 'P0001';
  end if;
  -- En numeric : bet × mult dépasserait bigint pour une mise énorme (casino « All in », 0048).
  payout := floor(bet::numeric * mult / 100)::bigint;
  bal := public.casino_settle(uid, bet, payout, 'Plinko : ×' ||
    case when mult % 100 = 0 then (mult / 100)::text
         else replace(rtrim((mult / 100.0)::numeric(10, 2)::text, '0'), '.', ',') end);
  perform public.casino_spin_log(uid, 'plinko', jsonb_build_object('rows', casino_plinko.rows, 'risk', casino_plinko.risk,
    'path', to_jsonb(path), 'slot', s, 'mult_x100', mult), bet, payout, bal);
  return jsonb_build_object('path', to_jsonb(path), 'slot', s, 'mult_x100', mult, 'stake', bet, 'payout', payout, 'balance', bal);
end $$;

revoke execute on function public.casino_plinko(bigint, int, text) from public, anon;
grant execute on function public.casino_plinko(bigint, int, text) to authenticated;
