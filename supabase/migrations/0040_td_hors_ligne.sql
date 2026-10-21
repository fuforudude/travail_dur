-- Tower defense : parties jouées hors ligne, envoyées au retour du réseau.
--
-- * `ticks_total` : durée de jeu cumulée (en ticks de 100 ms) des vagues reçues. La règle « vague
--   jouée trop vite » compare désormais cette durée au temps écoulé depuis le début de la partie,
--   et plus à l'envoi précédent : des vagues gardées dans le navigateur pendant une coupure
--   peuvent arriver l'une après l'autre sans être refusées.
-- * Ticket : une ligne `td_sessions` réservée d'avance (graine tirée par le serveur, `state` vide,
--   `mode` vide). Le site s'en sert pour lancer une partie quand le serveur est injoignable ; la
--   fonction `td` la démarre ensuite avec les réglages utilisés par le site. Un seul ticket libre
--   par joueur (la fonction `td` rend le même tant qu'il n'a pas servi).

set client_encoding = 'UTF8';

alter table public.td_sessions add column ticks_total int not null default 0;

create index td_sessions_ticket on public.td_sessions (user_id) where rules = 3 and state is null;
