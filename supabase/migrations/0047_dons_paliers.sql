-- Dons de points entre amis, records qui rapportent gros, paliers pour les scores de fou furieux.
--
-- * Dons (points_give) : seulement entre amis, jamais à soi-même ni à un compte suspendu, au plus
--   3 dons toutes les 10 secondes. Un don ne compte pas dans « gagné en jouant » de celui qui le reçoit.
-- * Records : 5 000 (record personnel) et 100 000 (record absolu), au lieu de 100 et 500, toujours
--   multipliés par points_gain_mult (× 3). Mêmes conditions qu'avant.
-- * Paliers (points_milestones) : un score énorme rapporte une prime, une seule fois par joueur et
--   par palier (aussi × 3). Seules les parties terminées après cette migration comptent.
-- À exécuter une fois, après 0046_suspension_revenus.sql.

set client_encoding = 'UTF8';

alter table public.point_events drop constraint point_events_kind_check;
alter table public.point_events add constraint point_events_kind_check
  check (kind in ('game', 'record', 'bonus', 'casino', 'shop', 'admin', 'crate', 'furniture', 'appart', 'gift'));

-- ---------------------------------------------------------------------------
-- Dons entre amis
-- ---------------------------------------------------------------------------

create function public.points_give(target uuid, amount bigint, message text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  me text;
  them text;
  note text := nullif(btrim(left(message, 80)), '');
  bal bigint;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if target = uid then raise exception 'impossible de s’envoyer des points à soi-même' using errcode = 'P0001'; end if;
  if amount is null or amount < 1 then raise exception 'montant invalide' using errcode = '22023'; end if;
  if not public.are_friends(uid, target) then raise exception 'on ne peut envoyer des points qu’à un ami' using errcode = 'P0001'; end if;
  if public.is_suspended(target) then raise exception 'ce joueur est suspendu' using errcode = 'P0001'; end if;
  if (select count(*) from public.point_events e where e.user_id = uid and e.kind = 'gift' and e.amount < 0 and e.created_at > now() - interval '10 seconds') >= 3 then
    raise exception 'trop de dons d’un coup, attends quelques secondes' using errcode = 'P0001';
  end if;
  select username into me from public.profiles where id = uid;
  select username into them from public.profiles where id = target;
  -- Les deux portefeuilles, verrouillés toujours dans le même ordre (deux dons croisés ne se bloquent pas).
  perform public.points_open(uid);
  perform public.points_open(target);
  perform 1 from public.wallets where user_id in (uid, target) order by user_id for update;
  bal := public.points_spend(uid, amount, 'Don à ' || them || coalesce(' : ' || note, ''), 'gift');
  update public.wallets set balance = balance + amount, updated_at = now() where user_id = target;
  insert into public.point_events (user_id, amount, reason, kind)
  values (target, amount, 'Don de ' || me || coalesce(' : ' || note, ''), 'gift');
  return bal;
end $$;

-- ---------------------------------------------------------------------------
-- Records
-- ---------------------------------------------------------------------------

create or replace function public.points_records(uid uuid, label text, score int, prev int, world int, minimum int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if world is not null and score > world then
    perform public.points_add(uid, 100000, 'Record absolu ' || label || ' !', 'record');
  elsif prev is not null and score > prev and score >= minimum then
    perform public.points_add(uid, 5000, 'Record personnel ' || label || ' !', 'record');
  end if;
end $$;

-- Comme 0042_td_defis.sql, avec les nouvelles primes de record et les paliers du mode infini.
create or replace function public.points_on_td() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev int; world int; first boolean; lvl int;
begin
  -- Campagne : des points seulement quand le niveau est réussi.
  if new.mode = 'campaign' then
    if new.won and not old.won then
      first := not exists (select 1 from public.td_sessions
                            where user_id = new.user_id and id <> new.id and rules = new.rules and mode = 'campaign'
                              and level = new.level and won and variant is not distinct from new.variant);
      lvl := least(new.level, 45);
      if new.variant is not null then
        perform public.points_add(new.user_id, case when first then 200 + 20 * lvl else 5 * lvl end,
          'Tower defense : défi ' || case new.variant when 'heroic' then 'Héroïque' else 'Fer' end || ', niveau ' || new.level
          || case when first then ' !' else ' (rejoué)' end);
      else
        perform public.points_add(new.user_id, case when first then 100 + 40 * lvl else 5 * lvl end,
          'Tower defense : niveau ' || new.level || case when first then ' terminé !' else ' rejoué' end);
      end if;
    end if;
    return new;
  end if;
  if new.wave <= old.wave then return new; end if;
  perform public.points_add(new.user_id, public.points_td(old.wave, new.wave), 'Tower defense : vague ' || new.wave);
  -- Records : comparés aux parties jouées avec les mêmes règles, dans le même mode.
  select max(wave) into prev from public.td_sessions
   where user_id = new.user_id and id <> new.id and rules = new.rules and mode is not distinct from new.mode;
  select max(wave) into world from public.td_sessions
   where id <> new.id and rules = new.rules and mode is not distinct from new.mode;
  if world is not null and new.wave > world and old.wave <= world then
    perform public.points_add(new.user_id, 100000, 'Record absolu au Tower defense !', 'record');
  elsif prev is not null and new.wave > prev and old.wave <= prev and new.wave >= 5 then
    perform public.points_add(new.user_id, 5000, 'Record personnel au Tower defense !', 'record');
  end if;
  if new.mode = 'infinite' then perform public.points_milestone(new.user_id, 'td', new.wave); end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Paliers
-- ---------------------------------------------------------------------------

-- Wordle : score 5 = trouvé en 2 essais, 6 = du premier coup.
create function public.points_milestones(game text) returns table (threshold int, reward bigint, label text)
language sql immutable set search_path = '' as $$
  select v.threshold, v.reward, v.label
    from (values
      ('2048', 20000, 10000::bigint, '20 000 points au 2048'),
      ('2048', 50000, 50000, '50 000 points au 2048'),
      ('2048', 100000, 250000, '100 000 points au 2048'),
      ('2048', 250000, 1000000, '250 000 points au 2048'),
      ('tetris', 50000, 10000, '50 000 points à Tetris'),
      ('tetris', 150000, 50000, '150 000 points à Tetris'),
      ('tetris', 400000, 250000, '400 000 points à Tetris'),
      ('tetris', 1000000, 1000000, '1 million de points à Tetris'),
      ('flappy', 25, 10000, '25 tuyaux à Flappy'),
      ('flappy', 50, 50000, '50 tuyaux à Flappy'),
      ('flappy', 100, 250000, '100 tuyaux à Flappy'),
      ('flappy', 200, 1000000, '200 tuyaux à Flappy'),
      ('td', 20, 10000, 'vague 20 en mode infini'),
      ('td', 30, 50000, 'vague 30 en mode infini'),
      ('td', 50, 250000, 'vague 50 en mode infini'),
      ('td', 75, 1000000, 'vague 75 en mode infini'),
      ('wordle', 5, 5000, 'Wordle trouvé en 2 essais'),
      ('wordle', 6, 50000, 'Wordle trouvé du premier coup')
    ) as v(game, threshold, reward, label)
   where v.game = points_milestones.game
$$;

create table public.score_milestones (
  user_id uuid not null references public.profiles (id) on delete cascade,
  game text not null,
  threshold int not null,
  created_at timestamptz not null default now(),
  primary key (user_id, game, threshold)
);
alter table public.score_milestones enable row level security;
create policy "ses paliers" on public.score_milestones for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.score_milestones from anon, authenticated;
grant select on public.score_milestones to authenticated;

-- Verse la prime de chaque palier atteint pour la première fois.
create function public.points_milestone(uid uuid, g text, score int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m record;
begin
  if uid is null or score is null then return; end if;
  for m in select * from public.points_milestones(g) where threshold <= score order by threshold loop
    insert into public.score_milestones (user_id, game, threshold) values (uid, g, m.threshold) on conflict do nothing;
    if found then perform public.points_add(uid, m.reward, 'Palier : ' || m.label || ' !', 'record'); end if;
  end loop;
end $$;

-- 2048, Tetris, Flappy : à la fin de la partie (score vérifié par le serveur).
create function public.milestone_on_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.finished_at is not null or new.finished_at is null then return new; end if;
  perform public.points_milestone(new.user_id, tg_argv[0], new.score);
  return new;
end $$;
create trigger milestone_2048 after update on public.g2048_sessions for each row execute function public.milestone_on_session('2048');
create trigger milestone_tetris after update on public.tetris_sessions for each row execute function public.milestone_on_session('tetris');
create trigger milestone_flappy after update on public.flappy_sessions for each row execute function public.milestone_on_session('flappy');

create function public.milestone_on_wordle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.finished or not new.finished or not new.solved then return new; end if;
  perform public.points_milestone(new.user_id, 'wordle', 7 - cardinality(new.guesses));
  return new;
end $$;
create trigger milestone_wordle after update on public.wordle_games for each row execute function public.milestone_on_wordle();

-- Pour la page Points : tous les paliers, primes × multiplicateur, et ceux déjà atteints.
create function public.points_milestones_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'game', g.game, 'threshold', m.threshold, 'label', m.label,
           'reward', m.reward * public.points_gain_mult(),
           'done', exists (select 1 from public.score_milestones s
                            where s.user_id = auth.uid() and s.game = g.game and s.threshold = m.threshold))
           order by g.n, m.threshold), '[]'::jsonb)
    from (values (1, '2048'), (2, 'tetris'), (3, 'flappy'), (4, 'td'), (5, 'wordle')) as g(n, game)
    cross join lateral public.points_milestones(g.game) m
$$;

revoke execute on function public.points_give(uuid, bigint, text), public.points_milestones(text), public.points_milestone(uuid, text, int),
  public.milestone_on_session(), public.milestone_on_wordle(), public.points_milestones_mine() from public, anon, authenticated;
grant execute on function public.points_give(uuid, bigint, text), public.points_milestones_mine() to authenticated;
