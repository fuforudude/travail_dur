-- Tower defense : étoiles, boutique à étoiles, niveaux bonus.
--
-- * Étoiles : chaque niveau réussi en rapporte 1 à 3 (3 sans perdre de vie, 2 avec au moins la
--   moitié des vies, 1 sinon). La fonction serveur `td` les calcule avec le moteur et les écrit
--   dans td_sessions.stars ; on garde la meilleure partie de chaque niveau.
-- * Niveaux bonus 21 à 25 (les défis de Tonton Jean-Mi) : ils ne comptent pas dans les niveaux
--   terminés de la campagne (td_cleared), qui débloquent les tours.
-- * Boutique à étoiles : 5 améliorations permanentes de 5 rangs ; le rang n coûte n étoiles
--   (à garder identique à PERKS, PERK_MAX et perkCost dans src/games/towerdefense/engine/data.ts).
--   Réinitialiser rend toutes les étoiles dépensées.
-- À exécuter une fois, après 0032_td_campagne.sql.

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- Parties : niveaux bonus et étoiles
-- ---------------------------------------------------------------------------

alter table public.td_sessions drop constraint if exists td_sessions_level_check;
alter table public.td_sessions add constraint td_sessions_level_check check (level between 1 and 25);
alter table public.td_sessions add column stars int not null default 0 check (stars between 0 and 3);

-- Parties déjà gagnées : les vies de départ ne sont pas connues, on compte sur 20.
update public.td_sessions set stars = case when lives >= 20 then 3 when lives >= 10 then 2 else 1 end
 where rules = 3 and mode = 'campaign' and won;

create or replace function public.td_cleared(uid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(max(level), 0) from public.td_sessions
   where user_id = uid and rules = 3 and mode = 'campaign' and won and level <= 20
$$;

-- Étoiles gagnées : la meilleure partie de chaque niveau.
create function public.td_stars(uid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(best), 0)::int from (
    select max(stars) as best from public.td_sessions
     where user_id = uid and rules = 3 and mode = 'campaign' and won
     group by level
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Boutique à étoiles
-- ---------------------------------------------------------------------------

create table public.td_perks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  perk_id text not null check (perk_id in ('damage', 'rate', 'range', 'cost', 'gold')),
  rank int not null check (rank between 1 and 5),
  primary key (user_id, perk_id)
);
alter table public.td_perks enable row level security;
create policy "ses améliorations td" on public.td_perks for select to authenticated using (user_id = auth.uid());
revoke all on public.td_perks from anon, authenticated;
grant select on public.td_perks to authenticated;

-- Étoiles dépensées : rangs 1 + 2 + … + n pour chaque amélioration.
create function public.td_stars_spent(uid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(rank * (rank + 1) / 2), 0)::int from public.td_perks where user_id = uid
$$;

-- Achète le rang suivant d'une amélioration.
create function public.td_perk_buy(perk text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cur int;
  cost int;
  left_ int;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if perk not in ('damage', 'rate', 'range', 'cost', 'gold') then
    raise exception 'amélioration inconnue' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('td_perks:' || uid::text));
  select rank into cur from public.td_perks where user_id = uid and perk_id = perk;
  cur := coalesce(cur, 0);
  if cur >= 5 then raise exception 'rang maximum' using errcode = 'P0001'; end if;
  cost := cur + 1;
  left_ := public.td_stars(uid) - public.td_stars_spent(uid);
  if left_ < cost then raise exception 'pas assez d’étoiles' using errcode = 'P0001'; end if;
  insert into public.td_perks (user_id, perk_id, rank) values (uid, perk, 1)
  on conflict (user_id, perk_id) do update set rank = public.td_perks.rank + 1;
  return jsonb_build_object('perk', perk, 'rank', cur + 1, 'left', left_ - cost);
end $$;

-- Rend toutes les étoiles dépensées.
create function public.td_perk_reset() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  delete from public.td_perks where user_id = uid;
  return jsonb_build_object('left', public.td_stars(uid));
end $$;

revoke execute on function public.td_stars(uuid), public.td_stars_spent(uuid) from public, anon, authenticated;
revoke execute on function public.td_perk_buy(text), public.td_perk_reset() from public, anon;
grant execute on function public.td_perk_buy(text), public.td_perk_reset() to authenticated;
grant execute on function public.td_cleared(uuid), public.td_stars(uuid), public.td_stars_spent(uuid) to service_role;
