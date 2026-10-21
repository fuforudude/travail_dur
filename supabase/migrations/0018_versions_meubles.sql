-- Versions décorées des meubles et revenus de l'appart × 4.
--
-- * Versions : de nouvelles finitions qui gardent la couleur du meuble et ajoutent des motifs
--   (fleurs, cœurs, étoiles, nounours, pics, arcs-en-ciel, flammes, couronne). Comme les autres
--   finitions rares, on ne les obtient que dans les caisses, selon leur rareté ; elles rapportent
--   selon cette rareté.
-- * Revenus : chaque meuble posé rapporte son prix × 0,8 par heure (au lieu de ÷ 5), toujours
--   multiplié selon la rareté ; chaque tâche de nettoyage, 200 par heure (au lieu de 50).
-- Doit rester identique à src/net/furniture.ts (FINISHES, CLEAN_RATE, itemIncome).
-- À exécuter une fois, après 0017_amis.sql.

set client_encoding = 'UTF8';

insert into public.furniture_finishes (id, rarity) values
  ('fleurs', 'common'), ('coeurs', 'common'),
  ('etoiles', 'rare'), ('nounours', 'rare'),
  ('pics', 'epic'), ('arcs', 'epic'),
  ('flammes', 'legendary'),
  ('couronne', 'mythic');

create or replace function public.apartment_rate(layout jsonb, clean_step int) returns numeric
language sql stable set search_path = '' as $$
  select 200 * clean_step + coalesce((
    select sum(b.price * 0.8 * public.apartment_rarity_mult(f.rarity))
      from jsonb_each(layout) r,
           jsonb_array_elements(coalesce(r.value -> 'floor', '[]') || coalesce(r.value -> 'wall', '[]')) e
      join public.furniture_bases b on b.id = split_part(e ->> 'i', ':', 1)
      join public.furniture_finishes f on f.id = split_part(e ->> 'i', ':', 2)
     where jsonb_typeof(r.value) = 'object'
  ), 0)
$$;

-- Les revenus déjà accumulés restent acquis ; nouveau taux à partir de maintenant.
do $$
declare
  a record;
begin
  for a in select user_id from public.apartments loop
    perform public.apartment_settle(a.user_id);
    update public.apartments set rate = public.apartment_rate(layout, clean_step) where user_id = a.user_id;
  end loop;
end $$;
