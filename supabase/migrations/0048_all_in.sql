-- Casino sans mise maximale : on peut miser tout son solde (« all in ») à la roulette et à la
-- machine à sous. Seules limites restantes : avoir les points, et 12 mises toutes les 10 secondes.
-- À exécuter une fois, après 0047_dons_paliers.sql.

set client_encoding = 'UTF8';

create or replace function public.casino_max(bal bigint) returns bigint
language sql immutable set search_path = '' as $$
  select greatest(coalesce(bal, 0), 0)::bigint
$$;

create or replace function public.casino_check(stake bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  bal bigint;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if stake is null or stake < 1 then raise exception 'mise invalide' using errcode = '22023'; end if;
  perform public.points_open(uid);
  select balance into bal from public.wallets where user_id = uid for update;
  if bal < stake then raise exception 'pas assez de points' using errcode = 'P0001'; end if;
  if (select count(*) from public.point_events where user_id = uid and kind = 'casino' and created_at > now() - interval '10 seconds') >= 12 then
    raise exception 'doucement : trop de mises d’un coup' using errcode = 'P0001';
  end if;
  return uid;
end $$;
