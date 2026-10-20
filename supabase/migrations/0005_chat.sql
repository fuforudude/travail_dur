-- Chat des salons.
--
-- Même principe que le reste : les clients lisent la table, et n'écrivent que par
-- public.room_say, qui identifie l'auteur avec auth.uid(). Un message ne peut donc pas
-- être envoyé au nom de quelqu'un d'autre.
-- À exécuter une fois, après 0004_td_wordle_flappy.sql.

set client_encoding = 'UTF8';

create table public.room_messages (
  id bigint generated always as identity primary key,
  room text not null check (room ~ '^[A-Z]{4}$'),
  sender uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index room_messages_room on public.room_messages (room, created_at desc);
create index room_messages_sender on public.room_messages (sender, created_at desc);

alter table public.room_messages enable row level security;
-- Le code du salon fait office de secret : quiconque le connaît voit la discussion.
create policy "messages lisibles" on public.room_messages for select to authenticated using (true);
revoke all on public.room_messages from anon, authenticated;
grant select on public.room_messages to authenticated;

create function public.room_say(room_code text, message text) returns void
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
  insert into public.room_messages (room, sender, body) values (room_code, uid, txt);
  -- Ménage : la discussion d'un salon n'est gardée qu'une journée.
  delete from public.room_messages where room = room_code and created_at < now() - interval '1 day';
end $$;

revoke execute on function public.room_say(text, text) from public, anon, authenticated;
grant execute on function public.room_say(text, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.room_messages;
  end if;
end $$;
