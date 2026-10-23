// Tests SQL : rejoue toutes les migrations dans une base Postgres en mémoire (PGlite, sans Docker),
// puis vérifie les droits et quelques règles de sécurité. Lancé par `npm run test:sql` et en CI.
//
// La liste des fonctions appelables par les joueurs (anon, authenticated) est figée dans
// supabase/tests/public-functions.txt : une fonction de plus fait échouer le test. Après avoir
// ajouté volontairement une fonction publique : `npm run test:sql -- --update`, puis relire le diff.

import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const migrations = join(root, 'supabase', 'migrations');
const allowFile = join(root, 'supabase', 'tests', 'public-functions.txt');
const update = process.argv.includes('--update');

const db = new PGlite();
let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`ÉCHEC : ${msg}`);
};
const ok = (msg) => console.log(`ok : ${msg}`);

// --- Migrations ------------------------------------------------------------------------------
await db.exec(readFileSync(join(root, 'supabase', 'tests', 'bootstrap.sql'), 'utf8'));
for (const file of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(migrations, file), 'utf8'));
  } catch (e) {
    fail(`${file} : ${e.message}`);
    process.exit(1); // la suite dépend de cette migration
  }
}
ok('toutes les migrations passent, dans l’ordre');

// --- Fonctions appelables par les joueurs ----------------------------------------------------
const { rows } = await db.query(`
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
         has_function_privilege('anon', p.oid, 'execute') as anon,
         has_function_privilege('authenticated', p.oid, 'execute') as auth
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
   order by 1`);
const current = rows.filter((r) => r.anon || r.auth).map((r) => `${r.anon ? 'anon+auth' : 'auth     '} ${r.sig}`);
if (update) {
  writeFileSync(allowFile, current.join('\n') + '\n');
  ok(`liste des fonctions publiques mise à jour (${current.length})`);
} else {
  const allowed = new Set(readFileSync(allowFile, 'utf8').split(/\r?\n/).filter(Boolean)); // \r\n : Git sous Windows
  const extra = current.filter((l) => !allowed.has(l));
  const gone = [...allowed].filter((l) => !current.includes(l));
  for (const l of extra) fail(`fonction appelable par les joueurs, absente de la liste validée : ${l}`);
  for (const l of gone) fail(`fonction de la liste validée qui n’est plus appelable : ${l}`);
  if (!extra.length && !gone.length) ok(`${current.length} fonctions appelables par les joueurs, toutes validées`);
}

// --- Comportements ---------------------------------------------------------------------------
const as = async (uid, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
};
const throws = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message;
  }
};
const newUser = async () => (await db.query(`insert into auth.users (is_anonymous) values (true) returning id`)).rows[0].id;
const a = await newUser();
const b = await newUser();

// Fonction interne : refusée aux joueurs.
const denied = await throws(() => as(a, `select public.points_add($1, 1000000, 'triche')`, [a]));
if (denied?.includes('permission denied')) ok('points_add est refusée aux joueurs');
else fail(`points_add appelable par un joueur (${denied ?? 'aucune erreur'})`);

// Gains ×3 (0034) : 10 points de jeu en rapportent 30.
await db.query(`select public.points_add($1, 10, 'test')`, [a]);
const bal = (await db.query(`select balance from public.wallets where user_id = $1`, [a])).rows[0]?.balance;
if (Number(bal) === 100 + 30) ok('gains de jeu × 3 (100 de bienvenue + 3 × 10)');
else fail(`solde inattendu après points_add : ${bal}`);

// Discussion (0037) : seuls les membres d'un salon lisent ses messages.
await as(a, `select public.room_join('ABCD')`);
await as(a, `select public.room_say('ABCD', 'salut')`);
const seenByA = (await as(a, `select count(*)::int as n from public.room_messages where room = 'ABCD'`)).rows[0].n;
const seenByB = (await as(b, `select count(*)::int as n from public.room_messages`)).rows[0].n;
if (seenByA === 1 && seenByB === 0) ok('un joueur ne lit pas la discussion d’un salon qu’il n’a pas rejoint');
else fail(`discussion : A voit ${seenByA} message(s), B (pas membre) en voit ${seenByB}`);
await as(b, `select public.room_join('ABCD')`);
if ((await as(b, `select count(*)::int as n from public.room_messages where room = 'ABCD'`)).rows[0].n === 1) ok('après room_join, le membre lit la discussion');
else fail('après room_join, le membre ne lit toujours pas la discussion');

