-- Plinko en rafale (spec docs/specs/2026-11-13-plinko-rafale.md).
-- * casino_plinko_batch tire jusqu'à 15 billes en un appel : même mise, mêmes rangées, même risque.
-- * Limite propre au Plinko : 15 billes par seconde par joueur, par un seau à jetons (capacité 15,
--   recharge 15 jetons/s, 1 jeton par bille) rangé dans plinko_rate. Une rafale de 15 d'un coup est
--   possible, puis 15/s sans fin. Un second seau limite les appels : capacité 8, recharge 8 appels/s,
--   1 appel par envoi accepté (même horloge « at »), pour borner le travail du serveur. Ce qui dépasse le seau ou le solde n'est pas tiré : la réponse dit
--   combien de billes sont refusées, et seules les billes tirées sont débitées.
-- * Un envoi = une ligne point_events (« Plinko : 4 billes, misé 40, gagné 52 ») et une ligne
--   casino_spins (detail : rows, risk, bet, paths, slots, mults_x100) pour les amis qui regardent.
-- * casino_plinko (0052, une bille) reste en place pour les pages déjà ouvertes.
-- À exécuter une fois, après 0052_plinko.sql.

set client_encoding = 'UTF8';

-- Seau à jetons de chaque joueur : jetons restants à l'instant « at ». Aucun droit pour les joueurs,
-- seule casino_plinko_batch (security definer) le lit et l'écrit.
create table public.plinko_rate (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  tokens numeric not null,
  calls numeric not null,
  at timestamptz not null
);
alter table public.plinko_rate enable row level security;
revoke all on public.plinko_rate from anon, authenticated;

-- La purge de casino_spin_log filtre sur created_at ; profite aussi à la roulette et à la machine à sous.
create index casino_spins_user_created on public.casino_spins (user_id, created_at);

create function public.casino_plinko_batch(bet bigint, rows int, risk text, n int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  bal bigint;
  tok numeric;
  last_at timestamptz;
  cal numeric;
  elapsed numeric;
  k int;
  j int;
  i int;
  b int;
  s int;
  path int[];
  mult int;
  paths jsonb := '[]';
  slots jsonb := '[]';
  mults jsonb := '[]';
  stake bigint;
  payout numeric := 0;
  total bigint;
begin
  -- Validations avant tout effet : aucun jeton consommé, rien de débité.
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if casino_plinko_batch.n is null or casino_plinko_batch.n not between 1 and 15 then
    raise exception 'nombre de billes invalide (1 à 15)' using errcode = '22023';
  end if;
  if casino_plinko_batch.rows is null or casino_plinko_batch.rows not between 8 and 16 then
    raise exception 'nombre de rangées invalide (8 à 16)' using errcode = '22023';
  end if;
  if casino_plinko_batch.risk is null or casino_plinko_batch.risk not in ('low', 'medium', 'high') then
    raise exception 'risque inconnu' using errcode = '22023';
  end if;
  if bet is null or bet < 1 then raise exception 'mise invalide' using errcode = '22023'; end if;

  -- Le verrou du portefeuille sérialise aussi les appels concurrents du même joueur sur son seau.
  perform public.points_open(uid);
  select w.balance into bal from public.wallets w where w.user_id = uid for update;

  -- Seau : plein (15) à la première bille, rechargé de 15 jetons par seconde écoulée, plafonné à 15.
  -- clock_timestamp() et non now() : les tests avancent l'heure en reculant « at ».
  select r.tokens, r.calls, r.at into tok, cal, last_at from public.plinko_rate r where r.user_id = uid;
  if not found then
    tok := 15;
    cal := 8;
  else
    elapsed := greatest(0, extract(epoch from clock_timestamp() - last_at));
    tok := least(15, tok + elapsed * 15);
    cal := least(8, cal + elapsed * 8);
  end if;

  -- Seau d'appels, avant toute écriture ni tirage : sans 1 appel disponible, rien n'est modifié.
  if cal < 1 then raise exception 'doucement : trop d''appels' using errcode = 'P0001'; end if;

  k := least(casino_plinko_batch.n, floor(tok)::int, least(floor(bal / bet), 15)::int);
  if k = 0 then
    if bal < bet then raise exception 'pas assez de points' using errcode = 'P0001'; end if;
    raise exception 'doucement : 15 billes par seconde au plus' using errcode = 'P0001';
  end if;
  insert into public.plinko_rate (user_id, tokens, calls, at) values (uid, tok - k, cal - 1, clock_timestamp())
    on conflict (user_id) do update set tokens = excluded.tokens, calls = excluded.calls, at = excluded.at;

  -- k billes : un rebond tiré par rangée (0 = gauche, 1 = droite), la case est la somme.
  for j in 1..k loop
    path := '{}';
    s := 0;
    for i in 1..casino_plinko_batch.rows loop
      b := (random() < 0.5)::int;
      path := path || b;
      s := s + b;
    end loop;
    select p.mult_x100 into mult from public.plinko_payouts p
     where p.rows = casino_plinko_batch.rows and p.risk = casino_plinko_batch.risk and p.slot = s;
    if mult is null then
      raise exception 'table du Plinko incomplète' using errcode = 'P0001';
    end if;
    -- En numeric : bet × mult dépasserait bigint pour une mise énorme (casino « All in », 0048).
    payout := payout + floor(bet::numeric * mult / 100);
    paths := paths || jsonb_build_array(to_jsonb(path));
    slots := slots || to_jsonb(s);
    mults := mults || to_jsonb(mult);
  end loop;

  stake := bet * k; -- k ≤ solde / mise : pas de débordement
  total := payout::bigint;
  bal := public.casino_settle(uid, stake, total, 'Plinko : ' || k ||
    case when k = 1 then ' bille' else ' billes' end || ', misé ' || stake || ', gagné ' || total);
  perform public.casino_spin_log(uid, 'plinko', jsonb_build_object('rows', casino_plinko_batch.rows,
    'risk', casino_plinko_batch.risk, 'bet', bet, 'paths', paths, 'slots', slots, 'mults_x100', mults), stake, total, bal);
  return jsonb_build_object('paths', paths, 'slots', slots, 'mults_x100', mults,
    'refused', casino_plinko_batch.n - k, 'stake', stake, 'payout', total, 'balance', bal);
end $$;

revoke execute on function public.casino_plinko_batch(bigint, int, text, int) from public, anon;
grant execute on function public.casino_plinko_batch(bigint, int, text, int) to authenticated;
