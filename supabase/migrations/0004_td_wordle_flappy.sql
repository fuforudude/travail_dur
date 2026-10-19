-- travail_dur : constructions pendant les vagues (tower defense), Flappy Bird et Wordle classés.
-- À exécuter après 0003_tower_defense.sql.

set client_encoding = 'UTF8';

-- ===========================================================================
-- Tower defense : actions horodatées pendant la vague
-- ===========================================================================
-- Le client appelle désormais td_wave à la FIN de chaque vague, avec toutes ses actions :
-- d'abord celles faites avant le lancement (sans @), puis celles faites pendant (avec @tick,
-- appliquées juste avant ce tick). Doit rester identique à src/games/towerdefense/logic.ts.

-- Applique une action de construction ; lève une erreur si elle est impossible.
create function public.td_apply(towers int[], gold int, action text, out t int[], out g int)
language plpgsql immutable set search_path = '' as $$
declare
  k_cost constant int[] := array[50, 90, 120];
  m text[];
  ax int; ay int; ak int; idx int; c int; i int;
  y int; x int;
begin
  t := towers; g := gold;
  m := regexp_match(action, '^([BUS])([0-9]+)\.([0-9]+)(?:\.([0-9]))?$');
  if m is null then raise exception 'action invalide' using errcode = '22023'; end if;
  ax := m[2]::int; ay := m[3]::int;
  idx := null;
  for i in 0..coalesce(array_length(t, 1), 0) / 5 - 1 loop
    if t[i * 5 + 1] = ax and t[i * 5 + 2] = ay then idx := i; exit; end if;
  end loop;
  if m[1] = 'B' then
    ak := m[4]::int;
    if ak is null or ak not between 1 and 3 then raise exception 'tour inconnue' using errcode = '22023'; end if;
    if ax >= 16 or ay >= 10 then raise exception 'emplacement impossible' using errcode = '22023'; end if;
    -- cases du chemin (identique à la carte du client)
    if (ay = 1 and ax <= 12) or (ax = 12 and ay between 2 and 4) or (ay = 4 and ax between 3 and 11)
       or (ax = 3 and ay between 5 and 7) or (ay = 7 and ax between 4 and 15) then
      raise exception 'emplacement impossible' using errcode = '22023';
    end if;
    if idx is not null then raise exception 'case occupée' using errcode = '22023'; end if;
    if g < k_cost[ak] then raise exception 'pas assez d''or' using errcode = '22023'; end if;
    g := g - k_cost[ak];
    t := t || array[ax, ay, ak, 1, k_cost[ak]];
  elsif m[1] = 'U' then
    if idx is null then raise exception 'pas de tour ici' using errcode = '22023'; end if;
    if t[idx * 5 + 4] >= 5 then raise exception 'niveau maximum' using errcode = '22023'; end if;
    c := k_cost[t[idx * 5 + 3]] * t[idx * 5 + 4];
    if g < c then raise exception 'pas assez d''or' using errcode = '22023'; end if;
    g := g - c;
    t[idx * 5 + 4] := t[idx * 5 + 4] + 1;
    t[idx * 5 + 5] := t[idx * 5 + 5] + c;
  else
    if idx is null then raise exception 'pas de tour ici' using errcode = '22023'; end if;
    g := g + t[idx * 5 + 5] / 2;
    t := t[1:idx * 5] || t[idx * 5 + 6:];
  end if;
end $$;

-- Caractéristiques des tours pour la simulation : portée le long du chemin, dégâts, recharge.
-- Une tour déjà présente dans old_t (même case) garde sa recharge en cours, comme côté client.
create function public.td_derive(t int[], bucket_x int[], bucket_y int[], old_t int[], old_cd int[],
  out cov boolean[], out t_dmg int[], out t_cool int[], out t_splash int[], out t_cd int[])
language plpgsql immutable set search_path = '' as $$
declare
  k_range constant int[] := array[220, 190, 450];
  k_dmg constant int[] := array[10, 18, 55];
  k_cd constant int[] := array[6, 18, 32];
  k_splash constant int[] := array[0, 70, 0];
  nb int := array_length(bucket_x, 1);
  nt int := coalesce(array_length(t, 1), 0) / 5;
  ti int; b int; k int; r int; cx int; cy int; c int;
begin
  cov := array_fill(false, array[greatest(nt * nb, 1)]);
  t_dmg := '{}'; t_cool := '{}'; t_splash := '{}'; t_cd := '{}';
  for ti in 0..nt - 1 loop
    r := k_range[t[ti * 5 + 3]] + 15 * (t[ti * 5 + 4] - 1);
    cx := t[ti * 5 + 1] * 100 + 50;
    cy := t[ti * 5 + 2] * 100 + 50;
    for b in 1..nb loop
      if (bucket_x[b] - cx) * (bucket_x[b] - cx) + (bucket_y[b] - cy) * (bucket_y[b] - cy) <= r * r then
        cov[ti * nb + b] := true;
      end if;
    end loop;
    t_dmg := t_dmg || (k_dmg[t[ti * 5 + 3]] * (100 + 60 * (t[ti * 5 + 4] - 1)) / 100);
    t_cool := t_cool || k_cd[t[ti * 5 + 3]];
    t_splash := t_splash || k_splash[t[ti * 5 + 3]];
    c := 0;
    for k in 0..coalesce(array_length(old_t, 1), 0) / 5 - 1 loop
      if old_t[k * 5 + 1] = t[ti * 5 + 1] and old_t[k * 5 + 2] = t[ti * 5 + 2] then c := old_cd[k + 1]; exit; end if;
    end loop;
    t_cd := t_cd || c;
  end loop;
end $$;

create or replace function public.td_wave(session_id uuid, actions text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.td_sessions;
  -- carte
  px int[] := '{}';
  py int[] := '{}';
  len int;
  nb int;
  bucket_x int[];
  bucket_y int[];
  -- tours
  t int[];
  nt int;
  old_t int[];
  old_cd int[];
  -- actions
  acts text[];
  act_text text[] := '{}';
  act_tick int[] := '{}';
  next_act int;
  a text;
  m text[];
  prev_tick int := -1;
  -- vague
  n int; hp int; cnt int; speed int; gap int; reward int; leak int;
  e_prog int[]; e_hp int[]; e_state int[];
  cov boolean[];
  t_dmg int[]; t_cd int[]; t_cool int[]; t_splash int[];
  spawned int := 0;
  first int := 1;
  ticks int := 0;
  done boolean := false;
  i int; j int; ti int; b int; x int; y int; r int; cx int; cy int; at_ int; f int; k int;
  res record;
  d record;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if actions is null or char_length(actions) > 8000
     or actions !~ '^([BUS][0-9]{1,2}\.[0-9]{1,2}(\.[0-9])?(@[0-9]{1,6})?(;[BUS][0-9]{1,2}\.[0-9]{1,2}(\.[0-9])?(@[0-9]{1,6})?)*)?$' then
    raise exception 'actions invalides' using errcode = '22023';
  end if;
  select * into s from public.td_sessions where id = session_id and user_id = uid for update;
  if not found then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if s.over then raise exception 'partie terminée' using errcode = 'P0001'; end if;

  -- Chemin et positions le long du chemin (tranches de 10 unités)
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

  -- Actions : celles d'avant la vague d'abord, puis celles pendant, dans l'ordre des ticks
  t := s.towers;
  if actions <> '' then
    acts := string_to_array(actions, ';');
    foreach a in array acts loop
      m := regexp_match(a, '^([^@]+)(?:@([0-9]+))?$');
      if m[2] is null then
        if prev_tick >= 0 then raise exception 'actions dans le désordre' using errcode = '22023'; end if;
        select * into res from public.td_apply(t, s.gold, m[1]);
        t := res.t; s.gold := res.g;
      else
        if m[2]::int < prev_tick then raise exception 'actions dans le désordre' using errcode = '22023'; end if;
        prev_tick := m[2]::int;
        act_text := act_text || m[1];
        act_tick := act_tick || m[2]::int;
      end if;
    end loop;
  end if;
  next_act := 1;

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
  old_t := '{}';
  old_cd := '{}';

  select * into d from public.td_derive(t, bucket_x, bucket_y, '{}', '{}');
  cov := d.cov; t_dmg := d.t_dmg; t_cool := d.t_cool; t_splash := d.t_splash; t_cd := d.t_cd;
  nt := coalesce(array_length(t, 1), 0) / 5;

  <<sim>>
  loop
    -- Actions faites pendant la vague, juste avant ce tick (recalcul après chacune, comme le client)
    while next_act <= coalesce(array_length(act_tick, 1), 0) and act_tick[next_act] = ticks loop
      old_t := t; old_cd := t_cd;
      select * into res from public.td_apply(t, s.gold, act_text[next_act]);
      t := res.t; s.gold := res.g;
      select * into d from public.td_derive(t, bucket_x, bucket_y, old_t, old_cd);
      cov := d.cov; t_dmg := d.t_dmg; t_cool := d.t_cool; t_splash := d.t_splash; t_cd := d.t_cd;
      nt := coalesce(array_length(t, 1), 0) / 5;
      next_act := next_act + 1;
    end loop;

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
      s.lives := 0; s.over := true; exit sim;
    elsif spawned = cnt and first > cnt then
      s.wave := n; s.gold := s.gold + 20 + 2 * n; exit sim;
    end if;
  end loop;

  if next_act <= coalesce(array_length(act_tick, 1), 0) then
    raise exception 'action après la fin de la vague' using errcode = '22023';
  end if;
  -- La vague a duré `ticks` × 100 ms ; le jeu accélère ×3 au maximum (marge ×5 pour le réseau).
  if now() - s.last_call_at < ticks * interval '20 milliseconds' then
    raise exception 'vague jouée trop vite' using errcode = 'P0001';
  end if;

  update public.td_sessions
     set wave = s.wave, lives = s.lives, gold = s.gold, kills = s.kills, towers = t, over = s.over,
         last_call_at = now(), last_ticks = ticks
   where id = s.id;
  return jsonb_build_object('wave', s.wave, 'lives', s.lives, 'gold', s.gold, 'kills', s.kills, 'over', s.over, 'ticks', ticks);
end $$;

-- ===========================================================================
-- Flappy Bird : graine serveur (position des tuyaux), le client renvoie les ticks de ses
-- battements d'ailes, le serveur rejoue jusqu'à la chute. Identique à src/games/flappy/logic.ts.
-- ===========================================================================

create table public.flappy_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  seed bigint not null check (seed between 1 and 4294967295),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score int,
  ticks int
);
create index flappy_sessions_user on public.flappy_sessions (user_id, started_at desc);

alter table public.flappy_sessions enable row level security;
create policy "parties terminées lisibles, les siennes aussi" on public.flappy_sessions for select to anon, authenticated
  using (finished_at is not null or user_id = auth.uid());
revoke all on public.flappy_sessions from anon, authenticated;
grant select on public.flappy_sessions to anon, authenticated;

