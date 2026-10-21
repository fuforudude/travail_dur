-- Gains augmentés dans tous les jeux, et des points à chaque partie, même sans record.
--
-- * Tous les gains de jeu et de record sont multipliés par 3 (points_gain_mult), au même endroit :
--   points_add. Le casino, la boutique, les caisses et les revenus de l'appart ne changent pas.
-- * « Partie jouée » : chaque partie terminée rapporte 10 × 3 = 30 points (2048 et Tetris d'au moins
--   30 s, Flappy d'au moins 10 s, Wordle, tower defense d'au moins une vague, match à deux assez
--   long), dans la limite de 40 par jour.
-- * Parties solo contre l'ordinateur (Morpion, Puissance 4, Échecs, Dames, Quoridor, Quarto) : jouées
--   dans le navigateur, elles rapportent via points_solo, limité à une partie toutes les 20 s et à
--   30 par jour (le résultat n'est pas vérifié par le serveur).
-- À exécuter une fois, après 0007_points_casino.sql (indépendante des migrations de l'appart).

set client_encoding = 'UTF8';

create or replace function public.points_gain_mult() returns int
language sql immutable set search_path = '' as $$ select 3 $$;

create or replace function public.points_add(uid uuid, amount bigint, reason text, kind text default 'game') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if uid is null or amount is null or amount <= 0 then return; end if;
  if kind in ('game', 'record') then amount := amount * public.points_gain_mult(); end if;
  perform public.points_open(uid);
  update public.wallets
     set balance = balance + amount,
         earned = earned + case when kind = 'casino' then 0 else amount end,
         updated_at = now()
   where user_id = uid;
  insert into public.point_events (user_id, amount, reason, kind) values (uid, amount, reason, kind);
end $$;

-- ---------------------------------------------------------------------------
-- Partie jouée
-- ---------------------------------------------------------------------------

create function public.points_played(uid uuid, label text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  if uid is null then return; end if;
  select count(*) into n from public.point_events
   where user_id = uid and reason like 'Partie jouée%' and created_at > now() - interval '1 day';
  if n >= 40 then return; end if;
  perform public.points_add(uid, 10, 'Partie jouée : ' || label);
end $$;

create function public.played_on_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  label text := tg_argv[0];
  min_secs int := tg_argv[1]::int;
begin
  if old.finished_at is not null or new.finished_at is null then return new; end if;
  if new.finished_at - new.started_at < make_interval(secs => min_secs) then return new; end if;
  perform public.points_played(new.user_id, label);
  return new;
end $$;
create trigger played_2048 after update on public.g2048_sessions for each row execute function public.played_on_session('2048', '30');
create trigger played_tetris after update on public.tetris_sessions for each row execute function public.played_on_session('Tetris', '30');
create trigger played_flappy after update on public.flappy_sessions for each row execute function public.played_on_session('Flappy', '10');

create function public.played_on_wordle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.finished or not new.finished then return new; end if;
  perform public.points_played(new.user_id, 'Wordle');
  return new;
end $$;
create trigger played_wordle after update on public.wordle_games for each row execute function public.played_on_wordle();

create function public.played_on_td() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.over or not new.over or new.wave < 1 then return new; end if;
  perform public.points_played(new.user_id, 'Tower defense');
  return new;
end $$;
create trigger played_td after update on public.td_sessions for each row execute function public.played_on_td();

create function public.played_on_match() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'playing' or new.status not in ('won', 'draw', 'forfeit', 'timeout') then return new; end if;
  if new.moves < public.points_duel_min_moves(new.game) then return new; end if;
  perform public.points_played(new.p1, public.points_game_name(new.game));
  perform public.points_played(new.p2, public.points_game_name(new.game));
  return new;
end $$;
create trigger played_match after update on public.matches for each row execute function public.played_on_match();

-- ---------------------------------------------------------------------------
-- Parties solo contre l'ordinateur
-- ---------------------------------------------------------------------------

-- Gagné : 10 + valeur du jeu à deux ÷ 10 ; perdu ou nul : 4 (avant le × 3).
create function public.points_solo(game text, won boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  last timestamptz;
  n int;
  amount int;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if game not in ('tictactoe', 'connect4', 'quarto', 'quoridor', 'checkers', 'chess') then
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

revoke execute on function public.points_played(uuid, text) from public, anon, authenticated;
revoke execute on function public.points_solo(text, boolean) from public, anon;
grant execute on function public.points_solo(text, boolean) to authenticated;
