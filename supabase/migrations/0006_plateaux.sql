-- Échecs, Dames, Quoridor et Quarto en ligne, arbitrés par le serveur.
--
-- Même principe que Puissance 4 et le Morpion : la ligne de public.matches fait foi, et seul le
-- serveur la modifie. Ces jeux envoient leurs coups en texte (public.match_move) ; l'état complet
-- est dans `board`, les coups joués dans `history`.
-- Chaque jeu doit rester identique à son jumeau TypeScript (src/games/<jeu>/logic.ts).
-- À exécuter une fois, après 0005_chat.sql.

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- Table des parties
-- ---------------------------------------------------------------------------

do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.matches'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%game%'
  loop
    execute format('alter table public.matches drop constraint %I', c);
  end loop;
end $$;
alter table public.matches add constraint matches_game_check
  check (game in ('connect4', 'tictactoe', 'chess', 'checkers', 'quoridor', 'quarto'));
alter table public.matches add column history text[] not null default '{}';

-- ===========================================================================
-- Échecs (src/games/chess/logic.ts)
--   b[1..64] cases (ligne 0 = 8e rangée), b[65] droits de roque, b[66] case en passant ou -1,
--   b[67] demi-coups pour la règle des 50 coups. Camp 1 = blancs. Coups UCI : e2e4, e7e8q.
-- ===========================================================================

create function public.chess_color(p int) returns int
language sql immutable parallel safe set search_path = '' as $$
  select case when p = 0 then 0 when p <= 6 then 1 else 2 end
$$;

create function public.chess_type(p int) returns int
language sql immutable parallel safe set search_path = '' as $$
  select case when p = 0 then 0 else (p - 1) % 6 + 1 end
$$;

create function public.chess_square(i int) returns text
language sql immutable parallel safe set search_path = '' as $$
  select substr('abcdefgh', i % 8 + 1, 1) || (8 - i / 8)::text
$$;

create function public.chess_parse(s text) returns int
language sql immutable parallel safe set search_path = '' as $$
  select (8 - substr(s, 2, 1)::int) * 8 + strpos('abcdefgh', substr(s, 1, 1)) - 1
$$;

create function public.chess_initial() returns smallint[]
language plpgsql immutable set search_path = '' as $$
declare
  b smallint[] := array_fill(0::smallint, array[67]);
  back int[] := array[4, 2, 3, 5, 6, 3, 2, 4];
  c int;
begin
  for c in 0..7 loop
    b[c + 1] := back[c + 1] + 6;
    b[8 + c + 1] := 7;
    b[48 + c + 1] := 1;
    b[56 + c + 1] := back[c + 1];
  end loop;
  b[65] := 15;
  b[66] := -1;
  return b;
end $$;

-- La case `sq` est-elle attaquée par le camp `by` ?
create function public.chess_attacked(b smallint[], sq int, by_side int) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  r int := sq / 8;
  c int := sq % 8;
  off int := case when by_side = 2 then 6 else 0 end;
  knight int[] := array[-2,-1, -2,1, -1,-2, -1,2, 1,-2, 1,2, 2,-1, 2,1];
  kingd int[] := array[-1,-1, -1,0, -1,1, 0,-1, 0,1, 1,-1, 1,0, 1,1];
  dirs int[] := array[-1,-1, -1,1, 1,-1, 1,1, -1,0, 1,0, 0,-1, 0,1];
  pr int; rr int; cc int; dr int; dc int; k int; p int;
begin
  pr := case when by_side = 1 then r + 1 else r - 1 end;
  if pr between 0 and 7 then
    if c >= 1 and b[pr * 8 + c] = 1 + off then return true; end if;
    if c <= 6 and b[pr * 8 + c + 2] = 1 + off then return true; end if;
  end if;
  for k in 0..7 loop
    rr := r + knight[2 * k + 1]; cc := c + knight[2 * k + 2];
    if rr between 0 and 7 and cc between 0 and 7 and b[rr * 8 + cc + 1] = 2 + off then return true; end if;
    rr := r + kingd[2 * k + 1]; cc := c + kingd[2 * k + 2];
    if rr between 0 and 7 and cc between 0 and 7 and b[rr * 8 + cc + 1] = 6 + off then return true; end if;
  end loop;
  for k in 0..7 loop
    dr := dirs[2 * k + 1]; dc := dirs[2 * k + 2];
    rr := r + dr; cc := c + dc;
    while rr between 0 and 7 and cc between 0 and 7 and b[rr * 8 + cc + 1] = 0 loop
      rr := rr + dr; cc := cc + dc;
    end loop;
    if rr between 0 and 7 and cc between 0 and 7 then
      p := b[rr * 8 + cc + 1];
      if p = 5 + off or p = (case when k < 4 then 3 else 4 end) + off then return true; end if;
    end if;
  end loop;
  return false;