-- flaps : écarts entre les ticks des battements (« 12,30,28… »). Retourne le score et la durée.
create function public.flappy_replay(seed bigint, flaps text, out score int, out ticks int)
language plpgsql immutable set search_path = '' as $$
declare
  w constant int := 3000;
  h constant int := 5000;
  bird_x constant int := 800;
  bird_r constant int := 140;
  pipe_w constant int := 520;
  gap constant int := 1400;
  r bigint := seed;
  y int := 2500;
  vy int := 0;
  px int[] := '{}';
  pg int[] := '{}';
  pp boolean[] := '{}';
  f int[];
  nf int;
  next_f int := 1;
  next_tick int;
  dead boolean := false;
  flap boolean;
  i int;
begin
  score := 0; ticks := 0;
  f := case when flaps = '' then '{}'::int[] else string_to_array(flaps, ',')::int[] end;
  nf := coalesce(array_length(f, 1), 0);
  next_tick := case when nf > 0 then f[1] else -1 end;
  for i in 2..nf loop
    if f[i] < 1 then raise exception 'battements invalides' using errcode = '22023'; end if;
  end loop;

  while not dead loop
    if ticks > 400000 then raise exception 'partie trop longue' using errcode = '22023'; end if;
    flap := next_f <= nf and next_tick = ticks;
    if flap then
      next_f := next_f + 1;
      if next_f <= nf then next_tick := next_tick + f[next_f]; end if;
      vy := -95;
    end if;
    vy := least(vy + 6, 120);
    y := y + vy;
    if y - bird_r < 0 then y := bird_r; vy := 0; end if;
    if ticks % 95 = 0 then
      r := public.xorshift32(r);
      px := px || w;
      pg := pg || (1100 + ((r * 2801) >> 32))::int;
      pp := pp || false;
    end if;
    for i in 1..coalesce(array_length(px, 1), 0) loop px[i] := px[i] - 18; end loop;
    if coalesce(array_length(px, 1), 0) > 0 and px[1] + pipe_w < 0 then
      px := px[2:]; pg := pg[2:]; pp := pp[2:];
    end if;
    for i in 1..coalesce(array_length(px, 1), 0) loop
      if not pp[i] and px[i] + pipe_w < bird_x - bird_r then pp[i] := true; score := score + 1; end if;
      if bird_x + bird_r > px[i] and bird_x - bird_r < px[i] + pipe_w
         and not (y - bird_r > pg[i] - gap / 2 and y + bird_r < pg[i] + gap / 2) then
        dead := true;
      end if;
    end loop;
    if y + bird_r >= h then dead := true; end if;
    ticks := ticks + 1;
  end loop;
  if next_f <= nf then raise exception 'battement après la chute' using errcode = '22023'; end if;
end $$;

create function public.flappy_start() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.flappy_sessions;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if (select count(*) from public.flappy_sessions
      where user_id = uid and started_at > now() - interval '1 minute') >= 30 then
    raise exception 'trop de parties, réessaie dans une minute' using errcode = 'P0001';
  end if;
  insert into public.flappy_sessions (user_id, seed)
  values (uid, floor(random() * 4294967295)::bigint + 1)
  returning * into s;
  return jsonb_build_object('id', s.id, 'seed', s.seed);
end $$;

