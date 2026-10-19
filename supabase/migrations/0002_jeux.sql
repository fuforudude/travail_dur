-- travail_dur : Morpion en ligne et Tetris classé.
--
-- 1. Les parties à deux deviennent génériques : c4_matches → matches (+ colonne game).
--    Défi, acceptation, revanche, abandon et victoire au temps sont communs à tous les jeux ;
--    seule la règle du coup dépend du jeu (match_play).
-- 2. Tetris : même principe que 2048 (graine serveur, rejeu complet des actions côté serveur).
--
-- À exécuter une fois, après 0001_init.sql.

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- Parties à deux, génériques
-- ---------------------------------------------------------------------------

drop view public.leaderboard_c4;
drop function public.c4_challenge(uuid, text);
drop function public.c4_respond(uuid, boolean);
drop function public.c4_play(uuid, int);
drop function public.c4_forfeit(uuid);
drop function public.c4_claim_timeout(uuid);
drop function public.c4_rematch(uuid);

alter table public.c4_matches rename to matches;
alter index public.c4_matches_p1 rename to matches_p1;
alter index public.c4_matches_p2 rename to matches_p2;
alter table public.matches add column game text not null default 'connect4'
  check (game in ('connect4', 'tictactoe'));
alter table public.matches alter column game drop default;
alter table public.matches alter column board drop default;

-- Plateau vide d'un jeu : 6×7 pour Puissance 4, 3×3 pour le Morpion.
create function public.match_empty_board(game_id text) returns smallint[]
language sql immutable set search_path = '' as $$
  select array_fill(0::smallint, array[case game_id when 'connect4' then 42 when 'tictactoe' then 9 end])
$$;

-- Morpion : retourne la ligne gagnante (3 cases 0..8) ou null.
create function public.ttt_line(board smallint[]) returns smallint[]
language plpgsql immutable set search_path = '' as $$
declare
  l int[];
begin
  foreach l slice 1 in array array[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]] loop
    if board[l[1] + 1] <> 0 and board[l[1] + 1] = board[l[2] + 1] and board[l[2] + 1] = board[l[3] + 1] then
      return array[l[1], l[2], l[3]]::smallint[];
    end if;
  end loop;
  return null;
end $$;

create function public.match_challenge(opponent uuid, room_code text, game_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  mid uuid;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if game_id is null or game_id not in ('connect4', 'tictactoe') then raise exception 'jeu inconnu' using errcode = '22023'; end if;
  if opponent = uid then raise exception 'impossible de se défier soi-même' using errcode = '22023'; end if;
  if room_code is null or room_code !~ '^[A-Z]{4}$' then raise exception 'salon invalide' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = opponent) then
    raise exception 'joueur inconnu' using errcode = 'P0002';
  end if;
  update public.matches set status = 'expired', updated_at = now()
   where status = 'pending' and created_at < now() - interval '2 minutes' and uid in (p1, p2);
  if (select count(*) from public.matches where p1 = uid and status = 'pending') >= 3 then
    raise exception 'trop de défis en attente' using errcode = 'P0001';
  end if;
  insert into public.matches (room, game, p1, p2, board)
  values (room_code, game_id, uid, opponent, public.match_empty_board(game_id))
  returning id into mid;
  return mid;
end $$;