end $$;

create function public.chess_in_check(b smallint[], side int) returns boolean
language sql immutable set search_path = '' as $$
  select public.chess_attacked(b, array_position(b, (6 + case when side = 2 then 6 else 0 end)::smallint) - 1, 3 - side)
$$;

-- Joue un coup supposé légal.
create function public.chess_apply(b smallint[], side int, mv text) returns smallint[]
language plpgsql immutable set search_path = '' as $$
declare
  n smallint[] := b;
  f int := public.chess_parse(substr(mv, 1, 2));
  t int := public.chess_parse(substr(mv, 3, 2));
  p int := b[f + 1];
  kind int := public.chess_type(b[f + 1]);
  captured int := b[t + 1];
  rights int := b[65];
  rook_from int; rook_to int;
begin
  n[f + 1] := 0;
  n[t + 1] := case when length(mv) > 4
    then strpos(' pnbrqk', substr(mv, 5, 1)) - 1 + case when side = 2 then 6 else 0 end
    else p end;
  if kind = 1 and t = b[66] and captured = 0 then
    n[t + (case when side = 1 then 8 else -8 end) + 1] := 0;
  end if;
  if kind = 6 and abs(t - f) = 2 then
    rook_from := case when t > f then f + 3 else f - 4 end;
    rook_to := case when t > f then f + 1 else f - 1 end;
    n[rook_to + 1] := n[rook_from + 1];
    n[rook_from + 1] := 0;
  end if;
  if kind = 6 then rights := rights & case when side = 1 then ~3 else ~12 end; end if;
  if f = 63 or t = 63 then rights := rights & ~1; end if;
  if f = 56 or t = 56 then rights := rights & ~2; end if;
  if f = 7 or t = 7 then rights := rights & ~4; end if;
  if f = 0 or t = 0 then rights := rights & ~8; end if;
  n[65] := rights;
  n[66] := case when kind = 1 and abs(t - f) = 16 then (f + t) / 2 else -1 end;
  n[67] := case when kind = 1 or captured <> 0 then 0 else b[67] + 1 end;
  return n;
end $$;

-- Tous les coups légaux du camp `side`.
create function public.chess_moves(b smallint[], side int) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  cand text[] := '{}';
  legal text[] := '{}';
  enemy int := 3 - side;
  knight int[] := array[-2,-1, -2,1, -1,-2, -1,2, 1,-2, 1,2, 2,-1, 2,1];
  kingd int[] := array[-1,-1, -1,0, -1,1, 0,-1, 0,1, 1,-1, 1,0, 1,1];
  dirs int[] := array[-1,-1, -1,1, 1,-1, 1,1, -1,0, 1,0, 0,-1, 0,1];
  sq int; p int; kind int; r int; c int; rr int; cc int; dr int; dc int; k int; d int;
  dir int; one int; two int; tgt int; q int; home int; rights int; lo int; hi int;
  x text; mv text;
