-- Classement du tower defense : niveau atteint dans la campagne (et étoiles), en plus de la vague
-- maximale du mode infini. Les joueurs qui n'ont fait que la campagne y apparaissent aussi.
-- Colonnes ajoutées à la fin (create or replace view ne peut qu'en ajouter) :
--   level = plus haut niveau de la campagne réussi (1 à 20, sans les défis bonus),
--   stars = étoiles gagnées (meilleure partie de chaque niveau, défis bonus compris).
-- À exécuter une fois, après 0033_td_etoiles.sql.

set client_encoding = 'UTF8';

create or replace view public.leaderboard_td with (security_invoker = true) as
select p.id as user_id, p.username,
       coalesce(max(s.wave) filter (where s.mode = 'infinite'), 0) as best,
       coalesce(max(s.kills) filter (where s.mode = 'infinite'), 0) as kills,
       count(*) as games,
       coalesce(max(s.level) filter (where s.mode = 'campaign' and s.won and s.level <= 20), 0) as level,
       (select coalesce(sum(b.best), 0)::int from (
          select max(x.stars) as best from public.td_sessions x
           where x.user_id = p.id and x.rules = 3 and x.mode = 'campaign' and x.won
           group by x.level
        ) b) as stars
  from public.td_sessions s
  join public.profiles p on p.id = s.user_id
 where s.rules = 3 and p.verified and public.listed(p.id)
 group by p.id, p.username
having max(s.wave) filter (where s.mode = 'infinite') > 0
    or bool_or(s.mode = 'campaign' and s.won);