create function public.match_respond(match_id uuid, accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  result text;
begin
  select * into m from public.matches where id = match_id for update;
  if not found or m.p2 is distinct from uid then raise exception 'défi inconnu' using errcode = 'P0002'; end if;
  if m.status <> 'pending' then raise exception 'défi déjà traité' using errcode = 'P0001'; end if;
  result := case
    when m.created_at < now() - interval '2 minutes' then 'expired'
    when accept then 'playing'
    else 'declined'
  end;
  update public.matches set status = result, updated_at = now() where id = m.id;
  return result;
end $$;

-- Un coup. Puissance 4 : `cell` est une colonne (0..6). Morpion : une case (0..8).
create function public.match_play(match_id uuid, cell int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  r int;
  placed int := null;
  win smallint[];
  size int;
begin
  select * into m from public.matches where id = match_id for update;
  if not found then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if m.status = 'pending' then raise exception 'le défi n''a pas encore été accepté' using errcode = 'P0001'; end if;
  if m.status <> 'playing' then raise exception 'partie terminée' using errcode = 'P0001'; end if;
  if uid is distinct from (case when m.turn = 1 then m.p1 else m.p2 end) then
    raise exception 'ce n''est pas ton tour' using errcode = 'P0001';
  end if;

  if m.game = 'connect4' then
    if cell is null or cell not between 0 and 6 then raise exception 'colonne invalide' using errcode = '22023'; end if;
    for r in reverse 5..0 loop
      if m.board[r * 7 + cell + 1] = 0 then placed := r * 7 + cell; exit; end if;
    end loop;
    if placed is null then raise exception 'colonne pleine' using errcode = 'P0001'; end if;
    m.board[placed + 1] := m.turn;
    win := public.c4_line_through(m.board, placed);
    size := 42;
  else -- tictactoe
    if cell is null or cell not between 0 and 8 then raise exception 'case invalide' using errcode = '22023'; end if;
    if m.board[cell + 1] <> 0 then raise exception 'case déjà prise' using errcode = 'P0001'; end if;
    placed := cell;
    m.board[placed + 1] := m.turn;
    win := public.ttt_line(m.board);
    size := 9;
  end if;

  update public.matches set
    board = m.board,
    last_cell = placed,
    moves = m.moves + 1,
    status = case when win is not null then 'won' when m.moves + 1 = size then 'draw' else 'playing' end,
    winner = case when win is not null then m.turn end,
    line = win,
    turn = case when win is not null then m.turn else 3 - m.turn end,
    updated_at = now()
  where id = m.id;
end $$;

create function public.match_forfeit(match_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.matches;
begin
  select * into m from public.matches where id = match_id for update;
  if not found or uid is null or uid not in (m.p1, m.p2) then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if m.status = 'pending' then
    update public.matches set status = 'declined', updated_at = now() where id = m.id;
  elsif m.status = 'playing' then
    update public.matches
       set status = 'forfeit', winner = case when uid = m.p1 then 2 else 1 end, updated_at = now()
     where id = m.id;
  end if;
end $$;

create function public.match_claim_timeout(match_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.matches;
begin
  select * into m from public.matches where id = match_id for update;
  if not found or uid is null or uid not in (m.p1, m.p2) then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if m.status <> 'playing' then raise exception 'partie terminée' using errcode = 'P0001'; end if;
  if uid = (case when m.turn = 1 then m.p1 else m.p2 end) then
    raise exception 'c''est à toi de jouer' using errcode = 'P0001';
  end if;
  if m.updated_at > now() - interval '45 seconds' then
    raise exception 'ton adversaire a encore le temps' using errcode = 'P0001';
  end if;
  update public.matches
     set status = 'timeout', winner = case when uid = m.p1 then 1 else 2 end, updated_at = now()
   where id = m.id;
end $$;

create function public.match_rematch(match_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  nid uuid;
begin
  select * into m from public.matches where id = match_id for update;
  if not found or uid is null or uid not in (m.p1, m.p2) then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if m.status not in ('won', 'draw', 'forfeit', 'timeout') then raise exception 'partie non terminée' using errcode = 'P0001'; end if;
  if m.next_match is not null then return m.next_match; end if;
  if uid = m.p1 then m.rematch_p1 := true; else m.rematch_p2 := true; end if;
  if m.rematch_p1 and m.rematch_p2 then
    insert into public.matches (room, game, p1, p2, status, board)
    values (m.room, m.game, m.p2, m.p1, 'playing', public.match_empty_board(m.game))
    returning id into nid;
  end if;
  update public.matches
     set rematch_p1 = m.rematch_p1, rematch_p2 = m.rematch_p2, next_match = nid, updated_at = now()
   where id = m.id;
  return nid;
end $$;

-- Classement d'un jeu à deux : victoires, défaites, nuls (comptes vérifiés uniquement).
create view public.leaderboard_c4 with (security_invoker = true) as
select p.id as user_id, p.username,
       count(*) filter (where (m.winner = 1 and m.p1 = p.id) or (m.winner = 2 and m.p2 = p.id)) as wins,
       count(*) filter (where m.winner is not null and not ((m.winner = 1 and m.p1 = p.id) or (m.winner = 2 and m.p2 = p.id))) as losses,
       count(*) filter (where m.status = 'draw') as draws
  from public.profiles p
  join public.matches m on p.id in (m.p1, m.p2)
 where m.game = 'connect4' and m.status in ('won', 'draw', 'forfeit', 'timeout') and p.verified
 group by p.id, p.username;

create view public.leaderboard_ttt with (security_invoker = true) as
select p.id as user_id, p.username,
       count(*) filter (where (m.winner = 1 and m.p1 = p.id) or (m.winner = 2 and m.p2 = p.id)) as wins,
       count(*) filter (where m.winner is not null and not ((m.winner = 1 and m.p1 = p.id) or (m.winner = 2 and m.p2 = p.id))) as losses,
       count(*) filter (where m.status = 'draw') as draws
  from public.profiles p
  join public.matches m on p.id in (m.p1, m.p2)
 where m.game = 'tictactoe' and m.status in ('won', 'draw', 'forfeit', 'timeout') and p.verified
 group by p.id, p.username;

-- ---------------------------------------------------------------------------
-- Tetris : le serveur fournit la graine (ordre des pièces), le client renvoie ses actions,
-- le serveur rejoue la partie. Doit rester identique à src/games/tetris/logic.ts.
--
-- Actions (une lettre chacune) :
--   L / R : gauche / droite      C / A : rotation horaire / antihoraire
--   D : descente douce (+1)      H : chute directe (+2 par ligne)
--   G : gravité (une ligne, émise par le minuteur du jeu)
-- ---------------------------------------------------------------------------

create table public.tetris_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  seed bigint not null check (seed between 1 and 4294967295),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score int,
  lines int,
  level int
);
create index tetris_sessions_user on public.tetris_sessions (user_id, started_at desc);

alter table public.tetris_sessions enable row level security;
create policy "parties terminées lisibles, les siennes aussi" on public.tetris_sessions for select to anon, authenticated
  using (finished_at is not null or user_id = auth.uid());
revoke all on public.tetris_sessions from anon, authenticated;
grant select on public.tetris_sessions to anon, authenticated;

-- Formes : pour chaque pièce (1..7 : I O T S Z J L) et rotation (0..3), 4 cases (x, y) dans une boîte 4×4.
create function public.tetris_shape(piece int, rot int) returns int[]
language sql immutable parallel safe set search_path = '' as $$
  -- La tranche d'un tableau 2D reste 2D : on l'aplatit avec unnest.
  select array(select unnest(shapes[(piece - 1) * 4 + rot + 1:(piece - 1) * 4 + rot + 1][1:8])) from (select array[
    -- I
    [0,1, 1,1, 2,1, 3,1], [2,0, 2,1, 2,2, 2,3], [0,2, 1,2, 2,2, 3,2], [1,0, 1,1, 1,2, 1,3],
    -- O
    [1,0, 2,0, 1,1, 2,1], [1,0, 2,0, 1,1, 2,1], [1,0, 2,0, 1,1, 2,1], [1,0, 2,0, 1,1, 2,1],
    -- T
    [1,0, 0,1, 1,1, 2,1], [1,0, 1,1, 2,1, 1,2], [0,1, 1,1, 2,1, 1,2], [1,0, 0,1, 1,1, 1,2],
    -- S
    [1,0, 2,0, 0,1, 1,1], [1,0, 1,1, 2,1, 2,2], [1,1, 2,1, 0,2, 1,2], [0,0, 0,1, 1,1, 1,2],
    -- Z
    [0,0, 1,0, 1,1, 2,1], [2,0, 1,1, 2,1, 1,2], [0,1, 1,1, 1,2, 2,2], [1,0, 0,1, 1,1, 0,2],
    -- J
    [0,0, 0,1, 1,1, 2,1], [1,0, 2,0, 1,1, 1,2], [0,1, 1,1, 2,1, 2,2], [1,0, 1,1, 0,2, 1,2],
    -- L
    [2,0, 0,1, 1,1, 2,1], [1,0, 1,1, 1,2, 2,2], [0,1, 1,1, 2,1, 0,2], [0,0, 1,0, 1,1, 1,2]
  ] as shapes) t
$$;

create function public.tetris_replay(seed bigint, events text,
  out score int, out lines int, out level int, out expected_ms bigint)
language plpgsql immutable set search_path = '' as $$
declare
  w constant int := 10;
  h constant int := 20;
  board int[] := array_fill(0, array[200]);
  r bigint := seed;
  queue int[] := '{}';
  bag int[];
  piece int; rot int; px int; py int;
  shape int[];
  i int; j int; t int; k int; n int; e text;
  nx int; ny int; nr int; ok boolean;
  row_full boolean; cleared int; y int; x int;
  kicks int[] := array[0, -1, 1, -2, 2];
  over boolean := false;
  newb int[];
begin
  score := 0; lines := 0; level := 1; expected_ms := 0;

  -- Sac de 7 pièces mélangé (Fisher-Yates)
  bag := array[1,2,3,4,5,6,7];
  for i in reverse 6..1 loop
    r := public.xorshift32(r);
    j := ((r * (i + 1)) >> 32)::int;
    t := bag[i + 1]; bag[i + 1] := bag[j + 1]; bag[j + 1] := t;
  end loop;
  queue := bag;
  piece := queue[1]; queue := queue[2:];
  if coalesce(array_length(queue, 1), 0) = 0 then
    bag := array[1,2,3,4,5,6,7];
    for i in reverse 6..1 loop
      r := public.xorshift32(r);
      j := ((r * (i + 1)) >> 32)::int;
      t := bag[i + 1]; bag[i + 1] := bag[j + 1]; bag[j + 1] := t;
    end loop;
    queue := queue || bag;
  end if;
  rot := 0; px := 3; py := 0;

  for k in 1..char_length(events) loop
    if over then raise exception 'action après la fin de partie (n°%)', k using errcode = '22023'; end if;
    e := substr(events, k, 1);

    if e in ('L', 'R') then
      nx := px + case when e = 'L' then -1 else 1 end;
      shape := public.tetris_shape(piece, rot);
      ok := true;
      for i in 0..3 loop
        x := nx + shape[i * 2 + 1]; y := py + shape[i * 2 + 2];
        if x < 0 or x >= w or y >= h or (y >= 0 and board[y * w + x + 1] <> 0) then ok := false; exit; end if;
      end loop;
      if ok then px := nx; end if;
      continue;
    end if;

    if e in ('C', 'A') then
      nr := (rot + case when e = 'C' then 1 else 3 end) % 4;
      shape := public.tetris_shape(piece, nr);
      foreach t in array kicks loop
        ok := true;
        for i in 0..3 loop
          x := px + t + shape[i * 2 + 1]; y := py + shape[i * 2 + 2];
          if x < 0 or x >= w or y >= h or (y >= 0 and board[y * w + x + 1] <> 0) then ok := false; exit; end if;
        end loop;
        if ok then rot := nr; px := px + t; exit; end if;
      end loop;
      continue;
    end if;

    if e not in ('D', 'G', 'H') then raise exception 'action inconnue' using errcode = '22023'; end if;

    if e = 'G' then
      expected_ms := expected_ms + greatest(100, 800 - (level - 1) * 70);
    end if;

    -- Descente : d'une ligne (D, G) ou jusqu'en bas (H). Bloquée → la pièce se pose.
    shape := public.tetris_shape(piece, rot);
    loop
      ok := true;
      for i in 0..3 loop
        x := px + shape[i * 2 + 1]; y := py + 1 + shape[i * 2 + 2];
        if y >= h or (y >= 0 and board[y * w + x + 1] <> 0) then ok := false; exit; end if;
      end loop;
      exit when not ok;
      py := py + 1;
      if e = 'D' then score := score + 1; end if;
      if e = 'H' then score := score + 2; end if;
      exit when e <> 'H';
    end loop;
    if ok and e <> 'H' then continue; end if;

    -- Pose de la pièce
    for i in 0..3 loop
      x := px + shape[i * 2 + 1]; y := py + shape[i * 2 + 2];
      board[y * w + x + 1] := piece;
    end loop;
    -- Lignes complètes : on reconstruit le plateau sans elles
    newb := '{}'; cleared := 0;
    for y in reverse h - 1..0 loop
      row_full := true;
      for x in 0..w - 1 loop
        if board[y * w + x + 1] = 0 then row_full := false; exit; end if;
      end loop;
      if row_full then cleared := cleared + 1;
      else newb := board[y * w + 1:y * w + w] || newb;
      end if;
    end loop;
    if cleared > 0 then
      board := array_fill(0, array[cleared * w]) || newb;
      score := score + (array[0, 100, 300, 500, 800])[cleared + 1] * level;
      lines := lines + cleared;
      level := 1 + lines / 10;
    end if;
    -- Pièce suivante
    piece := queue[1]; queue := queue[2:];
    if coalesce(array_length(queue, 1), 0) = 0 then
      bag := array[1,2,3,4,5,6,7];
      for i in reverse 6..1 loop
        r := public.xorshift32(r);
        j := ((r * (i + 1)) >> 32)::int;
        t := bag[i + 1]; bag[i + 1] := bag[j + 1]; bag[j + 1] := t;
      end loop;
      queue := queue || bag;
    end if;
    rot := 0; px := 3; py := 0;
    shape := public.tetris_shape(piece, rot);
    for i in 0..3 loop
      x := px + shape[i * 2 + 1]; y := py + shape[i * 2 + 2];
      if board[y * w + x + 1] <> 0 then over := true; exit; end if;
    end loop;
  end loop;
end $$;

create function public.tetris_start() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.tetris_sessions;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if (select count(*) from public.tetris_sessions
      where user_id = uid and started_at > now() - interval '1 minute') >= 15 then
    raise exception 'trop de parties, réessaie dans une minute' using errcode = 'P0001';
  end if;
  insert into public.tetris_sessions (user_id, seed)
  values (uid, floor(random() * 4294967295)::bigint + 1)
  returning * into s;
  return jsonb_build_object('id', s.id, 'seed', s.seed);
end $$;

create function public.tetris_finish(session_id uuid, events text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.tetris_sessions;
  res record;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if events is null or char_length(events) > 300000 or events !~ '^[LRCADGH]*$' then
    raise exception 'actions invalides' using errcode = '22023';
  end if;
  select * into s from public.tetris_sessions where id = session_id and user_id = uid for update;
  if not found then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if s.finished_at is not null then raise exception 'partie déjà enregistrée' using errcode = 'P0001'; end if;
  if s.started_at < now() - interval '1 day' then raise exception 'partie expirée' using errcode = 'P0001'; end if;

  select * into res from public.tetris_replay(s.seed, events);
  -- La gravité est cadencée par le temps : une partie ne peut pas durer moins longtemps
  -- que ses chutes automatiques (marge de 25 % pour les écarts de minuteur).
  if extract(epoch from now() - s.started_at) * 1000 < res.expected_ms * 0.75 then
    raise exception 'partie trop rapide' using errcode = 'P0001';
  end if;
  update public.tetris_sessions
     set finished_at = now(), score = res.score, lines = res.lines, level = res.level
   where id = s.id;
  return jsonb_build_object('score', res.score, 'lines', res.lines, 'level', res.level);
end $$;

create view public.leaderboard_tetris with (security_invoker = true) as
select p.id as user_id, p.username, max(s.score) as best, max(s.lines) as lines, count(*) as games
  from public.tetris_sessions s
  join public.profiles p on p.id = s.user_id
 where s.finished_at is not null and p.verified
 group by p.id, p.username;

grant select on public.leaderboard_c4, public.leaderboard_ttt, public.leaderboard_tetris to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.g2048_start(), public.g2048_finish(uuid, text),
  public.tetris_start(), public.tetris_finish(uuid, text),
  public.match_challenge(uuid, text, text), public.match_respond(uuid, boolean), public.match_play(uuid, int),
  public.match_forfeit(uuid), public.match_claim_timeout(uuid), public.match_rematch(uuid)
  to authenticated;
