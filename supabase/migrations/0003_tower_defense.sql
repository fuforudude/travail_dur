-- travail_dur : Tower defense classé, vérifié vague par vague.
--
-- Le serveur garde l'état de chaque partie (or, vies, tours). À chaque lancement de vague,
-- le client envoie les constructions faites depuis la précédente ; le serveur les valide
-- (or suffisant, case libre…), simule la vague et enregistre le résultat. Le coût d'un appel
-- reste donc constant quelle que soit l'avancée de la partie.
--
-- Doit rester identique à src/games/towerdefense/logic.ts. À exécuter après 0002_jeux.sql.

set client_encoding = 'UTF8';

create table public.td_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  last_call_at timestamptz not null default now(),
  last_ticks int not null default 0,
  wave int not null default 0, -- vagues terminées
  lives int not null default 20,
  gold int not null default 150,
  kills int not null default 0,
  towers int[] not null default '{}', -- 5 entiers par tour : x, y, type, niveau, or investi
  over boolean not null default false
);
create index td_sessions_user on public.td_sessions (user_id, started_at desc);
create index td_sessions_wave on public.td_sessions (wave desc);

alter table public.td_sessions enable row level security;
create policy "parties lisibles par tous" on public.td_sessions for select to anon, authenticated using (true);
revoke all on public.td_sessions from anon, authenticated;
grant select on public.td_sessions to anon, authenticated;

create function public.td_start() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if (select count(*) from public.td_sessions
      where user_id = uid and started_at > now() - interval '1 minute') >= 10 then
    raise exception 'trop de parties, réessaie dans une minute' using errcode = 'P0001';
  end if;
  insert into public.td_sessions (user_id) values (uid) returning id into sid;
  return sid;
end $$;

