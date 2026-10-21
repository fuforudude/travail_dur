-- Tower defense : défis Héroïque et Fer (comme dans Kingdom Rush) sur chaque niveau réussi avec
-- 3 étoiles, et sorts (Pluie de feu, Blizzard) lancés pendant les vagues (rejoués par la fonction
-- serveur `td` comme les constructions : rien à stocker ici).
-- * td_sessions.variant : 'heroic' ou 'iron' (null : partie normale). Une partie en défi ne donne pas
--   d'étoiles (stars = 0) : la progression, la boutique à étoiles et le classement n'en tiennent pas compte.
-- * Points : première victoire d'un défi sur un niveau : 200 + 20 × niveau (plafonné à 45), × 3 par
--   points_add ; ensuite, comme un niveau rejoué.
-- À exécuter une fois (appliquée automatiquement par le workflow Supabase).

set client_encoding = 'UTF8';

alter table public.td_sessions add column variant text check (variant in ('heroic', 'iron'));

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
    perform public.points_add(new.user_id, 500, 'Record absolu au Tower defense !', 'record');
  elsif prev is not null and new.wave > prev and old.wave <= prev and new.wave >= 5 then
    perform public.points_add(new.user_id, 100, 'Record personnel au Tower defense', 'record');
  end if;
  return new;
end $$;