// Suppression de compte (0037) : confirmation par le pseudo, puis tout disparaît.
const name = (await db.query(`select username from public.profiles where id = $1`, [b])).rows[0].username;
const wrong = await throws(() => as(b, `select public.account_delete('pas-mon-pseudo')`));
if (wrong) ok('account_delete refuse une confirmation incorrecte');
else fail('account_delete a accepté un mauvais pseudo');
await as(b, `select public.account_delete($1)`, [name]);
const left = (await db.query(`select (select count(*) from auth.users where id = $1)::int + (select count(*) from public.profiles where id = $1)::int as n`, [b])).rows[0].n;
if (left === 0) ok('account_delete efface le compte et le profil');
else fail('account_delete a laissé des traces du compte');

// Vente de meubles (0038) : 67 % du prix de base, refusée pour un meuble posé.
{
  const seller = await newUser();
  const base = (await db.query(`select id, price from public.furniture_bases order by id limit 1`)).rows[0];
  const own = async () => (await db.query(`insert into public.furniture_owned (user_id, item_id) values ($1, $2) returning id`, [seller, `${base.id}:standard`])).rows[0].id;
  const placed = await own();
  const free = await own();
  await db.query(`insert into public.apartments (user_id, layout) values ($1, $2) on conflict (user_id) do update set layout = excluded.layout`, [
    seller,
    JSON.stringify({ entree: { floor: [{ o: Number(placed), x: 0, y: 0 }], wall: [] } }),
  ]);
  const refused = await throws(() => as(seller, `select public.furniture_sell($1)`, [placed]));
  if (refused?.includes('posé')) ok('un meuble posé ne se vend pas');
  else fail(`vente d’un meuble posé : ${refused ?? 'acceptée'}`);
  const before = Number((await db.query(`select coalesce((select balance from public.wallets where user_id = $1), 100) as b`, [seller])).rows[0].b);
  await as(seller, `select public.furniture_sell($1)`, [free]);
  const after = Number((await db.query(`select balance from public.wallets where user_id = $1`, [seller])).rows[0].balance);
  const gone = (await db.query(`select count(*)::int as n from public.furniture_owned where id = $1`, [free])).rows[0].n;
  if (after - before === Math.floor((Number(base.price) * 67) / 100) && gone === 0) ok('un meuble de la réserve se vend 67 % du prix de base');
  else fail(`vente : ${after - before} points reçus (attendu ${Math.floor((Number(base.price) * 67) / 100)}), meuble encore là : ${gone}`);
}

