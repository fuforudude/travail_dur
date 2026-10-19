import { getSettings } from './settings';

let ctx: AudioContext | null = null;

// Petit « tic » très discret, seulement si le son est activé dans les réglages.
export function blip(freq = 440, duration = 0.05): void {
  if (!getSettings().sound) return;
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Audio indisponible : on ignore.
  }
}
