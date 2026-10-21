// Portefeuille de points. Tant que le domaine des points n'est pas passé sur l'API, débits et crédits
// passent par les mêmes fonctions SQL que le reste du site (points_spend, points_add) : une seule
// façon de toucher au solde. À appeler dans une transaction (Db.tx).

import type { Db } from '../db';

export class WalletRepo {
  constructor(private readonly db: Db) {}

  /** Débite `amount` (erreur « pas assez de points » sinon) et renvoie le nouveau solde. */
  async spend(uid: string, amount: number, reason: string, kind: string): Promise<number> {
    const [r] = await this.db.query<{ bal: number }>('select public.points_spend($1, $2, $3, $4) as bal', [uid, amount, reason, kind]);
    return Number(r.bal);
  }

  /** Crédite `amount` (multiplié par points_gain_mult pour les gains de jeu, comme partout). */
  async add(uid: string, amount: number, reason: string, kind: string): Promise<void> {
    await this.db.query('select public.points_add($1, $2, $3, $4)', [uid, amount, reason, kind]);
  }

  /** Crédite sans multiplicateur et regroupe dans une seule ligne d'historique par heure (revenus de l'appart). */
  async addGroupedHourly(uid: string, amount: number, reason: string, kind: string): Promise<void> {
    await this.db.query('select public.points_open($1)', [uid]);
    await this.db.query('update public.wallets set balance = balance + $2, earned = earned + $2, updated_at = now() where user_id = $1', [uid, amount]);
    const [ev] = await this.db.query<{ id: number }>(
      `select id from public.point_events
        where user_id = $1 and kind = $2 and reason = $3 and created_at > now() - interval '1 hour'
        order by id desc limit 1`,
      [uid, kind, reason],
    );
    if (ev) await this.db.query('update public.point_events set amount = amount + $2 where id = $1', [ev.id, amount]);
    else await this.db.query('insert into public.point_events (user_id, amount, reason, kind) values ($1, $2, $3, $4)', [uid, amount, reason, kind]);
  }

  async balance(uid: string): Promise<number> {
    const [r] = await this.db.query<{ balance: number }>('select balance from public.wallets where user_id = $1', [uid]);
    return Number(r?.balance ?? 0);
  }
}
