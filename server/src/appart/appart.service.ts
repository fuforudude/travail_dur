// Appart : toutes les règles (ménage, pièces, équipements, aménagement, revenus, achat et revente
// de meubles). Les calculs viennent de shared/furniture.ts, le même code que l'aperçu du site.
// Chaque action est une transaction : l'appart est verrouillé, ses revenus arrêtés à l'instant
// présent (au taux d'avant le changement), puis le changement est écrit avec le nouveau taux.

import {
  accrue,
  apartmentRate,
  BASES,
  baseOf,
  CLEAN_TASKS,
  roomCost,
  roomOf,
  ROOMS,
  sellPrice,
  SPECIALS,
  takesPhoto,
  whyNot,
  type Layout,
  type Placed,
  type RoomLayout,
  type Zone,
} from '../../../shared/furniture';
import type { Db } from '../db';
import { bad, forbidden, notFound } from '../http/errors';
import { WalletRepo } from '../points/wallet.repo';
import { AppartRepo, type ApartmentRow, type OwnedRow } from './appart.repo';

/** Ce que le site reçoit d'un appart : de quoi l'afficher et faire défiler le compteur de revenus. */
export interface ApartmentDto {
  layout: Layout;
  rooms: string[];
  specials: string[];
  cleanStep: number;
  rate: number; // points par heure
  banked: number;
  lastTick: number; // ms, heure de la base
}

export interface AppartView {
  owner: { id: string; name: string };
  apartment: ApartmentDto;
  artworks: { id: number; title: string; url: string }[];
  /** Chez soi seulement : ses meubles, ses photos débloquées, et s'il est admin (toutes les photos). */
  furniture?: OwnedRow[];
  photos?: number[];
  admin?: boolean;
}

const MAX_PER_ZONE = 64;
const ZONES: Zone[] = ['floor', 'wall'];

const dto = (a: ApartmentRow): ApartmentDto => {
  const rooms = a.rooms ?? ['entree'];
  const l = a.layout ?? {};
  return {
    layout: Object.fromEntries(rooms.map((r) => [r, { floor: l[r]?.floor ?? [], wall: l[r]?.wall ?? [] }])),
    rooms,
    specials: a.specials ?? [],
    cleanStep: Number(a.clean_step),
    rate: Number(a.rate),
    banked: Number(a.banked),
    lastTick: new Date(a.last_tick).getTime(),
  };
};

const isPlaced = (layout: Layout, owned: number) => Object.values(layout ?? {}).some((l) => [...(l?.floor ?? []), ...(l?.wall ?? [])].some((p) => p.o === owned));
const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);

export class AppartService {
  constructor(private readonly db: Db) {}

  /** L'appart de `owner` vu par `viewer` : chez soi, ou chez un ami (les admins peuvent tout visiter). */
  async view(viewer: string, owner: string): Promise<AppartView> {
    const repo = new AppartRepo(this.db);
    const mine = viewer === owner;
    if (!mine && !(await repo.areFriends(viewer, owner)) && !(await repo.isAdmin(viewer))) throw forbidden('Seuls ses amis peuvent visiter cet appart.');
    const [a, artworks, name] = await Promise.all([repo.find(owner), repo.artworks(), repo.username(owner)]);
    const view: AppartView = {
      owner: { id: owner, name: name ?? 'Inconnu' },
      apartment: dto(a ?? { layout: {}, rooms: ['entree'], specials: [], clean_step: 0, rate: 0, banked: 0, last_tick: new Date() }),
      artworks,
    };
    if (mine) [view.furniture, view.photos, view.admin] = await Promise.all([repo.furniture(owner), repo.ownedPhotos(owner), repo.isAdmin(owner)]);
    return view;
  }

  /** Tâche de ménage suivante. */
  clean(uid: string) {
    return this.change(uid, async (a, { wallet }) => {
      if (a.clean_step >= CLEAN_TASKS.length) throw bad('l’appart est déjà tout propre');
      const step = a.clean_step;
      const balance = await wallet.spend(uid, CLEAN_TASKS[step].cost, `Appart : nettoyage ${step + 1}/${CLEAN_TASKS.length}`, 'appart');
      return { fields: { clean_step: step + 1 }, balance };
    });
  }

