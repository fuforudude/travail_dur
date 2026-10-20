-- Points et casino.
--
-- Chaque partie terminée rapporte des points, attribués par le serveur lui-même (déclencheurs sur
-- les tables de parties) : le client ne peut ni choisir ni gonfler ses gains. Les points se misent
-- à la roulette et à la machine à sous, dont le tirage est fait ici aussi.
-- Barème (à garder identique à src/net/points.ts, qui l'affiche) :
--   2048       √score, + 30 / 150 / 400 pour les tuiles 1024 / 2048 / 4096
--   Tetris     √score
--   Flappy     score^1,5 / 4 (10 tuyaux : 7 ; 40 tuyaux : 63)
--   Tower def. 2 × n pour la vague n (vague 10 atteinte : 110 au total)
--   Wordle     trouvé en n essais : 40 + 15 × (6 − n) ; raté : 5
--   À deux     victoire : Morpion 15, Puissance 4 30, Quarto 40, Quoridor 60, Dames 90, Échecs 100 ;
--              nul : un tiers ; défaite : 3 ; victoire par abandon ou au temps : moitié.
--              Partie trop courte : rien. Au-delà de 10 parties par jour contre le même adversaire : rien.
--   Records    record personnel battu : +100 ; record absolu (tous joueurs) : +500.
--   Bienvenue  100 points à l'ouverture du portefeuille.
-- À exécuter une fois, après 0006_plateaux.sql.

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- Portefeuilles et historique
-- ---------------------------------------------------------------------------

create table public.wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  earned bigint not null default 0, -- gagné en jouant (hors casino)
  updated_at timestamptz not null default now()
);

create table public.point_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount bigint not null,
  reason text not null,
  kind text not null default 'game' check (kind in ('game', 'record', 'bonus', 'casino')),
  created_at timestamptz not null default now()
);
create index point_events_user on public.point_events (user_id, created_at desc);

alter table public.wallets enable row level security;
alter table public.point_events enable row level security;
create policy "soldes lisibles par tous" on public.wallets for select to anon, authenticated using (true);
create policy "son propre historique" on public.point_events for select to authenticated using (user_id = auth.uid());
revoke all on public.wallets, public.point_events from anon, authenticated;
grant select on public.wallets to anon, authenticated;
grant select on public.point_events to authenticated;

