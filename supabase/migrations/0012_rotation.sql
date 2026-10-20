-- Rotation des meubles : chaque meuble posé a une orientation r (0 à 3, quarts de tour).
-- Au sol, un quart de tour échange largeur et profondeur (un canapé 2 × 1 devient 1 × 2) ;
-- au mur, un objet fait toujours un emplacement et tourne dans le plan du mur.
-- Doit rester identique à footprint() dans src/net/apartment.ts.
-- À exécuter une fois, après 0011_prix_appart.sql.

set client_encoding = 'UTF8';

create or replace function public.apartment_save(layout jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  a public.apartments := public.apartment_settle(uid);
  zone text;
  cols int;
  rows_ int;
  grid boolean[];
  e jsonb;
  oid bigint;
  it record;
  x int; y int; dx int; dy int; r int; w int; h int;
  art bigint;
  used bigint[] := '{}';
  clean jsonb := '{"floor": [], "wall": []}';
  entry jsonb;
begin
  if a.clean_step < 6 then raise exception 'nettoie d''abord ton appart' using errcode = 'P0001'; end if;
  if layout is null or jsonb_typeof(layout) <> 'object' then raise exception 'aménagement invalide' using errcode = '22023'; end if;
  foreach zone in array array['floor', 'wall'] loop
    cols := case when zone = 'floor' then 8 else 16 end;
    rows_ := case when zone = 'floor' then 8 else 2 end;
    grid := array_fill(false, array[cols * rows_]);
    if layout -> zone is not null and jsonb_typeof(layout -> zone) <> 'array' then
      raise exception 'aménagement invalide' using errcode = '22023';
    end if;
    if jsonb_array_length(coalesce(layout -> zone, '[]')) > 64 then raise exception 'trop de meubles' using errcode = '22023'; end if;
    for e in select * from jsonb_array_elements(coalesce(layout -> zone, '[]')) loop
      if jsonb_typeof(e -> 'o') <> 'number' or jsonb_typeof(e -> 'x') <> 'number' or jsonb_typeof(e -> 'y') <> 'number'
         or (e ? 'r' and (jsonb_typeof(e -> 'r') <> 'number' or (e ->> 'r') !~ '^[0-3]$')) then
        raise exception 'aménagement invalide' using errcode = '22023';
      end if;
      oid := (e ->> 'o')::bigint;
      x := (e ->> 'x')::int;
      y := (e ->> 'y')::int;
      r := coalesce((e ->> 'r')::int, 0);
      if oid = any(used) then raise exception 'meuble placé deux fois' using errcode = '22023'; end if;
      used := used || oid;
      select f.item_id, i.place, i.w, i.h, i.base into it
        from public.furniture_owned f join public.furniture_items i on i.id = f.item_id
       where f.id = oid and f.user_id = uid;
      if not found then raise exception 'meuble non possédé' using errcode = 'P0001'; end if;
      if it.place <> zone then raise exception 'ce meuble ne va pas là' using errcode = '22023'; end if;
      -- Un quart de tour échange les deux dimensions.
      w := case when r % 2 = 1 then it.h else it.w end;
      h := case when r % 2 = 1 then it.w else it.h end;
      if x < 0 or y < 0 or x + w > cols or y + h > rows_ then raise exception 'meuble hors de la pièce' using errcode = '22023'; end if;
      for dy in 0..h - 1 loop
        for dx in 0..w - 1 loop
          if grid[(y + dy) * cols + x + dx + 1] then raise exception 'deux meubles au même endroit' using errcode = '22023'; end if;
          grid[(y + dy) * cols + x + dx + 1] := true;
        end loop;
      end loop;
      entry := jsonb_build_object('o', oid, 'i', it.item_id, 'x', x, 'y', y);
      if r <> 0 then entry := entry || jsonb_build_object('r', r); end if;
      if it.base = 'frame' and e ? 'art' and jsonb_typeof(e -> 'art') = 'number' then
        art := (e ->> 'art')::bigint;
        if not exists (select 1 from public.artworks where id = art) then raise exception 'photo inconnue' using errcode = 'P0002'; end if;
        entry := entry || jsonb_build_object('art', art);
      end if;
      clean := jsonb_set(clean, array[zone], (clean -> zone) || jsonb_build_array(entry));
    end loop;
  end loop;
  update public.apartments
     set layout = clean, rate = public.apartment_rate(clean, a.clean_step), updated_at = now()
   where user_id = uid;
  return clean;
end $$;