begin
  for sq in 0..63 loop
    p := b[sq + 1];
    continue when public.chess_color(p) <> side;
    r := sq / 8; c := sq % 8;
    kind := public.chess_type(p);
    if kind = 1 then
      dir := case when side = 1 then -1 else 1 end;
      one := sq + dir * 8;
      if b[one + 1] = 0 then
        if one / 8 = (case when side = 1 then 0 else 7 end) then
          foreach x in array array['q', 'r', 'b', 'n'] loop
            cand := cand || (public.chess_square(sq) || public.chess_square(one) || x);
          end loop;
        else
          cand := cand || (public.chess_square(sq) || public.chess_square(one));
        end if;
        two := one + dir * 8;
        if r = (case when side = 1 then 6 else 1 end) and b[two + 1] = 0 then
          cand := cand || (public.chess_square(sq) || public.chess_square(two));
        end if;
      end if;
      for d in 0..1 loop
        cc := c + case when d = 0 then -1 else 1 end;
        continue when cc < 0 or cc > 7;
        tgt := one + cc - c;
        if public.chess_color(b[tgt + 1]) = enemy or tgt = b[66] then
          if tgt / 8 = (case when side = 1 then 0 else 7 end) then
            foreach x in array array['q', 'r', 'b', 'n'] loop
              cand := cand || (public.chess_square(sq) || public.chess_square(tgt) || x);
            end loop;
          else
            cand := cand || (public.chess_square(sq) || public.chess_square(tgt));
          end if;
        end if;
      end loop;
    elsif kind = 2 or kind = 6 then
      for k in 0..7 loop
        if kind = 2 then rr := r + knight[2 * k + 1]; cc := c + knight[2 * k + 2];
        else rr := r + kingd[2 * k + 1]; cc := c + kingd[2 * k + 2];
        end if;
        continue when rr < 0 or rr > 7 or cc < 0 or cc > 7;
        if public.chess_color(b[rr * 8 + cc + 1]) <> side then
          cand := cand || (public.chess_square(sq) || public.chess_square(rr * 8 + cc));
        end if;
      end loop;
      if kind = 6 then
        home := case when side = 1 then 60 else 4 end;
        rights := b[65] >> (case when side = 1 then 0 else 2 end);
        if sq = home and not public.chess_attacked(b, home, enemy) then
          if rights & 1 <> 0 and b[home + 2] = 0 and b[home + 3] = 0
             and not public.chess_attacked(b, home + 1, enemy) and not public.chess_attacked(b, home + 2, enemy) then
            cand := cand || (public.chess_square(sq) || public.chess_square(home + 2));
          end if;
          if rights & 2 <> 0 and b[home] = 0 and b[home - 1] = 0 and b[home - 2] = 0
             and not public.chess_attacked(b, home - 1, enemy) and not public.chess_attacked(b, home - 2, enemy) then
            cand := cand || (public.chess_square(sq) || public.chess_square(home - 2));
          end if;
        end if;
      end if;
    else
      lo := case when kind = 4 then 4 else 0 end;
      hi := case when kind = 3 then 3 else 7 end;
      for k in lo..hi loop
        dr := dirs[2 * k + 1]; dc := dirs[2 * k + 2];
        rr := r + dr; cc := c + dc;
        while rr between 0 and 7 and cc between 0 and 7 loop
          q := b[rr * 8 + cc + 1];
          exit when public.chess_color(q) = side;
          cand := cand || (public.chess_square(sq) || public.chess_square(rr * 8 + cc));
          exit when q <> 0;
          rr := rr + dr; cc := cc + dc;
        end loop;
      end loop;
    end if;
  end loop;
  foreach mv in array cand loop
    if not public.chess_in_check(public.chess_apply(b, side, mv), side) then legal := legal || mv; end if;
  end loop;
  return legal;
end $$;

-- Après un coup : -1 partie en cours, 0 nulle, 1 ou 2 vainqueur. `next` doit jouer.
create function public.chess_outcome(b smallint[], next int, history text[]) returns int
language plpgsql immutable set search_path = '' as $$
declare
  minors int := 0;
  i int; kind int; seen int := 0;
  x smallint[]; side int := 1; mv text;
  key text := array_to_string(b[1:66], ',') || ':' || next;
begin
  if cardinality(public.chess_moves(b, next)) = 0 then
    return case when public.chess_in_check(b, next) then 3 - next else 0 end;
  end if;
  if b[67] >= 100 then return 0; end if;
  -- Matériel insuffisant : rois seuls, ou un seul fou ou cavalier en plus.
  for i in 1..64 loop
    kind := public.chess_type(b[i]);
    if kind in (1, 4, 5) then minors := 99; exit; end if;
    if kind in (2, 3) then minors := minors + 1; end if;
  end loop;
  if minors <= 1 then return 0; end if;
  -- Triple répétition : on rejoue la partie depuis le début.
  x := public.chess_initial();
  if array_to_string(x[1:66], ',') || ':' || side = key then seen := seen + 1; end if;
  foreach mv in array history loop
    x := public.chess_apply(x, side, mv);
    side := 3 - side;
    if array_to_string(x[1:66], ',') || ':' || side = key then seen := seen + 1; end if;
  end loop;
  return case when seen >= 3 then 0 else -1 end;
end $$;

