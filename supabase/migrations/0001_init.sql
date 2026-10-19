-- travail_dur : comptes, 2048 vérifié côté serveur, Puissance 4 arbitré par le serveur.
--
-- Principe de sécurité : les clients ne peuvent QUE lire les tables. Toute écriture passe par
-- des fonctions `security definer` qui identifient le joueur avec auth.uid() et valident tout.
-- À exécuter une fois dans l'éditeur SQL de Supabase (ou `supabase db push`).

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- Profils
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null
    check (char_length(username) between 2 and 16 and username ~ '^[A-Za-z0-9_À-ÖØ-öø-ÿ-]+$'),
  -- Email confirmé : seuls ces comptes apparaissent dans les classements. Recopié depuis auth.users.
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;
create policy "profils lisibles par tous" on public.profiles for select to anon, authenticated using (true);
create policy "chacun modifie son profil" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (username) on public.profiles to authenticated;

-- Un profil avec un pseudo aléatoire est créé à chaque nouveau compte (y compris anonyme).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  attempt int := 0;
begin
  loop
    attempt := attempt + 1;
    begin
      insert into public.profiles (id, username)
      values (new.id, 'Joueur' || lpad(floor(random() * 100000)::int::text, 5, '0'));
      return new;
    exception when unique_violation then
      if attempt >= 20 then raise; end if;
    end;
  end loop;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un compte anonyme qui ajoute puis confirme un email devient « vérifié ».
create function public.sync_verified() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
     set verified = (new.email_confirmed_at is not null and not coalesce(new.is_anonymous, false))
   where id = new.id;
  return new;
end $$;

create trigger on_auth_user_verified after update of email_confirmed_at, is_anonymous on auth.users
  for each row execute function public.sync_verified();

-- ---------------------------------------------------------------------------
-- 2048 : le serveur fournit la graine, le client renvoie ses coups, le serveur rejoue la partie.
-- ---------------------------------------------------------------------------

create table public.g2048_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  seed bigint not null check (seed between 1 and 4294967295),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score int,
  max_tile int,
  moves int
);
create index g2048_sessions_user on public.g2048_sessions (user_id, started_at desc);
create index g2048_sessions_score on public.g2048_sessions (score desc) where finished_at is not null;

alter table public.g2048_sessions enable row level security;
create policy "parties terminées lisibles, les siennes aussi" on public.g2048_sessions for select to anon, authenticated
  using (finished_at is not null or user_id = auth.uid());
revoke all on public.g2048_sessions from anon, authenticated;
grant select on public.g2048_sessions to anon, authenticated;

