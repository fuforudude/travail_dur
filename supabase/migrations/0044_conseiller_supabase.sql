-- Corrections signalées par les conseillers de Supabase (Advisors → Performance et Security).
--
-- 1. Règles RLS : auth.uid(), is_admin() et apartment_allowed() étaient réévalués pour chaque ligne
--    lue. Entourés d'un « (select …) », Postgres ne les calcule qu'une fois par requête. Le sens des
--    règles ne change pas.
-- 2. Vues furniture_items et leaderboard_wordle : elles s'exécutaient avec les droits de leur
--    créateur, donc sans RLS. Elles passent en security_invoker comme les autres classements.
-- 3. Temps réel : friendships n'est écoutée par aucune page, on la retire de la publication (moins
--    de changements à décoder par realtime.list_changes, la requête la plus coûteuse de la base).

-- --- 1. Règles RLS ---------------------------------------------------------------------------

alter policy "chacun sait s'il est admin" on public.admins using (user_id = (select auth.uid()));
alter policy "journal réservé aux admins" on public.admin_log using ((select public.is_admin()));
alter policy "appartements : soi et ses amis" on public.apartments
  using ((select public.apartment_allowed())
         and (user_id = (select auth.uid()) or (select public.is_admin()) or public.are_friends((select auth.uid()), user_id)));
alter policy "ses photos" on public.artwork_owned using (user_id = (select auth.uid()) or (select public.is_admin()));
alter policy "photos visibles" on public.artworks using ((select public.apartment_allowed()));
alter policy "chances des caisses" on public.crate_odds using ((select public.apartment_allowed()));
alter policy "ses ouvertures" on public.crate_openings using (user_id = (select auth.uid()) or (select public.is_admin()));
alter policy "caisses" on public.crates using ((select public.apartment_allowed()));
alter policy "sa propre malédiction" on public.curses using (user_id = (select auth.uid()));
alter policy "parties terminées lisibles, les siennes aussi" on public.flappy_sessions
  using (finished_at is not null or user_id = (select auth.uid()));
alter policy "ses amitiés" on public.friendships using ((select auth.uid()) = a or (select auth.uid()) = b);
alter policy "catalogue des meubles" on public.furniture_bases using ((select public.apartment_allowed()));
alter policy "finitions" on public.furniture_finishes using ((select public.apartment_allowed()));
alter policy "ses meubles" on public.furniture_owned using (user_id = (select auth.uid()) or (select public.is_admin()));
alter policy "parties terminées lisibles, les siennes aussi" on public.g2048_sessions
  using (finished_at is not null or user_id = (select auth.uid()));
alter policy "son inventaire" on public.inventory using (user_id = (select auth.uid()));
alter policy "ses notifications" on public.notifications using (user_id = (select auth.uid()));
alter policy "son propre historique" on public.point_events using (user_id = (select auth.uid()));
alter policy "chacun modifie son profil" on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "ses skins td" on public.td_equipped using (user_id = (select auth.uid()));
alter policy "ses héros td" on public.td_heroes using (user_id = (select auth.uid()));
alter policy "sa collection td" on public.td_items using (user_id = (select auth.uid()));
alter policy "ses améliorations td" on public.td_perks using (user_id = (select auth.uid()));
alter policy "parties terminées lisibles, les siennes aussi" on public.tetris_sessions
  using (finished_at is not null or user_id = (select auth.uid()));
alter policy "ses propres parties" on public.wordle_games using (user_id = (select auth.uid()));

-- --- 2. Vues ---------------------------------------------------------------------------------

-- Le catalogue est lisible sous les mêmes conditions que ses deux tables (apartment_allowed).
alter view public.furniture_items set (security_invoker = true);

-- Chacun ne lit que ses propres parties de Wordle : le classement de tous passe donc par une
-- fonction security definer qui n'expose que les colonnes du classement (comme leaderboard_duel).
create function public.leaderboard_wordle_rows()
returns table (user_id uuid, username text, solved bigint, games bigint, average numeric)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username,
         count(*) filter (where w.solved),
         count(*),
         round(avg(array_length(w.guesses, 1)) filter (where w.solved), 2)
    from public.wordle_games w
    join public.profiles p on p.id = w.user_id
   where w.finished and p.verified and public.listed(p.id)
   group by p.id, p.username
$$;
revoke all on function public.leaderboard_wordle_rows() from public;
grant execute on function public.leaderboard_wordle_rows() to anon, authenticated;

alter view public.leaderboard_wordle set (security_invoker = true);
create or replace view public.leaderboard_wordle with (security_invoker = true) as
select * from public.leaderboard_wordle_rows();

-- --- 3. Temps réel ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships') then
    alter publication supabase_realtime drop table public.friendships;
  end if;
end $$;
