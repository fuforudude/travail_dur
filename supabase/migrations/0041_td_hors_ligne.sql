-- Tower defense : parties enregistrées même quand le serveur est lent ou injoignable.
--
-- Le site ne dépend plus d'une réponse du serveur pour jouer : il lance chaque partie sur un ticket
-- réservé d'avance et garde dans le navigateur le démarrage et les vagues jusqu'à leur
-- enregistrement (fonction `td`, opérations `reserve` et `sync`).
--
-- * Ticket : ligne `td_sessions` réservée d'avance (graine tirée par le serveur, `state` et `mode`
--   vides). Elle n'apparaît nulle part (classements, progression) tant qu'elle n'a pas démarré.
-- * `ticks_total` : durée de jeu cumulée (en ticks de 100 ms) des vagues reçues. La règle « vague
--   jouée trop vite » compare cette durée au temps écoulé depuis le début de la partie, et plus à
--   l'envoi précédent : des vagues envoyées par lot ou après une coupure ne sont plus refusées.
-- * `td_rejects` : refus définitifs du serveur (partie inconnue, action invalide…), pour comprendre
--   les parties perdues. Lisible seulement depuis le tableau de bord Supabase.

set client_encoding = 'UTF8';

alter table public.td_sessions add column ticks_total int not null default 0;

create index td_sessions_ticket on public.td_sessions (user_id, started_at) where rules = 3 and state is null;

create table public.td_rejects (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid references public.profiles (id) on delete cascade,
  session uuid,
  step int,
  error text not null
);
create index td_rejects_at on public.td_rejects (at desc);
alter table public.td_rejects enable row level security;
revoke all on public.td_rejects from anon, authenticated;
