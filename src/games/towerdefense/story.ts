// Tower defense : l'histoire de la campagne (20 niveaux, trois actes). Le Royaume des Cramptés est
// envahi par les brainrots ; on le libère, du désert aux souterrains, jusqu'à Bagou, le fan de Linux
// qui les a lâchés. Texte seulement : la difficulté de chaque niveau est dans engine/data.ts.

import type { EnemyDef } from './engine/data';

export interface Line {
  who: string;
  text: string;
}

export interface Act {
  name: string;
  from: number; // premier niveau de l'acte
}

export interface LevelStory {
  name: string;
  intro: Line[];
  outro: Line[];
}

export const ACTS: Act[] = [
  { name: 'Acte I · Les Dunes du Royaume', from: 1 },
  { name: 'Acte II · La Jungle Brainrot', from: 8 },
  { name: 'Acte III · Les Tunnels de Bagou', from: 15 },
];
export const actOf = (L: number) => [...ACTS].reverse().find((a) => L >= a.from) ?? ACTS[0];

/** Nom des boss dans la campagne : des brainrots, puis Bagou (ailleurs, le nom de l'ennemi). */
const BOSSES: Record<number, string> = {
  5: 'Tung Tung Tung Sahur',
  10: 'Tralalero Tralala',
  15: 'Bombardiro Crocodilo',
  20: 'Bagou',
};
export const bossName = (d: EnemyDef, level: number) => BOSSES[level] ?? d.name;

const G = 'Général Moustache';
const S = 'Sergente Gisèle';
const R = 'Le roi Crampté III';
const B = 'Bagou';
const T = 'Tung Tung Tung Sahur';
const TR = 'Tralalero Tralala';
const BC = 'Bombardiro Crocodilo';

/** Prologue : avant le niveau 1. */
export const PROLOGUE: Line[] = [
  { who: R, text: 'Catastrophe ! Les brainrots ont envahi le Royaume des Cramptés. Il y a un requin en baskets dans la salle du trône.' },
  { who: G, text: 'Un requin en baskets, Majesté ?' },
  { who: R, text: 'Des Nike. Et il chante. Tout le royaume chante avec lui, plus personne ne travaille. Libérez le royaume, Général.' },
  { who: S, text: 'D’après les éclaireurs, ils sortent tous d’un trou dans le désert. Avec un panneau « sudo apt install brainrot ».' },
  { who: G, text: 'Je ne sais pas ce que ça veut dire, Sergente. Mais ça ne me plaît pas. En avant !' },
];

