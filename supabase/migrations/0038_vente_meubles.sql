-- Vente de meubles : un meuble de sa réserve (posé nulle part dans l'appart) se revend 67 % du prix de
-- base de son modèle (furniture_bases.price), quelle que soit sa finition. Le meuble disparaît.
-- À exécuter une fois, après 0009_appart_admin.sql (appliquée automatiquement par le workflow Supabase).

set client_encoding = 'UTF8';

-- Doit rester identique à sellPrice (src/net/apartment.ts).
create or replace function public.furniture_sell_price(item text) returns bigint
language sql stable set search_path = '' as $$
  select floor(b.price * 67 / 100)::bigint from public.furniture_bases b where b.id = split_part(item, ':', 1)
$$;

create function public.furniture_sell(owned_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  f public.furniture_owned;
  price bigint;
begin
  perform pg_advisory_xact_lock(hashtext('furniture_sell:' || uid::text));
  select * into f from public.furniture_owned where id = owned_id and user_id = uid for update;
  if not found then raise exception 'meuble introuvable' using errcode = 'P0002'; end if;
  -- Posé dans une pièce (sol ou mur) : il faut d'abord le ranger.
  if exists (
    select 1
      from public.apartments a,
           jsonb_each(coalesce(a.layout, '{}'::jsonb)) r,
           jsonb_array_elements(coalesce(r.value -> 'floor', '[]'::jsonb) || coalesce(r.value -> 'wall', '[]'::jsonb)) e
     where a.user_id = uid and jsonb_typeof(r.value) = 'object' and (e ->> 'o') = owned_id::text
  ) then
    raise exception 'ce meuble est posé dans l’appart : range-le d’abord' using errcode = 'P0001';
  end if;
  price := public.furniture_sell_price(f.item_id);
  if price is null then raise exception 'ce meuble ne se revend pas' using errcode = 'P0001'; end if;
  delete from public.furniture_owned where id = owned_id;
  perform public.points_add(uid, price, 'Meuble vendu : ' || f.item_id, 'furniture');
  return jsonb_build_object('price', price, 'balance', (select balance from public.wallets where user_id = uid));
end $$;

revoke execute on function public.furniture_sell_price(text), public.furniture_sell(bigint) from public, anon, authenticated;
grant execute on function public.furniture_sell(bigint) to authenticated;
