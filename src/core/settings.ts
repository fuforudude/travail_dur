import { load, save } from './storage';

export type Theme = 'light' | 'dark';
export type Palette = 'color' | 'mono';

export interface Settings {
  name: string;
  nameChosen: boolean;
  theme: Theme;
  /** « mono » : tout en noir et blanc, pour rester discret. */
  palette: Palette;
  sound: boolean;
  panicKey: string;
}

const ANIMALS = ['Hibou', 'Loutre', 'Renard', 'Blaireau', 'Lynx', 'Héron', 'Castor', 'Moineau', 'Marmotte', 'Belette'];

export function randomName(): string {
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return animal + (10 + Math.floor(Math.random() * 90));
}

const defaults: Settings = {
  name: randomName(),
  nameChosen: false,
  theme: 'light',
  palette: 'color',
  sound: false,
  panicKey: 'Escape',
};

let current: Settings = { ...defaults, ...load<Partial<Settings>>('settings', {}) };

export function getSettings(): Readonly<Settings> {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  save('settings', current);
  applyTheme();
}

export function applyTheme(): void {
  document.documentElement.dataset.theme = current.theme;
  document.documentElement.dataset.palette = current.palette;
}

export function keyLabel(key: string): string {
  const labels: Record<string, string> = {
    Escape: 'Échap',
    ' ': 'Espace',
    Enter: 'Entrée',
    Tab: 'Tab',
    Backspace: 'Retour arrière',
  };
  return labels[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}