  /** Verse les revenus accumulés (le site appelle aussi toutes les 5 minutes, sur toutes les pages). */
  collect(uid: string) {
    return this.change(uid, async (a, { wallet }) => {
      const gain = Math.floor(a.banked);
      if (gain < 1) return { fields: {}, gain: 0 };
      await wallet.addGroupedHourly(uid, gain, "Revenus de l'appart", 'appart'); // même ligne d'historique que l'ancienne fonction SQL
      return { fields: { banked: a.banked - gain }, gain };
    });
  }

  buyRoom(uid: string, room: unknown) {
    return this.change(uid, async (a, { wallet }) => {
      if (a.clean_step < CLEAN_TASKS.length) throw bad('nettoie d’abord ton entrée');
      const r = ROOMS.find((x) => x.id === room);
      if (!r) throw notFound('pièce inconnue');
      if (a.rooms.includes(r.id)) throw bad('pièce déjà débloquée');
      if (r.requires && !a.rooms.includes(r.requires)) throw bad(`débloque d’abord : ${roomOf(r.requires).name}`);
      const cost = roomCost(r.id, a.rooms);
      if (cost === undefined) throw bad('pièce indisponible');
      const balance = await wallet.spend(uid, cost, `Appart : ${r.name}`, 'appart');
      return { fields: { rooms: [...a.rooms, r.id] }, balance };
    });
  }

  buySpecial(uid: string, special: unknown) {
    return this.change(uid, async (a, { wallet }) => {
      const sp = SPECIALS.find((s) => s.id === special);
      if (!sp) throw notFound('équipement inconnu');
      if (!a.rooms.includes(sp.room)) throw bad('débloque d’abord la pièce');
      if (a.specials.includes(sp.id)) throw bad('déjà installé');
      const balance = await wallet.spend(uid, sp.cost, `Appart : ${sp.name}`, 'appart');
      return { fields: { specials: [...a.specials, sp.id] }, balance };
    });
  }

  /** Enregistre l'aménagement de toutes les pièces envoyées, après avoir vérifié chaque meuble. */
  save(uid: string, layout: unknown) {
    return this.change(uid, async (a, { repo }) => {
      if (a.clean_step < CLEAN_TASKS.length) throw bad('nettoie d’abord ton appart');
      if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw bad('aménagement invalide');
      const [owned, photos, admin] = await Promise.all([repo.furniture(uid), repo.ownedPhotos(uid), repo.isAdmin(uid)]);
      const items = new Map(owned.map((o) => [Number(o.id), o.item_id]));
      const artworks = new Set((await repo.artworks()).map((w) => Number(w.id)));
      const unlocked = new Set(photos);
      const used = new Set<number>();
      const clean: Layout = {};
      for (const [room, v] of Object.entries(layout as Record<string, unknown>)) {
        if (!a.rooms.includes(room)) throw bad('pièce pas encore débloquée');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('aménagement invalide');
        const out: RoomLayout = { floor: [], wall: [] };
        for (const zone of ZONES) {
          const list = (v as Record<string, unknown>)[zone] ?? [];
          if (!Array.isArray(list)) throw bad('aménagement invalide');
          if (list.length > MAX_PER_ZONE) throw bad('trop de meubles');
          for (const e of list as Record<string, unknown>[]) {
            if (!e || !int(e.o) || !int(e.x) || !int(e.y) || (e.r !== undefined && !(int(e.r) && (e.r as number) >= 0 && (e.r as number) <= 3))) throw bad('aménagement invalide');
            const o = e.o as number;
            const r = (e.r as number | undefined) ?? 0;
            if (used.has(o)) throw bad('meuble placé deux fois');
            used.add(o);
            const item = items.get(o);
            if (!item || !baseOf(item)) throw bad('meuble non possédé');
            const why = whyNot(out[zone], room, zone, item, r, e.x as number, e.y as number);
            if (why) throw bad(why);
            const p: Placed = { o, i: item, x: e.x as number, y: e.y as number, ...(r ? { r } : {}) };
            if (takesPhoto(item) && int(e.art)) {
              const art = e.art as number;
              if (!artworks.has(art)) throw notFound('photo inconnue');
              if (!admin && !unlocked.has(art)) throw bad('photo pas encore débloquée (caisse souvenirs)');
              p.art = art;
            }
            out[zone].push(p);
          }
        }
        clean[room] = out;
      }
      return { fields: { layout: clean } };
    });
  }

