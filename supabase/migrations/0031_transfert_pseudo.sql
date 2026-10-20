-- Transfert du pseudo quand on retrouve son compte depuis un compte invité.
--
-- Avant d'envoyer le lien de connexion (« Retrouver mon compte »), le compte invité demande un
-- code à usage unique (name_transfer_code), gardé dans le navigateur. Une fois connecté au compte
-- retrouvé, si celui-ci n'a encore que le pseudo par défaut (JoueurNNNNN), il présente le code
-- (name_transfer_claim) : le pseudo choisi sur le compte invité lui revient, et le compte invité,
-- abandonné, reçoit un pseudo par défaut. Seul le navigateur du compte invité connaît le code.
-- À exécuter une fois, après 0030_td_roguelike.sql.

set client_encoding = 'UTF8';

create table public.name_transfers (
  code text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.name_transfers enable row level security;
revoke all on public.name_transfers from anon, authenticated;

create function public.name_transfer_code() returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  if not coalesce((select is_anonymous from auth.users where id = uid), false) then return null; end if;
  delete from public.name_transfers where user_id = uid or created_at < now() - interval '1 day';
  insert into public.name_transfers (code, user_id) values (c, uid);
  return c;
end $$;

create function public.name_transfer_claim(transfer_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  src uuid;
  name text;
  mine text;
  tries int := 0;
begin
  if uid is null then raise exception 'non connecté' using errcode = '28000'; end if;
  delete from public.name_transfers
   where code = transfer_code and created_at > now() - interval '1 day'
  returning user_id into src;
  if src is null or src = uid then return null; end if;
  if not coalesce((select is_anonymous from auth.users where id = src), false) then return null; end if;
  select username into mine from public.profiles where id = uid;
  select username into name from public.profiles where id = src;
  if mine is null or mine !~ '^Joueur[0-9]{5}$' or name is null or name ~ '^Joueur[0-9]{5}$' then return null; end if;
  -- Le compte invité libère le pseudo (nouveau pseudo par défaut, en évitant les doublons).
  loop
    tries := tries + 1;
    begin
      update public.profiles set username = 'Joueur' || lpad(floor(random() * 100000)::int::text, 5, '0') where id = src;
      exit;
    exception when unique_violation then
      if tries >= 20 then raise; end if;
    end;
  end loop;
  update public.profiles set username = name where id = uid;
  return name;
end $$;

revoke execute on function public.name_transfer_code(), public.name_transfer_claim(text) from public, anon;
grant execute on function public.name_transfer_code(), public.name_transfer_claim(text) to authenticated;