// Pièces de luxe et équipements spéciaux (0022).
{
  const rich = await newUser();
  await db.query(`select public.points_add($1, 20000000, 'test', 'appart')`, [rich]);
  await db.query(`insert into public.apartments (user_id, clean_step, rooms) values ($1, 6, '{entree}') on conflict (user_id) do update set clean_step = 6`, [rich]);
  const bal = async () => Number((await db.query(`select balance from public.wallets where user_id = $1`, [rich])).rows[0].balance);
  const tooEarly = await throws(() => as(rich, `select public.apartment_room_buy('bar')`));
  if (tooEarly?.includes('Salle de jeux')) ok('le bar demande d’avoir la salle de jeux');
  else fail(`bar sans salle de jeux : ${tooEarly ?? 'acheté'}`);
  await as(rich, `select public.apartment_room_buy('jeux')`); // 1re pièce normale : 3 000
  let b0 = await bal();
  await as(rich, `select public.apartment_room_buy('bar')`);
  const barCost = b0 - (await bal());
  b0 = await bal();
  await as(rich, `select public.apartment_room_buy('salon')`);
  const salonCost = b0 - (await bal());
  if (barCost === 1000000 && salonCost === 8000) ok('bar à prix fixe (1 000 000), sans compter dans la suite des pièces normales');
  else fail(`prix : bar ${barCost} (attendu 1000000), salon ensuite ${salonCost} (attendu 8000)`);
  const rate = async () => Number((await db.query(`select rate from public.apartments where user_id = $1`, [rich])).rows[0].rate);
  const r0 = await rate();
  await as(rich, `select public.apartment_special_buy('jager')`);
  if ((await rate()) === 2 * r0 && r0 > 0) ok('la tireuse à Jäger double les revenus');
  else fail(`revenus avec la tireuse : ${await rate()} (avant : ${r0})`);
  const twice = await throws(() => as(rich, `select public.apartment_special_buy('jager')`));
  if (twice?.includes('déjà')) ok('un équipement ne s’achète qu’une fois');
  else fail(`tireuse achetée deux fois : ${twice ?? 'acceptée'}`);
  const locked = await throws(() => as(rich, `select public.apartment_special_buy('jacuzzi')`));
  if (locked?.includes('pièce')) ok('le jacuzzi demande le toit-terrasse');
  else fail(`jacuzzi sans toit : ${locked ?? 'acheté'}`);
  const chair = (await db.query(`insert into public.furniture_owned (user_id, item_id) values ($1, 'chair:standard') returning id`, [rich])).rows[0].id;
  const onTap = await throws(() => as(rich, `select public.apartment_save($1)`, [JSON.stringify({ bar: { floor: [{ o: Number(chair), x: 2, y: 0 }], wall: [] } })]));
  if (onTap?.includes('réservée')) ok('rien ne se pose à la place de la tireuse');
  else fail(`meuble sur la tireuse : ${onTap ?? 'accepté'}`);
  await as(rich, `select public.apartment_save($1)`, [JSON.stringify({ bar: { floor: [{ o: Number(chair), x: 0, y: 3 }], wall: [] } })]);
  const withChair = await rate();
  if (withChair === 2 * (r0 + 150 * 0.8)) ok('un meuble posé au bar compte aussi double');
  else fail(`revenus avec une chaise : ${withChair} (attendu ${2 * (r0 + 120)})`);
  // Coffre-fort : 72 h de revenus accumulés au lieu de 24.
  await db.query(`update public.apartments set specials = specials || '{coffre}', banked = 0, last_tick = now() - interval '100 hours' where user_id = $1`, [rich]);
  const banked = Number((await db.query(`select (public.apartment_settle($1)).banked as b`, [rich])).rows[0].b);
  if (Math.abs(banked - withChair * 72) < 1) ok('avec le coffre-fort, les revenus s’accumulent 72 h');
  else fail(`coffre-fort : ${banked} accumulés en 100 h (attendu ${withChair * 72})`);
}

// Parties à 4 (0039) : le gagnant humain est payé à la fin, pas pour une partie trop courte.
{
  const p1 = await newUser();
  const p2 = await newUser();
  const bal = async (u) => Number((await db.query(`select coalesce((select balance from public.wallets where user_id = $1), 0) as b`, [u])).rows[0].b);
  const mk = async (plies) =>
    (await db.query(
      `insert into public.matches4 (game, room, players, names, board, turn, plies, created_by)
       values ('chess4', 'ABCD', array[$1::uuid, $2::uuid, null, null], array['a','b','o1','o2'], '[]', 0, $3, $1) returning id`,
      [p1, p2, plies],
    )).rows[0].id;
  await db.query(`select public.points_open($1)`, [p1]); // les 100 points de bienvenue d'abord
  const short = await mk(5);
  const before = await bal(p1);
  await db.query(`update public.matches4 set status = 'won', winner = 0, turn = null where id = $1`, [short]);
  const afterShort = await bal(p1);
  const long = await mk(40);
  await db.query(`update public.matches4 set status = 'won', winner = 0, turn = null where id = $1`, [long]);
  const afterLong = await bal(p1);
  if (afterShort === before && afterLong - afterShort === 3 * 120 + 30) ok('partie à 4 : le gagnant reçoit 360 points + 30 de partie jouée, rien pour une partie trop courte');
  else fail(`partie à 4 : +${afterShort - before} (courte), +${afterLong - afterShort} (longue)`);
  const seen = (await as(p2, `select count(*)::int as n from public.matches4`)).rows[0].n;
  const outsider = await newUser();
  const hidden = (await as(outsider, `select count(*)::int as n from public.matches4`)).rows[0].n;
  if (seen === 2 && hidden === 0) ok('une partie à 4 n’est visible que de ses joueurs');
  else fail(`visibilité des parties à 4 : joueur ${seen}, étranger ${hidden}`);
}