-- Ouvre le portefeuille s'il n'existe pas (avec les points de bienvenue).
create function public.points_open(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.wallets (user_id, balance) values (uid, 100) on conflict do nothing;
  if found then
    insert into public.point_events (user_id, amount, reason, kind) values (uid, 100, 'Bienvenue !', 'bonus');
  end if;
end $$;

create function public.points_add(uid uuid, amount bigint, reason text, kind text default 'game') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if uid is null or amount is null or amount <= 0 then return; end if;
  perform public.points_open(uid);
  update public.wallets
     set balance = balance + amount,
         earned = earned + case when kind = 'casino' then 0 else amount end,
         updated_at = now()
   where user_id = uid;
  insert into public.point_events (user_id, amount, reason, kind) values (uid, amount, reason, kind);
end $$;

-- ---------------------------------------------------------------------------
-- Barème
-- ---------------------------------------------------------------------------

create function public.points_2048(score int, max_tile int) returns int
language sql immutable set search_path = '' as $$
  select round(sqrt(greatest(score, 0)))::int
       + case when max_tile >= 4096 then 400 when max_tile >= 2048 then 150 when max_tile >= 1024 then 30 else 0 end
$$;

create function public.points_tetris(score int) returns int
language sql immutable set search_path = '' as $$ select round(sqrt(greatest(score, 0)))::int $$;

create function public.points_flappy(score int) returns int
language sql immutable set search_path = '' as $$ select floor(power(greatest(score, 0), 1.5) / 4)::int $$;

-- Total pour les vagues a+1 .. b.
create function public.points_td(a int, b int) returns int
language sql immutable set search_path = '' as $$ select greatest(0, b * (b + 1) - a * (a + 1)) $$;

create function public.points_wordle(solved boolean, tries int) returns int
language sql immutable set search_path = '' as $$ select case when solved then 40 + 15 * (6 - tries) else 5 end $$;

create function public.points_duel_value(game text) returns int
language sql immutable set search_path = '' as $$
  select case game when 'tictactoe' then 15 when 'connect4' then 30 when 'quarto' then 40
                   when 'quoridor' then 60 when 'checkers' then 90 when 'chess' then 100 else 0 end
$$;

-- En dessous, la partie est trop courte pour rapporter (abandon immédiat, parties arrangées…).
create function public.points_duel_min_moves(game text) returns int
language sql immutable set search_path = '' as $$
  select case game when 'tictactoe' then 5 when 'connect4' then 7 when 'quarto' then 6
                   when 'quoridor' then 10 when 'checkers' then 12 when 'chess' then 12 else 1000 end
$$;

create function public.points_game_name(game text) returns text
language sql immutable set search_path = '' as $$
  select case game when 'tictactoe' then 'Morpion' when 'connect4' then 'Puissance 4' when 'quarto' then 'Quarto'
                   when 'quoridor' then 'Quoridor' when 'checkers' then 'Dames' when 'chess' then 'Échecs' else game end
$$;

-- Records : `prev` = meilleur score précédent du joueur, `world` = meilleur score précédent de tous.
create function public.points_records(uid uuid, label text, score int, prev int, world int, minimum int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if world is not null and score > world then
    perform public.points_add(uid, 500, 'Record absolu ' || label || ' !', 'record');
  elsif prev is not null and score > prev and score >= minimum then
    perform public.points_add(uid, 100, 'Record personnel ' || label, 'record');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Déclencheurs : les points tombent quand le serveur enregistre la fin d'une partie.
-- ---------------------------------------------------------------------------

create function public.points_on_2048() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev int; world int;
begin
  if old.finished_at is not null or new.finished_at is null then return new; end if;
  perform public.points_add(new.user_id, public.points_2048(new.score, new.max_tile), '2048 : ' || new.score);
  select max(score) into prev from public.g2048_sessions where user_id = new.user_id and finished_at is not null and id <> new.id;
  select max(score) into world from public.g2048_sessions where finished_at is not null and id <> new.id;
  perform public.points_records(new.user_id, 'au 2048', new.score, prev, world, 2000);
  return new;
end $$;
create trigger points_2048 after update on public.g2048_sessions for each row execute function public.points_on_2048();

create function public.points_on_tetris() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev int; world int;
begin
  if old.finished_at is not null or new.finished_at is null then return new; end if;
  perform public.points_add(new.user_id, public.points_tetris(new.score), 'Tetris : ' || new.score);
  select max(score) into prev from public.tetris_sessions where user_id = new.user_id and finished_at is not null and id <> new.id;
  select max(score) into world from public.tetris_sessions where finished_at is not null and id <> new.id;
  perform public.points_records(new.user_id, 'à Tetris', new.score, prev, world, 2000);
  return new;
end $$;
create trigger points_tetris after update on public.tetris_sessions for each row execute function public.points_on_tetris();

create function public.points_on_flappy() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev int; world int;
begin
  if old.finished_at is not null or new.finished_at is null then return new; end if;
  perform public.points_add(new.user_id, public.points_flappy(new.score), 'Flappy : ' || new.score || ' tuyaux');
  select max(score) into prev from public.flappy_sessions where user_id = new.user_id and finished_at is not null and id <> new.id;
  select max(score) into world from public.flappy_sessions where finished_at is not null and id <> new.id;
  perform public.points_records(new.user_id, 'à Flappy', new.score, prev, world, 10);
  return new;
end $$;
create trigger points_flappy after update on public.flappy_sessions for each row execute function public.points_on_flappy();

create function public.points_on_td() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev int; world int;
begin
  if new.wave <= old.wave then return new; end if;
  perform public.points_add(new.user_id, public.points_td(old.wave, new.wave), 'Tower defense : vague ' || new.wave);
  select max(wave) into prev from public.td_sessions where user_id = new.user_id and id <> new.id;
  select max(wave) into world from public.td_sessions where id <> new.id;
  -- Une seule récompense par record : à la vague qui le dépasse.
  if world is not null and new.wave > world and old.wave <= world then
    perform public.points_add(new.user_id, 500, 'Record absolu au Tower defense !', 'record');
  elsif prev is not null and new.wave > prev and old.wave <= prev and new.wave >= 5 then
    perform public.points_add(new.user_id, 100, 'Record personnel au Tower defense', 'record');
  end if;
  return new;
end $$;
create trigger points_td after update on public.td_sessions for each row execute function public.points_on_td();

create function public.points_on_wordle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.finished or not new.finished then return new; end if;
  perform public.points_add(
    new.user_id,
    public.points_wordle(new.solved, cardinality(new.guesses)),
    case when new.solved then 'Wordle trouvé en ' || cardinality(new.guesses) else 'Wordle' end
  );
  return new;
end $$;
create trigger points_wordle after update on public.wordle_games for each row execute function public.points_on_wordle();

create function public.points_on_match() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  value int := public.points_duel_value(new.game);
  label text := public.points_game_name(new.game);
  winner_id uuid;
  loser_id uuid;
  played_today int;
begin
  if old.status <> 'playing' or new.status not in ('won', 'draw', 'forfeit', 'timeout') then return new; end if;
  if new.moves < public.points_duel_min_moves(new.game) then return new; end if;
  select count(*) into played_today from public.matches
   where id <> new.id and status in ('won', 'draw', 'forfeit', 'timeout')
     and updated_at > now() - interval '1 day'
     and least(p1, p2) = least(new.p1, new.p2) and greatest(p1, p2) = greatest(new.p1, new.p2);
  if played_today >= 10 then return new; end if;
  if new.status = 'draw' then
    perform public.points_add(new.p1, value / 3, label || ' : match nul');
    perform public.points_add(new.p2, value / 3, label || ' : match nul');
    return new;
  end if;
  winner_id := case when new.winner = 1 then new.p1 else new.p2 end;
  loser_id := case when new.winner = 1 then new.p2 else new.p1 end;
  if new.status = 'won' then
    perform public.points_add(winner_id, value, label || ' : victoire');
    perform public.points_add(loser_id, 3, label || ' : défaite');
  else
    perform public.points_add(winner_id, value / 2, label || ' : victoire ' || case when new.status = 'forfeit' then 'par abandon' else 'au temps' end);
  end if;
  return new;
end $$;
create trigger points_match after update on public.matches for each row execute function public.points_on_match();

-- ---------------------------------------------------------------------------
-- Casino. Mise maximale 500 par tour ; le tirage se fait ici.
-- ---------------------------------------------------------------------------

-- Débite la mise, crédite le gain ; renvoie le nouveau solde. Le portefeuille est verrouillé pendant le tour.
create function public.casino_settle(uid uuid, stake bigint, payout bigint, reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  bal bigint;
begin
  update public.wallets set balance = balance - stake + payout, updated_at = now() where user_id = uid returning balance into bal;
  insert into public.point_events (user_id, amount, reason, kind) values (uid, payout - stake, reason, 'casino');
  return bal;
end $$;

create function public.casino_check(stake bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  bal bigint;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if stake is null or stake < 1 then raise exception 'mise invalide' using errcode = '22023'; end if;
  if stake > 500 then raise exception 'mise maximale : 500 points' using errcode = '22023'; end if;
  perform public.points_open(uid);
  select balance into bal from public.wallets where user_id = uid for update;
  if bal < stake then raise exception 'pas assez de points' using errcode = 'P0001'; end if;
  if (select count(*) from public.point_events where user_id = uid and kind = 'casino' and created_at > now() - interval '10 seconds') >= 12 then
    raise exception 'doucement : trop de mises d’un coup' using errcode = 'P0001';
  end if;
  return uid;
end $$;

-- Roulette européenne (37 cases, un seul zéro). `bets` : {"red": 10, "n17": 5, …}.
-- Mises : n0..n36 (plein, ×36), red / black / even / odd / low / high (×2), d1 / d2 / d3 (douzaines, ×3).
create function public.casino_roulette(bets jsonb) returns jsonb
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
  return jsonb_build_object('number', n, 'stake', stake, 'payout', payout, 'balance', bal);
end $$;

-- Machine à sous : 3 rouleaux, chacun tiré selon les poids ci-dessous (sur 32).
--   0 cerise 10 · 1 citron 8 · 2 cloche 6 · 3 étoile 4 · 4 diamant 3 · 5 sept 1
-- Gains (× la mise) : trois identiques 5 / 9 / 18 / 36 / 75 / 400 ; exactement deux cerises : 2.
-- Retour au joueur ≈ 95,9 % (calculé dans src/ui/slots.ts).
create function public.casino_slots(bet bigint) returns jsonb
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
  return jsonb_build_object('reels', reels, 'stake', bet, 'payout', bet * mult, 'balance', bal);
end $$;

-- Le client ouvre son portefeuille (et reçoit les points de bienvenue) à la première visite.
create function public.points_wallet() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  w public.wallets;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  perform public.points_open(uid);
  select * into w from public.wallets where user_id = uid;
  return jsonb_build_object('balance', w.balance, 'earned', w.earned);
end $$;

-- ---------------------------------------------------------------------------
-- Classement et ouverture des portefeuilles existants
-- ---------------------------------------------------------------------------

create view public.leaderboard_points with (security_invoker = true) as
select p.id as user_id, p.username, w.balance, w.earned
  from public.wallets w
  join public.profiles p on p.id = w.user_id
 where p.verified;
grant select on public.leaderboard_points to anon, authenticated;

-- Les parties jouées avant cette version comptent aussi (sans les bonus de record).
do $$
declare
  p record;
  total bigint;
begin
  for p in select id from public.profiles loop
    perform public.points_open(p.id);
    total :=
      coalesce((select sum(public.points_2048(score, max_tile)) from public.g2048_sessions where user_id = p.id and finished_at is not null), 0)
      + coalesce((select sum(public.points_tetris(score)) from public.tetris_sessions where user_id = p.id and finished_at is not null), 0)
      + coalesce((select sum(public.points_flappy(score)) from public.flappy_sessions where user_id = p.id and finished_at is not null), 0)
      + coalesce((select sum(public.points_td(0, wave)) from public.td_sessions where user_id = p.id), 0)
      + coalesce((select sum(public.points_wordle(solved, cardinality(guesses))) from public.wordle_games where user_id = p.id and finished), 0)
      + coalesce((select sum(case
            when m.status = 'draw' then public.points_duel_value(m.game) / 3
            when (m.winner = 1 and m.p1 = p.id) or (m.winner = 2 and m.p2 = p.id) then
              case when m.status = 'won' then public.points_duel_value(m.game) else public.points_duel_value(m.game) / 2 end
            when m.status = 'won' then 3
            else 0 end)
          from public.matches m
         where p.id in (m.p1, m.p2) and m.status in ('won', 'draw', 'forfeit', 'timeout')
           and m.moves >= public.points_duel_min_moves(m.game)), 0);
    perform public.points_add(p.id, total, 'Parties déjà jouées', 'bonus');
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.wallets, public.point_events;
  end if;
end $$;

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
  public.points_wallet(), public.casino_roulette(jsonb), public.casino_slots(bigint)
  to authenticated;
grant execute on function public.leaderboard_duel(text) to anon, authenticated;
