-- Revenus de l'appart versés automatiquement : le site les récolte chaque minute, sur n'importe quelle
-- page (src/net/idle.ts). Pour ne pas remplir l'historique d'une ligne par minute, les récoltes d'une
-- même heure s'ajoutent à une seule ligne « Revenus de l'appart » (une seule notification par heure).
-- Hors du site, les revenus continuent de s'accumuler, toujours dans la limite de 24 h.
-- À exécuter une fois, après 0020_meubles_perso.sql.

set client_encoding = 'UTF8';

create or replace function public.apartment_collect() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  a public.apartments := public.apartment_settle(uid);
  gain bigint := floor(a.banked);
  ev bigint;
begin
  if gain < 1 then return jsonb_build_object('gain', 0); end if;
  update public.apartments set banked = a.banked - gain where user_id = uid;
  -- Comme points_add (sans multiplicateur : ce n'est pas un gain de jeu), mais en regroupant par heure.
  perform public.points_open(uid);
  update public.wallets set balance = balance + gain, earned = earned + gain, updated_at = now() where user_id = uid;
  select id into ev from public.point_events
   where user_id = uid and kind = 'appart' and reason = 'Revenus de l''appart' and created_at > now() - interval '1 hour'
   order by id desc limit 1;
  if found then
    update public.point_events set amount = amount + gain where id = ev;
  else
    insert into public.point_events (user_id, amount, reason, kind) values (uid, gain, 'Revenus de l''appart', 'appart');
  end if;
  return jsonb_build_object('gain', gain);
end $$;
