-- Pas de revenus de l'appart pendant une suspension (0045_suspension.sql).
-- Les revenus s'accumulent hors du site (apartment_settle) : sans ce correctif, un joueur suspendu
-- retrouvait à son retour jusqu'à 24 h (72 h avec le coffre-fort) de revenus gagnés pendant sa suspension.
-- * apartment_settle retire du temps écoulé la période de suspension (de son début à sa fin, ou à
--   maintenant si elle dure encore).
-- * admin_suspend verse d'abord au joueur ce qu'il avait gagné avant d'être suspendu, et
--   admin_unsuspend arrête le compteur au moment de la levée (la ligne de suspension disparaît).
-- À exécuter une fois, après 0045_suspension.sql.

set client_encoding = 'UTF8';

create or replace function public.apartment_settle(uid uuid) returns public.apartments
language plpgsql security definer set search_path = '' as $$
declare
  a public.apartments;
  secs numeric;
  s public.suspensions;
begin
  insert into public.apartments (user_id) values (uid) on conflict do nothing;
  select * into a from public.apartments where user_id = uid for update;
  secs := extract(epoch from now() - a.last_tick);
  select * into s from public.suspensions where user_id = uid;
  if found then
    secs := secs - greatest(0, extract(epoch from least(coalesce(s.until, now()), now()) - greatest(s.created_at, a.last_tick)));
  end if;
  a.banked := least(a.banked + a.rate * greatest(secs, 0) / 3600,
                    greatest(a.rate, 1) * public.apartment_cap_hours(a.specials));
  a.last_tick := now();
  update public.apartments set banked = a.banked, last_tick = a.last_tick where user_id = uid;
  return a;
end $$;

create or replace function public.admin_suspend(target uuid, hours int, reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.admin_check();
  name text;
  ends timestamptz := case when coalesce(hours, 0) > 0 then now() + make_interval(hours => hours) end;
begin
  if hours < 0 then raise exception 'durée invalide' using errcode = '22023'; end if;
  if target = me then raise exception 'impossible de se suspendre soi-même' using errcode = 'P0001'; end if;
  if exists (select 1 from public.admins where user_id = target) then
    raise exception 'impossible de suspendre un admin' using errcode = 'P0001';
  end if;
  select username into name from public.profiles where id = target;
  if not found then raise exception 'joueur inconnu' using errcode = 'P0002'; end if;
  -- Ce qui a été gagné avant la suspension reste acquis ; le compteur repart d'ici.
  if exists (select 1 from public.apartments where user_id = target) then perform public.apartment_settle(target); end if;
  insert into public.suspensions (user_id, until, reason, admin_id)
  values (target, ends, nullif(btrim(left(reason, 200)), ''), me)
  on conflict (user_id) do update set until = excluded.until, reason = excluded.reason, admin_id = excluded.admin_id, created_at = now();
  -- Plus de connexion ni de jeton renouvelé jusqu'à la fin de la suspension.
  update auth.users set banned_until = coalesce(ends, now() + interval '100 years') where id = target;
  delete from auth.sessions where user_id = target;
  perform public.admin_note('suspend', target,
    name || ' · ' || case when ends is null then 'sans fin' else hours || ' h' end || coalesce(' · ' || nullif(btrim(reason), ''), ''));
end $$;

create or replace function public.admin_unsuspend(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  name text;
begin
  perform public.admin_check();
  if not exists (select 1 from public.suspensions where user_id = target) then
    raise exception 'ce joueur n’est pas suspendu' using errcode = 'P0001';
  end if;
  -- Arrête le compteur à la levée, tant que la suspension est encore connue (rien n'est versé pour elle).
  if exists (select 1 from public.apartments where user_id = target) then perform public.apartment_settle(target); end if;
  delete from public.suspensions where user_id = target;
  update auth.users set banned_until = null where id = target;
  select username into name from public.profiles where id = target;
  perform public.admin_note('unsuspend', target, name);
end $$;
