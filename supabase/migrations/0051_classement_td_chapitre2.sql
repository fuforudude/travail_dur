-- Classement du tower defense : la colonne level compte aussi le chapitre 2 (0040_chapitre2.sql).
-- level = avancement dans l'histoire, de 0 à 70 : niveaux 1 à 20 du chapitre 1, puis 21 à 70 pour
-- les niveaux 26 à 75 du chapitre 2 (débloqué après le niveau 20, joué dans l'ordre). Les défis
-- bonus (21 à 25) n'en font pas partie. Même règle que storyRank dans src/ui/scores.ts.
-- Le reste de la vue ne change pas.
-- À exécuter une fois (appliquée automatiquement par le workflow Supabase).

set client_encoding = 'UTF8';

create or replace view public.leaderboard_td with (security_invoker = true) as
select p.id as user_id, p.username,
       coalesce(max(s.wave) filter (where s.mode = 'infinite'), 0) as best,
       coalesce(max(s.kills) filter (where s.mode = 'infinite'), 0) as kills,
       count(*) as games,
       coalesce(max(case when s.level <= 20 then s.level when s.level between 26 and 75 then s.level - 5 end)
                  filter (where s.mode = 'campaign' and s.won), 0) as level,
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