create function public.flappy_finish(session_id uuid, flaps text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.flappy_sessions;
  res record;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if flaps is null or char_length(flaps) > 200000 or flaps !~ '^([0-9]{1,6}(,[0-9]{1,6})*)?$' then
    raise exception 'battements invalides' using errcode = '22023';
  end if;
  select * into s from public.flappy_sessions where id = session_id and user_id = uid for update;
  if not found then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if s.finished_at is not null then raise exception 'partie déjà enregistrée' using errcode = 'P0001'; end if;
  if s.started_at < now() - interval '1 day' then raise exception 'partie expirée' using errcode = 'P0001'; end if;
  select * into res from public.flappy_replay(s.seed, flaps);
  -- 60 ticks par seconde : la partie ne peut pas avoir duré moins longtemps (marge de 20 %).
  if extract(epoch from now() - s.started_at) < res.ticks / 60.0 * 0.8 then
    raise exception 'partie trop rapide' using errcode = 'P0001';
  end if;
  update public.flappy_sessions set finished_at = now(), score = res.score, ticks = res.ticks where id = s.id;
  return jsonb_build_object('score', res.score);
end $$;

create view public.leaderboard_flappy with (security_invoker = true) as
select p.id as user_id, p.username, max(s.score) as best, count(*) as games
  from public.flappy_sessions s
  join public.profiles p on p.id = s.user_id
 where s.finished_at is not null and p.verified
 group by p.id, p.username;

-- ===========================================================================
-- Wordle : un mot du jour, le même pour tous, choisi côté serveur et jamais envoyé au client
-- avant la fin de sa partie. Chaque proposition est vérifiée et colorée par le serveur.
-- ===========================================================================

-- Dictionnaire (propositions acceptées) et solutions possibles. Source : an-array-of-french-words
-- (licence MIT), mots de 5 lettres sans accents ; solutions choisies parmi les mots courants.
create table public.wordle_words (
  word text primary key check (word ~ '^[A-Z]{5}$'),
  solution boolean not null default false
);
insert into public.wordle_words (word)
select unnest('{
  ABATS,ABBES,ABCES,ABETI,ABIMA,ABIME,ABODE,ABOIE,ABOIS,ABOLI,ABORD,ABOYA,ABOYE,ABRIS,ABSES,ABUSA,
  ABUSE,ACCES,ACCRA,ACCRO,ACCRU,ACCUX,ACERA,ACERE,ACHAT,ACIDE,ACIER,ACMES,ACNES,ACRES,ACTES,ACTIF,
  ADAGE,ADAMO,ADAMS,ADELE,ADIEU,ADMET,ADMIS,ADMIT,ADORA,ADORE,ADULA,ADULE,AERAI,AERAS,AERAT,AERER,
  AERES,AEREZ,AFFUT,AGACA,AGACE,AGATE,AGAVE,AGEES,AGENT,AGILE,AGIOS,AGIRA,AGITA,AGITE,AGNAT,AGREA,
  AGREE,AGRES,AGTDC,AHURI,AIDAI,AIDAS,AIDAT,AIDER,AIDES,AIDEZ,AIENT,AIEUL,AIEUX,AIGLE,AIGRE,AIGRI,
  AIGUE,AIGUS,AILEE,AILES,AILLE,AIMAI,AIMAS,AIMAT,AIMEE,AIMER,AIMES,AIMEZ,AINES,AINSI,AIRES,AISEE,
  AISES,AISNE,AJONC,AJOUT,ALAIN,ALBUM,ALEAS,ALENE,ALESA,ALESE,ALFAS,ALGER,ALGUE,ALIAS,ALIBI,ALICE,
  ALITE,ALIZE,ALLAH,ALLAI,ALLAS,ALLAT,ALLEE,ALLEN,ALLER,ALLEZ,ALLIA,ALLIE,ALOES,ALOIS,ALORS,ALOSE,
  ALPES,ALPHA,ALPIN,ALTOS,ALUNI,ALUNS,AMANT,AMBLE,AMBRE,AMENA,AMENE,AMERE,AMERS,AMIBE,AMIES,AMINE,
  AMMAN,AMONT,AMOUR,AMPLE,AMURE,AMUSA,AMUSE,ANALE,ANAUX,ANCHE,ANCRA,ANCRE,ANDES,ANDIN,ANDRE,ANDYS,
  ANETH,ANGES,ANGLE,ANIMA,ANIME,ANION,ANNAS,ANNEE,ANNES,ANODE,ANONS,ANSES,ANTAN,ANTRE,AORTE,AOUTS,
  APERO,APHTE,APPAT,APPEL,APPUI,APRES,APRIL,APTES,APURA,APURE,ARABE,ARASA,ARASE,ARBRE,ARCHE,ARCON,
  ARCOS,ARDUE,ARDUS,ARENE,ARETE,ARGON,ARGOT,ARGUA,ARGUE,ARGUS,ARIAS,ARIDE,ARMAI,ARMAS,ARMAT,ARMEE,
  ARMER,ARMES,ARMEZ,AROME,ARQUA,ARQUE,ARRET,ARROI,ARYEN,ASANA,ASCII,ASIES,ASILE,ASPIC,ASSEZ,ASSIS,
  ASTER,ASTIS,ASTRE,ATHEE,ATLAS,ATOLL,ATOME,ATONE,ATOUT,ATRES,AUBES,AUCUN,AUDIT,AUGES,AULNE,AUNES,
  AURAI,AURAS,AUREZ,AUSSI,AUTEL,AUTOS,AUTRE,AVAIS,AVAIT,AVALA,AVALE,AVALS,AVANT,AVARE,AVENS,AVENT,
  AVERS,AVEUX,AVIDE,AVIEZ,AVILI,AVION,AVISA,AVISE,AVIVA,AVIVE,AVOIR,AVONS,AVOUA,AVOUE,AVRIL,AXAIS,
  AXAIT,AXANT,AXENT,AXERA,AXIAL,AXIEZ,AXONS,AYANT,AYONS,AZOTE,AZURE,AZURS,AZYME,BABAE,BABAS,BABEL,
  BABIL,BACHE,BACHS,BACLA,BACLE,BACON,BADEN,BADGE,BADIN,BAFFE,BAFRA,BAFRE,BAGNE,BAGOU,BAGUA,BAGUE,
  BAHUT,BAIES,BAINS,BAKER,BALAI,BALES,BALLE,BALSA,BALTE,BANAL,BANCS,BANDA,BANDE,BANFF,BANJO,BANNI,
  BARBA,BARBE,BARBS,BARBU,BARDA,BARDE,BARGE,BARIL,BARON,BARRA,BARRE,BARRI,BASAI,BASAS,BASAT,BASER,
  BASES,BASEZ,BASIC,BASSE,BATIR,BATIS,BATIT,BATON,BATTE,BATTU,BAUDS,BAUME,BAVAI,BAVAS,BAVAT,BAVER,
  BAVES,BAVEZ,BAYOU,BAZAR,BCBGE,BCBGS,BEANT,BEATE,BEATS,BEAUF,BEAUX,BEBES,BECHA,BECHE,BECOT,BEGUE,
  BEGUM,BEIGE,BELAI,BELAS,BELAT,BELER,BELES,BELEZ,BELGE,BELLE,BEMOL,BENET,BENIN,BENIR,BENIS,BENIT,
  BENNE,BERCA,BERCE,BERET,BERGE,BERME,BERNA,BERNE,BERYL,BETES,BETHS,BETON,BETSY,BETTE,BEVUE,BIAIS,
  BIBLE,BICHE,BIDES,BIDET,BIDON,BIEFS,BIENS,BIERE,BIGOT,BIJOU,BILAN,BILES,BILLE,BILLS,BILLY,BINAI,
  BINAS,BINAT,BINER,BINES,BINEZ,BIQUE,BISES,BISON,BISOU,BISSA,BISSE,BIZUT,BLAMA,BLAME,BLANC,BLASE,
  BLEDS,BLEME,BLEMI,BLETS,BLEUE,BLEUI,BLEUS,BLOCS,BLOND,BLUES,BLUET,BLUFF,BLUTA,BLUTE,BLVDS,BOBBY,
  BOBOS,BOCAL,BOCHE,BODYS,BOERS,BOEUF,BOIRA,BOIRE,BOISA,BOISE,BOITA,BOITE,BOIVE,BOLEE,BOMBE,BONDA,
  BONDE,BONDI,BONDS,BONGO,BONNE,BONNS,BONNY,BONTE,BONUS,BONZE,BOOMS,BORAX,BORDA,BORDE,BORDS,BORES,
  BORIS,BORNA,BORNE,BOSSA,BOSSE,BOSSU,BOTES,BOTTA,BOTTE,BOUCS,BOUDA,BOUDE,BOUEE,BOUES,BOUGE,BOULE,
  BOURG,BOUSE,BOUTS,BOVIN,BOXAI,BOXAS,BOXAT,BOXER,BOXES,BOXEZ,BOYAU,BRADA,BRADE,BRADS,BRAIE,BRAIS,
  BRAIT,BRAMA,BRAME,BRASA,BRASE,BRAVA,BRAVE,BRAVO,BREAK,BREFS,BREME,BREST,BREVE,BRIBE,BRICK,BRIDA,
  BRIDE,BRIMA,BRIME,BRINS,BRIOS,BRISA,BRISE,BROCS,BRODA,BRODE,BROIE,BROME,BRONX,BROYA,BROYE,BRUCE,
  BRUIS,BRUIT,BRULA,BRULE,BRUME,BRUNE,BRUNI,BRUNO,BRUNS,BRUTE,BRUTS,BUCHE,BUEES,BUGGE,BUGGY,BUGLE,
  BULBE,BULLE,BUMES,BURIN,BUSES,BUSHS,BUSSE,BUSTE,BUTAI,BUTAS,BUTAT,BUTEE,BUTER,BUTES,BUTEZ,BUTIN,
  BUTOR,BUTTE,BUVEZ,CABAN,CABLA,CABLE,CABOT,CABRA,CABRE,CABRI,CACAO,CACAS,CACHA,CACHE,CADET,CADRA,
  CADRE,CADUC,CAFES,CAGES,CAHOT,CAIDS,CAINS,CAIRE,CAIRN,CAJOU,CALAI,CALAS,CALAT,CALER,CALES,CALEZ,
  CALIF,CALIN,CALMA,CALME,CALOT,CAMEE,CAMES,CAMPA,CAMPE,CAMPS,CAMUS,CANAI,CANAL,CANAS,CANAT,CANDI,
  CANER,CANES,CANEZ,CANIF,CANIN,CANNA,CANNE,CANOE,CANON,CANOT,CAPES,CAPOT,CAPRE,CAPRI,CAPTA,CAPTE,
  CAQUE,CARAT,CARDA,CARDE,CARGO,CARIA,CARIE,CARLS,CARPE,CARRA,CARRE,CARTE,CASAI,CASAS,CASAT,CASER,
  CASES,CASEZ,CASHS,CASSA,CASSE,CASTE,CATCH,CATHY,CATIN,CAUSA,CAUSE,CAVES,CEDAI,CEDAS,CEDAT,CEDEE,
  CEDER,CEDES,CEDEZ,CEDRE,CEINS,CEINT,CELLE,CELTE,CELUI,CENSE,CENTS,CERFS,CERNA,CERNE,CESAR,CESSA,
  CESSE,CETTE,CHAHS,CHAIR,CHAIS,CHALE,CHAMP,CHANT,CHAOS,CHAPE,CHARS,CHATS,CHAUD,CHAUX,CHEFS,CHEIK,
  CHENE,CHENU,CHERE,CHERI,CHERS,CHIAI,CHIAS,CHIAT,CHIEN,CHIER,CHIES,CHIEZ,CHILI,CHINA,CHINE,CHIOT,
  CHIPA,CHIPE,CHIPS,CHOCS,CHOIE,CHOIR,CHOIS,CHOIT,CHOIX,CHOPE,CHOSE,CHOUX,CHOYA,CHOYE,CHRIS,CHUCK,
  CHUTA,CHUTE,CIBLA,CIBLE,CIDRE,CIEUX,CIGUE,CILLA,CILLE,CIMES,CIRAI,CIRAS,CIRAT,CIRER,CIRES,CIREZ,
  CITAI,CITAS,CITAT,CITER,CITES,CITEZ,CIVES,CIVET,CIVIL,CLAIE,CLAIR,CLAMA,CLAME,CLANS,CLARK,CLASH,
  CLEFS,CLERC,CLICS,CLIFF,CLINS,CLIPS,CLIVA,CLIVE,CLONA,CLONE,CLOPE,CLORA,CLORE,CLOSE,CLOUA,CLOUE,
  CLOUS,CLOWN,CLUBS,COACH,COBOL,COBRA,COCAS,COCHE,COCON,COCOS,COCUE,COCUS,CODAI,CODAS,CODAT,CODEE,
  CODER,CODES,CODEX,CODEZ,COEUR,COGNA,COGNE,COHUE,COING,COINS,COITE,COITS,COKES,COLIN,COLIS,COLLA,
  COLLE,COLON,COLOS,COLTS,COLZA,COMAS,COMME,COMTE,CONCU,CONES,CONGE,CONGO,CONNE,CONNS,CONNU,CONTA,
  CONTE,COPIA,COPIE,COPTE,COQUE,CORAN,CORDA,CORDE,COREE,CORNE,CORNU,CORPS,CORSA,CORSE,CORSO,COSSE,
  COSSU,COSTA,COTAI,COTAS,COTAT,COTER,COTES,COTEZ,COTON,COTTE,COUAC,COUDA,COUDE,COUDS,COUIC,COULA,
  COULE,COUPA,COUPE,COUPS,COURE,COURS,COURT,COURU,COUSE,COUSU,COUTA,COUTE,COUTS,COUVA,COUVE,CRABE,
  CRACK,CRACS,CRADE,CRADO,CRAIE,CRAMA,CRAME,CRANA,CRANE,CRANS,CRAWL,CREAI,CREAS,CREAT,CREDO,CREER,
  CREES,CREEZ,CREMA,CREME,CREPA,CREPE,CREPI,CREPU,CRETE,CREUX,CREVA,CREVE,CRIAI,CRIAS,CRIAT,CRICS,
  CRIER,CRIES,CRIEZ,CRIME,CRINS,CRISA,CRISE,CROCS,CROIE,CROIS,CROIT,CROIX,CROSS,CROUP,CRUEL,CRUES,
  CUBAI,CUBAS,CUBAT,CUBER,CUBES,CUBEZ,CUIRA,CUIRE,CUIRS,CUISE,CULOT,CULTE,CUMIN,CUMUL,CURAI,CURAS,
  CURAT,CUREE,CURER,CURES,CUREZ,CURIE,CURRY,CUVAI,CUVAS,CUVAT,CUVEE,CUVER,CUVES,CUVEZ,CYBER,CYCLE,
  CYGNE,DADAS,DAGUE,DAIMS,DAISY,DAKAR,DALIS,DALLA,DALLE,DAMAI,DAMAS,DAMAT,DAMER,DAMES,DAMEZ,DAMNA,
  DAMNE,DANDY,DANSA,DANSE,DARDA,DARDE,DARDS,DARNE,DATAI,DATAS,DATAT,DATER,DATES,DATEZ,DATIF,DATTE,
  DAUBE,DAVES,DAVID,DEANS,DEBAT,DEBIT,DEBUT,DECAS,DECES,DECHU,DECOR,DECRU,DECUE,DECUS,DECUT,DEDIA,
  DEDIE,DEDIS,DEDIT,DEFIA,DEFIE,DEFIS,DEFIT,DEGAT,DEGEL,DEGRE,DEITE,DELAI,DELHI,DELIA,DELIE,DELIT,
  DELTA,DEMET,DEMIE,DEMIS,DEMIT,DEMON,DENIA,DENIE,DENIS,DENSE,DENTA,DENTE,DENTS,DENUE,DEPIT,DEPLU,
  DEPOT,DERBY,DERME,DESIR,DETTE,DEUGS,DEUIL,DEVET,DEVEZ,DEVIA,DEVIE,DEVIN,DEVIS,DEVOT,DEVRA,DIANE,
  DICKS,DICTA,DICTE,DIEGO,DIESE,DIETE,DIEUX,DIGNE,DIGUE,DILUA,DILUE,DIMES,DINDE,DINER,DIODE,DIRAI,
  DIRAS,DIREZ,DISES,DISSE,DITES,DIVAN,DIVAS,DIVIN,DODUE,DODUS,DOGES,DOGME,DOIGT,DOIVE,DOLLY,DOMES,
  DONNA,DONNE,DOPAI,DOPAS,DOPAT,DOPEE,DOPER,DOPES,DOPEZ,DORAI,DORAS,DORAT,DOREE,DORER,DORES,DOREZ,
  DORME,DORMI,DOSAI,DOSAS,DOSAT,DOSER,DOSES,DOSEZ,DOSSE,DOTAI,DOTAS,DOTAT,DOTER,DOTES,DOTEZ,DOUAI,
  DOUAS,DOUAT,DOUCE,DOUEE,DOUER,DOUES,DOUEZ,DOUTA,DOUTE,DOUVE,DOUZE,DOYEN,DRAME,DRAPA,DRAPE,DRAPS,
  DREGE,DROIT,DROLE,DRUES,DRUPE,DRUZE,DUCAL,DUCAT,DUCHE,DUDIT,DUELS,DUMES,DUNES,DUPAI,DUPAS,DUPAT,
  DUPER,DUPES,DUPEZ,DURAI,DURAS,DURAT,DURCI,DUREE,DURER,DURES,DUREZ,DUSSE,DUTES,DUVET,EBAHI,EBATS,
  EBENE,EBOUA,EBOUE,ECALA,ECALE,ECART,ECHEC,ECHOS,ECHUE,ECHUS,ECLAT,ECLOS,ECLOT,ECOLE,ECOPA,ECOPE,
  ECOTS,ECRAN,ECRIN,ECRIS,ECRIT,ECROU,ECRUS,ECUMA,ECUME,EDDIE,EDENS,EDITA,EDITE,EDITH,EDITS,EFFET,
  EGAIE,EGALA,EGALE,EGARA,EGARD,EGARE,EGAUX,EGAYA,EGAYE,EGEES,EGIDE,EGOUT,EGYPT,EIRES,ELANS,ELBES,
  ELEVA,ELEVE,ELFES,ELIDA,ELIDE,ELIMA,ELIME,ELIRA,ELIRE,ELISE,ELITE,ELLES,ELOGE,ELOPA,ELOPE,ELUDA,
  ELUDE,ELUES,EMAIL,EMANA,EMANE,EMAUX,EMBUE,EMERI,EMETS,EMEUS,EMEUT,EMEUX,EMIRS,EMOIS,EMPLI,EMUES,
  EMULE,ENCAN,ENCRE,ENEES,ENFER,ENFIN,ENFLA,ENFLE,ENGIN,ENJEU,ENNUI,ENTAI,ENTAS,ENTAT,ENTER,ENTES,
  ENTEZ,ENTRA,ENTRE,ENVIA,ENVIE,ENVOI,ENVOL,EPAIS,EPANS,EPANT,EPARS,EPATA,EPATE,EPAVE,EPEES,EPELA,
  EPELE,EPIAI,EPIAS,EPIAT,EPICA,EPICE,EPIER,EPIES,EPIEZ,EPINE,EPOUX,EPRIS,EPSOM,EPURA,EPURE,ERGOT,
  ERIGE,ERODA,ERODE,ERRAI,ERRAS,ERRAT,ERRER,ERRES,ERREZ,ESOPE,ESPAR,ESSAI,ESSEC,ESSOR,ETAGE,ETAIE,
  ETAIN,ETAIS,ETAIT,ETALA,ETALE,ETAMA,ETAME,ETANG,ETANT,ETAPE,ETATS,ETAUX,ETAYA,ETAYE,ETEND,ETHER,
  ETIEZ,ETIRA,ETIRE,ETNAS,ETOLE,ETUDE,ETUIS,ETUVA,ETUVE,EUMES,EUROS,EUSSE,EUTES,EVADE,EVASA,EVASE,
  EVEIL,EVENT,EVIDA,EVIDE,EVIER,EVITA,EVITE,EXACT,EXCES,EXCLU,EXIGE,EXIGU,EXILA,EXILE,EXILS,EXODE,
  EXPIA,EXPIE,EXPOS,EXTRA,FABLE,FACES,FACHA,FACHE,FACON,FADES,FAGOT,FAIMS,FAINE,FAIRE,FAITE,FAITS,
  FAKIR,FALLU,FALOT,FAMEE,FAMES,FANAI,FANAL,FANAS,FANAT,FANER,FANES,FANEZ,FANGE,FANON,FAONS,FARAD,
  FARCE,FARCI,FARDA,FARDE,FARDS,FARTA,FARTE,FARTS,FASOS,FASSE,FASTE,FATAL,FAUNE,FAUST,FAUTA,FAUTE,
  FAUVE,FAYOT,FECAL,FECES,FEINS,FEINT,FELAI,FELAS,FELAT,FELER,FELES,FELEZ,FELIN,FELIX,FEMME,FEMUR,
  FENDE,FENDS,FENDU,FENTE,FERAI,FERAS,FEREZ,FERIE,FERLA,FERLE,FERMA,FERME,FERRA,FERRE,FERRY,FERUE,
  FERUS,FESSA,FESSE,FETAI,FETAS,FETAT,FETER,FETES,FETEZ,FETUX,FEULA,FEULE,FEVES,FIBRE,FICHA,FICHE,
  FICHU,FIEFS,FIELS,FIERE,FIERS,FIFRE,FIGEA,FIGER,FIGES,FIGEZ,FIGUE,FIJIS,FILAI,FILAS,FILAT,FILER,
  FILES,FILET,FILEZ,FILIN,FILLE,FILMA,FILME,FILMS,FILON,FILOU,FIMES,FINAL,FINES,FINIR,FINIS,FINIT,
  FIOLE,FIRME,FISSE,FITES,FIXAI,FIXAS,FIXAT,FIXER,FIXES,FIXEZ,FJORD,FLACS,FLAIR,FLANA,FLANC,FLANE,
  FLANS,FLASH,FLEAU,FLETS,FLEUR,FLICS,FLIRT,FLORE,FLOTS,FLOUE,FLOUS,FLUAI,FLUAS,FLUAT,FLUER,FLUES,
  FLUET,FLUEZ,FLUOR,FLUTE,FOBES,FOCAL,FOIES,FOINS,FOIRE,FOLIE,FOLIO,FOLLE,FONCA,FONCE,FONDA,FONDE,
  FONDS,FONDU,FONTE,FONTS,FOOTS,FORAI,FORAS,FORAT,FORCA,FORCE,FORDS,FORER,FORES,FORET,FOREZ,FORGE,
  FORMA,FORME,FORTE,FORTS,FORUM,FOSSE,FOUET,FOUIR,FOUIS,FOUIT,FOULA,FOULE,FOURS,FOUTE,FOUTU,FOYER,
  FRAIE,FRAIS,FRANC,FRANK,FRANZ,FRAYA,FRAYE,FREDI,FREDS,FREIN,FRELE,FREMI,FRENE,FRERE,FRETA,FRETE,
  FRETS,FREUD,FREUX,FRICS,FRIGO,FRIME,FRIPA,FRIPE,FRIRE,FRISA,FRISE,FRITE,FROCS,FROID,FROLA,FROLE,
  FRONT,FRUIT,FUELS,FUGUE,FUIES,FUIRA,FUITE,FUMAI,FUMAS,FUMAT,FUMEE,FUMER,FUMES,FUMET,FUMEZ,FURAX,
  FURET,FURIA,FURIE,FUSAI,FUSAS,FUSAT,FUSEE,FUSER,FUSES,FUSEZ,FUSIL,FUSSE,FUTEE,FUTES,FUTON,FUTUR,
  FUYEZ,GABIS,GABON,GACHA,GACHE,GAFFA,GAFFE,GAGAS,GAGEA,GAGER,GAGES,GAGEZ,GAGNA,GAGNE,GAIES,GAINA,
  GAINE,GAINS,GALAS,GALBA,GALBE,GALEE,GALES,GALET,GALLE,GALON,GALOP,GAMIN,GAMMA,GAMME,GANDS,GANGE,
  GANGS,GANSA,GANSE,GANTA,GANTE,GANTS,GARAI,GARAS,GARAT,GARCE,GARDA,GARDE,GARER,GARES,GARET,GAREZ,
  GARNI,GATAI,GATAS,GATAT,GATER,GATES,GATEZ,GATTS,GAULA,GAULE,GAVAI,GAVAS,GAVAT,GAVER,GAVES,GAVEZ,
  GAZAI,GAZAS,GAZAT,GAZER,GAZES,GAZEZ,GAZON,GEAIS,GEANT,GECKO,GEINS,GEINT,GELAI,GELAS,GELAT,GELEE,
  GELER,GELES,GELEZ,GEMIR,GEMIS,GEMIT,GEMME,GENAI,GENAS,GENAT,GENEE,GENER,GENES,GENET,GENEZ,GENIE,
  GENOU,GENRE,GENTS,GEOLE,GERAI,GERAS,GERAT,GERBA,GERBE,GERCA,GERCE,GERER,GERES,GEREZ,GERMA,GERME,
  GESIR,GESTE,GHANA,GIBET,GICLA,GICLE,GIFLA,GIFLE,GIGOT,GIGUE,GILET,GIRLS,GIRON,GISEZ,GITAN,GITES,
  GIVRA,GIVRE,GLACA,GLACE,GLANA,GLAND,GLANE,GLAPI,GLEBE,GLENN,GLOBE,GLOSA,GLOSE,GNOLE,GNOME,GNONS,
  GNOUS,GOALS,GOBAI,GOBAS,GOBAT,GOBER,GOBES,GOBEZ,GODET,GOLFE,GOLFS,GOMBO,GOMMA,GOMME,GONDS,GONGS,
  GORGE,GOSSE,GOTHE,GOTHS,GOUGE,GOULE,GOULU,GOUTA,GOUTE,GOUTS,GPLZS,GRAAL,GRACE,GRADE,GRAIN,GRAND,
  GRAVA,GRAVE,GRAVI,GREAI,GREAS,GREAT,GRECE,GRECS,GREEN,GREER,GREES,GREEZ,GREGS,GRELE,GREMI,GRENU,
  GREVA,GREVE,GRIEF,GRILL,GRILS,GRISA,GRISE,GRIVE,GROGS,GROIN,GROOM,GRUAU,GRUES,GUAMS,GUANO,GUEPE,
  GUERE,GUERI,GUETS,GUEUX,GUIDA,GUIDE,GUIDO,GUIRE,GUISE,GUPPY,GYPSE,HABIT,HACHA,HACHE,HAIES,HAINE,
  HAIRA,HAITI,HALAI,HALAS,HALAT,HALEE,HALER,HALES,HALEZ,HALLE,HALLS,HALOS,HALTE,HAMAC,HAMPE,HANOI,
  HANTA,HANTE,HAPPA,HAPPE,HARAS,HARDE,HARDI,HARDY,HAREM,HARPE,HARRY,HATAI,HATAS,HATAT,HATER,HATES,
  HATEZ,HATIF,HAUTE,HAUTS,HAVES,HAVRE,HAWAI,HAYES,HAYON,HEGEL,HELAI,HELAS,HELAT,HELEN,HELER,HELES,
  HELEZ,HELIX,HENNE,HENNI,HENRI,HENRY,HERBE,HERBU,HERES,HERON,HEROS,HERSA,HERSE,HERTZ,HESSE,HETRE,
  HEURE,HEURT,HEVEA,HIBOU,HICKE,HINDI,HIPPY,HISSA,HISSE,HIVER,HOBBY,HOCHA,HOCHE,HOMME,HOMOS,HONGS,
  HONNI,HONTE,HORDE,HORNS,HOTEL,HOTES,HOTTE,HOUES,HOULE,HTMLS,HUAIS,HUAIT,HUANT,HUARD,HUCHE,HUEES,
  HUENT,HUERA,HUIEZ,HUILA,HUILE,HUMAI,HUMAS,HUMAT,HUMER,HUMES,HUMEZ,HUMUS,HUNES,HUONS,HUPPE,HURES,
  HURLA,HURLE,HUTTE,HYDRO,HYENE,HYMEN,HYMNE,IBERE,ICONE,IDAHO,IDEAL,IDEES,IDIOT,IDOLE,IGLOO,IGNEE,
  ILEON,ILLES,ILOTE,ILOTS,IMAGE,IMAMS,IMBUE,IMBUS,IMITA,IMITE,IMPEC,IMPER,IMPIE,IMPOT,IMPUR,INCAS,
  INDES,INDEX,INDUE,INDUS,INFUS,INNEE,INNES,INOUI,INTER,IODAI,IODAS,IODAT,IODER,IODES,IODEZ,IODLA,
  IODLE,IOTAS,IOWAS,IRAIS,IRAIT,IRAKS,IRANS,IRAQS,IRIEZ,IRISE,IRONS,IRONT,ISERE,ISLAM,ISOLA,ISOLE,
  ISSUE,ISSUS,ITEMS,ITERA,ITERE,IVANS,IVRES,JABOT,JACKS,JACOB,JACTA,JACTE,JADES,JADIS,JALON,JAMBE,
  JAMES,JANES,JANTE,JAPON,JAPPA,JAPPE,JASAI,JASAS,JASAT,JASER,JASES,JASEZ,JASPE,JATTE,JAUGE,JAUNE,
  JAUNI,JAVAS,JAVEL,JEANS,JEEPS,JEFFS,JESUS,JETAI,JETAS,JETAT,JETEE,JETER,JETEZ,JETON,JETTE,JEUDI,
  JEUNA,JEUNE,JILLS,JIMMY,JODLA,JODLE,JOELS,JOGGA,JOGGE,JOHNS,JOIES,JOINS,JOINT,JOKER,JOLIE,JOLIS,
  JONCS,JONES,JOSES,JOUAI,JOUAS,JOUAT,JOUER,JOUES,JOUET,JOUEZ,JOUGS,JOUIR,JOUIS,JOUIT,JOULE,JOURS,
  JOUTA,JOUTE,JOYAU,JUANS,JUCHA,JUCHE,JUDEE,JUDOS,JUGEA,JUGER,JUGES,JUGEZ,JUIFS,JUINS,JUIVE,JULEP,
  JULES,JULIA,JULIE,JUNES,JUNON,JUNTE,JUPES,JUPON,JURAI,JURAS,JURAT,JUREE,JURER,JURES,JUREZ,JURON,
  JURYS,JUSTE,JUTES,KAPOK,KAREN,KARMA,KARTS,KATHY,KATIE,KAYAC,KAYAK,KCALS,KENTS,KENYA,KEPIS,KETCH,
  KHANS,KIEVS,KIKIS,KILOS,KILTS,KINES,KITTY,KIWIS,KNOUT,KOALA,KODAK,KOHLS,KONGS,KRACH,KURDE,KYSTE,
  LABEL,LACAI,LACAS,LACAT,LACER,LACES,LACET,LACEZ,LACHA,LACHE,LACIS,LACTE,LADRE,LAGON,LAIDE,LAIDS,
  LAIES,LAINE,LAITS,LAMAS,LAMES,LAMPE,LANCA,LANCE,LANDE,LANGE,LAPAI,LAPAS,LAPAT,LAPER,LAPES,LAPEZ,
  LAPIN,LAPON,LAQUA,LAQUE,LARDA,LARDE,LARDS,LARGE,LARGO,LARME,LARVE,LASER,LASSA,LASSE,LASSO,LATEX,
  LATIN,LATTA,LATTE,LAURE,LAVAI,LAVAS,LAVAT,LAVER,LAVES,LAVEZ,LAYON,LAZZI,LECHA,LECHE,LECON,LEDIT,
  LEGAL,LEGAT,LEGER,LEGUA,LEGUE,LEMAN,LENTE,LENTS,LEONE,LEONS,LEPRE,LESAI,LESAS,LESAT,LESER,LESES,
  LESEZ,LESTA,LESTE,LESTS,LEVAI,LEVAS,LEVAT,LEVEE,LEVER,LEVES,LEVEZ,LEVRE,LEWIS,LIAIS,LIAIT,LIANE,
  LIANT,LIBAN,LIBRE,LIBYE,LICES,LICOU,LIEGE,LIENS,LIENT,LIERA,LIEUE,LIEUR,LIEUX,LIGNE,LIGUA,LIGUE,
  LIIEZ,LILAS,LILLE,LILLY,LIMAI,LIMAS,LIMAT,LIMBE,LIMER,LIMES,LIMEZ,LIMON,LINDA,LINGE,LINON,LIONS,
  LIRAI,LIRAS,LIREZ,LISAS,LISES,LISEZ,LISSA,LISSE,LISTA,LISTE,LITEE,LITRE,LIVRA,LIVRE,LLOYD,LOBBY,
  LOBES,LOCAL,LOESS,LOGEA,LOGER,LOGES,LOGEZ,LOGIS,LOGOS,LOIRE,LOIRS,LOMBE,LONGE,LONGS,LOPIN,LOQUE,
  LORDS,LOTIR,LOTIS,LOTIT,LOTOS,LOTTE,LOTUS,LOUAI,LOUAS,LOUAT,LOUER,LOUES,LOUEZ,LOUIS,LOUPA,LOUPE,
  LOUPS,LOURD,LOUVE,LOYAL,LOYER,LUBIE,LUCIE,LUCRE,LUEUR,LUGEA,LUGER,LUGES,LUGEZ,LUIRA,LUIRE,LUISE,
  LUMEN,LUMES,LUNCH,LUNDI,LUNES,LUPIN,LURON,LUSIN,LUSSE,LUTES,LUTHS,LUTIN,LUTTA,LUTTE,LUXAI,LUXAS,
  LUXAT,LUXER,LUXES,LUXEZ,LYCEE,LYCOS,LYONS,LYRES,MACHA,MACHE,MACHO,MACON,MACRO,MADRE,MAFIA,MAGES,
  MAGIE,MAGMA,MAGNA,MAGNE,MAGOT,MAILS,MAINE,MAINS,MAINT,MAIRE,MAJOR,MALES,MALIN,MALIS,MALLE,MALTA,
  MALTE,MALTS,MAMAN,MAMBA,MANDA,MANDE,MANGE,MANIA,MANIE,MANNE,MANTE,MARCS,MARDI,MAREE,MARES,MARGE,
  MARIA,MARIE,MARIN,MARIO,MARIS,MARKS,MARNA,MARNE,MAROC,MARRA,MARRE,MARRI,MARYS,MASHS,MASON,MASSA,
  MASSE,MATAI,MATAS,MATAT,MATCH,MATER,MATES,MATEZ,MATHS,MATIN,MATIR,MATIS,MATIT,MATOU,MATTS,MAUDE,
  MAURE,MAUVE,MECHA,MECHE,MEDIA,MEDIS,MEDIT,MEFIA,MEFIE,MEGAS,MEGIR,MEGIS,MEGIT,MEGOT,MELAI,MELAS,
  MELAT,MELEE,MELER,MELES,MELEZ,MELON,MELOS,MEMES,MEMOS,MENAI,MENAS,MENAT,MENER,MENES,MENEZ,MENTE,
  MENTI,MENUS,MERCI,MERDE,MERES,MERLE,MERLU,MEROU,MESAS,MESON,MESSE,METAL,METEO,METIS,METRA,METRE,
  METRO,METTE,MEULA,MEULE,MEURE,MEURS,MEURT,MEUSE,MEUTE,MEUVE,MIAMI,MIAOU,MICAS,MICHE,MICRO,MIDAS,
  MIDIS,MIELS,MIENS,MIEUX,MIGRA,MIGRE,MIKES,MILAN,MILES,MILKY,MILLE,MIMAI,MIMAS,MIMAT,MIMER,MIMES,
  MIMEZ,MINAI,MINAS,MINAT,MINCE,MINCI,MINER,MINES,MINET,MINEZ,MINGS,MINIE,MINIS,MINOU,MIRAI,MIRAS,
  MIRAT,MIRER,MIRES,MIREZ,MISAI,MISAS,MISAT,MISER,MISES,MISEZ,MISSE,MITAI,MITAS,MITAT,MITEE,MITER,
  MITES,MITEZ,MITRE,MIXER,MIXTE,MOCHE,MODAL,MODEM,MODES,MOIES,MOINE,MOINS,MOIRA,MOIRE,MOISA,MOISE,
  MOISI,MOITE,MOKAS,MOLES,MOLLE,MOLLI,MOLLO,MOMES,MOMIE,MONDA,MONDE,MONOS,MONTA,MONTE,MONTS,MOQUA,
  MOQUE,MORAL,MORDE,MORDS,MORDU,MORNE,MORSE,MORTS,MORUE,MORVE,MOSES,MOTEL,MOTET,MOTIF,MOTOS,MOTTE,
  MOUDS,MOUES,MOULA,MOULE,MOULU,MOUTS,MOYEN,MOYES,MOYEU,MTECS,MTEPS,MUAIS,MUAIT,MUANT,MUCUS,MUENT,
  MUERA,MUETS,MUFLE,MUGES,MUGIR,MUGIS,MUGIT,MUIEZ,MULES,MULET,MULOT,MULTI,MUMES,MUNIR,MUNIS,MUNIT,
  MUONS,MURAI,MURAL,MURAS,MURAT,MURER,MURES,MUREZ,MURIR,MURIS,MURIT,MUSAI,MUSAS,MUSAT,MUSCS,MUSEE,
  MUSER,MUSES,MUSEZ,MUSIC,MUSSE,MUTAI,MUTAS,MUTAT,MUTER,MUTES,MUTEZ,MUTIN,MYOPE,MYRTE,MYTHE,NABOT,
  NACRE,NADIR,NAFTA,NAGEA,NAGER,NAGES,NAGEZ,NAIFS,NAINE,NAINS,NAIVE,NANCY,NANTI,NAPPA,NAPPE,NARRA,
  NARRE,NASAL,NASAS,NASSE,NATAL,NATIF,NATTE,NAVAL,NAVET,NAVRA,NAVRE,NAZIE,NAZIS,NEANT,NEFLE,NEGRE,
  NEIGE,NEONS,NEPAL,NERFS,NETTE,NEVES,NEVEU,NIAIS,NIAIT,NIANT,NICES,NICHA,NICHE,NICKS,NIECE,NIENT,
  NIERA,NIGER,NIIEZ,NIMES,NINAS,NIONS,NIPPA,NIPPE,NIQUE,NIXON,NOBEL,NOBLE,NOCES,NOCIF,NODAL,NOELS,
  NOEUD,NOIES,NOIRE,NOIRS,NOMMA,NOMME,NONCE,NONNE,NORME,NORMS,NOTAI,NOTAS,NOTAT,NOTER,NOTES,NOTEZ,
  NOTRE,NOUAI,NOUAS,NOUAT,NOUBA,NOUER,NOUES,NOUEZ,NOVAE,NOYAI,NOYAS,NOYAT,NOYAU,NOYEE,NOYER,NOYES,
  NOYEZ,NUAGE,NUEES,NUIRA,NUIRE,NUISE,NUITS,NULLE,NUQUE,NURSE,NYLON,OASIS,OBEIR,OBEIS,OBEIT,OBERA,
  OBERE,OBESE,OBITS,OBJET,OBOLE,OBTUS,OCDES,OCEAN,OCTAL,OCTET,ODEUR,OEUFS,OFFRE,OGIVE,OGRES,OHIOS,
  OIENT,OIGNE,OISES,OISIF,OISON,OLIVE,OMANS,OMBRA,OMBRE,OMETS,ONCES,ONCLE,ONDEE,ONDES,ONGLE,OPALE,
  OPALS,OPEPS,OPERA,OPERE,OPINA,OPINE,OPIUM,OPTAI,OPTAS,OPTAT,OPTER,OPTES,OPTEZ,ORAGE,ORALE,ORAUX,
  ORBES,ORDRE,OREES,ORGES,ORGIE,ORGUE,ORIEL,ORMES,ORNAI,ORNAS,ORNAT,ORNER,ORNES,ORNEZ,ORPIN,ORSAY,
  ORTIE,OSAIS,OSAIT,OSANT,OSCAR,OSENT,OSERA,OSIER,OSIEZ,OSLOS,OSONS,OTAGE,OTAIS,OTAIT,OTANS,OTANT,
  OTENT,OTERA,OTIEZ,OTONS,OUAIS,OUATA,OUATE,OUBLI,OUEST,OUIES,OURAL,OURLA,OURLE,OURSE,OUTIL,OUTRA,
  OUTRE,OUVRE,OVALE,OVINE,OVINS,OVNIS,OVULA,OVULE,OXYDA,OXYDE,OYANT,OYONS,OZONE,PACKS,PACTE,PAGES,
  PAGNE,PAIEN,PAIES,PAINS,PAIRE,PAIRS,PALAN,PALES,PALET,PALIR,PALIS,PALIT,PALME,PALOT,PALPA,PALPE,
  PAMAI,PAMAS,PAMAT,PAMER,PAMES,PAMEZ,PANAI,PANAS,PANAT,PANDA,PANER,PANES,PANEZ,PANNE,PANSA,PANSE,
  PAONS,PAPAL,PAPAS,PAPES,PAQUE,PARAI,PARAS,PARAT,PARCE,PARCS,PARER,PARES,PAREZ,PARIA,PARIE,PARIS,
  PARKA,PARLA,PARLE,PARME,PARMI,PAROI,PARTE,PARTI,PARTS,PARUS,PARUT,PASSA,PASSE,PATEE,PATER,PATES,
  PATEZ,PATIN,PATIO,PATIR,PATIS,PATIT,PATRE,PATTE,PATTY,PAULS,PAUMA,PAUME,PAUSE,PAVAI,PAVAS,PAVAT,
  PAVER,PAVES,PAVEZ,PAVOT,PAYAI,PAYAS,PAYAT,PAYER,PAYES,PAYEZ,PEAGE,PEAUX,PECAN,PECHA,PECHE,PEDES,
  PEGGY,PEGRE,PEINA,PEINE,PEINS,PEINT,PEKIN,PELAI,PELAS,PELAT,PELER,PELES,PELEZ,PELLE,PENAL,PENCE,
  PENDE,PENDS,PENDU,PENES,PENIS,PENNE,PENNS,PENNY,PENSA,PENSE,PENTE,PEONS,PEPIA,PEPIE,PEPIN,PERCA,
  PERCE,PERCU,PERDE,PERDS,PERDU,PERES,PERIL,PERIR,PERIS,PERIT,PERLA,PERLE,PERME,PEROU,PERSE,PERTE,
  PESAI,PESAS,PESAT,PESER,PESES,PESEZ,PESOS,PESTA,PESTE,PETAI,PETAS,PETAT,PETER,PETES,PETEZ,PETIT,
  PETRI,PEURS,PHARE,PHASE,PHILO,PHILS,PHONE,PHONO,PHOTO,PIAFS,PIANO,PICOT,PIECE,PIEDS,PIEGE,PIETE,
  PIEUX,PIGEA,PIGER,PIGES,PIGEZ,PILAI,PILAS,PILAT,PILER,PILES,PILEZ,PILLA,PILLE,PILON,PINCA,PINCE,
  PINTE,PIONS,PIPAI,PIPAS,PIPAT,PIPER,PIPES,PIPEZ,PIPIS,PIQUA,PIQUE,PIREE,PIRES,PISES,PISSA,PISSE,
  PISTA,PISTE,PITIE,PITON,PITRE,PIVOT,PIXEL,PIZZA,PLACA,PLACE,PLAGE,PLAID,PLAIE,PLAIS,PLAIT,PLANA,
  PLANE,PLANS,PLANT,PLATS,PLEIN,PLEUR,PLEUT,PLIAI,PLIAS,PLIAT,PLIER,PLIES,PLIEZ,PLOIE,PLOMB,PLOUC,
  PLOYA,PLOYE,PLUIE,PLUMA,PLUME,PNEUS,PNUDS,POCHA,POCHE,POELE,POEME,POETE,POIDS,POILS,POILU,POING,
  POINS,POINT,POIRE,POKER,POLAR,POLES,POLIE,POLIO,POLIR,POLIS,POLIT,POLKA,POLOS,POMME,POMPA,POMPE,
  PONCA,PONCE,PONDE,PONDS,PONDU,PONEY,PONTE,PONTS,POPES,PORCS,PORES,PORNO,PORTA,PORTE,PORTS,POSAI,
  POSAS,POSAT,POSEE,POSER,POSES,POSEZ,POSTA,POSTE,POTES,POTIN,POUAH,POUCE,POULE,POULS,POUPE,POWER,
  PREAU,PREND,PRETA,PRETE,PRETS,PREVU,PRIAI,PRIAS,PRIAT,PRIER,PRIES,PRIEZ,PRIMA,PRIME,PRIMO,PRISA,
  PRISE,PRIVA,PRIVE,PROBE,PROFS,PROIE,PROLO,PROMU,PRONA,PRONE,PROSE,PROUE,PRUDE,PRUNE,PUAIS,PUAIT,
  PUANT,PUCES,PUENT,PUERA,PUIEZ,PUISA,PUISE,PUITS,PULLS,PULPE,PUMAS,PUMES,PUNCH,PUNIR,PUNIS,PUNIT,
  PUNKS,PUNTS,PUONS,PUREE,PURES,PURGE,PURIN,PUSSE,PUTES,PUTTA,PUTTE,PUTTS,QATAR,QUAIS,QUAND,QUANT,
  QUART,QUASI,QUELS,QUETA,QUETE,QUEUE,QUOTA,RABAT,RABLA,RABLE,RABOT,RACEE,RACES,RACLA,RACLE,RADAR,
  RADES,RADIA,RADIE,RADIN,RADIO,RADIS,RADON,RAFLA,RAFLE,RAGEA,RAGER,RAGES,RAGEZ,RAGOT,RAIDE,RAIDI,
  RAIDS,RAIES,RAILS,RALAI,RALAS,RALAT,RALER,RALES,RALEZ,RAMAI,RAMAS,RAMAT,RAMER,RAMES,RAMEZ,RAMIS,
  RAMPA,RAMPE,RANCE,RANCH,RANCI,RANGE,RANGS,RAPAI,RAPAS,RAPAT,RAPEE,RAPER,RAPES,RAPEZ,RAPTS,RAQUA,
  RAQUE,RARES,RASAI,RASAS,RASAT,RASEE,RASER,RASES,RASEZ,RASSI,RATAI,RATAS,RATAT,RATEE,RATER,RATES,
  RATEZ,RATIO,RATON,RAVAI,RAVAS,RAVAT,RAVER,RAVES,RAVEZ,RAVIN,RAVIR,RAVIS,RAVIT,RAYAI,RAYAS,RAYAT,
  RAYEE,RAYER,RAYES,RAYEZ,RAYON,REAGI,REBAT,REBUS,REBUT,RECEL,RECHE,RECIF,RECIT,RECLU,RECRU,RECUE,
  RECUL,RECUS,RECUT,REDIS,REDIT,REDUS,REDUT,REELS,REELU,REFIS,REFIT,REFUS,REGAL,REGIR,REGIS,REGIT,
  REGLA,REGLE,REGNA,REGNE,REIMS,REINE,REINS,REJET,RELIA,RELIE,RELIS,RELIT,RELUS,RELUT,REMET,REMIS,
  REMIT,REMUA,REMUE,RENAL,RENDE,RENDS,RENDU,RENEE,RENES,RENIA,RENIE,RENNE,RENOM,RENTE,REPAS,REPIT,
  REPLI,REPLU,REPOS,REPUS,REPUT,RESTA,RESTE,RESTO,RETIF,RETRO,REUNI,REVAI,REVAS,REVAT,REVER,REVES,
  REVET,REVEZ,REVIS,REVIT,REVUE,RHINS,RHODE,RHONE,RHUME,RHUMS,RIAIS,RIAIT,RIANT,RICAS,RICHE,RICHS,
  RICKS,RICKY,RICOS,RIDAI,RIDAS,RIDAT,RIDEE,RIDER,RIDES,RIDEZ,RIENT,RIEUR,RIIEZ,RIMAI,RIMAS,RIMAT,
  RIMER,RIMES,RIMEZ,RINCA,RINCE,RINGS,RIONS,RIPAI,RIPAS,RIPAT,RIPER,RIPES,RIPEZ,RIRAI,RIRAS,RIREZ,
  RISEE,RISSE,RITAL,RITES,RIVAI,RIVAL,RIVAS,RIVAT,RIVER,RIVES,RIVET,RIVEZ,RIXES,RIYAD,ROBES,ROBIN,
  ROBOT,ROCHE,ROCKS,RODAI,RODAS,RODAT,RODEO,RODER,RODES,RODEZ,ROGER,ROGNA,ROGNE,ROLES,ROMAN,ROMES,
  ROMPE,ROMPS,ROMPT,ROMPU,RONCE,RONDE,RONDS,RONGE,ROQUE,ROSEE,ROSES,ROSSA,ROSSE,ROTAI,ROTAS,ROTAT,
  ROTER,ROTES,ROTEZ,ROTIN,ROTIR,ROTIS,ROTIT,ROTOR,ROUAI,ROUAN,ROUAS,ROUAT,ROUEN,ROUER,ROUES,ROUET,
  ROUEZ,ROUGE,ROUGI,ROULA,ROULE,ROUTA,ROUTE,ROYAL,RUADE,RUAIS,RUAIT,RUANT,RUBAN,RUBIS,RUBYS,RUCHE,
  RUDES,RUEES,RUENT,RUERA,RUGBY,RUGIR,RUGIS,RUGIT,RUHRS,RUIEZ,RUINA,RUINE,RUMBA,RUMEN,RUNES,RUONS,
  RUPIN,RURAL,RUSAI,RUSAS,RUSAT,RUSEE,RUSER,RUSES,RUSEZ,RUSSE,RUTHS,SABLA,SABLE,SABOT,SABRA,SABRE,
  SACHE,SACRA,SACRE,SAGAS,SAGES,SAINE,SAINS,SAINT,SAISI,SAKES,SALAI,SALAM,SALAS,SALAT,SALEE,SALEM,
  SALER,SALES,SALEZ,SALIN,SALIR,SALIS,SALIT,SALKS,SALLE,SALLY,SALON,SALOP,SALUA,SALUE,SALUT,SALVE,
  SAMBA,SAMOA,SANDY,SANGS,SANTE,SAONE,SAOUL,SAPAI,SAPAS,SAPAT,SAPER,SAPES,SAPEZ,SAPIN,SARAH,SARDE,
  SARRE,SATAN,SATIN,SAUCA,SAUCE,SAUGE,SAULE,SAUNA,SAUTA,SAUTE,SAUTS,SAUVA,SAUVE,SAVON,SAXES,SAXON,
  SAXOS,SCALP,SCEAU,SCENE,SCIAI,SCIAS,SCIAT,SCIER,SCIES,SCIEZ,SCION,SCOOP,SCORE,SCOTT,SCOUT,SEAUX,
  SECHA,SECHE,SECTE,SEINE,SEING,SEINS,SEIZE,SELLA,SELLE,SELON,SELTZ,SEMAI,SEMAS,SEMAT,SEMER,SEMES,
  SEMEZ,SEMIS,SENAT,SENSE,SENTE,SENTI,SEOIR,SEOUL,SEPIA,SERAI,SERAS,SERBE,SEREZ,SERFS,SERGE,SERIE,
  SERIN,SERPE,SERRA,SERRE,SERTI,SERUM,SERVE,SERVI,SEUIL,SEVES,SEVIR,SEVIS,SEVIT,SEVRA,SEVRE,SEXES,
  SHAHS,SHORT,SIDAS,SIEGE,SIENS,SIGLE,SIGNA,SIGNE,SIKHS,SILEX,SILOS,SINAI,SINGE,SINON,SINUA,SINUE,
  SINUS,SIONS,SIOUX,SIRES,SIROP,SISAL,SITES,SITOT,SITUA,SITUE,SITUS,SITUX,SKIAI,SKIAS,SKIAT,SKIER,
  SKIES,SKIEZ,SKIFF,SLAVE,SLOOP,SMITH,SMOGS,SNACK,SNOBA,SNOBE,SOBRE,SOCLE,SODAS,SOEUR,SOFAS,SOFIA,
  SOIES,SOIFS,SOINS,SOIRS,SOJAS,SOLDA,SOLDE,SOLES,SOLOS,SOMMA,SOMME,SONAR,SONDA,SONDE,SONGE,SONNA,
  SONNE,SORTE,SORTI,SORTS,SOSIE,SOTES,SOUCI,SOUDA,SOUDE,SOULA,SOULE,SOULS,SOUPE,SOURD,SOUTE,SOYAS,
  SOYEZ,SPORE,SPORT,SPOTS,SPRAY,STADE,STAGE,STAND,STARS,STASE,STEAK,STELE,STENO,STERE,STEVE,STOCK,
  STOPS,STORE,STRIA,STRIE,STUCS,STYLA,STYLE,STYLO,SUAIS,SUAIT,SUANT,SUAVE,SUBIR,SUBIS,SUBIT,SUCAI,
  SUCAS,SUCAT,SUCER,SUCES,SUCEZ,SUCRA,SUCRE,SUDES,SUEDE,SUENT,SUERA,SUEUR,SUFFI,SUIES,SUIEZ,SUIFS,
  SUITE,SUIVE,SUIVI,SUJET,SUMAC,SUONS,SUPER,SUPRA,SURES,SURET,SURFA,SURFE,SURFS,SURGI,SURIR,SURIS,
  SURIT,SUSAN,SUSHI,SUSSE,SWING,SYMPA,SYRIE,TABAC,TABLA,TABLE,TABOU,TACHA,TACHE,TACLE,TACOS,TACOT,
  TACTS,TAIES,TAIIT,TAINS,TAIRA,TAIRE,TAISE,TALAI,TALAS,TALAT,TALCS,TALER,TALES,TALEZ,TALON,TALUS,
  TAMIS,TANCA,TANCE,TANGO,TANIN,TANKS,TANNA,TANNE,TANTE,TAONS,TAPAI,TAPAS,TAPAT,TAPER,TAPES,TAPEZ,
  TAPIR,TAPIS,TAPIT,TARDA,TARDE,TAREE,TARES,TARIF,TARIR,TARIS,TARIT,TAROT,TARSE,TARTE,TASSA,TASSE,
  TATAI,TATAS,TATAT,TATER,TATES,TATEZ,TATOU,TAULE,TAUPE,TAXAI,TAXAS,TAXAT,TAXER,TAXES,TAXEZ,TAXIS,
  TCHAD,TECKS,TEINS,TEINT,TELES,TELEX,TELLE,TEMPE,TEMPO,TEMPS,TENDE,TENDS,TENDU,TENEZ,TENIA,TENIR,
  TENNS,TENON,TENOR,TENTA,TENTE,TENUE,TENUS,TERME,TERNE,TERNI,TERRA,TERRE,TERRY,TESTA,TESTE,TESTS,
  TETAI,TETAS,TETAT,TETER,TETES,TETEZ,TETTE,TETUE,TETUS,TEXAN,TEXAS,TEXTE,THAIS,THEME,THESE,THONS,
  THUYA,THYMS,TIARE,TIBET,TIBIA,TIBRE,TIEDE,TIEDI,TIENS,TIENT,TIERS,TIGES,TIGRE,TILDE,TIMES,TIMON,
  TINAS,TINTA,TINTE,TIPIS,TIQUA,TIQUE,TIRAI,TIRAS,TIRAT,TIREE,TIRER,TIRES,TIRET,TIREZ,TISON,TISSA,
  TISSE,TISSU,TITAN,TITRA,TITRE,TOAST,TOGES,TOGOS,TOILE,TOISE,TOITS,TOKYO,TOLES,TOLET,TOLLE,TOMBA,
  TOMBE,TOMES,TONAL,TONDE,TONDS,TONDU,TONGA,TONGS,TONNE,TONTE,TONYS,TOPAI,TOPAS,TOPAT,TOPER,TOPES,
  TOPEZ,TOQUE,TORDE,TORDS,TORDU,TORON,TORSE,TORTS,TORVE,TORYS,TOTAL,TOTEM,TOURS,TOUTE,TRACA,TRACE,
  TRACS,TRACT,TRAHI,TRAIE,TRAIN,TRAIS,TRAIT,TRAMA,TRAME,TRAMS,TRAPU,TREMA,TREVE,TRIAI,TRIAS,TRIAT,
  TRIBU,TRIER,TRIES,TRIEZ,TRIMA,TRIME,TRIOS,TRIPE,TROCS,TROIS,TROLL,TRONC,TRONE,TROPE,TROTS,TROUA,
  TROUE,TROUS,TROYS,TRUCS,TRUIE,TRUST,TSARS,TUAIS,TUAIT,TUANT,TUBAI,TUBAS,TUBAT,TUBER,TUBES,TUBEZ,
  TUENT,TUERA,TUEUR,TUIEZ,TUILE,TULLE,TUMES,TUONS,TURBO,TURCS,TURFS,TURIN,TUTES,TUTUS,TUYAU,TVTIS,
  TWAIN,TWEED,TWIST,TYPES,TYRAN,TYROL,TZARS,ULTRA,ULULA,ULULE,UNIES,UNION,UNIRA,UNITE,UNIXS,UNTEL,
  UREES,URINA,URINE,URNES,URSSS,USAGE,USAIS,USAIT,USANT,USEES,USENT,USERA,USIEZ,USINA,USINE,USITE,
  USONS,USUEL,USURE,UTAHS,UTILE,UVULE,VACHE,VAGIN,VAGIR,VAGIS,VAGIT,VAGUE,VAINC,VAINE,VAINS,VALET,
  VALEZ,VALSA,VALSE,VALUS,VALUT,VALVE,VAMPS,VANNA,VANNE,VANTA,VANTE,VAQUA,VAQUE,VARAN,VARIA,VARIE,
  VASES,VASTE,VEAUX,VECUS,VECUT,VEGAS,VEINA,VEINE,VELAI,VELAS,VELAT,VELER,VELES,VELEZ,VELIN,VELOS,
  VELUE,VELUS,VENAL,VENDE,VENDS,VENDU,VENEZ,VENGE,VENIN,VENIR,VENTE,VENTS,VENUE,VENUS,VERAS,VERBE,
  VERDI,VERGE,VERIN,VERNI,VERRA,VERRE,VERSA,VERSE,VERSO,VERTE,VERTS,VERTU,VERVE,VESCE,VESTE,VETES,
  VETEZ,VETIR,VETIS,VETIT,VETOS,VEUFS,VEULE,VEUVE,VEXAI,VEXAS,VEXAT,VEXEE,VEXER,VEXES,VEXEZ,VIBRA,
  VIBRE,VICES,VICIA,VICIE,VIDAI,VIDAS,VIDAT,VIDEO,VIDER,VIDES,VIDEZ,VIENS,VIENT,VIETS,VIEUX,VIGIE,
  VIGNE,VILES,VILLA,VILLE,VIMES,VINCI,VINGT,VIOLA,VIOLE,VIOLS,VIRAI,VIRAL,VIRAS,VIRAT,VIRER,VIRES,
  VIREZ,VIRIL,VIRUS,VISAI,VISAS,VISAT,VISEE,VISER,VISES,VISEZ,VISON,VISSA,VISSE,VITAL,VITES,VITRA,
  VITRE,VITRO,VIVAS,VIVAT,VIVES,VIVEZ,VIVRA,VIVRE,VIZIR,VOCAL,VODKA,VOEUX,VOGUE,VOICI,VOIES,VOILA,
  VOILE,VOIRE,VOISE,VOLAI,VOLAS,VOLAT,VOLEE,VOLER,VOLES,VOLET,VOLEZ,VOLGA,VOLTS,VOMIR,VOMIS,VOMIT,
  VOTAI,VOTAS,VOTAT,VOTER,VOTES,VOTEZ,VOTRE,VOUAI,VOUAS,VOUAT,VOUER,VOUES,VOUEZ,VOULU,VOUTA,VOUTE,
  VOYEZ,VOYOU,VRACS,VRAIE,VRAIS,VULVE,WAGON,WATTS,WHIGS,WHIST,WILLS,WILLY,WOODY,WORLD,XENON,XERES,
  YACHT,YAHOO,YALES,YEMEN,YOGAS,YOGIS,YOLES,YORKS,YUCCA,ZAIRE,ZEBRA,ZEBRE,ZEBUS,ZELEE,ZELES,ZEROS,
  ZESTE,ZINCS,ZOMBI,ZONAL,ZONES,ZOOMS
}'::text[]);
update public.wordle_words set solution = true where word = any ('{
  ABIME,ABRIS,ACIER,ACTIF,ADIEU,AGILE,AIGLE,AIMER,AINSI,AJOUT,ALBUM,ALIBI,ALORS,AMBRE,AMOUR,AMPLE,
  ANCRE,ANGLE,ANNEE,ANTRE,APPEL,APRES,ARBRE,ARENE,ARMEE,AROME,ASILE,ASTRE,ATOME,ATOUT,AUTRE,AVANT,
  AVION,AVOIR,AVRIL,BADGE,BAGUE,BALAI,BALLE,BANAL,BANDE,BANJO,BARBE,BARRE,BASSE,BATON,BELLE,BETON,
  BIBLE,BIJOU,BILAN,BILLE,BLAME,BLANC,BLOND,BOIRE,BOITE,BONTE,BOSSE,BOTTE,BOULE,BRAVE,BRISE,BRUIT,
  BRUME,BRUNE,BUTIN,CABLE,CADRE,CALME,CANAL,CANNE,CANOT,CARGO,CARTE,CASSE,CAUSE,CEDRE,CHAIR,CHAMP,
  CHANT,CHAOS,CHAUD,CHENE,CHERI,CHIEN,CHOIX,CHOSE,CIDRE,CLAIR,CLOWN,COBRA,COEUR,COLLE,COMTE,CONTE,
  CORDE,CORPS,COTON,COUDE,COUPE,COURS,COURT,CRABE,CRAIE,CREME,CREPE,CRISE,CROIX,CRUEL,CYCLE,DANSE,
  DATTE,DEBUT,DELTA,DEMON,DENSE,DEPOT,DESIR,DETTE,DEUIL,DIGNE,DINER,DIVAN,DOIGT,DOUCE,DOUTE,DRAME,
  DROIT,DUVET,ECHEC,ECLAT,ECOLE,ECRAN,ECRIT,EFFET,ELEVE,ELITE,EMAIL,ENFIN,ENNUI,ENTRE,ENVIE,EPAIS,
  EPICE,EPINE,EPOUX,ESSAI,ETAGE,ETANG,ETAPE,ETUDE,EXACT,EXTRA,FABLE,FACON,FAIRE,FAUNE,FAUTE,FEMME,
  FERME,FIBRE,FICHE,FILLE,FINAL,FLASH,FLEUR,FLUTE,FOLIE,FORCE,FORET,FORME,FORTE,FOSSE,FOULE,FRAIS,
  FRERE,FRITE,FROID,FRUIT,FUMEE,FUSEE,FUSIL,GAFFE,GALET,GAMIN,GARDE,GELEE,GENRE,GERME,GESTE,GLACE,
  GLOBE,GOMME,GORGE,GRACE,GRADE,GRAIN,GRAND,GRAVE,GREVE,GUIDE,HABIT,HAINE,HALTE,HAMAC,HERBE,HEROS,
  HEURE,HIVER,HOMME,HONTE,HOTEL,HUILE,HYMNE,IDEAL,IDOLE,IGLOO,IMAGE,INDEX,ISSUE,JAMBE,JAUNE,JETON,
  JEUNE,JOINT,JOKER,JOLIE,JOUER,JOUET,JUPON,JUSTE,KAYAK,KOALA,LAINE,LAMPE,LANCE,LAPIN,LARGE,LARME,
  LASER,LATTE,LEGER,LIBRE,LIGNE,LIMON,LINGE,LISTE,LITRE,LIVRE,LOCAL,LONGE,LOUPE,LOURD,LOYAL,LUEUR,
  LUNDI,LUTIN,LYCEE,MAGIE,MAIRE,MALIN,MANIE,MARDI,MARGE,MARIN,MASSE,MATCH,MATIN,MAUVE,MEDIA,MELON,
  MERCI,MERLE,METAL,METRE,MIEUX,MINCE,MODEM,MOINE,MONDE,MORAL,MORSE,MOTIF,MOULE,MOYEN,MUSEE,MYTHE,
  NAGER,NAIVE,NAPPE,NAVET,NEIGE,NOBLE,NOIRE,NORME,NUAGE,OBJET,OCEAN,ODEUR,OFFRE,OLIVE,OMBRE,ONCLE,
  OPERA,ORAGE,ORDRE,ORGUE,OSIER,OUTIL,OVALE,PAGNE,PAIRE,PANDA,PANNE,PARMI,PAROI,PARTI,PASSE,PATTE,
  PAUSE,PAYER,PECHE,PEINE,PELLE,PENTE,PERLE,PERTE,PESTE,PETIT,PHARE,PHOTO,PIANO,PIECE,PIEGE,PINCE,
  PISTE,PITIE,PIZZA,PLACE,PLAGE,PLAIE,PLANT,PLEIN,PLUIE,PLUME,POCHE,POELE,POIDS,POINT,POIRE,POMME,
  PONEY,PORTE,POSTE,POUCE,POULE,PRIME,PRISE,PRIVE,PROIE,PROSE,PRUNE,PUITS,PUNCH,PUREE,QUART,QUETE,
  QUEUE,QUOTA,RADAR,RADIO,RAIDE,RAYON,REGLE,REINE,RENTE,REPAS,RESTE,REVER,REVUE,RICHE,RIVAL,ROBOT,
  ROCHE,RONDE,ROSEE,ROUGE,ROUTE,ROYAL,RUBAN,RUCHE,RUGBY,RUINE,RURAL,SABLE,SABRE,SAINT,SALLE,SALON,
  SALUT,SAUCE,SAUGE,SAULE,SAVON,SCENE,SCOOP,SEIZE,SELLE,SENTE,SERRE,SERUM,SEUIL,SIGNE,SINGE,SIROP,
  SOBRE,SOCLE,SOEUR,SOLDE,SOMME,SONDE,SORTE,SOUPE,SOURD,SPORT,STADE,STAGE,STYLE,SUCRE,SUITE,SUJET,
  SUPER,TABAC,TABLE,TACHE,TALON,TANTE,TAPIS,TARTE,TASSE,TAUPE,TEMPS,TENTE,TERRE,TEXTE,THEME,TIGRE,
  TISSU,TITRE,TOAST,TOILE,TOMBE,TONNE,TORSE,TOTAL,TRACE,TRAIN,TRAIT,TREVE,TRIBU,TRONC,TUILE,TUYAU,
  UNION,UNITE,USAGE,USINE,UTILE,VACHE,VAGUE,VALET,VALSE,VASTE,VEINE,VENIR,VERBE,VERRE,VERTE,VESTE,
  VIDEO,VIEUX,VILLE,VINGT,VIRUS,VITRE,VIVRE,VOEUX,VOILE,VOIRE,VRAIE,WAGON,YACHT,ZEBRE,ZESTE
}'::text[]);
alter table public.wordle_words enable row level security; -- aucune politique : illisible par les clients
revoke all on public.wordle_words from anon, authenticated;

-- Secret qui rend le mot du jour imprévisible (illisible côté client).
create table public.wordle_secret (secret text not null);
insert into public.wordle_secret values (encode(sha256((random()::text || clock_timestamp()::text)::bytea), 'hex'));
alter table public.wordle_secret enable row level security;
revoke all on public.wordle_secret from anon, authenticated;

create table public.wordle_games (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  guesses text[] not null default '{}',
  solved boolean not null default false,
  finished boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.wordle_games enable row level security;
-- Chacun ne voit que ses propres parties : les propositions d'un autre joueur trahiraient le mot.
create policy "ses propres parties" on public.wordle_games for select to authenticated using (user_id = auth.uid());
revoke all on public.wordle_games from anon, authenticated;
grant select on public.wordle_games to authenticated;

-- Jour courant, heure de Paris.
create function public.wordle_day() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Europe/Paris')::date $$;

create function public.wordle_answer(d date) returns text
language sql stable security definer set search_path = '' as $$
  select word from (
    select word, row_number() over (order by word) - 1 as i, count(*) over () as n
      from public.wordle_words where solution
  ) w
  where i = (('x' || substr(encode(sha256(((select secret from public.wordle_secret) || d::text)::bytea), 'hex'), 1, 8))::bit(32)::bigint % n)
$$;

-- Couleurs d'une proposition : 2 = bien placée, 1 = présente ailleurs, 0 = absente (règles
-- officielles pour les lettres en double). Identique à src/games/wordle/logic.ts.
create function public.wordle_pattern(guess text, answer text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  res int[] := array[0,0,0,0,0];
  rest text[] := '{}';
  i int; j int;
begin
  for i in 1..5 loop
    if substr(guess, i, 1) = substr(answer, i, 1) then res[i] := 2;
    else rest := rest || substr(answer, i, 1);
    end if;
  end loop;
  for i in 1..5 loop
    if res[i] = 0 then
      j := array_position(rest, substr(guess, i, 1));
      if j is not null then res[i] := 1; rest[j] := '-'; end if;
    end if;
  end loop;
  return array_to_string(res, '');
end $$;

-- État de la partie du jour : propositions, couleurs, et le mot une fois la partie finie.
create function public.wordle_today() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  d date := public.wordle_day();
  g public.wordle_games;
  answer text := public.wordle_answer(d);
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  select * into g from public.wordle_games where user_id = uid and day = d;
  return jsonb_build_object(
    'day', d,
    'guesses', coalesce(to_jsonb(g.guesses), '[]'::jsonb),
    'patterns', coalesce((select jsonb_agg(public.wordle_pattern(x, answer) order by o)
                            from unnest(g.guesses) with ordinality as t(x, o)), '[]'::jsonb),
    'solved', coalesce(g.solved, false),
    'finished', coalesce(g.finished, false),
    'answer', case when g.finished then answer end);
end $$;

create function public.wordle_guess(guess text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  d date := public.wordle_day();
  g public.wordle_games;
  answer text := public.wordle_answer(d);
  p text;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  guess := upper(guess);
  if guess is null or guess !~ '^[A-Z]{5}$' or not exists (select 1 from public.wordle_words where word = guess) then
    raise exception 'mot inconnu' using errcode = '22023';
  end if;
  insert into public.wordle_games (user_id, day) values (uid, d) on conflict do nothing;
  select * into g from public.wordle_games where user_id = uid and day = d for update;
  if g.finished then raise exception 'partie du jour déjà terminée' using errcode = 'P0001'; end if;
  p := public.wordle_pattern(guess, answer);
  g.guesses := g.guesses || guess;
  g.solved := p = '22222';
  g.finished := g.solved or array_length(g.guesses, 1) >= 6;
  update public.wordle_games set guesses = g.guesses, solved = g.solved, finished = g.finished, updated_at = now()
   where user_id = uid and day = d;
  return jsonb_build_object('pattern', p, 'solved', g.solved, 'finished', g.finished,
    'answer', case when g.finished then answer end);
end $$;

-- Classement : uniquement des totaux. La vue s'exécute avec les droits de son propriétaire,
-- seul à pouvoir lire toutes les parties ; aucune proposition n'est exposée.
create view public.leaderboard_wordle as
select p.id as user_id, p.username,
       count(*) filter (where w.solved) as solved,
       count(*) as games,
       round(avg(array_length(w.guesses, 1)) filter (where w.solved), 2) as average
  from public.wordle_games w
  join public.profiles p on p.id = w.user_id
 where w.finished and p.verified
 group by p.id, p.username;
grant select on public.leaderboard_wordle to anon, authenticated;

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
  public.match_challenge(uuid, text, text), public.match_respond(uuid, boolean), public.match_play(uuid, int),
  public.match_forfeit(uuid), public.match_claim_timeout(uuid), public.match_rematch(uuid)
  to authenticated;
grant select on public.leaderboard_flappy to anon, authenticated;