create function public.td_wave(session_id uuid, actions text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.td_sessions;
  -- carte
  cols constant int := 16;
  rows_ constant int := 10;
  px int[] := '{}';
  py int[] := '{}';
  len int;
  nb int;
  bucket_x int[];
  bucket_y int[];
  -- tours (types 1..3) : coût, portée, dégâts, recharge, zone
  k_cost constant int[] := array[50, 90, 120];
  k_range constant int[] := array[220, 190, 450];
  k_dmg constant int[] := array[10, 18, 55];
  k_cd constant int[] := array[6, 18, 32];
  k_splash constant int[] := array[0, 70, 0];
  t int[];
  nt int;
  -- actions
  a text;
  m text[];
  ax int; ay int; ak int; idx int; c int;
  -- vague
  n int; hp int; cnt int; speed int; gap int; reward int; leak int;
  e_prog int[]; e_hp int[]; e_state int[];
  cov boolean[];
  t_dmg int[]; t_cd int[]; t_cool int[]; t_splash int[];
  spawned int := 0;
  first int := 1;
  ticks int := 0;
  done boolean := false;
  i int; j int; ti int; b int; x int; y int; r int; cx int; cy int; at_ int; f int;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if actions is null or char_length(actions) > 4000
     or actions !~ '^([BUS][0-9]{1,2}\.[0-9]{1,2}(\.[0-9])?(;[BUS][0-9]{1,2}\.[0-9]{1,2}(\.[0-9])?)*)?$' then
    raise exception 'actions invalides' using errcode = '22023';
  end if;
  select * into s from public.td_sessions where id = session_id and user_id = uid for update;
  if not found then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if s.over then raise exception 'partie terminée' using errcode = 'P0001'; end if;
  -- La vague précédente a duré last_ticks × 100 ms ; le jeu accélère ×3 au maximum.
  -- Marge large (×5) pour absorber la latence réseau.
  if now() - s.last_call_at < s.last_ticks * interval '20 milliseconds' then
    raise exception 'vague lancée trop tôt' using errcode = 'P0001';
  end if;

  -- Chemin
  for x in 0..12 loop px := px || x; py := py || 1; end loop;
  for y in 2..4 loop px := px || 12; py := py || y; end loop;
  for x in reverse 11..3 loop px := px || x; py := py || 4; end loop;
  for y in 5..7 loop px := px || 3; py := py || y; end loop;
  for x in 4..15 loop px := px || x; py := py || 7; end loop;
  len := (array_length(px, 1) - 1) * 100;
  nb := len / 10 + 1;
  bucket_x := array_fill(0, array[nb]);
  bucket_y := array_fill(0, array[nb]);
  for b in 0..nb - 1 loop
    i := (b * 10) / 100;
    f := (b * 10) % 100;
    j := least(i + 1, array_length(px, 1) - 1);
    bucket_x[b + 1] := px[i + 1] * 100 + 50 + (px[j + 1] - px[i + 1]) * f;
    bucket_y[b + 1] := py[i + 1] * 100 + 50 + (py[j + 1] - py[i + 1]) * f;
  end loop;

  -- Constructions
  t := s.towers;
  if actions <> '' then
    foreach a in array string_to_array(actions, ';') loop
      m := regexp_match(a, '^([BUS])([0-9]+)\.([0-9]+)(?:\.([0-9]))?$');
      ax := m[2]::int; ay := m[3]::int;
      idx := null;
      for i in 0..coalesce(array_length(t, 1), 0) / 5 - 1 loop
        if t[i * 5 + 1] = ax and t[i * 5 + 2] = ay then idx := i; exit; end if;
      end loop;
      if m[1] = 'B' then
        ak := m[4]::int;
        if ak is null or ak not between 1 and 3 then raise exception 'tour inconnue' using errcode = '22023'; end if;
        if ax >= cols or ay >= rows_ then raise exception 'emplacement impossible' using errcode = '22023'; end if;
        for i in 1..array_length(px, 1) loop
          if px[i] = ax and py[i] = ay then raise exception 'emplacement impossible' using errcode = '22023'; end if;
        end loop;
        if idx is not null then raise exception 'case occupée' using errcode = '22023'; end if;
        if s.gold < k_cost[ak] then raise exception 'pas assez d''or' using errcode = '22023'; end if;
        s.gold := s.gold - k_cost[ak];
        t := t || array[ax, ay, ak, 1, k_cost[ak]];
      elsif m[1] = 'U' then
        if idx is null then raise exception 'pas de tour ici' using errcode = '22023'; end if;
        if t[idx * 5 + 4] >= 5 then raise exception 'niveau maximum' using errcode = '22023'; end if;
        c := k_cost[t[idx * 5 + 3]] * t[idx * 5 + 4];
        if s.gold < c then raise exception 'pas assez d''or' using errcode = '22023'; end if;
        s.gold := s.gold - c;
        t[idx * 5 + 4] := t[idx * 5 + 4] + 1;
        t[idx * 5 + 5] := t[idx * 5 + 5] + c;
      else
        if idx is null then raise exception 'pas de tour ici' using errcode = '22023'; end if;
        s.gold := s.gold + t[idx * 5 + 5] / 2;
        t := t[1:idx * 5] || t[idx * 5 + 6:];
      end if;
    end loop;
  end if;
  nt := coalesce(array_length(t, 1), 0) / 5;

  -- Paramètres de la vague
  n := s.wave + 1;
  hp := 30;
  for i in 2..n loop hp := hp * 112 / 100 + 3; end loop;
  if n % 10 = 0 then
    cnt := n / 10; reward := (1 + hp / 12) * 10; hp := hp * 15; speed := 7; gap := 30; leak := 5;
  else
    cnt := least(8 + n, 30); leak := 1;
    if n % 3 = 0 then hp := hp * 6 / 10; speed := 16; gap := 7;
    else speed := 10; gap := 10;
    end if;
    reward := 1 + hp / 12;
  end if;
  e_prog := array_fill(0, array[cnt]);
  e_hp := array_fill(hp, array[cnt]);
  e_state := array_fill(0, array[cnt]);

  -- Portée de chaque tour, tranche par tranche du chemin
  cov := array_fill(false, array[greatest(nt * nb, 1)]);
  t_dmg := '{}'; t_cd := '{}'; t_cool := '{}'; t_splash := '{}';
  for ti in 0..nt - 1 loop
    r := k_range[t[ti * 5 + 3]] + 15 * (t[ti * 5 + 4] - 1);
    cx := t[ti * 5 + 1] * 100 + 50;
    cy := t[ti * 5 + 2] * 100 + 50;
    for b in 1..nb loop
      if (bucket_x[b] - cx) * (bucket_x[b] - cx) + (bucket_y[b] - cy) * (bucket_y[b] - cy) <= r * r then cov[ti * nb + b] := true; end if;
    end loop;
    t_dmg := t_dmg || (k_dmg[t[ti * 5 + 3]] * (100 + 60 * (t[ti * 5 + 4] - 1)) / 100);
    t_cd := t_cd || 0;
    t_cool := t_cool || k_cd[t[ti * 5 + 3]];
    t_splash := t_splash || k_splash[t[ti * 5 + 3]];
  end loop;

  -- Simulation, tick par tick
  while not done loop
    -- 1. apparition
    if spawned < cnt and ticks % gap = 0 then
      spawned := spawned + 1;
      e_state[spawned] := 1;
    end if;
    -- 2. déplacement
    for i in first..spawned loop
      if e_state[i] = 1 then
        e_prog[i] := e_prog[i] + speed;
        if e_prog[i] >= len then
          e_state[i] := 2;
          s.lives := s.lives - leak;
        end if;
      end if;
    end loop;
    -- 3. tirs
    for ti in 1..nt loop
      if t_cd[ti] > 0 then
        t_cd[ti] := t_cd[ti] - 1;
        continue;
      end if;
      for i in first..spawned loop
        if e_state[i] = 1 and cov[(ti - 1) * nb + e_prog[i] / 10 + 1] then
          at_ := e_prog[i];
          if t_splash[ti] > 0 then
            for j in first..spawned loop
              if e_state[j] = 1 and abs(e_prog[j] - at_) <= t_splash[ti] then
                e_hp[j] := e_hp[j] - t_dmg[ti];
                if e_hp[j] <= 0 then e_state[j] := 2; s.gold := s.gold + reward; s.kills := s.kills + 1; end if;
              end if;
            end loop;
          else
            e_hp[i] := e_hp[i] - t_dmg[ti];
            if e_hp[i] <= 0 then e_state[i] := 2; s.gold := s.gold + reward; s.kills := s.kills + 1; end if;
          end if;
          t_cd[ti] := t_cool[ti];
          exit;
        end if;
      end loop;
    end loop;
    while first <= spawned and e_state[first] = 2 loop first := first + 1; end loop;
    ticks := ticks + 1;
    if s.lives <= 0 then
      s.lives := 0; s.over := true; done := true;
    elsif spawned = cnt and first > cnt then
      s.wave := n; s.gold := s.gold + 20 + 2 * n; done := true;
    end if;
  end loop;

  update public.td_sessions
     set wave = s.wave, lives = s.lives, gold = s.gold, kills = s.kills, towers = t, over = s.over,
         last_call_at = now(), last_ticks = ticks
   where id = s.id;
  return jsonb_build_object('wave', s.wave, 'lives', s.lives, 'gold', s.gold, 'kills', s.kills, 'over', s.over, 'ticks', ticks);
end $$;

create view public.leaderboard_td with (security_invoker = true) as
select p.id as user_id, p.username, max(s.wave) as best, max(s.kills) as kills, count(*) as games
  from public.td_sessions s
  join public.profiles p on p.id = s.user_id
 where s.wave > 0 and p.verified
 group by p.id, p.username;

grant select on public.leaderboard_td to anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.g2048_start(), public.g2048_finish(uuid, text),
  public.tetris_start(), public.tetris_finish(uuid, text),
  public.td_start(), public.td_wave(uuid, text),
  public.match_challenge(uuid, text, text), public.match_respond(uuid, boolean), public.match_play(uuid, int),
  public.match_forfeit(uuid), public.match_claim_timeout(uuid), public.match_rematch(uuid)
  to authenticated;
