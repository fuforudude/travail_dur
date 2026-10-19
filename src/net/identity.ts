// Identifiant propre à cet onglet : deux onglets du même navigateur sont deux joueurs distincts.
export const localId: string =
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
