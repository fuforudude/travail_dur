-- Heure du serveur, pour que le site ne dépende pas de l'horloge de l'appareil (src/net/serverClock.ts).
-- Les gains (revenus de l'appart, limites des points…) sont déjà calculés avec now() côté serveur :
-- changer l'heure de son téléphone ne rapporte rien. Cette fonction sert à ce que l'affichage
-- (compteur des revenus de l'appart) ne puisse pas non plus être trompé.
-- À exécuter une fois (indépendante des autres migrations).

create or replace function public.server_now() returns timestamptz
language sql stable set search_path = '' as $$ select now() $$;

grant execute on function public.server_now() to anon, authenticated;
