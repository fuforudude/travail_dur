import type { RealtimeChannel } from '@supabase/supabase-js';
import { onAccount } from '../net/auth';
import { getSupabase, multiConfigured } from '../net/supabase';
import { isPanicked } from './panic';

// « Malédiction » : un screamer de temps en temps pour les joueurs qu'un admin a maudits
// (public.curses, 0009_appart_admin.sql). Un admin peut aussi en déclencher un tout de suite.
// Garde-fous : aucun clignotement (photosensibilité), son plafonné et bref,
// jamais pendant le faux écran de la touche panique.

const FIRST_DELAY_MS = 60_000; // jamais dans la première minute
/** Écart entre deux screamers selon le niveau de malédiction : [min, max] en minutes. */
const GAPS: Record<number, [number, number]> = { 1: [8, 15], 2: [3, 8], 3: [1, 3] };

interface Curse {
  active: boolean;
  level: number;
  scare_at: string | null;
}
let curse: Curse | null = null;
let lastScare = Date.now(); // un screamer « immédiat » plus ancien que l'ouverture de la page est ignoré

function scream(): void {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.35, t + 0.03); // fort mais plafonné
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    out.connect(ctx.destination);
    // cri : deux dents de scie qui chutent, plus un souffle de bruit
    for (const f of [880, 1170]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f / 3, t + 0.9);
      o.connect(out);
      o.start(t);
      o.stop(t + 0.9);
    }
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const ng = ctx.createGain();
    ng.gain.value = 0.4;
    src.connect(ng).connect(out);
    src.start(t);
    src.stop(t + 0.9);
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    // pas d'audio : l'image suffit
  }
}

const FACE = `
<svg viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="pk-skin" cx="50%" cy="40%" r="60%">
      <stop offset="0" stop-color="#d9d4c7"/><stop offset="1" stop-color="#5b574d"/>
    </radialGradient>
  </defs>
  <path d="M100 8 C40 8 18 70 22 120 C26 180 60 232 100 232 C140 232 174 180 178 120 C182 70 160 8 100 8Z" fill="url(#pk-skin)"/>
  <ellipse cx="66" cy="98" rx="24" ry="30" fill="#0b0b0b"/>
  <ellipse cx="134" cy="98" rx="24" ry="30" fill="#0b0b0b"/>
  <circle cx="70" cy="104" r="4" fill="#e8e2d0"/>
  <circle cx="130" cy="104" r="4" fill="#e8e2d0"/>
  <path d="M92 132 L100 150 L108 132Z" fill="#2a2824"/>
  <ellipse cx="100" cy="190" rx="34" ry="30" fill="#0b0b0b"/>
  <path d="M70 182 L80 196 L88 180 L96 198 L104 180 L112 198 L120 180 L130 194" stroke="#e8e2d0" stroke-width="4" fill="none"/>
  <path d="M40 60 L60 80 M160 60 L140 80" stroke="#2a2824" stroke-width="6" stroke-linecap="round"/>
</svg>`;

/** Affiche le screamer (exporté pour pouvoir le tester). */
export function showPrank(): void {
  const el = document.createElement('div');
  el.className = 'prank';
  el.innerHTML = FACE; // contenu fixe, défini ci-dessus
  document.body.append(el);
  scream();
  const close = () => {
    el.remove();
    window.removeEventListener('keydown', close, true);
  };
  setTimeout(() => {
    el.addEventListener('click', close);
    window.addEventListener('keydown', close, true);
  }, 400);
  setTimeout(close, 1800);
}

const gap = () => {
  const [min, max] = GAPS[curse?.level ?? 2] ?? GAPS[2];
  return (min + Math.random() * (max - min)) * 60_000;
};

function schedule(delay: number): void {
  setTimeout(() => {
    // Pas pendant le faux écran (il doit rester crédible), ni onglet caché.
    if (curse?.active && !isPanicked() && !document.hidden) showPrank();
    schedule(gap());
  }, delay);
}

/** Nouvelle ligne de malédiction : screamer immédiat si un admin vient de le demander. */
function update(next: Curse | null): void {
  curse = next;
  const at = next?.scare_at ? Date.parse(next.scare_at) : 0;
  if (at > lastScare && Date.now() - at < 60_000) {
    lastScare = at;
    if (!isPanicked()) showPrank();
  }
}

let channel: RealtimeChannel | null = null;

async function watch(uid: string): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) return;
  if (channel) void supabase.removeChannel(channel);
  channel = supabase
    .channel(`curse:${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'curses', filter: `user_id=eq.${uid}` }, (p) => update((p.new as Curse) ?? null))
    .subscribe();
  const { data } = await supabase.from('curses').select('active, level, scare_at').eq('user_id', uid).maybeSingle();
  update((data as Curse | null) ?? null);
}

export function initPrank(): void {
  if (!multiConfigured) return;
  let current = '';
  onAccount((a) => {
    if (!a || a.id === current) return;
    current = a.id;
    void watch(a.id);
  });
  schedule(FIRST_DELAY_MS + Math.random() * 60_000);
}
