-- L'appartement, les meubles et les caisses ouvrent à tous les joueurs connectés
-- (jusqu'ici réservés aux admins). Côté site, la condition « admin » est retirée en même temps.
-- À exécuter une fois, après 0015_caisse_photos.sql.

set client_encoding = 'UTF8';

create or replace function public.apartment_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
$$;
