// Appart : lectures et écritures en base, sans aucune règle (elles sont dans appart.service.ts).

import type { Layout } from '../../../shared/furniture';
import type { Db } from '../db';

export interface ApartmentRow {
  layout: Layout;
  rooms: string[];
  specials: string[];
  clean_step: number;
  rate: number;
  banked: number;
  last_tick: Date;
}

export interface OwnedRow {
  id: number;
  item_id: string;
}

const COLUMNS = 'layout, rooms, specials, clean_step, rate, banked, last_tick';

export class AppartRepo {
  constructor(private readonly db: Db) {}

  /** L'appart de `uid`, ou null s'il n'a jamais été ouvert. */
  async find(uid: string): Promise<ApartmentRow | null> {
    const [a] = await this.db.query<ApartmentRow>(`select ${COLUMNS} from public.apartments where user_id = $1`, [uid]);
    return a ?? null;
  }

  /** L'appart de `uid` (créé au besoin), verrouillé jusqu'à la fin de la transaction, et l'heure de la base. */
  async lock(uid: string): Promise<{ a: ApartmentRow; now: Date }> {
    await this.db.query('insert into public.apartments (user_id) values ($1) on conflict do nothing', [uid]);
    const [r] = await this.db.query<ApartmentRow & { now: Date }>(`select ${COLUMNS}, now() as now from public.apartments where user_id = $1 for update`, [uid]);
    const { now, ...a } = r;
    return { a, now };
  }

  async update(uid: string, fields: Partial<ApartmentRow>): Promise<void> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (!entries.length) return;
    const set = entries.map(([k], i) => `${k} = $${i + 2}${k === 'layout' ? '::jsonb' : ''}`).join(', ');
    const values = entries.map(([k, v]) => (k === 'layout' ? JSON.stringify(v) : v));
    await this.db.query(`update public.apartments set ${set}, updated_at = now() where user_id = $1`, [uid, ...values]);
  }

  async furniture(uid: string): Promise<OwnedRow[]> {
    return this.db.query<OwnedRow>('select id, item_id from public.furniture_owned where user_id = $1 order by id', [uid]);
  }

  /** Un meuble de `uid`, verrouillé (vente). */
  async lockFurniture(uid: string, id: number): Promise<OwnedRow | null> {
    const [f] = await this.db.query<OwnedRow>('select id, item_id from public.furniture_owned where id = $1 and user_id = $2 for update', [id, uid]);
    return f ?? null;
  }

  async addFurniture(uid: string, item: string, source: string): Promise<number> {
    const [r] = await this.db.query<{ id: number }>('insert into public.furniture_owned (user_id, item_id, source) values ($1, $2, $3) returning id', [uid, item, source]);
    return Number(r.id);
  }

  async deleteFurniture(id: number): Promise<void> {
    await this.db.query('delete from public.furniture_owned where id = $1', [id]);
  }

  /** Une vente à la fois par joueur. */
  async lockSales(uid: string): Promise<void> {
    await this.db.query('select pg_advisory_xact_lock(hashtext($1))', [`furniture_sell:${uid}`]);
  }

  async artworks(): Promise<{ id: number; title: string; url: string }[]> {
    return this.db.query('select id, title, url from public.artworks order by id');
  }

  async ownedPhotos(uid: string): Promise<number[]> {
    const rows = await this.db.query<{ artwork_id: number }>('select artwork_id from public.artwork_owned where user_id = $1', [uid]);
    return rows.map((r) => Number(r.artwork_id));
  }

  async isAdmin(uid: string): Promise<boolean> {
    return (await this.db.query('select 1 from public.admins where user_id = $1', [uid])).length > 0;
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const [r] = await this.db.query<{ ok: boolean }>('select public.are_friends($1, $2) as ok', [a, b]);
    return Boolean(r?.ok);
  }

  async username(uid: string): Promise<string | null> {
    const [r] = await this.db.query<{ username: string }>('select username from public.profiles where id = $1', [uid]);
    return r?.username ?? null;
  }
}
