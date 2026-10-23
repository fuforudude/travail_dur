-- Regarder un ami jouer au casino, en direct.
-- * Chaque tour de roulette ou de machine à sous est noté dans casino_spins (mises, résultat, gain,
--   solde après le tour), lisible par le joueur et par ses amis, et diffusé en temps réel. Le site
--   d'un spectateur rejoue l'animation au moment où le joueur lance (page #/regarder/<id>).
-- * On ne garde que la dernière heure de chaque joueur.
-- * casino_roulette et casino_slots : identiques à 0007_points_casino.sql, plus la ligne de journal.
-- À exécuter une fois, après 0048_all_in.sql.

set client_encoding = 'UTF8';

create table public.casino_spins (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  game text not null check (game in ('roulette', 'slots')),
  detail jsonb not null, -- roulette : {number, bets} ; machine à sous : {reels}
  stake bigint not null,
  payout bigint not null,
  balance bigint not null,
  created_at timestamptz not null default now()
);
create index casino_spins_user on public.casino_spins (user_id, id desc);
alter table public.casino_spins enable row level security;
create policy "ses tours et ceux de ses amis" on public.casino_spins for select to authenticated
  using (user_id = (select auth.uid()) or public.are_friends((select auth.uid()), user_id));
revoke all on public.casino_spins from anon, authenticated;
grant select on public.casino_spins to authenticated;

create function public.casino_spin_log(uid uuid, g text, d jsonb, stake bigint, payout bigint, bal bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.casino_spins where user_id = uid and created_at < now() - interval '1 hour';
  insert into public.casino_spins (user_id, game, detail, stake, payout, balance) values (uid, g, d, stake, payout, bal);
end $$;

create or replace function public.casino_roulette(bets jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  reds int[] := array[1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  uid uuid;
  stake bigint := 0;
  payout bigint := 0;
  n int;
  k text;
  v jsonb;
  amount bigint;
  wins boolean;
  mult int;
  bal bigint;
begin
  if bets is null or jsonb_typeof(bets) <> 'object' or (select count(*) from jsonb_object_keys(bets)) not between 1 and 40 then
    raise exception 'mises invalides' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(bets) loop
    if k !~ '^(n([0-9]|[12][0-9]|3[0-6])|red|black|even|odd|low|high|d[123])$' then
      raise exception 'mise inconnue : %', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]+$' or (v #>> '{}')::bigint < 1 then
      raise exception 'montant invalide' using errcode = '22023';
    end if;
    stake := stake + (v #>> '{}')::bigint;
  end loop;
  uid := public.casino_check(stake);
  n := floor(random() * 37)::int;
  for k, v in select * from jsonb_each(bets) loop
    amount := (v #>> '{}')::bigint;
    wins := case
      when k like 'n%' then substr(k, 2)::int = n
      when k = 'red' then n = any(reds)
      when k = 'black' then n > 0 and not n = any(reds)
      when k = 'even' then n > 0 and n % 2 = 0
      when k = 'odd' then n % 2 = 1
      when k = 'low' then n between 1 and 18
      when k = 'high' then n between 19 and 36
      else n between (substr(k, 2)::int - 1) * 12 + 1 and substr(k, 2)::int * 12
    end;
    mult := case when k like 'n%' then 36 when k like 'd%' then 3 else 2 end;
    if wins then payout := payout + amount * mult; end if;
  end loop;
  bal := public.casino_settle(uid, stake, payout,
    'Roulette : ' || n || case when n = 0 then ' vert' when n = any(reds) then ' rouge' else ' noir' end);
  perform public.casino_spin_log(uid, 'roulette', jsonb_build_object('number', n, 'bets', bets), stake, payout, bal);
  return jsonb_build_object('number', n, 'stake', stake, 'payout', payout, 'balance', bal);
end $$;

create or replace function public.casino_slots(bet bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  weights int[] := array[10, 8, 6, 4, 3, 1];
  triple int[] := array[5, 9, 18, 36, 75, 400];
  uid uuid := public.casino_check(bet);
  reels int[] := '{}';
  r int; acc int; s int; i int;
  cherries int;
  mult int := 0;
  bal bigint;
begin
  for i in 1..3 loop
    r := floor(random() * 32)::int;
    acc := 0;
    for s in 1..6 loop
      acc := acc + weights[s];
      if r < acc then reels := reels || (s - 1); exit; end if;
    end loop;
  end loop;
  cherries := (reels[1] = 0)::int + (reels[2] = 0)::int + (reels[3] = 0)::int;
  if reels[1] = reels[2] and reels[2] = reels[3] then mult := triple[reels[1] + 1];
  elsif cherries = 2 then mult := 2;
  end if;
  bal := public.casino_settle(uid, bet, bet * mult, 'Machine à sous' || case when mult > 0 then ' : ×' || mult else '' end);
  perform public.casino_spin_log(uid, 'slots', jsonb_build_object('reels', to_jsonb(reels)), bet, bet * mult, bal);
  return jsonb_build_object('reels', reels, 'stake', bet, 'payout', bet * mult, 'balance', bal);
end $$;


revoke execute on function public.casino_spin_log(uuid, text, jsonb, bigint, bigint, bigint) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.casino_spins;
  end if;
end $$;