  /** Achat d'un meuble neuf (finition standard) au prix de son modèle. */
  async buyFurniture(uid: string, base: unknown): Promise<{ balance: number; owned: OwnedRow }> {
    const b = BASES.find((x) => x.id === base);
    if (!b) throw notFound('meuble inconnu');
    return this.db.tx(async (db) => {
      const item = `${b.id}:standard`;
      const balance = await new WalletRepo(db).spend(uid, b.price, `Meuble : ${item}`, 'furniture');
      return { balance, owned: { id: await new AppartRepo(db).addFurniture(uid, item, 'shop'), item_id: item } };
    });
  }

  /** Revente d'un meuble rangé : 67 % du prix de base de son modèle. */
  async sellFurniture(uid: string, id: unknown): Promise<{ price: number; balance: number }> {
    if (!int(id)) throw bad('meuble introuvable');
    return this.db.tx(async (db) => {
      const repo = new AppartRepo(db);
      const wallet = new WalletRepo(db);
      // L'appart verrouillé : un enregistrement en même temps ne peut pas poser ce meuble pendant la vente.
      const { a } = await repo.lock(uid);
      await repo.lockSales(uid);
      const f = await repo.lockFurniture(uid, id as number);
      if (!f) throw notFound('meuble introuvable');
      if (isPlaced(a.layout, Number(f.id))) throw bad('ce meuble est posé dans l’appart : range-le d’abord');
      const price = sellPrice(f.item_id);
      if (!price) throw bad('ce meuble ne se revend pas');
      await repo.deleteFurniture(Number(f.id));
      await wallet.add(uid, price, `Meuble vendu : ${f.item_id}`, 'furniture');
      return { price, balance: await wallet.balance(uid) };
    });
  }

  /**
   * Squelette commun des actions : verrouille l'appart, arrête ses revenus à maintenant, applique
   * `f`, puis écrit ses champs avec le taux recalculé. Renvoie l'appart à jour et ce que `f` ajoute.
   */
  private change<T extends Record<string, unknown>>(
    uid: string,
    f: (a: ApartmentRow, ctx: { wallet: WalletRepo; repo: AppartRepo }) => Promise<{ fields: Partial<ApartmentRow> } & T>,
  ): Promise<{ apartment: ApartmentDto } & Omit<T, 'fields'>> {
    return this.db.tx(async (db) => {
      const repo = new AppartRepo(db);
      const { a: locked, now } = await repo.lock(uid);
      const a: ApartmentRow = {
        ...locked,
        rooms: locked.rooms ?? ['entree'],
        specials: locked.specials ?? [],
        clean_step: Number(locked.clean_step),
        rate: Number(locked.rate),
        banked: accrue(Number(locked.banked), Number(locked.rate), locked.specials ?? [], now.getTime() - new Date(locked.last_tick).getTime()),
        last_tick: now,
      };
      const { fields, ...extra } = await f(a, { wallet: new WalletRepo(db), repo });
      const next: ApartmentRow = { ...a, ...fields };
      next.rate = apartmentRate(next.layout ?? {}, next.clean_step, next.specials);
      await repo.update(uid, { ...fields, banked: next.banked, last_tick: now, rate: next.rate });
      return { apartment: dto(next), ...extra } as { apartment: ApartmentDto } & Omit<T, 'fields'>;
    });
  }
}
