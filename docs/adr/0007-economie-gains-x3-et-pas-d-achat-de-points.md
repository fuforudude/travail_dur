# 0007. Économie : gains multipliés par 3, et pas d'achat de points contre de l'argent réel

Date : 2026-10-21 (gains ×3, `0034_gains.sql`) ; consignée après coup
Statut : acceptée

## Contexte
Les points se gagnent en jouant et se dépensent au casino (roulette, machine à sous), dans la boutique, dans les caisses et dans l'appartement. L'audit (`AUDIT.md`, P3) examine la monétisation future : vendre des points qui se misent au casino ou dans des caisses reviendrait à vendre des loot boxes payantes, interdit de fait en Belgique et surveillé par l'ANJ en France.

## Décision
- Tous les gains de jeu et de record sont multipliés par 3, à un seul endroit : `points_gain_mult()` et `points_add` dans `supabase/migrations/0034_gains.sql`. Casino, boutique, caisses et revenus de l'appartement ne sont pas touchés ; chaque partie terminée rapporte en plus 30 points, dans la limite de 40 par jour (commentaire de la migration).
- Il n'existe pas d'achat de points contre de l'argent, et il n'y en aura pas dans cette économie : `AUDIT.md` le note (« Pas d'achat direct de points », section des pistes de revenu) pour la raison légale du P3. L'audit ajoute que les points sont de toute façon trop abondants (gains ×3, revenus de l'appartement ×4) pour valoir de l'argent.
- Si une monnaie payante est un jour ajoutée, elle sera séparée : elle ne servirait ni au casino ni aux caisses (`AUDIT.md`, P3, « Monnaie premium séparée »).

## Options écartées
- Vendre des points jouables au casino ou dans les caisses : légalement risqué, voir contexte.

## Conséquences
- Une économie gratuite, sans enjeu légal d'argent réel ; le serveur reste seul maître des gains (ADR 0002).
- Inflation assumée des points : la boutique monte jusqu'au milliard (`0043_grande_echelle.sql`).
- Le multiplicateur se change en une seule fonction SQL, mais les affichages du site doivent suivre : la règle est dupliquée TS / SQL et doit rester identique des deux côtés (`CLAUDE.md`).
- Avant toute monétisation : traiter les points P3 et P4 de l'audit (statut, CGU, mineurs, paiement).
- Pourquoi le facteur 3 précisément : raison non consignée ; seul le commentaire de la migration décrit le changement.
