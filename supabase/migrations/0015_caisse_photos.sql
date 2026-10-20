-- Caisse souvenirs (photos à débloquer) et revenus de l'appart revus à la hausse.
--
-- * Photos : chacune doit maintenant être débloquée pour être accrochée dans un cadre (les admins
--   les ont toutes). On les obtient dans la caisse souvenirs : 5 % de chances d'une photo pas encore
--   obtenue, tirée au hasard parmi celles ajoutées par les admins ; sinon (95 %) un meuble, avec les
--   chances de la caisse classique. Plus aucune photo à débloquer : toujours un meuble.
-- * Revenus : chaque meuble posé rapporte son prix ÷ 5 par heure (au lieu de ÷ 10), toujours
--   multiplié selon la rareté ; chaque tâche de nettoyage, 50 par heure (au lieu de 20).
-- Doit rester identique à src/net/furniture.ts (CLEAN_RATE, itemIncome, PHOTO_CHANCE).
-- À exécuter une fois, après 0014_portes.sql.

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- Revenus
-- ---------------------------------------------------------------------------

create or replace function public.apartment_rate(layout jsonb, clean_step int) returns numeric
language sql stable set search_path = '' as $$
  select 50 * clean_step + coalesce((
    select sum(b.price / 5.0 * public.apartment_rarity_mult(f.rarity))
      from jsonb_each(layout) r,
           jsonb_array_elements(coalesce(r.value -> 'floor', '[]') || coalesce(r.value -> 'wall', '[]')) e
      join public.furniture_bases b on b.id = split_part(e ->> 'i', ':', 1)
      join public.furniture_finishes f on f.id = split_part(e ->> 'i', ':', 2)
     where jsonb_typeof(r.value) = 'object'
  ), 0)
$$;

-- ---------------------------------------------------------------------------
-- Photos débloquées
-- ---------------------------------------------------------------------------

create table public.artwork_owned (
  user_id uuid not null references public.profiles (id) on delete cascade,
  artwork_id bigint not null references public.artworks (id) on delete cascade,
  acquired_at timestamptz not null default now(),
  primary key (user_id, artwork_id)
);
alter table public.artwork_owned enable row level security;
create policy "ses photos" on public.artwork_owned for select to authenticated using (user_id = auth.uid() or public.is_admin());
revoke all on public.artwork_owned from anon, authenticated;
grant select on public.artwork_owned to authenticated;

-- Les revenus déjà accumulés restent acquis ; nouveau taux à partir de maintenant.
-- Les photos déjà accrochées sont débloquées pour leur propriétaire (rien ne disparaît).
do $$
declare
  a record;
begin
  for a in select user_id, layout from public.apartments loop
    perform public.apartment_settle(a.user_id);
    update public.apartments set rate = public.apartment_rate(layout, clean_step) where user_id = a.user_id;
    insert into public.artwork_owned (user_id, artwork_id)
    select distinct a.user_id, (e ->> 'art')::bigint
      from jsonb_each(a.layout) r, jsonb_array_elements(coalesce(r.value -> 'wall', '[]')) e
     where jsonb_typeof(r.value) = 'object' and e ? 'art'
       and exists (select 1 from public.artworks w where w.id = (e ->> 'art')::bigint)
    on conflict do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Caisse souvenirs
-- ---------------------------------------------------------------------------

insert into public.crates (id, price) values ('photos', 4000);
insert into public.crate_odds (crate_id, rarity, weight)
select 'photos', rarity, weight from public.crate_odds where crate_id = 'classic';

-- Comme avant, avec la caisse souvenirs : 50 chances sur 1 000 de débloquer une photo.
create or replace function public.crate_open(crate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  c public.crates;
  total int;
  r int;
  acc int := 0;
  o record;
  picked_rarity text;
  item text;
  bal bigint;
  oid bigint;
  photo public.artworks;
begin
  select * into c from public.crates where id = crate;
  if not found then raise exception 'caisse inconnue' using errcode = 'P0002'; end if;
  if (select count(*) from public.crate_openings where user_id = uid and opened_at > now() - interval '5 seconds') >= 3 then
    raise exception 'doucement : une caisse à la fois' using errcode = 'P0001';
  end if;
  bal := public.points_spend(uid, c.price, 'Caisse : ' || c.id, 'crate');
  if c.id = 'photos' and random() < 0.05 then
    select * into photo from public.artworks w
     where not exists (select 1 from public.artwork_owned x where x.user_id = uid and x.artwork_id = w.id)
     order by random() limit 1;
    if found then
      insert into public.artwork_owned (user_id, artwork_id) values (uid, photo.id);
      insert into public.crate_openings (user_id, crate_id, item_id) values (uid, c.id, 'photo:' || photo.id);
      return jsonb_build_object('balance', bal, 'photo', jsonb_build_object('id', photo.id, 'title', photo.title, 'url', photo.url), 'rarity', 'photo');
    end if;
  end if;
  select sum(weight) into total from public.crate_odds where crate_id = c.id;
  r := floor(random() * total)::int;
  for o in select rarity, weight from public.crate_odds where crate_id = c.id order by weight desc, rarity loop
    acc := acc + o.weight;
    if r < acc then picked_rarity := o.rarity; exit; end if;
  end loop;
  select i.id into item from public.furniture_items i where i.rarity = picked_rarity order by random() limit 1;
  insert into public.furniture_owned (user_id, item_id, source) values (uid, item, 'crate') returning id into oid;
  insert into public.crate_openings (user_id, crate_id, item_id) values (uid, c.id, item);
  return jsonb_build_object('balance', bal, 'owned', oid, 'item', item, 'rarity', picked_rarity);
end $$;

-- ---------------------------------------------------------------------------
-- Aménagement : comme 0014, mais un cadre n'affiche qu'une photo débloquée (toutes pour un admin).
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
  update public.apartments
     set layout = clean, rate = public.apartment_rate(clean, a.clean_step), updated_at = now()
   where user_id = uid;
  return clean;
end $$;
