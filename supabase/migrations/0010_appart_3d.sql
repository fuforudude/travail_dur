-- Appartement en vue isométrique, nettoyage payant, revenus, et suppression de joueur par un admin.
--
-- * Pièce carrée : sol 8 × 8, deux murs du fond de 8 emplacements sur 2 hauteurs
--   (mur : x de 0 à 7 = mur de gauche, de 8 à 15 = mur de droite).
-- * L'appart est sale au départ : 6 tâches de nettoyage payantes, dans l'ordre. On ne peut meubler
--   qu'une fois tout nettoyé.
-- * Revenus : chaque tâche faite et chaque meuble posé rapportent des points par heure (davantage
--   selon la rareté). Ils s'accumulent jusqu'à 24 h, puis il faut venir les récolter.
-- Doit rester identique à src/net/apartment.ts (tâches, revenus).
-- À exécuter une fois, après 0009_appart_admin.sql.

set client_encoding = 'UTF8';

alter table public.point_events drop constraint point_events_kind_check;
alter table public.point_events add constraint point_events_kind_check
  check (kind in ('game', 'record', 'bonus', 'casino', 'shop', 'admin', 'crate', 'furniture', 'appart'));

alter table public.apartments
  add column clean_step int not null default 0,
  add column rate numeric not null default 0,     -- points par heure
  add column banked numeric not null default 0,   -- revenus accumulés pas encore récoltés
  add column last_tick timestamptz not null default now();

-- L'ancienne pièce (12 × 7) ne correspond plus : on repart d'une pièce vide.
update public.apartments set layout = '{"floor": [], "wall": []}';

-- ---------------------------------------------------------------------------
-- Barème
-- ---------------------------------------------------------------------------

-- Coût de la tâche de nettoyage n (0 à 5).
create function public.apartment_clean_cost(step int) returns bigint
language sql immutable set search_path = '' as $$
  select (array[300, 800, 1500, 3000, 6000, 10000])[step + 1]::bigint
$$;

create function public.apartment_rarity_mult(rarity text) returns numeric
language sql immutable set search_path = '' as $$
  select case rarity when 'common' then 1.5 when 'rare' then 2.5 when 'epic' then 4 when 'legendary' then 8 when 'mythic' then 20 else 1 end
$$;

-- Revenus par heure : 20 par tâche de nettoyage faite, et pour chaque meuble posé
-- prix standard ÷ 40 × multiplicateur de rareté (une chaise : 20/h, un trophée : 200/h, ×20 en Mythique).
create function public.apartment_rate(layout jsonb, clean_step int) returns numeric
language sql stable set search_path = '' as $$
  select 20 * clean_step + coalesce((
    select sum(b.price / 40.0 * public.apartment_rarity_mult(f.rarity))
      from jsonb_array_elements(coalesce(layout -> 'floor', '[]') || coalesce(layout -> 'wall', '[]')) e
      join public.furniture_bases b on b.id = split_part(e ->> 'i', ':', 1)
      join public.furniture_finishes f on f.id = split_part(e ->> 'i', ':', 2)
  ), 0)
$$;

-- Ajoute aux revenus accumulés ce qui a été gagné depuis le dernier calcul (plafond : 24 h de revenus).
create function public.apartment_settle(uid uuid) returns public.apartments
language plpgsql security definer set search_path = '' as $$
declare
  a public.apartments;
begin
  insert into public.apartments (user_id) values (uid) on conflict do nothing;
  select * into a from public.apartments where user_id = uid for update;
  a.banked := least(a.banked + a.rate * extract(epoch from now() - a.last_tick) / 3600, greatest(a.rate, 1) * 24);
  a.last_tick := now();
  update public.apartments set banked = a.banked, last_tick = a.last_tick where user_id = uid;
  return a;
end $$;

-- ---------------------------------------------------------------------------
-- Nettoyage, récolte, aménagement
-- ---------------------------------------------------------------------------

create function public.apartment_clean() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  a public.apartments := public.apartment_settle(uid);
  bal bigint;
begin
  if a.clean_step >= 6 then raise exception 'l''appart est déjà tout propre' using errcode = 'P0001'; end if;
  bal := public.points_spend(uid, public.apartment_clean_cost(a.clean_step), 'Appart : nettoyage ' || (a.clean_step + 1) || '/6', 'appart');
  update public.apartments
     set clean_step = a.clean_step + 1, rate = public.apartment_rate(a.layout, a.clean_step + 1), updated_at = now()
   where user_id = uid;
  return jsonb_build_object('balance', bal, 'clean_step', a.clean_step + 1);
