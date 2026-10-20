-- Plusieurs pièces : on commence avec l'entrée, les autres se débloquent en payant, de plus en plus cher.
-- Cadres photo plus grands : 2 emplacements de mur de large.
--
-- * apartments.rooms = pièces débloquées ; layout = {"entree": {"floor": […], "wall": […]}, "salon": {…}}.
-- * Chaque pièce a sa taille : sol w × d (w le long de x, d le long de y) ; murs : x de 0 à d − 1 = mur
--   de gauche, de d à d + w − 1 = mur de droite, sur 2 hauteurs. Un objet mural ne passe pas d'un mur à l'autre.
-- * Au mur, une rotation ne change pas l'emprise (seul le sol échange largeur et profondeur).
-- * Le nettoyage du début concerne l'entrée ; il faut l'avoir fini pour meubler ou acheter une pièce.
-- Les pièces ayant changé de taille, les meubles déjà posés retournent dans la réserve.
-- Doit rester identique à src/net/furniture.ts (ROOMS, ROOM_COSTS, footprint, fitsIn).
-- À exécuter une fois, après 0012_rotation.sql.

set client_encoding = 'UTF8';

update public.furniture_bases set w = 2 where id = 'frame';

alter table public.apartments add column rooms text[] not null default '{entree}';
alter table public.apartments alter column layout set default '{"entree": {"floor": [], "wall": []}}';

-- ---------------------------------------------------------------------------
-- Barème
-- ---------------------------------------------------------------------------

create function public.apartment_room(room text, out name text, out w int, out d int)
language sql immutable set search_path = '' as $$
  select v.name, v.w, v.d
    from (values
      ('entree', 'Entrée', 6, 5),
      ('salon', 'Salon', 8, 7),
      ('cuisine', 'Cuisine', 7, 6),
      ('chambre', 'Chambre', 7, 7),
      ('sdb', 'Salle de bain', 6, 5),
      ('bureau', 'Bureau', 6, 6),
      ('jeux', 'Salle de jeux', 8, 8)
    ) as v(id, name, w, d)
   where v.id = room
$$;

-- Prix de la pièce suivante, n = nombre de pièces déjà achetées (l'entrée ne compte pas).
create function public.apartment_room_cost(n int) returns bigint
language sql immutable set search_path = '' as $$
  select (array[3000, 8000, 20000, 50000, 120000, 300000])[n + 1]::bigint
$$;

-- Comme avant, mais en additionnant les meubles de toutes les pièces.
create or replace function public.apartment_rate(layout jsonb, clean_step int) returns numeric
language sql stable set search_path = '' as $$
  select 20 * clean_step + coalesce((
    select sum(b.price / 10.0 * public.apartment_rarity_mult(f.rarity))
      from jsonb_each(layout) r,
           jsonb_array_elements(coalesce(r.value -> 'floor', '[]') || coalesce(r.value -> 'wall', '[]')) e
      join public.furniture_bases b on b.id = split_part(e ->> 'i', ':', 1)
      join public.furniture_finishes f on f.id = split_part(e ->> 'i', ':', 2)
     where jsonb_typeof(r.value) = 'object'
  ), 0)
$$;

-- Les revenus déjà accumulés restent acquis ; les meubles reviennent dans la réserve.
do $$
declare
  a record;
begin
  for a in select user_id from public.apartments loop
    perform public.apartment_settle(a.user_id);
    update public.apartments
       set layout = '{"entree": {"floor": [], "wall": []}}', rate = public.apartment_rate('{}', clean_step), updated_at = now()
     where user_id = a.user_id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Achat d'une pièce, aménagement
-- ---------------------------------------------------------------------------

create function public.apartment_room_buy(room text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  a public.apartments := public.apartment_settle(uid);
  info record;
  bal bigint;
begin
  if a.clean_step < 6 then raise exception 'nettoie d''abord ton entrée' using errcode = 'P0001'; end if;
  select * into info from public.apartment_room(room);
  if info.w is null then raise exception 'pièce inconnue' using errcode = 'P0002'; end if;
  if room = any(a.rooms) then raise exception 'pièce déjà débloquée' using errcode = 'P0001'; end if;
  bal := public.points_spend(uid, public.apartment_room_cost(cardinality(a.rooms) - 1), 'Appart : ' || info.name, 'appart');
  update public.apartments set rooms = a.rooms || room, updated_at = now() where user_id = uid;
  return jsonb_build_object('balance', bal, 'rooms', to_jsonb(a.rooms || room));
end $$;

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

-- Photo supprimée : les cadres qui la montraient, dans toutes les pièces, redeviennent vides.
create or replace function public.admin_artwork_delete(artwork bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare
  p text;
begin
  perform public.admin_check();
  delete from public.artworks where id = artwork returning path into p;
  update public.apartments a
     set layout = (
       select jsonb_object_agg(r.key, jsonb_set(r.value, '{wall}', coalesce((
                select jsonb_agg(case when (w ->> 'art')::bigint = artwork then w - 'art' else w end)
                  from jsonb_array_elements(r.value -> 'wall') w), '[]')))
         from jsonb_each(a.layout) r)
   where exists (select 1 from jsonb_each(a.layout) r where r.value -> 'wall' @> jsonb_build_array(jsonb_build_object('art', artwork)));
  perform public.admin_note('artwork_delete', null, artwork::text);
  return p;
end $$;

revoke execute on function public.apartment_room(text), public.apartment_room_cost(int), public.apartment_room_buy(text)
  from public, anon, authenticated;
grant execute on function public.apartment_room_buy(text) to authenticated;