-- ===========================================================================
-- Dames internationales (src/games/checkers/logic.ts)
--   b[1..50] cases foncées (0 vide, 1 pion blanc, 2 dame blanche, 3 pion noir, 4 dame noire),
--   b[51] demi-coups de dames sans prise. Camp 1 = blancs, en bas. Coups : 31-27, 27x18x9.
-- ===========================================================================

create function public.dames_row(i int) returns int
language sql immutable parallel safe set search_path = '' as $$ select i / 5 $$;

create function public.dames_col(i int) returns int
language sql immutable parallel safe set search_path = '' as $$
  select 2 * (i % 5) + case when (i / 5) % 2 = 0 then 1 else 0 end
$$;

create function public.dames_index(r int, c int) returns int
language sql immutable parallel safe set search_path = '' as $$
  select case when r < 0 or r > 9 or c < 0 or c > 9 then -1 when (r + c) % 2 = 0 then -1 else r * 5 + c / 2 end
$$;

create function public.dames_side(p int) returns int
language sql immutable parallel safe set search_path = '' as $$
  select case when p is null or p = 0 then 0 when p <= 2 then 1 else 2 end
$$;

create function public.dames_initial() returns smallint[]
language sql immutable set search_path = '' as $$
  select array_fill(3::smallint, array[20]) || array_fill(0::smallint, array[10]) || array_fill(1::smallint, array[20]) || array[0::smallint]
$$;