// Double authentification des admins (0037) : sans code (aal1), les actions d'admin sont refusées.
const admin = await newUser();
await db.query(`insert into public.admins (user_id) values ($1)`, [admin]);
const asAdmin = async (aal, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${admin}', false); select set_config('request.jwt.claims', '{"aal":"${aal}"}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`);
  }
};
const noCode = await throws(() => asAdmin('aal1', `select public.admin_points($1, 5, 'test')`, [a]));
if (noCode?.includes('double authentification')) ok('un admin sans double authentification ne peut rien faire');
else fail(`admin sans double authentification : ${noCode ?? 'action acceptée'}`);
const withCode = await throws(() => asAdmin('aal2', `select public.admin_points($1, 5, 'test')`, [a]));
if (!withCode) ok('un admin avec double authentification peut agir');
else fail(`admin avec double authentification refusé : ${withCode}`);

// Suspension (0045) : le compte suspendu est bloqué partout sauf account_status, puis libéré.
{
  const bad = await newUser();
  await db.query(`insert into auth.sessions (user_id) values ($1)`, [bad]);
  const admin2 = await newUser();
  await db.query(`insert into public.admins (user_id) values ($1)`, [admin2]);
  const self = await throws(() => asAdmin('aal2', `select public.admin_suspend($1, 0, 'test')`, [admin]));
  const noAdmin = await throws(() => asAdmin('aal2', `select public.admin_suspend($1, 0, 'test')`, [admin2]));
  const byPlayer = await throws(() => as(a, `select public.admin_suspend($1, 0, 'test')`, [bad]));
  if (self?.includes('soi-même') && noAdmin?.includes('suspendre un admin') && byPlayer?.includes('réservé aux admins'))
    ok('on ne se suspend pas soi-même, ni un autre admin, et un joueur ne suspend personne');
  else fail(`suspension de soi : ${self ?? 'acceptée'} ; d’un admin : ${noAdmin ?? 'acceptée'} ; par un joueur : ${byPlayer ?? 'acceptée'}`);
  await asAdmin('aal2', `select public.admin_suspend($1, 24, 'triche')`, [bad]);
  const u = (await db.query(`select banned_until > now() + interval '23 hours' as banned, (select count(*)::int from auth.sessions where user_id = $1) as sessions from auth.users where id = $1`, [bad])).rows[0];
  const blocked = await throws(() => as(bad, `select public.request_check()`));
  const other = await throws(() => as(a, `select public.request_check()`));
  const status = (await as(bad, `select public.account_status() as s`)).rows[0].s;
  if (u.banned && u.sessions === 0 && blocked?.includes('suspendu') && !other && status.suspended && status.reason === 'triche')
    ok('un compte suspendu ne se reconnecte plus, ses requêtes sont refusées, il voit la raison ; les autres passent');
  else fail(`suspension : banni ${u.banned}, sessions ${u.sessions}, requête ${blocked ?? 'acceptée'}, autre joueur ${other ?? 'ok'}, statut ${JSON.stringify(status)}`);
  await asAdmin('aal2', `select public.admin_unsuspend($1)`, [bad]);
  const freed = await throws(() => as(bad, `select public.request_check()`));
  const unbanned = (await db.query(`select banned_until is null as ok from auth.users where id = $1`, [bad])).rows[0].ok;
  if (!freed && unbanned) ok('une suspension levée rend l’accès');
  else fail(`après levée : ${freed ?? 'accès rendu'}, banned_until vidé : ${unbanned}`);
  await db.query(`insert into public.suspensions (user_id, until) values ($1, now() - interval '1 minute')`, [bad]);
  if (!(await throws(() => as(bad, `select public.request_check()`)))) ok('une suspension terminée ne bloque plus');
  else fail('une suspension expirée bloque encore');

  // Revenus de l'appart (0046) : rien n'est gagné pendant la suspension, ni pendant qu'elle dure, ni après.
  const rich = await newUser();
  await db.query(`alter table public.apartments disable trigger apartment_rate_sync`);
  await db.query(`insert into public.apartments (user_id, rate, banked, last_tick) values ($1, 100, 0, now() - interval '10 hours')`, [rich]);
  await asAdmin('aal2', `select public.admin_suspend($1, 0, 'farm')`, [rich]);
  const before = Number((await db.query(`select banked from public.apartments where user_id = $1`, [rich])).rows[0].banked);
  // 6 h plus tard, toujours suspendu, puis levée au bout de 8 h, 2 h de jeu normal ensuite.
  await db.query(`update public.apartments set last_tick = now() - interval '6 hours' where user_id = $1`, [rich]);
  await db.query(`update public.suspensions set created_at = now() - interval '6 hours' where user_id = $1`, [rich]);
  const during = Number((await db.query(`select (public.apartment_settle($1)).banked`, [rich])).rows[0].banked);
  await db.query(`update public.apartments set last_tick = now() - interval '4 hours' where user_id = $1`, [rich]);
  await db.query(`update public.suspensions set created_at = now() - interval '8 hours', until = now() - interval '2 hours' where user_id = $1`, [rich]);
  const after = Number((await db.query(`select (public.apartment_settle($1)).banked`, [rich])).rows[0].banked);
  await db.query(`alter table public.apartments enable trigger apartment_rate_sync`);
  if (Math.round(before) === 1000 && Math.round(during) === 1000 && Math.round(after) === 1200)
    ok('les revenus de l’appart s’arrêtent pendant une suspension (gagnés avant : gardés)');
  else fail(`revenus : avant ${before}, pendant ${during}, après ${after} (attendu 1000, 1000, 1200)`);
}

// Dons entre amis (0047) : seulement à un ami, pas plus que son solde, rien n'est créé ni perdu.
{
  const giver = await newUser();
  const friend = await newUser();
  const stranger = await newUser();
  await as(giver, `select public.points_wallet()`);
  await as(friend, `select public.points_wallet()`);
  await db.query(`update public.wallets set balance = 1000 where user_id = $1`, [giver]);
  const notFriend = await throws(() => as(giver, `select public.points_give($1, 10)`, [stranger]));
  await db.query(`insert into public.friendships (a, b, requested_by, accepted) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), $1, true)`, [giver, friend]);
  const self = await throws(() => as(giver, `select public.points_give($1, 10)`, [giver]));
  const tooMuch = await throws(() => as(giver, `select public.points_give($1, 1001)`, [friend]));
  const negative = await throws(() => as(giver, `select public.points_give($1, -5)`, [friend]));
  if (notFriend?.includes('ami') && self?.includes('soi-même') && tooMuch?.includes('pas assez') && negative?.includes('invalide'))
    ok('un don est refusé à un inconnu, à soi-même, au-delà du solde, ou négatif');
  else fail(`dons refusés : inconnu ${notFriend ?? 'accepté'}, soi ${self ?? 'accepté'}, trop ${tooMuch ?? 'accepté'}, négatif ${negative ?? 'accepté'}`);
  const before = Number((await db.query(`select balance from public.wallets where user_id = $1`, [friend])).rows[0].balance);
  const left = Number((await as(giver, `select public.points_give($1, 400, 'bon anniv') as b`, [friend])).rows[0].b);
  const w = (await db.query(`select balance, earned from public.wallets where user_id = $1`, [friend])).rows[0];
  const ev = (await db.query(`select reason from public.point_events where user_id = $1 and kind = 'gift'`, [friend])).rows[0]?.reason;
  if (left === 600 && Number(w.balance) === before + 400 && Number(w.earned) === 0 && ev?.includes('bon anniv'))
    ok('un don passe d’un ami à l’autre, avec son message, sans compter comme gagné en jouant');
  else fail(`don : reste ${left}, reçu ${Number(w.balance) - before}, gagné ${w.earned}, ligne ${ev}`);
  await as(giver, `select public.points_give($1, 1)`, [friend]);
  await as(giver, `select public.points_give($1, 1)`, [friend]);
  if ((await throws(() => as(giver, `select public.points_give($1, 1)`, [friend])))?.includes('trop de dons')) ok('au plus 3 dons toutes les 10 secondes');
  else fail('les dons en rafale ne sont pas limités');
}

// Records et paliers (0047) : primes énormes, chaque palier une seule fois.
{
  const ace = await newUser();
  const total = async () => Number((await db.query(`select coalesce(sum(amount), 0) as n from public.point_events where user_id = $1 and kind = 'record'`, [ace])).rows[0].n);
  const flappy = async (score) => {
    const id = (await db.query(`insert into public.flappy_sessions (user_id, seed) values ($1, 1) returning id`, [ace])).rows[0].id;
    await db.query(`update public.flappy_sessions set finished_at = now(), score = $2 where id = $1`, [id, score]);
  };
  await db.query(`insert into public.flappy_sessions (user_id, seed, finished_at, score) values ($1, 1, now(), 10)`, [a]);
  const others = Number((await db.query(`select max(score) as n from public.flappy_sessions where finished_at is not null`)).rows[0].n);
  await flappy(60); // paliers 25 et 50 (+ record absolu si personne n'a fait mieux)
  const first = await total();
  await flappy(55); // ni record ni nouveau palier
  const second = await total();
  const expected = (10000 + 50000 + (others < 60 ? 100000 : 0)) * 3;
  const list = (await as(ace, `select public.points_milestones_mine() as l`)).rows[0].l;
  const done = list.filter((m) => m.game === 'flappy' && m.done).map((m) => m.threshold);
  if (first === expected && second === first && done.join() === '25,50') ok('les paliers de Flappy rapportent une fois chacun, et la page Points les voit');
  else fail(`paliers : ${first} puis ${second} (attendu ${expected}), atteints ${done}`);
}

// Grande échelle (0043) : la mise maximale suit le solde, les caisses chères donnent du Divin.
{
  const rich = await newUser();
  await as(rich, `select public.casino_slots(1)`);
  await db.query(`update public.wallets set balance = 10000000 where user_id = $1`, [rich]);
  const tooMuch = await throws(() => as(rich, `select public.casino_slots(2000001)`));
  const max = await throws(() => as(rich, `select public.casino_slots(2000000)`));
  if (tooMuch?.includes('mise maximale') && !max) ok('avec 10 millions, on mise jusqu’à 2 millions (20 % du solde), pas plus');
  else fail(`mise maximale : 2 000 001 → ${tooMuch ?? 'acceptée'}, 2 000 000 → ${max ?? 'acceptée'}`);
  const small = await throws(() => as(a, `select public.casino_slots(501)`));
  if (small?.includes('mise maximale')) ok('avec un petit solde, la mise reste limitée à 500');
  else fail(`petit solde : 501 → ${small ?? 'acceptée'}`);
  const divine = (await db.query(`select count(*)::int as n from public.furniture_items where rarity = 'divine'`)).rows[0].n;
  const elsewhere = (await db.query(`select count(*)::int as n from public.crate_odds where rarity = 'divine' and crate_id not in ('royale', 'divine')`)).rows[0].n;
  if (divine > 0 && elsewhere === 0) ok('des meubles Divins existent, seulement dans les caisses royale et divine');
  else fail(`Divin : ${divine} meubles, ${elsewhere} autres caisses`);
}

// Vues en security_invoker (0044) : le classement Wordle montre tout le monde sans livrer les
// propositions des autres, et le catalogue des meubles reste lisible.
{
  const other = await newUser();
  await db.query(`update public.profiles set verified = true where id = $1`, [a]);
  await db.query(`insert into public.wordle_games (user_id, day, guesses, solved, finished) values ($1, current_date, '{crane,poste}', true, true)`, [a]);
  const ranked = (await as(other, `select count(*)::int as n from public.leaderboard_wordle where user_id = $1`, [a])).rows[0].n;
  const games = (await as(other, `select count(*)::int as n from public.wordle_games where user_id = $1`, [a])).rows[0].n;
  if (ranked === 1 && games === 0) ok('le classement Wordle montre les autres joueurs, pas leurs propositions');
  else fail(`classement Wordle : ${ranked} ligne(s) pour A, ${games} partie(s) de A lisibles par un autre`);
  const catalogue = (await as(a, `select count(*)::int as n from public.furniture_items`)).rows[0].n;
  if (catalogue > 0) ok('le catalogue des meubles reste lisible par les joueurs');
  else fail('furniture_items est vide pour un joueur');
}

await db.close();
if (failures) {
  console.error(`\n${failures} échec(s).`);
  process.exit(1);
}
console.log('\nTous les tests SQL passent.');
