-- Suspension de compte par un admin (temporaire ou sans fin), et levée de la suspension.
-- * Le compte suspendu ne peut plus se connecter ni prolonger sa session (auth.users.banned_until,
--   sessions supprimées) : au plus tard à l'expiration de son jeton (1 h), il est dehors.
-- * Sans attendre : chaque requête de l'API passe par public.request_check (pgrst.db_pre_request),
--   qui refuse tout au compte suspendu, sauf public.account_status (le site y lit la raison à afficher).
-- * Jamais un admin ni soi-même. Chaque suspension et levée est notée dans le journal des admins.
-- À exécuter une fois, après 0037_securite.sql.

set client_encoding = 'UTF8';

create table public.suspensions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  until timestamptz, -- null : sans fin, jusqu'à ce qu'un admin la lève
  reason text,
  admin_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.suspensions enable row level security;
create policy "sa suspension, ou toutes pour un admin" on public.suspensions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
revoke all on public.suspensions from anon, authenticated;
grant select on public.suspensions to authenticated;

-- Le compte est-il suspendu en ce moment ? (Une suspension temporaire expire d'elle-même.)
create function public.is_suspended(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid is not null and exists (select 1 from public.suspensions s where s.user_id = uid and (s.until is null or s.until > now()))
$$;

-- Appelée par PostgREST avant chaque requête (voir plus bas) : un compte suspendu n'a plus accès à rien.
create function public.request_check() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.is_suspended(auth.uid()) and coalesce(current_setting('request.path', true), '') <> '/rpc/account_status' then
    raise exception 'compte suspendu' using errcode = '42501', hint = 'suspendu';
  end if;
end $$;

-- Pour le site : suspendu ou non, jusqu'à quand et pourquoi.
create function public.account_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('suspended', true, 'until', s.until, 'reason', s.reason)
       from public.suspensions s
      where s.user_id = auth.uid() and (s.until is null or s.until > now())),
    '{"suspended": false}'::jsonb)
$$;

-- hours : durée en heures (null ou 0 : sans fin). Une nouvelle suspension remplace la précédente.
create function public.admin_suspend(target uuid, hours int, reason text) returns void
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
  insert into public.suspensions (user_id, until, reason, admin_id)
  values (target, ends, nullif(btrim(left(reason, 200)), ''), me)
  on conflict (user_id) do update set until = excluded.until, reason = excluded.reason, admin_id = excluded.admin_id, created_at = now();
  -- Plus de connexion ni de jeton renouvelé jusqu'à la fin de la suspension.
  update auth.users set banned_until = coalesce(ends, now() + interval '100 years') where id = target;
  delete from auth.sessions where user_id = target;
  perform public.admin_note('suspend', target,
    name || ' · ' || case when ends is null then 'sans fin' else hours || ' h' end || coalesce(' · ' || nullif(btrim(reason), ''), ''));
end $$;

create function public.admin_unsuspend(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  name text;
begin
  perform public.admin_check();
  delete from public.suspensions where user_id = target;
  if not found then raise exception 'ce joueur n’est pas suspendu' using errcode = 'P0001'; end if;
  update auth.users set banned_until = null where id = target;
  select username into name from public.profiles where id = target;
  perform public.admin_note('unsuspend', target, name);
end $$;

revoke execute on function public.is_suspended(uuid), public.request_check(), public.account_status(),
  public.admin_suspend(uuid, int, text), public.admin_unsuspend(uuid) from public, anon, authenticated;
grant execute on function public.request_check() to anon, authenticated;
grant execute on function public.account_status(), public.admin_suspend(uuid, int, text), public.admin_unsuspend(uuid) to authenticated;

-- Branche le contrôle sur l'API. Sans le droit de modifier le rôle authenticator, on continue :
-- la suspension s'applique quand même à l'expiration du jeton du joueur (1 h au plus).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_pre_request = 'public.request_check';
    notify pgrst, 'reload config';
  end if;
exception when insufficient_privilege then
  raise notice 'pgrst.db_pre_request non installé : suspension effective à l’expiration du jeton';
end $$;
