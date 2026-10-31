// Annonce des admins (0050_annonce_connexions.sql) : un bandeau tout en haut, par-dessus le site, pour
// tous les visiteurs. La croix le ferme ; il ne revient qu'avec une nouvelle annonce (retenu dans le
// navigateur par sa date de mise à jour). Relu toutes les 5 minutes et au retour sur l'onglet.

import { getSupabase, multiConfigured } from '../net/supabase';
import { h } from '../ui/dom';
import { load, save } from './storage';

const CLOSED_KEY = 'annonce:fermee';
const REFRESH_MS = 5 * 60_000;

interface Announcement {
  body: string;
  updated_at: string;
}

let banner: HTMLElement | null = null;
let shown = ''; // updated_at de l'annonce affichée

/** Annonce en cours, ou null (aucune, serveur injoignable ou migration pas encore passée). */
export async function currentAnnouncement(): Promise<Announcement | null> {
  const supabase = await getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from('announcement').select('body, updated_at').maybeSingle();
  return error ? null : ((data as Announcement | null) ?? null);
}

function hide(): void {
  banner?.remove();
  banner = null;
  shown = '';
}

function show(a: Announcement): void {
  if (shown === a.updated_at) return;
  hide();
  const close = h('button', { class: 'announce-close', type: 'button', 'aria-label': 'Fermer l’annonce', title: 'Fermer' }, '×');
  close.addEventListener('click', () => {
    save(CLOSED_KEY, a.updated_at);
    hide();
  });
  banner = h('div', { class: 'announce', role: 'status' }, h('span', { class: 'announce-text' }, a.body), close);
  shown = a.updated_at;
  document.body.append(banner);
}

/** Relit l'annonce et met le bandeau à jour (aussi appelé par la page Administration après publication). */
export async function refreshAnnouncement(): Promise<void> {
  const a = await currentAnnouncement();
  if (!a) return hide();
  if (load<string>(CLOSED_KEY, '') === a.updated_at) return hide();
  show(a);
}

export function initAnnouncement(): void {
  if (!multiConfigured) return;
  void refreshAnnouncement();
  window.setInterval(() => document.visibilityState === 'visible' && void refreshAnnouncement(), REFRESH_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void refreshAnnouncement());
}
