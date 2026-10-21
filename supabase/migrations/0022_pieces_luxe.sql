-- Pièces de luxe et leurs équipements spéciaux.
--
-- * Trois pièces très chères, à prix fixe (hors de la suite 3 000 → 300 000), chacune derrière une porte
--   d'une pièce existante qu'il faut avoir d'abord : le bar (depuis la salle de jeux, 1 000 000), la salle
--   des coffres (depuis le bureau, 2 500 000), le toit-terrasse (depuis le bar, 5 000 000).
-- * Chacune a un équipement spécial à installer, posé au sol à une place fixe (aucun meuble dessus) :
--   tireuse à Jäger (1 000 000, revenus × 2), coffre-fort blindé (2 000 000, 72 h de revenus hors du
--   site au lieu de 24 h), jacuzzi en or (5 000 000, revenus × 1,5, en plus de la tireuse).
-- * apartments.rate inclut désormais ce multiplicateur : un déclencheur le recalcule à chaque changement
--   de meubles, de ménage ou d'équipements, quelle que soit la fonction qui écrit.
-- * Nouvelles portes dans la salle de jeux et le bureau : ce qui était accroché à leur place retourne
--   dans la réserve.
-- Doit rester identique à src/net/furniture.ts (ROOMS, roomCost, SPECIALS, incomeMult, capHours, fitsIn).
-- À exécuter une fois, après 0021_revenus_auto.sql.

set client_encoding = 'UTF8';

alter table public.apartments add column specials text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- Barème
-- ---------------------------------------------------------------------------

create or replace function public.apartment_room(room text, out name text, out w int, out d int)
language sql immutable set search_path = '' as $$
  select v.name, v.w, v.d
    from (values
      ('entree', 'Entrée', 6, 5),
      ('salon', 'Salon', 8, 7),
      ('cuisine', 'Cuisine', 7, 6),
      ('chambre', 'Chambre', 7, 7),
      ('sdb', 'Salle de bain', 6, 5),
      ('bureau', 'Bureau', 6, 6),
      ('jeux', 'Salle de jeux', 8, 8),
      ('bar', 'Bar', 8, 6),
      ('coffres', 'Salle des coffres', 6, 6),
      ('toit', 'Toit-terrasse', 9, 8)
    ) as v(id, name, w, d)
   where v.id = room
$$;

create or replace function public.apartment_room_doors(room text) returns int[]
language sql immutable set search_path = '' as $$
  select case room
    when 'entree' then array[2, 6, 9]   -- salon, chambre, salle de bain
    when 'salon' then array[3, 9, 13]   -- entrée, cuisine, salle de jeux
    when 'cuisine' then array[2]        -- salon
    when 'chambre' then array[3, 11]    -- entrée, bureau
    when 'sdb' then array[2]            -- entrée
    when 'bureau' then array[2, 8]      -- chambre, salle des coffres
    when 'jeux' then array[3, 12]       -- salon, bar
    when 'bar' then array[2, 10]        -- salle de jeux, toit-terrasse
    when 'coffres' then array[2]        -- bureau
    when 'toit' then array[3]           -- bar
    else '{}'::int[] end
$$;

-- Pièces de luxe : prix fixe, et la pièce qu'il faut avoir pour atteindre leur porte.
create function public.apartment_room_luxury(room text, out price bigint, out requires text)
language sql immutable set search_path = '' as $$
  select v.price, v.requires
    from (values ('bar', 1000000::bigint, 'jeux'), ('coffres', 2500000, 'bureau'), ('toit', 5000000, 'bar')) as v(id, price, requires)
   where v.id = room
$$;

-- Équipements spéciaux : pièce, prix et place réservée au sol (x, y, w × h).
create function public.apartment_specials()
returns table (id text, room text, name text, cost bigint, x int, y int, w int, h int)
language sql immutable set search_path = '' as $$
  values
    ('jager', 'bar', 'Tireuse à Jäger', 1000000::bigint, 1, 0, 3, 1),
    ('coffre', 'coffres', 'Coffre-fort blindé', 2000000, 3, 0, 2, 2),
    ('jacuzzi', 'toit', 'Jacuzzi en or', 5000000, 5, 2, 2, 2)
$$;

create function public.apartment_mult(specials text[]) returns numeric
language sql immutable set search_path = '' as $$
  select (case when 'jager' = any(specials) then 2 else 1 end) * (case when 'jacuzzi' = any(specials) then 1.5 else 1 end)
$$;

create function public.apartment_cap_hours(specials text[]) returns int
language sql immutable set search_path = '' as $$
  select case when 'coffre' = any(specials) then 72 else 24 end
$$;

-- ---------------------------------------------------------------------------
-- Revenus : multiplicateur dans le taux, plafond selon le coffre-fort
-- ---------------------------------------------------------------------------

create function public.apartment_rate_sync() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.rate := public.apartment_rate(new.layout, new.clean_step) * public.apartment_mult(new.specials);
  return new;
end $$;

create trigger apartment_rate_sync before insert or update of layout, clean_step, specials, rate on public.apartments
  for each row execute function public.apartment_rate_sync();

create or replace function public.apartment_settle(uid uuid) returns public.apartments
language plpgsql security definer set search_path = '' as $$
declare
  a public.apartments;