export const STORY: LevelStory[] = [
  {
    name: 'Le Village des Cramptés',
    intro: [
      { who: S, text: 'Les villageois sont sur la place. Ils font tous la même danse en boucle depuis trois jours.' },
      { who: G, text: 'Les brainrots arrivent par la route ! Construisez des tours. Des Arbalètes, c’est un bon début.' },
    ],
    outro: [{ who: G, text: 'Premier village libéré ! Notez dans le journal : « Jour 1. Les Cramptés ont arrêté de danser. Un peu. »' }],
  },
  {
    name: 'Les Dunes Qui Font Brr Brr',
    intro: [
      { who: 'Brr Brr Patapim', text: 'Brr brr patapim ! Brr brr patapim !' },
      { who: S, text: 'C’est un arbre avec des pieds, Général. Il dit juste ça.' },
      { who: G, text: 'Alors on ne négocie pas. Tours en position !' },
    ],
    outro: [{ who: S, text: 'Un marchand crampté nous vend des fioles d’alchimiste. Il dit qu’elles « dérèglent le rizz ». Elles piquent.' }],
  },
  {
    name: 'L’Oasis du Cappuccino',
    intro: [
      { who: 'Ballerina Cappuccina', text: 'Bienvenue à mon oasis ! Le cappuccino est gratuit. Les brainrots aussi, ils sont livrés avec.' },
      { who: G, text: 'Des brainrots ? Où ça ?' },
      { who: 'Ballerina Cappuccina', text: 'Derrière vous. Je fais des pointes, je ne peux pas tout surveiller.' },
    ],
    outro: [{ who: 'Ballerina Cappuccina', text: 'Bon, je vous dis tout : un type en sweat à capuche avec un pingouin dessus nous a « compilés » ici. Il est parti par un tunnel.' }],
  },
  {
    name: 'Le Caravansérail des Chameaux Frigo',
    intro: [
      { who: 'Frigo Camelo', text: 'Je suis un chameau. Je suis aussi un frigo. Ne posez pas de questions.' },
      { who: S, text: 'Il a des momies dans le bac à légumes, Général.' },
      { who: G, text: 'Ne le regardez pas dans les yeux. Regardez plutôt ce qui sort de la porte.' },
    ],
    outro: [{ who: S, text: 'Nos ingénieurs ont fabriqué une Tesla avec une dynamo de vélo et la lampe du frigo.' }],
  },
  {
    name: 'La Pyramide de Tung Tung Tung',
    intro: [
      { who: T, text: 'TUNG. TUNG. TUNG. TUNG. TUNG. TUNG. TUNG. TUNG. TUNG. SAHUR !' },
      { who: G, text: 'C’est une bûche avec une batte de baseball. Elle tape sur la pyramide.' },
      { who: T, text: 'Bagou m’a dit de taper jusqu’à ce que tout le royaume se réveille. Je ne sais pas m’arrêter. TUNG.' },
    ],
    outro: [
      { who: T, text: 'Tung… tung… tung… Bon. Bagou est parti vers la jungle. Il a dit qu’il « poussait une mise à jour ».' },
      { who: S, text: 'Général, nos tours ont appris à se spécialiser. Elles ont regardé un tuto.' },
    ],
  },
  {
    name: 'Les Ruines de l’Ancien Rizz',
    intro: [
      { who: S, text: 'D’après la carte, c’était le grand temple du Rizz Crampté.' },
      { who: G, text: 'Il reste un mur.' },
      { who: S, text: 'Et des brainrots invisibles. Ils ont activé le mode sombre.' },
    ],
    outro: [{ who: G, text: 'Un tireur d’élite crampté s’engage chez nous. Il voit les brainrots camouflés. Il refuse de dire comment.' }],
  },
  {
    name: 'Le Canyon de Lirilì Larilà',
    intro: [
      { who: 'Lirilì Larilà', text: 'Lirilì larilà… je suis un cactus éléphant… avec des sandales…' },
      { who: 'L’écho', text: 'Sandales… dales… ales…' },
      { who: S, text: 'Même l’écho est contaminé, Général.' },
    ],
    outro: [{ who: S, text: 'Au bout du canyon, ça sent la banane et la sueur. On entre dans la jungle.' }],
  },
  {
    name: 'L’Orée de la Jungle Brainrot',
    intro: [
      { who: 'Chimpanzini Bananini', text: 'Chimpanzini bananini ! Wa wa wa !' },
      { who: G, text: 'C’est un singe dans une banane, Sergente.' },
      { who: S, text: 'Ou une banane dans un singe. Les scientifiques ne sont pas d’accord.' },
    ],
    outro: [{ who: G, text: 'On a récupéré un lance-flammes. Parfait pour les bananes. Et le reste.' }],
  },
  {
    name: 'Le Marais de Trippi Troppi',
    intro: [
      { who: 'Trippi Troppi', text: 'Troppa trippa ! Je suis un chat-crevette. Et mes copains volent.' },
      { who: S, text: 'Les brainrots volants arrivent : prévoyez des tours qui tirent en l’air.' },
    ],
    outro: [{ who: S, text: 'Nos tours peuvent désormais finir leur spécialisation. Elles se la racontent.' }],
  },
  {
    name: 'La Plage de Tralalero Tralala',
    intro: [
      { who: TR, text: 'Tralalero tralala ! Je suis un requin à trois pattes, en Nike, et c’est moi qui chantais dans la salle du trône !' },
      { who: G, text: 'Les Nike, c’était donc vous.' },
      { who: TR, text: 'Bagou me les a offertes. Il dit que les vraies chaussures, c’est open source. Attaquez, mes frères !' },
    ],
    outro: [
      { who: TR, text: 'Tralala… plus de tralala… Bagou est sous le volcan. Il a mis un serveur dans la lave pour le refroidissement.' },
      { who: G, text: 'Un comptoir commercial crampté nous suit maintenant. Il vend des bannières et prend des intérêts.' },
    ],
  },
  {
    name: 'Les Lianes de Boneca Ambalabu',
    intro: [
      { who: 'Boneca Ambalabu', text: 'Ambalabu ! Je suis une grenouille avec un pneu. Le pneu, c’est un choix de vie.' },
      { who: S, text: 'Les lianes sont gluantes, Général.' },
      { who: G, text: 'Ce ne sont pas des lianes, Sergente. Ce sont des câbles réseau. Bagou est passé par là.' },
    ],
    outro: [{ who: S, text: 'On a trouvé un autocollant « I use Arch btw » collé sur un arbre. Il est tout près.' }],
  },
  {
    name: 'Le Repaire de Bobrito Bandito',
    intro: [
      { who: 'Bobrito Bandito', text: 'Je suis un castor bandit. Je vole les impôts du royaume. Et les barrages.' },
      { who: G, text: 'C’est le brainrot le plus raisonnable qu’on ait croisé depuis le début.' },
    ],
    outro: [{ who: 'Bobrito Bandito', text: 'Bagou nous avait promis la gloire. Il nous a juste installé sans nous demander. Comme une mise à jour Windows, sauf qu’il déteste Windows.' }],
  },
  {
    name: 'Les Chutes de la Vache Saturne',
    intro: [
      { who: 'La Vaca Saturno Saturnita', text: 'Je suis une vache. Je suis aussi la planète Saturne. Meuh, dans l’espace.' },
      { who: S, text: 'Derrière la cascade, il y a une porte avec un paillasson : « Bienvenue dans /home/bagou ».' },
      { who: G, text: 'Il a un paillasson. Ce Bagou est diabolique.' },
    ],
    outro: [{ who: S, text: 'Les ingénieurs ont monté un Railgun. Ils ont perdu un sourcil chacun. Ça valait le coup.' }],
  },
  {
    name: 'Le Volcan du Cappuccino Assassino',
    intro: [
      { who: 'Cappuccino Assassino', text: 'Je suis un cappuccino. Avec des katanas. Je suis venu terminer votre pause café.' },
      { who: 'Le volcan', text: 'BLOUB.' },
      { who: G, text: 'Même le volcan est contre nous.' },
      { who: S, text: 'Non, le volcan dit juste BLOUB. C’est sa façon de dire bonjour.' },
    ],
    outro: [{ who: G, text: 'Le tunnel est ouvert. En bas, on entend des ventilateurs et quelqu’un qui tape très vite au clavier.' }],
  },
  {
    name: 'La Base Aérienne de Bombardiro',
    intro: [
      { who: BC, text: 'BOMBARDIRO CROCODILO ! Je suis un crocodile. Je suis un bombardier. Je suis les deux à la fois !' },
      { who: G, text: 'Il garde l’entrée des tunnels. Il faut passer.' },
      { who: BC, text: 'Bagou m’a mis root sur tout le ciel. Personne ne passe sans le mot de passe. Et le mot de passe, c’est « non ».' },
    ],
    outro: [
      { who: BC, text: 'Crocodilo… s’écrase… Vous ne trouverez jamais Bagou, il a creusé partout. Partout !' },
      { who: S, text: 'Les tunnels commencent ici, Général. Tous nos éclaireurs reviennent avec le même message : « Permission denied ».' },
    ],
  },
  {
    name: 'Les Galeries du Terminal',
    intro: [
      { who: B, text: '[voix dans les haut-parleurs] Bienvenue dans mes tunnels. Ici, tout est en ligne de commande. Votre souris ne vous servira à rien.' },
      { who: S, text: 'Les brainrots creusent sous le chemin. Gardez des tours le long de la sortie.' },
    ],
    outro: [{ who: G, text: 'On a trouvé un plan pour une Singularité. C’est un trou noir dans une boîte à chaussures. Bagou l’avait nommé « rm -rf ».' }],
  },
  {
    name: 'Le Lac des Pingouins',
    intro: [
      { who: S, text: 'Des milliers de petits pingouins en peluche flottent sur le lac souterrain.' },
      { who: B, text: 'Ce sont mes mascottes ! Et chacun de ces pingouins fait tourner un brainrot. Bonne chance pour tous les arrêter.' },
    ],
    outro: [{ who: B, text: 'Vous ne savez même pas quitter vim. Comment voulez-vous arriver jusqu’à moi ?' }],
  },
  {
    name: 'La Salle des Serveurs',
    intro: [
      { who: G, text: 'Tout clignote. Tout ronronne. Il fait 45 degrés.' },
      { who: S, text: 'C’est d’ici qu’il compile les brainrots, Général. Un par seconde.' },
    ],
    outro: [{ who: S, text: 'Au fond, une porte : « /root — accès interdit, surtout au Général ». C’est lui.' }],
  },
  {
    name: 'Le Pont du Noyau',
    intro: [
      { who: B, text: 'Ce pont, c’est le noyau. Je l’ai recompilé moi-même. Trois semaines. Il ne marche qu’à moitié, mais c’est MOI qui l’ai fait.' },
      { who: G, text: 'Tout le monde en position !' },
    ],
    outro: [{ who: B, text: 'Très bien. Vous l’aurez voulu. sudo su. Je descends moi-même.' }],
  },
  {
    name: 'Le Terrier de Bagou',
    intro: [
      { who: B, text: 'Je suis Bagou. J’utilise Linux. Je vous l’ai déjà dit ? J’utilise Linux.' },
      { who: B, text: 'Les brainrots, c’est moi. Le royaume chantera Tralalero pour toujours. Et vos tours, je les kill -9 une par une.' },
      { who: S, text: 'Il creuse des tunnels sous le chemin ! Ses brainrots vont s’en servir pour le rattraper.' },
      { who: G, text: 'Alors on les attend à la sortie. Pour le Roi, pour les Cramptés… et pour le silence !' },
    ],
    outro: [
      { who: B, text: 'Non… Segmentation fault… core dumped…' },
      { who: G, text: 'Bagou est tombé ! Les brainrots s’arrêtent un par un. Tung Tung Tung Sahur a enfin posé sa batte.' },
      { who: R, text: 'Bravo, Général ! Le Royaume des Cramptés est libre ! Et le requin en baskets ?' },
      { who: G, text: '…Il est toujours dans la salle du trône, Majesté. Il dit qu’il aime bien l’ambiance.' },
      { who: S, text: 'Et Bagou a laissé un tunnel ouvert. On y retourne en mode infini : il en sort encore.' },
    ],
  },
];