-- Rafles depuis `from_sq` ; `b` est le plateau sans la pièce qui joue, `taken` les pièces déjà sautées.
create function public.dames_captures(b smallint[], side int, king boolean, from_sq int, taken int[], path text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  found text[] := '{}';
  extended boolean := false;
  dirs int[] := array[-1,-1, -1,1, 1,-1, 1,1];
  r0 int := public.dames_row(from_sq);
  c0 int := public.dames_col(from_sq);
  k int; dr int; dc int; r int; c int; over int; land int;
begin
  for k in 0..3 loop
    dr := dirs[2 * k + 1]; dc := dirs[2 * k + 2];
    r := r0 + dr; c := c0 + dc;
    if king then
      while public.dames_index(r, c) >= 0 and b[public.dames_index(r, c) + 1] = 0 loop
        r := r + dr; c := c + dc;
      end loop;
    end if;
    over := public.dames_index(r, c);
    continue when over < 0;
    continue when public.dames_side(b[over + 1]) <> 3 - side or over = any(taken);
    r := r + dr; c := c + dc;
    while public.dames_index(r, c) >= 0 and b[public.dames_index(r, c) + 1] = 0 loop
      land := public.dames_index(r, c);
      extended := true;
      found := found || public.dames_captures(b, side, king, land, taken || over, path || 'x' || land);
      exit when not king;
      r := r + dr; c := c + dc;
    end loop;
  end loop;
  if not extended and cardinality(taken) > 0 then found := found || path; end if;
  return found;
end $$;

create function public.dames_moves(b smallint[], side int) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  caps text[] := '{}';
  quiet text[] := '{}';
  dirs int[] := array[-1,-1, -1,1, 1,-1, 1,1];
  lifted smallint[];
  i int; p int; k int; dr int; dc int; r int; c int; best int;
  king boolean;
begin
  for i in 0..49 loop
    p := b[i + 1];
    continue when public.dames_side(p) <> side;
    king := p in (2, 4);
    lifted := b;
    lifted[i + 1] := 0;
    caps := caps || public.dames_captures(lifted, side, king, i, '{}', i::text);
    for k in 0..3 loop
      dr := dirs[2 * k + 1]; dc := dirs[2 * k + 2];
      continue when not king and dr <> (case when side = 1 then -1 else 1 end);
      r := public.dames_row(i) + dr; c := public.dames_col(i) + dc;
      while public.dames_index(r, c) >= 0 and b[public.dames_index(r, c) + 1] = 0 loop
        quiet := quiet || (i || '-' || public.dames_index(r, c));
        exit when not king;
        r := r + dr; c := c + dc;
      end loop;
    end loop;
  end loop;
  if cardinality(caps) = 0 then return quiet; end if;
  -- Prise obligatoire, et du plus grand nombre de pièces (= nombre de « x » dans le coup).
  select max(length(x) - length(replace(x, 'x', ''))) into best from unnest(caps) x;
  return array(select distinct x from unnest(caps) x where length(x) - length(replace(x, 'x', '')) = best);
end $$;

create function public.dames_apply(b smallint[], side int, mv text) returns smallint[]
language plpgsql immutable set search_path = '' as $$
declare
  n smallint[] := b;
  capture boolean := strpos(mv, 'x') > 0;
  sq int[] := string_to_array(mv, case when strpos(mv, 'x') > 0 then 'x' else '-' end)::int[];
  f int; t int; p int; k int; a int; z int; dr int; dc int; r int; c int; i int;
begin
  f := sq[1];
  t := sq[cardinality(sq)];
  p := n[f + 1];
  if capture then
    for k in 1..cardinality(sq) - 1 loop
      a := sq[k]; z := sq[k + 1];
      dr := sign(public.dames_row(z) - public.dames_row(a));
      dc := sign(public.dames_col(z) - public.dames_col(a));
      r := public.dames_row(a) + dr; c := public.dames_col(a) + dc;
      while r <> public.dames_row(z) loop
        i := public.dames_index(r, c);
        if i <> f and n[i + 1] <> 0 then n[i + 1] := 0; end if;
        r := r + dr; c := c + dc;
      end loop;
    end loop;
  end if;
  n[f + 1] := 0;
  n[t + 1] := case when p in (1, 3) and public.dames_row(t) = (case when side = 1 then 0 else 9 end) then p + 1 else p end;
  n[51] := case when p in (2, 4) and not capture then b[51] + 1 else 0 end;
  return n;
end $$;

create function public.dames_outcome(b smallint[], next int) returns int
language sql immutable set search_path = '' as $$
  select case
    when cardinality(public.dames_moves(b, next)) = 0 then 3 - next
    when b[51] >= 50 then 0
    else -1
  end
$$;

-- ===========================================================================
-- Quoridor (src/games/quoridor/logic.ts)
--   b[1], b[2] case des pions, b[3], b[4] murs restants, b[5..68] intersections 8×8
--   (0 libre, 1 mur horizontal, 2 vertical). Camp 1 part d'en bas. Coups : m40, h34, v34.
-- ===========================================================================

create function public.quoridor_initial() returns smallint[]
language sql immutable set search_path = '' as $$
  select array[76, 4, 10, 10]::smallint[] || array_fill(0::smallint, array[64])
$$;

create function public.quoridor_wall(b smallint[], r int, c int) returns int
language sql immutable parallel safe set search_path = '' as $$
  select case when r < 0 or r > 7 or c < 0 or c > 7 then 0 else b[4 + r * 8 + c + 1] end
$$;

create function public.quoridor_blocked(b smallint[], r int, c int, dr int, dc int) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select case
    when dr = 1 then public.quoridor_wall(b, r, c) = 1 or public.quoridor_wall(b, r, c - 1) = 1
    when dr = -1 then public.quoridor_wall(b, r - 1, c) = 1 or public.quoridor_wall(b, r - 1, c - 1) = 1
    when dc = 1 then public.quoridor_wall(b, r, c) = 2 or public.quoridor_wall(b, r - 1, c) = 2
    else public.quoridor_wall(b, r, c - 1) = 2 or public.quoridor_wall(b, r - 1, c - 1) = 2
  end
$$;

-- Longueur du plus court chemin vers le but (en ignorant les pions), ou -1.
create function public.quoridor_distance(b smallint[], side int) returns int
language plpgsql immutable set search_path = '' as $$
declare
  goal int := case when side = 1 then 0 else 8 end;
  dist int[] := array_fill(-1, array[81]);
  queue int[] := array[b[side]::int];
  steps int[] := array[-1,0, 1,0, 0,-1, 0,1];
  head int := 1;
  cell int; r int; c int; nr int; nc int; k int;
begin
  dist[b[side] + 1] := 0;
  while head <= cardinality(queue) loop
    cell := queue[head];
    head := head + 1;
    r := cell / 9; c := cell % 9;
    if r = goal then return dist[cell + 1]; end if;
    for k in 0..3 loop
      nr := r + steps[2 * k + 1]; nc := c + steps[2 * k + 2];
      continue when nr < 0 or nr > 8 or nc < 0 or nc > 8;
      continue when public.quoridor_blocked(b, r, c, steps[2 * k + 1], steps[2 * k + 2]);
      continue when dist[nr * 9 + nc + 1] >= 0;
      dist[nr * 9 + nc + 1] := dist[cell + 1] + 1;
      queue := queue || (nr * 9 + nc);
    end loop;
  end loop;
  return -1;
end $$;

-- Déplacements du pion, sauts par-dessus l'adversaire compris.
create function public.quoridor_pawn_moves(b smallint[], side int) returns int[]
language plpgsql immutable set search_path = '' as $$
declare
  me int := b[side];
  opp int := b[3 - side];
  r int := b[side] / 9;
  c int := b[side] % 9;
  steps int[] := array[-1,0, 1,0, 0,-1, 0,1];
  res int[] := '{}';
  k int; j int; dr int; dc int; nr int; nc int; sr int; sc int;
begin
  for k in 0..3 loop
    dr := steps[2 * k + 1]; dc := steps[2 * k + 2];
    nr := r + dr; nc := c + dc;
    continue when nr < 0 or nr > 8 or nc < 0 or nc > 8;
    continue when public.quoridor_blocked(b, r, c, dr, dc);
    if nr * 9 + nc <> opp then
      res := res || (nr * 9 + nc);
      continue;
    end if;
    if nr + dr between 0 and 8 and nc + dc between 0 and 8 and not public.quoridor_blocked(b, nr, nc, dr, dc) then
      res := res || ((nr + dr) * 9 + nc + dc);
      continue;
    end if;
    for j in 0..1 loop
      if dr = 0 then sr := case when j = 0 then -1 else 1 end; sc := 0;
      else sr := 0; sc := case when j = 0 then -1 else 1 end;
      end if;
      if nr + sr between 0 and 8 and nc + sc between 0 and 8 and not public.quoridor_blocked(b, nr, nc, sr, sc) then
        res := res || ((nr + sr) * 9 + nc + sc);
      end if;
    end loop;
  end loop;
  return res;
end $$;

create function public.quoridor_legal(b smallint[], side int, mv text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  m text[];
  r int; c int; o int;
  n smallint[];
begin
  m := regexp_match(mv, '^m([0-9]|[1-7][0-9]|80)$');
  if m is not null then return m[1]::int = any(public.quoridor_pawn_moves(b, side)); end if;
  m := regexp_match(mv, '^([hv])([0-7])([0-7])$');
  if m is null then return false; end if;
  r := m[2]::int; c := m[3]::int; o := case when m[1] = 'h' then 1 else 2 end;
  if b[2 + side] <= 0 or public.quoridor_wall(b, r, c) <> 0 then return false; end if;
  if o = 1 and (public.quoridor_wall(b, r, c - 1) = 1 or public.quoridor_wall(b, r, c + 1) = 1) then return false; end if;
  if o = 2 and (public.quoridor_wall(b, r - 1, c) = 2 or public.quoridor_wall(b, r + 1, c) = 2) then return false; end if;
  n := b;
  n[4 + r * 8 + c + 1] := o;
  return public.quoridor_distance(n, 1) >= 0 and public.quoridor_distance(n, 2) >= 0;
end $$;

create function public.quoridor_apply(b smallint[], side int, mv text) returns smallint[]
language plpgsql immutable set search_path = '' as $$
declare
  n smallint[] := b;
begin
  if substr(mv, 1, 1) = 'm' then
    n[side] := substr(mv, 2)::int;
  else
    n[4 + substr(mv, 2, 1)::int * 8 + substr(mv, 3, 1)::int + 1] := case when substr(mv, 1, 1) = 'h' then 1 else 2 end;
    n[2 + side] := b[2 + side] - 1;
  end if;
  return n;
end $$;

create function public.quoridor_outcome(b smallint[], next int, plies int) returns int
language sql immutable set search_path = '' as $$
  select case
    when b[1] / 9 = 0 then 1
    when b[2] / 9 = 8 then 2
    when plies >= 400 then 0
    when cardinality(public.quoridor_pawn_moves(b, next)) = 0 and b[2 + next] = 0 then 0
    else -1
  end
$$;

-- ===========================================================================
-- Quarto (src/games/quarto/logic.ts)
--   b[1..16] plateau 4×4 (0 vide, sinon pièce + 1), b[17] pièce à poser (+ 1), 0 au premier coup.
--   Coups : g5 (donner), p10g3 (poser puis donner), p10 (poser : gagne ou remplit le plateau).
-- ===========================================================================

-- Première ligne gagnante (cases 0..15), ou null.
create function public.quarto_line(b smallint[]) returns smallint[]
language plpgsql immutable set search_path = '' as $$
declare
  lines int[] := array[
    [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15],
    [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15],
    [0, 5, 10, 15], [3, 6, 9, 12]];
  l int[]; i int; all_bits int; none_bits int; complete boolean;
begin
  foreach l slice 1 in array lines loop
    all_bits := 15; none_bits := 15; complete := true;
    foreach i in array l loop
      if b[i + 1] = 0 then complete := false; exit; end if;
      all_bits := all_bits & (b[i + 1] - 1);
      none_bits := none_bits & (~(b[i + 1] - 1) & 15);
    end loop;
    if complete and (all_bits <> 0 or none_bits <> 0) then return l::smallint[]; end if;
  end loop;
  return null;
end $$;

create function public.quarto_moves(b smallint[]) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  free int[] := array(select g from generate_series(0, 15) g where not (g + 1)::smallint = any(b));
  res text[] := '{}';
  n smallint[];
  cell int; p int;
begin
  if b[17] = 0 then
    return array(select 'g' || f from unnest(free) f);
  end if;
  for cell in 0..15 loop
    continue when b[cell + 1] <> 0;
    n := b;
    n[cell + 1] := b[17];
    if public.quarto_line(n) is not null or cardinality(free) = 0 then
      res := res || ('p' || cell);
    else
      foreach p in array free loop res := res || ('p' || cell || 'g' || p); end loop;
    end if;
  end loop;
  return res;
end $$;

create function public.quarto_apply(b smallint[], mv text) returns smallint[]
language plpgsql immutable set search_path = '' as $$
declare
  n smallint[] := b;
  m text[] := regexp_match(mv, '^(?:p(\d+))?(?:g(\d+))?$');
begin
  if m[1] is not null then n[m[1]::int + 1] := b[17]; end if;
  n[17] := case when m[2] is not null then m[2]::int + 1 else 0 end;
  return n;
end $$;

create function public.quarto_outcome(b smallint[], next int) returns int
language sql immutable set search_path = '' as $$
  select case
    when public.quarto_line(b) is not null then 3 - next
    when not 0::smallint = any(b[1:16]) then 0
    else -1
  end
$$;

-- ===========================================================================
-- Fonctions communes des parties à deux
-- ===========================================================================

-- Position de départ de chaque jeu.
create or replace function public.match_empty_board(game_id text) returns smallint[]
language sql immutable set search_path = '' as $$
  select case game_id
    when 'connect4' then array_fill(0::smallint, array[42])
    when 'tictactoe' then array_fill(0::smallint, array[9])
    when 'chess' then public.chess_initial()
    when 'checkers' then public.dames_initial()
    when 'quoridor' then public.quoridor_initial()
    when 'quarto' then array_fill(0::smallint, array[17])
  end
$$;

create or replace function public.match_challenge(opponent uuid, room_code text, game_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  mid uuid;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if game_id is null or game_id not in ('connect4', 'tictactoe', 'chess', 'checkers', 'quoridor', 'quarto') then
    raise exception 'jeu inconnu' using errcode = '22023';
  end if;
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

-- Puissance 4 et Morpion uniquement (les autres jeux passent par match_move).
create or replace function public.match_play(match_id uuid, cell int) returns void
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
  elsif m.game = 'tictactoe' then
    if cell is null or cell not between 0 and 8 then raise exception 'case invalide' using errcode = '22023'; end if;
    if m.board[cell + 1] <> 0 then raise exception 'case déjà prise' using errcode = 'P0001'; end if;
    placed := cell;
    m.board[placed + 1] := m.turn;
    win := public.ttt_line(m.board);
    size := 9;
  else
    raise exception 'ce jeu se joue avec match_move' using errcode = '22023';
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

-- Un coup en texte (Échecs, Dames, Quoridor, Quarto).
create function public.match_move(match_id uuid, mv text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  side int;
  legal boolean;
  nb smallint[];
  hist text[];
  res int;
begin
  select * into m from public.matches where id = match_id for update;
  if not found then raise exception 'partie inconnue' using errcode = 'P0002'; end if;
  if m.status = 'pending' then raise exception 'le défi n''a pas encore été accepté' using errcode = 'P0001'; end if;
  if m.status <> 'playing' then raise exception 'partie terminée' using errcode = 'P0001'; end if;
  if uid is distinct from (case when m.turn = 1 then m.p1 else m.p2 end) then
    raise exception 'ce n''est pas ton tour' using errcode = 'P0001';
  end if;
  if mv is null or length(mv) > 40 then raise exception 'coup invalide' using errcode = '22023'; end if;
  side := m.turn;
  legal := case m.game
    when 'chess' then mv = any(public.chess_moves(m.board, side))
    when 'checkers' then mv = any(public.dames_moves(m.board, side))
    when 'quoridor' then public.quoridor_legal(m.board, side, mv)
    when 'quarto' then mv = any(public.quarto_moves(m.board))
  end;
  if legal is null then raise exception 'ce jeu se joue avec match_play' using errcode = '22023'; end if;
  if not legal then raise exception 'coup interdit' using errcode = 'P0001'; end if;
  nb := case m.game
    when 'chess' then public.chess_apply(m.board, side, mv)
    when 'checkers' then public.dames_apply(m.board, side, mv)
    when 'quoridor' then public.quoridor_apply(m.board, side, mv)
    else public.quarto_apply(m.board, mv)
  end;
  hist := m.history || mv;
  res := case m.game
    when 'chess' then public.chess_outcome(nb, 3 - side, hist)
    when 'checkers' then public.dames_outcome(nb, 3 - side)
    when 'quoridor' then public.quoridor_outcome(nb, 3 - side, cardinality(hist))
    else public.quarto_outcome(nb, 3 - side)
  end;
  update public.matches set
    board = nb,
    history = hist,
    last_cell = null,
    moves = m.moves + 1,
    status = case when res < 0 then 'playing' when res = 0 then 'draw' else 'won' end,
    winner = case when res > 0 then res end,
    line = case when res > 0 and m.game = 'quarto' then public.quarto_line(nb) end,
    turn = case when res >= 0 then side else 3 - side end,
    updated_at = now()
  where id = m.id;
end $$;

-- Victoire au temps : le délai dépend du jeu (on réfléchit plus longtemps aux échecs qu'au morpion).
create or replace function public.match_claim_timeout(match_id uuid) returns void
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
  if m.updated_at > now() - (case when m.game in ('connect4', 'tictactoe') then interval '45 seconds'
                                  when m.game = 'quarto' then interval '90 seconds'
                                  else interval '3 minutes' end) then
    raise exception 'ton adversaire a encore le temps' using errcode = 'P0001';
  end if;
  update public.matches
     set status = 'timeout', winner = case when uid = m.p1 then 1 else 2 end, updated_at = now()
   where id = m.id;
end $$;

-- ---------------------------------------------------------------------------
-- Classements (comptes vérifiés uniquement), comme Puissance 4 et le Morpion.
-- ---------------------------------------------------------------------------

create function public.leaderboard_duel(game_id text)
returns table (user_id uuid, username text, wins bigint, losses bigint, draws bigint)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.username,
         count(*) filter (where (m.winner = 1 and m.p1 = p.id) or (m.winner = 2 and m.p2 = p.id)),
         count(*) filter (where m.winner is not null and not ((m.winner = 1 and m.p1 = p.id) or (m.winner = 2 and m.p2 = p.id))),
         count(*) filter (where m.status = 'draw')
    from public.profiles p
    join public.matches m on p.id in (m.p1, m.p2)
   where m.game = game_id and m.status in ('won', 'draw', 'forfeit', 'timeout') and p.verified
   group by p.id, p.username
$$;

create view public.leaderboard_chess with (security_invoker = true) as select * from public.leaderboard_duel('chess');
create view public.leaderboard_checkers with (security_invoker = true) as select * from public.leaderboard_duel('checkers');
create view public.leaderboard_quoridor with (security_invoker = true) as select * from public.leaderboard_duel('quoridor');
create view public.leaderboard_quarto with (security_invoker = true) as select * from public.leaderboard_duel('quarto');
grant select on public.leaderboard_chess, public.leaderboard_checkers, public.leaderboard_quoridor, public.leaderboard_quarto
  to anon, authenticated;

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
  public.match_forfeit(uuid), public.match_claim_timeout(uuid), public.match_rematch(uuid)
  to authenticated;
-- Les vues de classement appellent cette fonction avec les droits de qui les lit.
grant execute on function public.leaderboard_duel(text) to anon, authenticated;