begin
  insert into public.apartments (user_id) values (uid) on conflict do nothing;
  select * into a from public.apartments where user_id = uid for update;
  a.banked := least(a.banked + a.rate * extract(epoch from now() - a.last_tick) / 3600,
                    greatest(a.rate, 1) * public.apartment_cap_hours(a.specials));
  a.last_tick := now();
  update public.apartments set banked = a.banked, last_tick = a.last_tick where user_id = uid;
  return a;
end $$;

-- ---------------------------------------------------------------------------
-- Achats
-- ---------------------------------------------------------------------------

-- Comme 0013, avec les pièces de luxe : prix fixe, pièce voisine requise ; elles ne comptent pas
-- dans la suite de prix des pièces normales.
create or replace function public.apartment_room_buy(room text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  a public.apartments := public.apartment_settle(uid);
  info record;
  lux record;
  cost bigint;
  bal bigint;
begin
  if a.clean_step < 6 then raise exception 'nettoie d''abord ton entrée' using errcode = 'P0001'; end if;
  select * into info from public.apartment_room(room);
  if info.w is null then raise exception 'pièce inconnue' using errcode = 'P0002'; end if;
  if room = any(a.rooms) then raise exception 'pièce déjà débloquée' using errcode = 'P0001'; end if;
  select * into lux from public.apartment_room_luxury(room);
  if lux.price is not null then
    if not lux.requires = any(a.rooms) then
      raise exception 'débloque d''abord : %', (select r.name from public.apartment_room(lux.requires) r) using errcode = 'P0001';
    end if;
    cost := lux.price;
  else
    cost := public.apartment_room_cost((select count(*)::int from unnest(a.rooms) r
                                         where r <> 'entree' and (select l.price from public.apartment_room_luxury(r) l) is null));
  end if;
  if cost is null then raise exception 'pièce indisponible' using errcode = 'P0001'; end if;
  bal := public.points_spend(uid, cost, 'Appart : ' || info.name, 'appart');
  update public.apartments set rooms = a.rooms || room, updated_at = now() where user_id = uid;
  return jsonb_build_object('balance', bal, 'rooms', to_jsonb(a.rooms || room));
end $$;

create function public.apartment_special_buy(special text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  a public.apartments := public.apartment_settle(uid); -- les revenus d'avant restent à l'ancien taux
  sp record;
  bal bigint;
begin
  select * into sp from public.apartment_specials() s where s.id = special;
  if not found then raise exception 'équipement inconnu' using errcode = 'P0002'; end if;
  if not sp.room = any(a.rooms) then raise exception 'débloque d''abord la pièce' using errcode = 'P0001'; end if;
  if special = any(a.specials) then raise exception 'déjà installé' using errcode = 'P0001'; end if;
  bal := public.points_spend(uid, sp.cost, 'Appart : ' || sp.name, 'appart');
  update public.apartments set specials = a.specials || special, updated_at = now() where user_id = uid;
  return jsonb_build_object('balance', bal, 'specials', to_jsonb(a.specials || special));
end $$;

-- ---------------------------------------------------------------------------
-- Aménagement : comme 0020, avec la place des équipements spéciaux réservée
-- ---------------------------------------------------------------------------

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
  admin boolean := public.is_admin();
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
        select f.item_id, i.place, i.w, i.h, i.base, i.finish into it
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
        -- Colonnes renommées : x, y, w, h et room sont aussi des variables de la fonction.
        if zone = 'floor' and exists (select 1 from public.apartment_specials() s(sid, sroom, sname, scost, sx, sy, sw, sh)
                                        where sroom = room and x < sx + sw and sx < x + w and y < sy + sh and sy < y + h) then
          raise exception 'place réservée à l''équipement de la pièce' using errcode = '22023';
        end if;
        for dy in 0..h - 1 loop
          for dx in 0..w - 1 loop
            if grid[(y + dy) * cols + x + dx + 1] then raise exception 'deux meubles au même endroit' using errcode = '22023'; end if;
            grid[(y + dy) * cols + x + dx + 1] := true;
          end loop;
        end loop;
        entry := jsonb_build_object('o', oid, 'i', it.item_id, 'x', x, 'y', y);
        if r <> 0 then entry := entry || jsonb_build_object('r', r); end if;
        if (it.base = 'frame' or it.finish = 'perso') and e ? 'art' and jsonb_typeof(e -> 'art') = 'number' then
          art := (e ->> 'art')::bigint;
          if not exists (select 1 from public.artworks where id = art) then raise exception 'photo inconnue' using errcode = 'P0002'; end if;
          if not admin and not exists (select 1 from public.artwork_owned where user_id = uid and artwork_id = art) then
            raise exception 'photo pas encore débloquée (caisse souvenirs)' using errcode = 'P0001';
          end if;
          entry := entry || jsonb_build_object('art', art);
        end if;
        one := jsonb_set(one, array[zone], (one -> zone) || jsonb_build_array(entry));
      end loop;
    end loop;
    clean := clean || jsonb_build_object(room, one);
  end loop;
  update public.apartments set layout = clean, updated_at = now() where user_id = uid; -- rate : déclencheur
  return clean;
end $$;

-- ---------------------------------------------------------------------------
-- Nouvelles portes : décroche ce qui est à leur place (comme 0014), puis recalcule les revenus.
-- ---------------------------------------------------------------------------

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
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------

revoke execute on function public.apartment_room_luxury(text), public.apartment_specials(), public.apartment_mult(text[]),
  public.apartment_cap_hours(text[]), public.apartment_special_buy(text) from public, anon, authenticated;
grant execute on function public.apartment_special_buy(text) to authenticated;
