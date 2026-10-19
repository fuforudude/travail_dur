/**
 * Navigation aux flèches dans une grille de boutons : la flèche choisit le bouton le plus
 * proche dans cette direction (d'après leur position à l'écran), donc quelle que soit la mise en page.
 */
export function spatialNav(container: HTMLElement): (e: KeyboardEvent) => boolean {
  return (e) => {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    if (!d) return false;
    e.preventDefault();
    const items = [...container.querySelectorAll<HTMLElement>('button:not(:disabled)')];
    const cur = document.activeElement as HTMLElement;
    if (!items.includes(cur)) {
      items[0]?.focus();
      return true;
    }
    const center = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    };
    const [cx, cy] = center(cur);
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const [x, y] = center(el);
      const along = (x - cx) * d[0] + (y - cy) * d[1]; // distance dans la direction voulue
      if (along <= 4) continue;
      const across = Math.abs((x - cx) * d[1]) + Math.abs((y - cy) * d[0]); // écart latéral
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    best?.focus();
    return true;
  };
}
