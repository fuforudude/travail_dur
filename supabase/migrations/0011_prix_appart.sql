-- Appart plus accessible au début : nettoyage ÷ 10, meubles standard bien moins chers.
-- Les meubles « boostés » (finitions rares) restent chers : on ne les obtient que dans les caisses.
-- Revenus : prix standard ÷ 10 par heure (au lieu de ÷ 40, puisque les prix ont baissé),
-- toujours multipliés selon la rareté. Doit rester identique à src/net/apartment.ts.
-- À exécuter une fois, après 0010_appart_3d.sql.

set client_encoding = 'UTF8';

create or replace function public.apartment_clean_cost(step int) returns bigint
language sql immutable set search_path = '' as $$
  select (array[30, 80, 150, 300, 600, 1000])[step + 1]::bigint
$$;

update public.furniture_bases b set price = v.price
  from (values
    ('chair', 150), ('plant', 100), ('teddy', 120), ('lamp', 150), ('books', 300), ('guitar', 400),
    ('tv', 500), ('computer', 700), ('aquarium', 700), ('arcade', 1000), ('trophy', 1500),
    ('sofa', 600), ('bath', 900), ('piano', 1200), ('bed', 800),
    ('frame', 300), ('window', 400), ('clock', 250), ('mirror', 300)
  ) as v(id, price)
 where b.id = v.id;

create or replace function public.apartment_rate(layout jsonb, clean_step int) returns numeric
language sql stable set search_path = '' as $$
  select 20 * clean_step + coalesce((
    select sum(b.price / 10.0 * public.apartment_rarity_mult(f.rarity))
      from jsonb_array_elements(coalesce(layout -> 'floor', '[]') || coalesce(layout -> 'wall', '[]')) e
      join public.furniture_bases b on b.id = split_part(e ->> 'i', ':', 1)
      join public.furniture_finishes f on f.id = split_part(e ->> 'i', ':', 2)
  ), 0)
$$;

-- Les revenus déjà accumulés restent acquis ; le nouveau taux s'applique à partir de maintenant.
do $$
declare
  a record;
begin
  for a in select user_id from public.apartments loop
    perform public.apartment_settle(a.user_id);
    update public.apartments set rate = public.apartment_rate(layout, clean_step) where user_id = a.user_id;
  end loop;
end $$;
