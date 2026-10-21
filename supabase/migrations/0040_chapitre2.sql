-- Tower defense, chapitre 2 : la chasse à la sorcière (niveaux 26 à 75, après les défis bonus 21 à 25).
-- * Les parties acceptent les niveaux 1 à 75.
-- * td_cleared2 : plus haut niveau réussi du chapitre 2 (débloqués dans l'ordre, après le niveau 20).
-- * Points d'un niveau réussi : 100 + 40 × niveau la première fois, 5 × niveau ensuite, comme avant,
--   mais plafonnés au niveau 45 (sinon le niveau 75 rapporterait trop) ; × 3 par points_add (0034).
-- À exécuter une fois (appliquée automatiquement par le workflow Supabase).

set client_encoding = 'UTF8';

alter table public.td_sessions drop constraint if exists td_sessions_level_check;
alter table public.td_sessions add constraint td_sessions_level_check check (level between 1 and 75);

create function public.td_cleared2(uid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(max(level), 0) from public.td_sessions
   where user_id = uid and rules = 3 and mode = 'campaign' and won and level between 26 and 75
$$;

create or replace function public.points_on_td() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev int; world int; first boolean; lvl int;
begin
  -- Campagne : des points seulement quand le niveau est réussi.
  if new.mode = 'campaign' then
    if new.won and not old.won then
      first := not exists (select 1 from public.td_sessions
                            where user_id = new.user_id and id <> new.id and rules = new.rules and mode = 'campaign' and level = new.level and won);
      lvl := least(new.level, 45);
      perform public.points_add(new.user_id, case when first then 100 + 40 * lvl else 5 * lvl end,
        'Tower defense : niveau ' || new.level || case when first then ' terminé !' else ' rejoué' end);
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
    perform public.points_add(new.user_id, 500, 'Record absolu au Tower defense !', 'record');
  elsif prev is not null and new.wave > prev and old.wave <= prev and new.wave >= 5 then
    perform public.points_add(new.user_id, 100, 'Record personnel au Tower defense', 'record');
  end if;
  return new;
end $$;

revoke execute on function public.td_cleared2(uuid) from public, anon, authenticated;
grant execute on function public.td_cleared2(uuid) to service_role;
