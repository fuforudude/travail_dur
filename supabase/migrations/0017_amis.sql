-- Amis et notifications.
--
-- * Amitiés : une demande (recherche par pseudo), acceptée ou refusée par l'autre. Rien ne s'écrit
--   directement dans les tables : tout passe par les fonctions ci-dessous, qui identifient le joueur.
-- * Appartements : on ne voit plus que le sien et ceux de ses amis (les admins voient tout).
-- * Notifications : demande d'ami, demande acceptée, invitation dans un salon. Reçues en direct.
-- À exécuter une fois, après 0016_appart_pour_tous.sql.

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- Amitiés
-- ---------------------------------------------------------------------------

-- Une ligne par paire (a < b), quel que soit celui qui a demandé.
create table public.friendships (
  a uuid not null references public.profiles (id) on delete cascade,
  b uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b),
  check (requested_by in (a, b))
);
create index friendships_b on public.friendships (b);
alter table public.friendships enable row level security;
create policy "ses amitiés" on public.friendships for select to authenticated using (auth.uid() in (a, b));
revoke all on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;

create function public.are_friends(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships where a = least(x, y) and b = greatest(x, y) and accepted)
$$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('friend_request', 'friend_accepted', 'room_invite')),
  from_id uuid references public.profiles (id) on delete cascade,
  room text check (room is null or room ~ '^[A-Z]{4}$'),
  game text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy "ses notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

create function public.notify(target uuid, k text, sender uuid, room_code text default null, game_id text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, from_id, room, game) values (target, k, sender, room_code, game_id)
$$;

-- ---------------------------------------------------------------------------
-- Fonctions des joueurs
-- ---------------------------------------------------------------------------

-- Recherche par pseudo (au moins 2 caractères) : 20 résultats, avec la relation actuelle.
create function public.friend_search(search text)
returns table (id uuid, username text, relation text)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if search is null or char_length(btrim(search)) < 2 then return; end if;
  return query
  select p.id, p.username,
         case
           when f.accepted then 'friend'
           when f.requested_by = uid then 'sent'
           when f.requested_by is not null then 'received'
           else 'none'
         end
    from public.profiles p
    left join public.friendships f on f.a = least(uid, p.id) and f.b = greatest(uid, p.id)
   where p.id <> uid and p.username ilike '%' || replace(replace(btrim(search), '%', ''), '_', '\_') || '%'
     and p.username !~ '^Joueur[0-9]{5}$'
   order by (lower(p.username) = lower(btrim(search))) desc, p.username
   limit 20;
end $$;

-- Demande d'ami. Si l'autre nous avait déjà demandé, c'est accepté directement.
create function public.friend_request(target uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  f public.friendships;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if target is null or target = uid then raise exception 'impossible' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = target) then raise exception 'joueur inconnu' using errcode = 'P0002'; end if;
  select * into f from public.friendships where a = least(uid, target) and b = greatest(uid, target) for update;
  if found then
    if f.accepted then return 'friend'; end if;
    if f.requested_by = uid then return 'sent'; end if;
    update public.friendships set accepted = true where a = f.a and b = f.b;
    perform public.notify(target, 'friend_accepted', uid);
    return 'friend';
  end if;
  if (select count(*) from public.friendships where requested_by = uid and not accepted) >= 30 then
    raise exception 'trop de demandes en attente' using errcode = 'P0001';
  end if;
  insert into public.friendships (a, b, requested_by) values (least(uid, target), greatest(uid, target), uid);
  perform public.notify(target, 'friend_request', uid);
  return 'sent';
end $$;

create function public.friend_respond(other uuid, accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  f public.friendships;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  select * into f from public.friendships where a = least(uid, other) and b = greatest(uid, other) for update;
  if not found or f.accepted or f.requested_by = uid then raise exception 'pas de demande à accepter' using errcode = 'P0002'; end if;
  if accept then
    update public.friendships set accepted = true where a = f.a and b = f.b;
    perform public.notify(other, 'friend_accepted', uid);
  else
    delete from public.friendships where a = f.a and b = f.b;
  end if;
  delete from public.notifications where user_id = uid and kind = 'friend_request' and from_id = other;
end $$;

-- Retirer un ami, ou annuler une demande envoyée.
create function public.friend_remove(other uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  delete from public.friendships where a = least(uid, other) and b = greatest(uid, other);
  delete from public.notifications where kind = 'friend_request' and user_id = other and from_id = uid;
end $$;

-- Liste de mes amis et demandes (pseudo compris).
create function public.friend_list()
returns table (id uuid, username text, status text, since timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  return query
  select p.id, p.username,
         case when f.accepted then 'friend' when f.requested_by = uid then 'sent' else 'received' end,
         f.created_at
    from public.friendships f
    join public.profiles p on p.id = case when f.a = uid then f.b else f.a end
   where uid in (f.a, f.b)
   order by f.accepted desc, p.username;
end $$;

-- Invitation d'un ami dans un salon (au plus 6 par minute).
create function public.room_invite(friend uuid, room_code text, game_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if room_code is null or room_code !~ '^[A-Z]{4}$' then raise exception 'salon invalide' using errcode = '22023'; end if;
  if not public.are_friends(uid, friend) then raise exception 'vous n''êtes pas amis' using errcode = 'P0001'; end if;
  if (select count(*) from public.notifications where from_id = uid and kind = 'room_invite' and created_at > now() - interval '1 minute') >= 6 then
    raise exception 'doucement : trop d''invitations d''un coup' using errcode = 'P0001';
  end if;
  -- Une seule invitation en cours de la même personne : la nouvelle remplace l'ancienne,
  -- mais pas plus d'une toutes les 10 secondes (sinon on pourrait bombarder un ami).
  if exists (select 1 from public.notifications where user_id = friend and from_id = uid and kind = 'room_invite'
             and created_at > now() - interval '10 seconds') then
    raise exception 'doucement : invitation déjà envoyée' using errcode = 'P0001';
  end if;
  delete from public.notifications where user_id = friend and from_id = uid and kind = 'room_invite';
  perform public.notify(friend, 'room_invite', uid, room_code, game_id);
end $$;

create function public.notifications_read(ids bigint[]) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read = true where user_id = auth.uid() and (ids is null or id = any(ids))
$$;

-- ---------------------------------------------------------------------------
-- Appartements : le sien, ceux de ses amis (et tout pour un admin)
-- ---------------------------------------------------------------------------

drop policy "appartements visibles" on public.apartments;
create policy "appartements : soi et ses amis" on public.apartments for select to authenticated
  using (public.apartment_allowed() and (user_id = auth.uid() or public.is_admin() or public.are_friends(auth.uid(), user_id)));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.friendships;
  end if;
end $$;

revoke execute on function public.are_friends(uuid, uuid), public.notify(uuid, text, uuid, text, text),
  public.friend_search(text), public.friend_request(uuid), public.friend_respond(uuid, boolean), public.friend_remove(uuid),
  public.friend_list(), public.room_invite(uuid, text, text), public.notifications_read(bigint[])
  from public, anon, authenticated;
grant execute on function public.friend_search(text), public.friend_request(uuid), public.friend_respond(uuid, boolean),
  public.friend_remove(uuid), public.friend_list(), public.room_invite(uuid, text, text), public.notifications_read(bigint[])
  to authenticated;
-- Utilisée par la règle d'accès aux appartements.
grant execute on function public.are_friends(uuid, uuid) to authenticated;