end $$;

create function public.apartment_collect() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.apartment_check();
  a public.apartments := public.apartment_settle(uid);
  gain bigint := floor(a.banked);
begin
  if gain < 1 then return jsonb_build_object('gain', 0); end if;
  update public.apartments set banked = a.banked - gain where user_id = uid;
  perform public.points_add(uid, gain, 'Revenus de l''appart', 'appart');
  return jsonb_build_object('gain', gain);
end $$;

-- Même vérifications qu'avant, avec la nouvelle pièce, et seulement une fois l'appart nettoyé.
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
  x int; y int; dx int; dy int;
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
      if jsonb_typeof(e -> 'o') <> 'number' or jsonb_typeof(e -> 'x') <> 'number' or jsonb_typeof(e -> 'y') <> 'number' then
        raise exception 'aménagement invalide' using errcode = '22023';
      end if;
      oid := (e ->> 'o')::bigint;
      x := (e ->> 'x')::int;
      y := (e ->> 'y')::int;
      if oid = any(used) then raise exception 'meuble placé deux fois' using errcode = '22023'; end if;
      used := used || oid;
      select f.item_id, i.place, i.w, i.h, i.base into it
        from public.furniture_owned f join public.furniture_items i on i.id = f.item_id
       where f.id = oid and f.user_id = uid;
      if not found then raise exception 'meuble non possédé' using errcode = 'P0001'; end if;
      if it.place <> zone then raise exception 'ce meuble ne va pas là' using errcode = '22023'; end if;
      if x < 0 or y < 0 or x + it.w > cols or y + it.h > rows_ then raise exception 'meuble hors de la pièce' using errcode = '22023'; end if;
      for dy in 0..it.h - 1 loop
        for dx in 0..it.w - 1 loop
          if grid[(y + dy) * cols + x + dx + 1] then raise exception 'deux meubles au même endroit' using errcode = '22023'; end if;
          grid[(y + dy) * cols + x + dx + 1] := true;
        end loop;
      end loop;
      entry := jsonb_build_object('o', oid, 'i', it.item_id, 'x', x, 'y', y);
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

-- ---------------------------------------------------------------------------
-- Admin : supprimer un joueur (compte, scores, points, tout). Jamais un admin ni soi-même.
-- ---------------------------------------------------------------------------

create function public.admin_delete_player(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  name text;
begin
  perform public.admin_check();
  if target = auth.uid() then raise exception 'impossible de se supprimer soi-même' using errcode = 'P0001'; end if;
  if exists (select 1 from public.admins where user_id = target) then
    raise exception 'impossible de supprimer un admin' using errcode = 'P0001';
  end if;
  select username into name from public.profiles where id = target;
  if not found then raise exception 'joueur inconnu' using errcode = 'P0002'; end if;
  perform public.admin_note('delete', null, name || ' (' || target || ')');
  -- Supprimer le compte efface en cascade le profil et tout ce qui s'y rattache.
  delete from auth.users where id = target;
  delete from public.profiles where id = target;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.g2048_start(), public.g2048_finish(uuid, text),
  public.tetris_start(), public.tetris_finish(uuid, text),
  public.flappy_start(), public.flappy_finish(uuid, text),
  public.td_start(), public.td_wave(uuid, text),
  public.wordle_today(), public.wordle_guess(text),
  public.room_say(text, text),
  public.match_challenge(uuid, text, text), public.match_respond(uuid, boolean), public.match_play(uuid, int),
  public.match_move(uuid, text),
  public.match_forfeit(uuid), public.match_claim_timeout(uuid), public.match_rematch(uuid),
  public.points_wallet(), public.casino_roulette(jsonb), public.casino_slots(bigint),
  public.shop_buy(text), public.shop_equip(text, text),
  public.furniture_buy(text), public.crate_open(text), public.apartment_save(jsonb),
  public.apartment_clean(), public.apartment_collect(),
  public.admin_find_players(text), public.admin_points(uuid, bigint, text), public.admin_rename(uuid, text),
  public.admin_curse(uuid, boolean, int), public.admin_scare(uuid), public.admin_delete_player(uuid),
  public.admin_artwork_add(text, text, text), public.admin_artwork_delete(bigint), public.admin_give(uuid, text)
  to authenticated;
grant execute on function public.leaderboard_duel(text), public.listed(uuid) to anon, authenticated;
grant execute on function public.is_admin(), public.apartment_allowed() to authenticated;