-- Générateur xorshift32 : doit rester identique à src/shared/rng.ts.
create function public.xorshift32(x bigint) returns bigint
language sql immutable parallel safe set search_path = '' as $$
  select (((y # ((y << 5) & 4294967295))))
  from (select (z # (z >> 17)) as y
        from (select (x # ((x << 13) & 4294967295)) as z) a) b
$$;

-- Rejoue une partie complète. Retourne (score, tuile max) ou lève une erreur si un coup est invalide.
-- Doit rester identique à src/shared/g2048.ts.
create function public.g2048_replay(seed bigint, moves text, out score int, out max_tile int)
language plpgsql immutable set search_path = '' as $$
declare
  b int[] := array_fill(0, array[16]);
  r bigint := seed;
  i int; j int; k int; n int; m int; c int;
  idx int[];
  vals int[];
  outv int[];
  free int[];
  moved boolean;
  dir text;
begin
  score := 0;
  -- deux tuiles de départ
  for i in 1..2 loop
    free := array(select g from generate_series(1, 16) g where b[g] = 0);
    r := public.xorshift32(r);
    n := free[((r * array_length(free, 1)) >> 32) + 1];
    r := public.xorshift32(r);
    b[n] := case when r % 10 = 0 then 4 else 2 end;
  end loop;

  for m in 1..char_length(moves) loop
    dir := substr(moves, m, 1);
    moved := false;
    for k in 0..3 loop
      idx := case dir
        when 'L' then array[k*4+1, k*4+2, k*4+3, k*4+4]
        when 'R' then array[k*4+4, k*4+3, k*4+2, k*4+1]
        when 'U' then array[k+1, k+5, k+9, k+13]
        else array[k+13, k+9, k+5, k+1]
      end;
      vals := '{}';
      for j in 1..4 loop
        if b[idx[j]] <> 0 then vals := vals || b[idx[j]]; end if;
      end loop;
      outv := '{}';
      j := 1;
      n := coalesce(array_length(vals, 1), 0);
      while j <= n loop
        if j < n and vals[j] = vals[j+1] then
          c := vals[j] * 2;
          outv := outv || c;
          score := score + c;
          j := j + 2;
        else
          outv := outv || vals[j];
          j := j + 1;
        end if;
      end loop;
      for j in 1..4 loop
        c := coalesce(outv[j], 0);
        if b[idx[j]] <> c then
          moved := true;
          b[idx[j]] := c;
        end if;
      end loop;
    end loop;
    if not moved then
      raise exception 'coup invalide n°%', m using errcode = '22023';
    end if;
    free := array(select g from generate_series(1, 16) g where b[g] = 0);
    r := public.xorshift32(r);
    n := free[((r * array_length(free, 1)) >> 32) + 1];
    r := public.xorshift32(r);
    b[n] := case when r % 10 = 0 then 4 else 2 end;
  end loop;

  select max(v) into max_tile from unnest(b) v;
end $$;

create function public.g2048_start() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.g2048_sessions;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if (select count(*) from public.g2048_sessions
      where user_id = uid and started_at > now() - interval '1 minute') >= 15 then
    raise exception 'trop de parties, réessaie dans une minute' using errcode = 'P0001';
  end if;
  insert into public.g2048_sessions (user_id, seed)
  values (uid, floor(random() * 4294967295)::bigint + 1)
  returning * into s;
  return jsonb_build_object('id', s.id, 'seed', s.seed);
end $$;

create function public.g2048_finish(session_id uuid, moves text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.g2048_sessions;
  res record;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if moves is null or char_length(moves) > 100000 or moves !~ '^[UDLR]*$' then
    raise exception 'coups invalides' using errcode = '22023';
  end if;
  select * into s from public.g2048_sessions where id = session_id and user_id = uid for update;
  if not found then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if s.finished_at is not null then raise exception 'partie déjà enregistrée' using errcode = 'P0001'; end if;
  if s.started_at < now() - interval '7 days' then raise exception 'partie expirée' using errcode = 'P0001'; end if;
  -- Personne ne joue plus de 25 coups par seconde en moyenne.
  if now() - s.started_at < char_length(moves) * interval '40 milliseconds' then
    raise exception 'partie trop rapide' using errcode = 'P0001';
  end if;

  select * into res from public.g2048_replay(s.seed, moves);
  update public.g2048_sessions
     set finished_at = now(), score = res.score, max_tile = res.max_tile, moves = char_length(g2048_finish.moves)
   where id = s.id;
  return jsonb_build_object('score', res.score, 'max_tile', res.max_tile);
end $$;

-- ---------------------------------------------------------------------------
-- Puissance 4 en ligne : chaque coup est validé et appliqué par le serveur.
-- ---------------------------------------------------------------------------

create table public.c4_matches (
  id uuid primary key default gen_random_uuid(),
  room text not null check (room ~ '^[A-Z]{4}$'),
  p1 uuid not null references public.profiles (id) on delete cascade, -- joue les 1, commence
  p2 uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'declined', 'expired', 'playing', 'won', 'draw', 'forfeit', 'timeout')),
  board smallint[] not null default array_fill(0::smallint, array[42]), -- index 0..41 stocké en 1..42, ligne 0 en haut
  turn smallint not null default 1 check (turn in (1, 2)),
  winner smallint check (winner in (1, 2)),
  line smallint[],
  last_cell smallint,
  moves int not null default 0,
  rematch_p1 boolean not null default false,
  rematch_p2 boolean not null default false,
  next_match uuid references public.c4_matches (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (p1 <> p2)
);
create index c4_matches_p1 on public.c4_matches (p1, status);
create index c4_matches_p2 on public.c4_matches (p2, status);

alter table public.c4_matches enable row level security;
create policy "parties lisibles par tous" on public.c4_matches for select to anon, authenticated using (true);
revoke all on public.c4_matches from anon, authenticated;
grant select on public.c4_matches to anon, authenticated;

create function public.c4_challenge(opponent uuid, room_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  mid uuid;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if opponent = uid then raise exception 'impossible de se défier soi-même' using errcode = '22023'; end if;
  if room_code !~ '^[A-Z]{4}$' then raise exception 'salon invalide' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = opponent) then
    raise exception 'joueur inconnu' using errcode = 'P0002';
  end if;
  update public.c4_matches set status = 'expired', updated_at = now()
   where status = 'pending' and created_at < now() - interval '2 minutes' and uid in (p1, p2);
  if (select count(*) from public.c4_matches where p1 = uid and status = 'pending') >= 3 then
    raise exception 'trop de défis en attente' using errcode = 'P0001';
  end if;
  insert into public.c4_matches (room, p1, p2) values (room_code, uid, opponent) returning id into mid;
  return mid;
end $$;

create function public.c4_respond(match_id uuid, accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.c4_matches;
  result text;
begin
  select * into m from public.c4_matches where id = match_id for update;
  if not found or m.p2 is distinct from uid then raise exception 'défi inconnu' using errcode = 'P0002'; end if;
  if m.status <> 'pending' then raise exception 'défi déjà traité' using errcode = 'P0001'; end if;
  result := case
    when m.created_at < now() - interval '2 minutes' then 'expired'
    when accept then 'playing'
    else 'declined'
  end;
  update public.c4_matches set status = result, updated_at = now() where id = m.id;
  return result;
end $$;

-- Cherche un alignement de 4 passant par la case `cell` (0..41). Retourne les 4 cases ou null.
create function public.c4_line_through(board smallint[], cell int) returns smallint[]
language plpgsql immutable set search_path = '' as $$
declare
  who smallint := board[cell + 1];
  r0 int := cell / 7;
  c0 int := cell % 7;
  dr int; dc int; s int; rr int; cc int;
  cells smallint[];
  d int[];
begin
  foreach d slice 1 in array array[[0, 1], [1, 0], [1, 1], [1, -1]] loop
    dr := d[1]; dc := d[2];
    cells := array[cell::smallint];
    foreach s in array array[1, -1] loop
      rr := r0 + dr * s; cc := c0 + dc * s;
      while rr between 0 and 5 and cc between 0 and 6 and board[rr * 7 + cc + 1] = who loop
        cells := cells || (rr * 7 + cc)::smallint;
        rr := rr + dr * s; cc := cc + dc * s;
      end loop;
    end loop;
    if array_length(cells, 1) >= 4 then
      return (select array_agg(x order by x) from (select unnest(cells) x order by 1 limit 4) t);
    end if;
  end loop;
  return null;
end $$;

create function public.c4_play(match_id uuid, col int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.c4_matches;
  r int;
  cell int := null;
  win smallint[];
begin
  select * into m from public.c4_matches where id = match_id for update;
  if not found then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if m.status = 'pending' then raise exception 'le défi n''a pas encore été accepté' using errcode = 'P0001'; end if;
  if m.status <> 'playing' then raise exception 'partie terminée' using errcode = 'P0001'; end if;
  if uid is distinct from (case when m.turn = 1 then m.p1 else m.p2 end) then
    raise exception 'ce n''est pas ton tour' using errcode = 'P0001';
  end if;
  if col is null or col not between 0 and 6 then raise exception 'colonne invalide' using errcode = '22023'; end if;
  for r in reverse 5..0 loop
    if m.board[r * 7 + col + 1] = 0 then cell := r * 7 + col; exit; end if;
  end loop;
  if cell is null then raise exception 'colonne pleine' using errcode = 'P0001'; end if;

  m.board[cell + 1] := m.turn;
  win := public.c4_line_through(m.board, cell);
  update public.c4_matches set
    board = m.board,
    last_cell = cell,
    moves = m.moves + 1,
    status = case when win is not null then 'won' when m.moves + 1 = 42 then 'draw' else 'playing' end,
    winner = case when win is not null then m.turn end,
    line = win,
    turn = case when win is not null then m.turn else 3 - m.turn end,
    updated_at = now()
  where id = m.id;
end $$;

-- Abandon (ou annulation d'un défi par celui qui l'a lancé).
create function public.c4_forfeit(match_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.c4_matches;
begin
  select * into m from public.c4_matches where id = match_id for update;
  if not found or uid is null or uid not in (m.p1, m.p2) then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if m.status = 'pending' then
    update public.c4_matches set status = 'declined', updated_at = now() where id = m.id;
  elsif m.status = 'playing' then
    update public.c4_matches
       set status = 'forfeit', winner = case when uid = m.p1 then 2 else 1 end, updated_at = now()
     where id = m.id;
  end if;
end $$;

-- Victoire par forfait si l'adversaire ne joue plus depuis 45 s.
create function public.c4_claim_timeout(match_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.c4_matches;
begin
  select * into m from public.c4_matches where id = match_id for update;
  if not found or uid is null or uid not in (m.p1, m.p2) then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if m.status <> 'playing' then raise exception 'partie terminée' using errcode = 'P0001'; end if;
  if uid = (case when m.turn = 1 then m.p1 else m.p2 end) then
    raise exception 'c''est à toi de jouer' using errcode = 'P0001';
  end if;
  if m.updated_at > now() - interval '45 seconds' then
    raise exception 'ton adversaire a encore le temps' using errcode = 'P0001';
  end if;
  update public.c4_matches
     set status = 'timeout', winner = case when uid = m.p1 then 1 else 2 end, updated_at = now()
   where id = m.id;
end $$;

-- Revanche : quand les deux l'ont demandée, une nouvelle partie démarre, l'autre joueur commence.
create function public.c4_rematch(match_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.c4_matches;
  nid uuid;
begin
  select * into m from public.c4_matches where id = match_id for update;
  if not found or uid is null or uid not in (m.p1, m.p2) then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if m.status not in ('won', 'draw', 'forfeit', 'timeout') then raise exception 'partie non terminée' using errcode = 'P0001'; end if;
  if m.next_match is not null then return m.next_match; end if;
  if uid = m.p1 then m.rematch_p1 := true; else m.rematch_p2 := true; end if;
  if m.rematch_p1 and m.rematch_p2 then
    insert into public.c4_matches (room, p1, p2, status) values (m.room, m.p2, m.p1, 'playing') returning id into nid;
  end if;
  update public.c4_matches
     set rematch_p1 = m.rematch_p1, rematch_p2 = m.rematch_p2, next_match = nid, updated_at = now()
   where id = m.id;
  return nid;
end $$;

-- ---------------------------------------------------------------------------
-- Classements
-- ---------------------------------------------------------------------------

create view public.leaderboard_2048 with (security_invoker = true) as
select p.id as user_id, p.username, max(s.score) as best, max(s.max_tile) as max_tile, count(*) as games
  from public.g2048_sessions s
  join public.profiles p on p.id = s.user_id
 where s.finished_at is not null and p.verified
 group by p.id, p.username;

create view public.leaderboard_c4 with (security_invoker = true) as
select p.id as user_id, p.username,
       count(*) filter (where (m.winner = 1 and m.p1 = p.id) or (m.winner = 2 and m.p2 = p.id)) as wins,
       count(*) filter (where m.winner is not null and not ((m.winner = 1 and m.p1 = p.id) or (m.winner = 2 and m.p2 = p.id))) as losses,
       count(*) filter (where m.status = 'draw') as draws
  from public.profiles p
  join public.c4_matches m on p.id in (m.p1, m.p2)
 where m.status in ('won', 'draw', 'forfeit', 'timeout') and p.verified
 group by p.id, p.username;

grant select on public.leaderboard_2048, public.leaderboard_c4 to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Droits d'exécution : seules les fonctions de jeu sont appelables, et seulement connecté.
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.g2048_start(), public.g2048_finish(uuid, text),
  public.c4_challenge(uuid, text), public.c4_respond(uuid, boolean), public.c4_play(uuid, int),
  public.c4_forfeit(uuid), public.c4_claim_timeout(uuid), public.c4_rematch(uuid)
  to authenticated;

-- Mises à jour en direct des parties de Puissance 4.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.c4_matches;
  end if;
end $$;
