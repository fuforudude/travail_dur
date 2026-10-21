-- Jeux à 4 joueurs (échecs à 4, corridor à 4) en ligne.
--
-- Une partie se lance depuis un salon avec 2 à 4 joueurs ; les places vides sont tenues par
-- l'ordinateur. La fonction serveur `board4` (supabase/functions/board4) crée la partie, valide chaque
-- coup avec le même moteur que le site (src/games/four/engine), fait jouer les ordinateurs, et un
-- joueur absent plus d'une minute est remplacé par l'ordinateur. Les joueurs ne font que lire la table.
-- À exécuter une fois (appliquée automatiquement par le workflow Supabase).

set client_encoding = 'UTF8';

create table public.matches4 (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game in ('chess4', 'quoridor4')),
  room text not null check (room ~ '^[A-Z]{4}$'),
  players uuid[] not null check (cardinality(players) = 4), -- null : place tenue par l'ordinateur
  names text[] not null check (cardinality(names) = 4),
  board jsonb not null,
  turn int check (turn between 0 and 3), -- null : partie terminée
  status text not null default 'playing' check (status in ('playing', 'won', 'draw')),
  winner int check (winner between 0 and 3),
  plies int not null default 0,
  last_move text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index matches4_room on public.matches4 (room, created_at desc);
create index matches4_creator on public.matches4 (created_by, created_at desc);

alter table public.matches4 enable row level security;
create policy "ses parties à 4" on public.matches4 for select to authenticated using ((select auth.uid()) = any (players));
revoke all on public.matches4 from anon, authenticated;
grant select on public.matches4 to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.matches4;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Points
-- ---------------------------------------------------------------------------

create or replace function public.points_duel_value(game text) returns int
language sql immutable set search_path = '' as $$
  select case game when 'tictactoe' then 15 when 'connect4' then 30 when 'quarto' then 40
                   when 'quoridor' then 60 when 'checkers' then 90 when 'chess' then 100
                   when 'quoridor4' then 80 when 'chess4' then 120 else 0 end
$$;

create or replace function public.points_game_name(game text) returns text
language sql immutable set search_path = '' as $$
  select case game when 'tictactoe' then 'Morpion' when 'connect4' then 'Puissance 4' when 'quarto' then 'Quarto'
                   when 'quoridor' then 'Quoridor' when 'checkers' then 'Dames' when 'chess' then 'Échecs'
                   when 'quoridor4' then 'Corridor à 4' when 'chess4' then 'Échecs à 4' else game end
$$;

-- Fin d'une partie à 4 : le gagnant (humain) reçoit la valeur du jeu, chaque humain la prime de
-- partie jouée. Partie trop courte (moins de 20 coups) : rien.
create function public.points_on_match4() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p uuid;
begin
  if old.status <> 'playing' or new.status = 'playing' or new.plies < 20 then return new; end if;
  if new.status = 'won' and new.players[new.winner + 1] is not null then
    perform public.points_add(new.players[new.winner + 1], public.points_duel_value(new.game), public.points_game_name(new.game) || ' : victoire');
  end if;
  foreach p in array new.players loop
    if p is not null then perform public.points_played(p, public.points_game_name(new.game)); end if;
  end loop;
  return new;
end $$;
create trigger points_match4 after update on public.matches4 for each row execute function public.points_on_match4();

-- Les jeux à 4 en solo rapportent comme les autres jeux solo (même code qu'en 0034, liste élargie).
create or replace function public.points_solo(game text, won boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  last timestamptz;
  n int;
  amount int;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if game not in ('tictactoe', 'connect4', 'quarto', 'quoridor', 'checkers', 'chess', 'quoridor4', 'chess4') then
    raise exception 'jeu inconnu' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('points_solo:' || uid::text));
  select max(created_at), count(*) filter (where created_at > now() - interval '1 day') into last, n
    from public.point_events where user_id = uid and reason like 'Solo : %';
  if (last is not null and last > now() - interval '20 seconds') or n >= 30 then
    return jsonb_build_object('amount', 0);
  end if;
  amount := case when won then 10 + public.points_duel_value(game) / 10 else 4 end;
  perform public.points_add(uid, amount, 'Solo : ' || public.points_game_name(game) || case when won then ' gagné' else ' joué' end);
  return jsonb_build_object('amount', amount * public.points_gain_mult());
end $$;

revoke execute on function public.points_on_match4() from public, anon, authenticated;
