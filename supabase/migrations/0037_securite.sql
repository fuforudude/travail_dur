-- Sécurité (AUDIT.md, P0) :
-- * Discussions des salons : jusqu'ici, tout joueur connecté pouvait lire toutes les discussions
--   (politique « using (true) »). Désormais, seuls les membres d'un salon lisent ses messages ; on
--   devient membre en ouvrant la discussion (room_join, limité pour qu'on ne puisse pas deviner les
--   codes à la chaîne) ou en y écrivant.
-- * Suppression de compte par le joueur lui-même (RGPD) : account_delete efface le compte et, en
--   cascade, tout ce qui s'y rattache (profil, scores, points, appart, amis…).
-- À exécuter une fois, après 0005_chat.sql (indépendante des autres migrations).

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- Discussions des salons
-- ---------------------------------------------------------------------------

create table public.room_members (
  room text not null check (room ~ '^[A-Z]{4}$'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room, user_id)
);
create index room_members_user on public.room_members (user_id, joined_at desc);
alter table public.room_members enable row level security;
create policy "ses salons" on public.room_members for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.room_members from anon, authenticated;
grant select on public.room_members to authenticated;

drop policy "messages lisibles" on public.room_messages;
create policy "messages des salons rejoints" on public.room_messages for select to authenticated
  using (exists (select 1 from public.room_members m where m.room = room_messages.room and m.user_id = (select auth.uid())));

-- Rejoindre la discussion d'un salon (à l'ouverture du salon). 20 salons différents par heure au plus.
create function public.room_join(room_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if room_code is null or room_code !~ '^[A-Z]{4}$' then raise exception 'salon invalide' using errcode = '22023'; end if;
  if exists (select 1 from public.room_members where room = room_code and user_id = uid) then
    update public.room_members set joined_at = now() where room = room_code and user_id = uid;
    return;
  end if;
  if (select count(*) from public.room_members where user_id = uid and joined_at > now() - interval '1 hour') >= 20 then
    raise exception 'trop de salons rejoints : réessaie dans un moment' using errcode = 'P0001';
  end if;
  insert into public.room_members (room, user_id) values (room_code, uid);
  -- Ménage : on oublie les salons de plus d'un jour (comme leurs messages).
  delete from public.room_members where user_id = uid and joined_at < now() - interval '1 day';
end $$;

-- Écrire dans un salon en fait aussi membre (même code qu'avant, plus l'adhésion).
create or replace function public.room_say(room_code text, message text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  txt text := btrim(regexp_replace(coalesce(message, ''), '[[:cntrl:]]', ' ', 'g'));
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if room_code is null or room_code !~ '^[A-Z]{4}$' then raise exception 'salon invalide' using errcode = '22023'; end if;
  if char_length(txt) = 0 then return; end if;
  if char_length(txt) > 300 then raise exception 'message trop long (300 caractères max)' using errcode = '22023'; end if;
  if (select count(*) from public.room_messages where sender = uid and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'doucement : trop de messages d’un coup' using errcode = 'P0001';
  end if;
  insert into public.room_members (room, user_id) values (room_code, uid)
  on conflict (room, user_id) do update set joined_at = now();
  insert into public.room_messages (room, sender, body) values (room_code, uid, txt);
  -- Ménage : la discussion d'un salon n'est gardée qu'une journée.
  delete from public.room_messages where room = room_code and created_at < now() - interval '1 day';
end $$;

-- ---------------------------------------------------------------------------
-- Suppression de son propre compte
-- ---------------------------------------------------------------------------

-- `confirm` doit être le pseudo du joueur (protection contre un clic malheureux). Un admin doit
-- d'abord être retiré des admins (on ne veut pas perdre le dernier accès à l'administration).
create function public.account_delete(confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  name text;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if exists (select 1 from public.admins where user_id = uid) then
    raise exception 'un admin ne peut pas supprimer son compte : retire-toi d’abord des admins' using errcode = 'P0001';
  end if;
  select username into name from public.profiles where id = uid;
  if name is null or confirm is distinct from name then
    raise exception 'tape exactement ton pseudo pour confirmer' using errcode = '22023';
  end if;
  -- Supprimer le compte efface en cascade le profil et tout ce qui s'y rattache.
  delete from auth.users where id = uid;
  delete from public.profiles where id = uid;
end $$;

revoke execute on function public.room_join(text), public.account_delete(text) from public, anon;
grant execute on function public.room_join(text), public.room_say(text, text), public.account_delete(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Fonctions qui n'ont plus à être appelables par les joueurs
-- ---------------------------------------------------------------------------

-- L'ancien tower defense tout en SQL (0003) : remplacé par la fonction serveur `td`, il créait encore
-- des parties à l'ancien format (rules = 1) et rapportait des points en contournant le nouveau jeu.
revoke execute on function public.td_start(), public.td_wave(uuid, text) from public, anon, authenticated;
-- Simple constante, utilisée par les autres fonctions du serveur.
revoke execute on function public.points_gain_mult() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Temps réel : la table des apparences n'est plus diffusée (le site la relit à la demande)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cosmetics') then
    alter publication supabase_realtime drop table public.cosmetics;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Double authentification des admins
-- ---------------------------------------------------------------------------

-- Les actions d'admin exigent une session validée par un code (TOTP, niveau « aal2 ») : un lien de
-- connexion volé ne suffit plus. La page Administration propose d'activer la double authentification
-- (QR code à scanner), puis demande le code à chaque nouvelle session.
create or replace function public.admin_check() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'réservé aux admins' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'double authentification requise : entre ton code sur la page Administration' using errcode = '42501';
  end if;
  return auth.uid();
end $$;
