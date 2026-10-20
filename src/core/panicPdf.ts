// Écran panique en PDF : le document s'affiche comme dans une visionneuse PDF.
// Les pages sont dessinées par pdf.js dans la page elle-même (pas d'<iframe>) : les touches restent
// à nous, et la touche panique ramène toujours au jeu, même après un clic dans le document.
// Le PDF se choisit dans les réglages et reste dans ce navigateur (IndexedDB) : un support de cours
// est souvent protégé, il ne doit pas être publié avec le site. Sans PDF choisi, on montre le faux carnet.

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// ---------------------------------------------------------------------------
// PDF personnel (IndexedDB)
// ---------------------------------------------------------------------------

interface StoredPdf {
  name: string;
  data: ArrayBuffer;
}

const DB = 'td-panic';
const STORE = 'pdf';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

/** PDF choisi dans les réglages, ou null (navigation privée, stockage bloqué : null aussi). */
export async function getCustomPdf(): Promise<StoredPdf | null> {
  try {
    return (await tx<StoredPdf | undefined>('readonly', (s) => s.get('custom'))) ?? null;
  } catch {
    return null;
  }
}

export async function setCustomPdf(file: File): Promise<void> {
  const data = await file.arrayBuffer();
  await tx('readwrite', (s) => s.put({ name: file.name, data } satisfies StoredPdf, 'custom'));
  resetPdfScreen();
}

export async function clearCustomPdf(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete('custom'));
  } finally {
    resetPdfScreen();
  }
}

// ---------------------------------------------------------------------------
// Visionneuse
// ---------------------------------------------------------------------------

let screen: { el: HTMLElement; name: string } | null = null;
let building: Promise<{ el: HTMLElement; name: string }> | null = null;

/** Oublie la visionneuse : elle sera reconstruite avec le nouveau PDF. */
export function resetPdfScreen(): void {
  screen = null;
  building = null;
}

/**
 * Prépare la visionneuse (chargement de pdf.js, du fichier, rendu des pages).
 * Appelée au démarrage quand le navigateur est libre : la touche panique doit afficher le PDF tout de suite.
 */
export function preparePdfScreen(): Promise<{ el: HTMLElement; name: string }> {
  if (screen) return Promise.resolve(screen);
  building ??= build().then((s) => (screen = s));
  return building;
}

/** La visionneuse si elle est prête, sinon null (on affiche alors un écran d'attente). */
export function readyPdfScreen(): { el: HTMLElement; name: string } | null {
  return screen;
}

async function build(): Promise<{ el: HTMLElement; name: string }> {
  const custom = await getCustomPdf();
  if (!custom) throw new Error('aucun PDF choisi');
  const name = custom.name;
  const pages = document.createElement('div');
  pages.className = 'pdf-pages';
  const count = document.createElement('span');
  const el = document.createElement('div');
  el.className = 'pdf-viewer';
  const bar = document.createElement('div');
  bar.className = 'pdf-bar';
  const title = document.createElement('span');
  title.className = 'pdf-title';
  title.textContent = name;
  bar.append(title, count);
  const scroller = document.createElement('div');
  scroller.className = 'pdf-scroll';
  scroller.tabIndex = -1;
  scroller.append(pages);
  el.append(bar, scroller);

  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(custom.data.slice(0)); // copie : pdf.js transfère le tampon à son worker
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  count.textContent = `${doc.numPages} page${doc.numPages > 1 ? 's' : ''}`;
  // Rendu net sur les écrans haute densité, sans dépasser une largeur raisonnable.
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.6, 900 / base.width);
    const viewport = page.getViewport({ scale: scale * ratio });
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
    canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    pages.append(canvas);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  }
  return { el, name };
}

/** Défilement au clavier dans la visionneuse (les touches n'atteignent jamais le jeu). */
export function scrollPdf(root: HTMLElement, key: string, shift: boolean): boolean {
  const scroller = root.querySelector<HTMLElement>('.pdf-scroll');
  if (!scroller) return false;
  const page = scroller.clientHeight * 0.9;
  const steps: Record<string, number> = {
    ArrowDown: 60,
    ArrowUp: -60,
    PageDown: page,
    PageUp: -page,
    ' ': shift ? -page : page,
    Home: -scroller.scrollHeight,
    End: scroller.scrollHeight,
  };
  if (!(key in steps)) return false;
  scroller.scrollBy({ top: steps[key] });
  return true;
}
