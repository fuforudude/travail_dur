type Attrs = Record<string, string | number | boolean | undefined>;

/** Petit utilitaire de création d'éléments. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Barre d'aide clavier en bas d'écran. */
export function hints(...items: [string, string][]): HTMLElement {
  return h(
    'p',
    { class: 'hints' },
    ...items.flatMap(([k, label], i) => [i ? ' · ' : '', h('kbd', {}, k), ' ', label]),
  );
}
