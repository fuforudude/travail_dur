-- Le strict nécessaire de Supabase pour rejouer les migrations dans PGlite (scripts/sql-test.mjs) :
-- les rôles des clients, auth.users et auth.uid() (lu dans le réglage request.jwt.claim.sub, comme
-- le fait PostgREST). Le stockage et le temps réel n'existent pas ici : les migrations les sautent.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- auth.jwt() : les revendications du jeton (dont « aal », le niveau d'authentification).
create function auth.jwt() returns jsonb
language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant execute on function auth.jwt() to anon, authenticated, service_role;
