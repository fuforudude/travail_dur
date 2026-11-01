-- Annonce des admins et heures de connexion des comptes (docs/specs/2026-10-31-annonce-connexions-pocharlume.md).
-- * announcement : une seule annonce, lue par tout le monde (même sans compte), écrite seulement par
--   admin_announce (admin avec double authentification). Texte vide : l'annonce est retirée.
-- * connections : une ligne par séance (arrivée, dernière activité). Le site appelle connection_ping à
--   l'ouverture puis toutes les 5 minutes ; au-delà de 15 minutes sans signe de vie, une nouvelle séance
--   commence. Personne ne lit la table directement : les admins passent par admin_connections et
--   admin_last_seen. Les séances de plus de 90 jours sont effacées.
-- À exécuter une fois (appliquée automatiquement par le workflow Supabase).

set client_encoding = 'UTF8';

-- --- Annonce -------------------------------------------------------------------
create table public.announcement (
  id smallint primary key default 1 check (id = 1),
  body text not null check (char_length(body) between 1 and 500),
  updated_at timestamptz not null default now(),
  admin_id uuid references public.profiles (id) on delete set null
);
alter table public.announcement enable row level security;
create policy "annonce lue par tous" on public.announcement for select to anon, authenticated using (true);
revoke all on public.announcement from anon, authenticated;
grant select (body, updated_at) on public.announcement to anon, authenticated;

create function public.admin_announce(body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.admin_check();
  text_ text := btrim(coalesce(body, ''), E' \t\r\n');
begin
  if char_length(text_) > 500 then raise exception 'annonce trop longue (500 caractères au plus)' using errcode = '22023'; end if;
  if text_ = '' then
    delete from public.announcement where id = 1;
    perform public.admin_note('announce', null, 'annonce retirée');
  else
    insert into public.announcement (id, body, updated_at, admin_id) values (1, text_, now(), me)
    on conflict (id) do update set body = excluded.body, updated_at = excluded.updated_at, admin_id = excluded.admin_id;
    perform public.admin_note('announce', null, text_);
  end if;
end $$;

-- --- Connexions ----------------------------------------------------------------
create table public.connections (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create index connections_user_last on public.connections (user_id, last_at desc);
create index connections_last on public.connections (last_at); -- purge des vieilles séances
alter table public.connections enable row level security; -- aucune règle : personne ne lit la table directement
revoke all on public.connections from anon, authenticated;

-- Signe de vie du site : prolonge la séance en cours, ou en commence une nouvelle.
create function public.connection_ping() returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cur bigint;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  select id into cur from public.connections
   where user_id = uid and last_at > now() - interval '15 minutes'
   order by last_at desc limit 1;
  if cur is null then
    insert into public.connections (user_id) values (uid);
    -- Purge de toutes les séances de plus de 90 jours, aussi celles des comptes qui ne reviennent pas.
    delete from public.connections where last_at < now() - interval '90 days';
  else
    update public.connections set last_at = now() where id = cur;
  end if;
end $$;

-- Pour la page Administration : les 30 dernières séances d'un compte…
create function public.admin_connections(target uuid)
returns table (started_at timestamptz, last_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_check();
  return query
    select c.started_at, c.last_at from public.connections c
     where c.user_id = target order by c.last_at desc limit 30;
end $$;

-- … et la dernière activité de plusieurs comptes (liste des joueurs).
create function public.admin_last_seen(ids uuid[])
returns table (user_id uuid, last_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_check();
  return query
    select c.user_id, max(c.last_at) from public.connections c
     where c.user_id = any (ids) group by c.user_id;
end $$;

revoke execute on function public.admin_announce(text), public.connection_ping(), public.admin_connections(uuid), public.admin_last_seen(uuid[])
  from public, anon;
grant execute on function public.admin_announce(text), public.connection_ping(), public.admin_connections(uuid), public.admin_last_seen(uuid[])
  to authenticated;
