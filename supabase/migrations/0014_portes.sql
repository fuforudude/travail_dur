-- Portes entre les pièces : chacune occupe toute la hauteur d'une colonne de mur, où l'on ne peut
-- donc rien accrocher. Plan (arbre autour de l'entrée) et colonnes : comme ROOMS dans src/net/furniture.ts.
-- Les objets muraux déjà accrochés à la place d'une porte retournent dans la réserve.
-- À exécuter une fois, après 0013_pieces.sql.

set client_encoding = 'UTF8';

-- Colonnes de mur occupées par une porte (x de 0 à d − 1 = mur de gauche, puis mur de droite).
create function public.apartment_room_doors(room text) returns int[]
language sql immutable set search_path = '' as $$
  select case room
    when 'entree' then array[2, 6, 9]   -- salon, chambre, salle de bain
    when 'salon' then array[3, 9, 13]   -- entrée, cuisine, salle de jeux
    when 'cuisine' then array[2]        -- salon
    when 'chambre' then array[3, 11]    -- entrée, bureau
    when 'sdb' then array[2]            -- entrée
    when 'bureau' then array[2]         -- chambre
    when 'jeux' then array[3]           -- salon
    else '{}'::int[] end
$$;

-- Décroche ce qui est à la place d'une porte, puis recalcule les revenus.
do $$
declare
  a record;
begin
  for a in select user_id from public.apartments loop
    perform public.apartment_settle(a.user_id);
    update public.apartments p
       set layout = coalesce((
             select jsonb_object_agg(r.key, jsonb_set(r.value, '{wall}', coalesce((
                      select jsonb_agg(e)
                        from jsonb_array_elements(r.value -> 'wall') e
                        join public.furniture_items i on i.id = e ->> 'i'
                       where not exists (
                         select 1 from unnest(public.apartment_room_doors(r.key)) c
                          where c >= (e ->> 'x')::int and c < (e ->> 'x')::int + i.w)), '[]')))
               from jsonb_each(p.layout) r
              where jsonb_typeof(r.value) = 'object'), p.layout)
     where p.user_id = a.user_id;
    update public.apartments set rate = public.apartment_rate(layout, clean_step) where user_id = a.user_id;
  end loop;
end $$;

-- Même aménagement que 0013, avec les portes en plus.
create or replace function public.apartment_save(layout jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  a public.apartments := public.apartment_settle(uid);
  room text;
  v jsonb;
  info record;
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
  clean jsonb := '{}';
  one jsonb;
  entry jsonb;
begin
  if a.clean_step < 6 then raise exception 'nettoie d''abord ton appart' using errcode = 'P0001'; end if;
  if layout is null or jsonb_typeof(layout) <> 'object' then raise exception 'aménagement invalide' using errcode = '22023'; end if;
  for room, v in select key, value from jsonb_each(layout) loop
    if not room = any(a.rooms) then raise exception 'pièce pas encore débloquée' using errcode = 'P0001'; end if;
    if jsonb_typeof(v) <> 'object' then raise exception 'aménagement invalide' using errcode = '22023'; end if;
    select * into info from public.apartment_room(room);
    one := '{"floor": [], "wall": []}';
    foreach zone in array array['floor', 'wall'] loop
      cols := case when zone = 'floor' then info.w else info.d + info.w end;
      rows_ := case when zone = 'floor' then info.d else 2 end;
      grid := array_fill(false, array[cols * rows_]);
      if v -> zone is not null and jsonb_typeof(v -> zone) <> 'array' then
        raise exception 'aménagement invalide' using errcode = '22023';
      end if;
      if jsonb_array_length(coalesce(v -> zone, '[]')) > 64 then raise exception 'trop de meubles' using errcode = '22023'; end if;
      for e in select * from jsonb_array_elements(coalesce(v -> zone, '[]')) loop
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
        -- Au sol, un quart de tour échange les deux dimensions ; au mur, l'emprise ne change pas.
        w := case when zone = 'floor' and r % 2 = 1 then it.h else it.w end;
        h := case when zone = 'floor' and r % 2 = 1 then it.w else it.h end;
        if x < 0 or y < 0 or x + w > cols or y + h > rows_ then raise exception 'meuble hors de la pièce' using errcode = '22023'; end if;
        if zone = 'wall' and x < info.d and x + w > info.d then
          raise exception 'un objet ne peut pas être à cheval sur deux murs' using errcode = '22023';
        end if;
        if zone = 'wall' and exists (select 1 from unnest(public.apartment_room_doors(room)) c where c >= x and c < x + w) then
          raise exception 'il y a une porte ici' using errcode = '22023';
        end if;
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
        one := jsonb_set(one, array[zone], (one -> zone) || jsonb_build_array(entry));
      end loop;
    end loop;
    clean := clean || jsonb_build_object(room, one);
  end loop;
  update public.apartments
     set layout = clean, rate = public.apartment_rate(clean, a.clean_step), updated_at = now()
   where user_id = uid;
  return clean;
end $$;


revoke execute on function public.apartment_room_doors(text) from public, anon, authenticated;
