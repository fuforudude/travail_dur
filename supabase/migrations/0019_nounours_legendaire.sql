-- Les meubles « à nounours » passent de Rare à Légendaire (plus rares dans les caisses, et ils
-- rapportent ×8 au lieu de ×2,5). Doit rester identique à FINISHES dans src/net/furniture.ts.
-- À exécuter une fois, après 0018_versions_meubles.sql.

set client_encoding = 'UTF8';

update public.furniture_finishes set rarity = 'legendary' where id = 'nounours';

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
