// Tower defense : l'histoire de la campagne (20 niveaux, trois actes). Le Royaume des Cramptés est
// envahi par les brainrots ; on le libère, du désert aux souterrains, jusqu'à Bagou, le fan de Linux
// qui les a lâchés. Puis les niveaux bonus : les défis de Tonton Jean-Mi, 43 ans, qui parle « jeune »
// avec dix ans de retard. Texte seulement : la difficulté de chaque niveau est dans engine/data.ts.

import { CHAPTER2_FIRST, inChapter2, LEVEL_COUNT, type EnemyDef } from './engine/data';
import { ACTS2, BOSSES2, PROLOGUE2, STORY2 } from './story2';

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
export const BONUS_ACT: Act = { name: 'Bonus · Les Défis de Tonton Jean-Mi', from: LEVEL_COUNT + 1 };
export const actOf = (L: number) =>
  inChapter2(L) ? [...ACTS2].reverse().find((a) => L >= a.from) ?? ACTS2[0] : L > LEVEL_COUNT ? BONUS_ACT : [...ACTS].reverse().find((a) => L >= a.from) ?? ACTS[0];
export { ACTS2 };
/** Prologue d'un niveau : le début de chaque chapitre. */
export const prologueOf = (L: number): Line[] => (L === 1 ? PROLOGUE : L === CHAPTER2_FIRST ? PROLOGUE2 : []);

/** Nom des boss dans la campagne : des brainrots, puis Bagou (ailleurs, le nom de l'ennemi). */
const BOSSES: Record<number, string> = {
  5: 'Tung Tung Tung Sahur',
  10: 'Tralalero Tralala',
  15: 'Bombardiro Crocodilo',
  20: 'Bagou',
  23: 'Tung Tung Tung Dab',
  25: 'Bagou 2 : le Retour (en VF)',
};
export const bossName = (d: EnemyDef, level: number) => BOSSES[level] ?? BOSSES2[level] ?? d.name;

const G = 'Général Moustache';
const S = 'Sergente Gisèle';
const R = 'Le roi Crampté III';
const B = 'Bagou';
const T = 'Tung Tung Tung Sahur';
const TR = 'Tralalero Tralala';
const BC = 'Bombardiro Crocodilo';
const J = 'Tonton Jean-Mi';

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

/** Niveaux bonus (21 à 25) : les défis de Tonton Jean-Mi. */
export const BONUS_STORY: LevelStory[] = [
  {
    name: 'YOLO (Mais Vraiment)',
    intro: [
      { who: J, text: 'Wesh wesh les jeunes ! C’est Tonton Jean-Mi, 43 ans, cadre chez un fournisseur de rouleaux de scotch. Vous êtes chauds patates ?' },
      { who: S, text: 'Qui c’est, lui ?' },
      { who: J, text: 'Moi, j’ai inventé des défis pour le Royaume. Le premier : YOLO. You Only Live Once. Une seule vie. C’est le swag ultime.' },
      { who: G, text: 'Une seule vie ? Pour toute l’armée ?' },
      { who: J, text: 'C’est ça, la street, mon Général. Allez, on y va, c’est le feu, ça va être de la balle atomique !' },
    ],
    outro: [
      { who: J, text: 'Oh. Vous l’avez fait. C’est… comment on dit… c’est trop stylé. Non. C’est trop « goat ». C’est ça ? Ma fille dit que je dois arrêter.' },
      { who: S, text: 'Votre fille a raison.' },
    ],
  },
  {
    name: 'Ça Passe Crème',
    intro: [
      { who: J, text: 'Défi numéro deux : « Ça passe crème ». Les brainrots ont bu trois Red Bull et un café. Ils vont super vite. Vitesse grand V. V comme « Vas-y frérot ».' },
      { who: G, text: 'Ça ne veut rien dire.' },
      { who: J, text: 'Exactement. C’est ça, le délire. Vous n’êtes pas prêts. Moi non plus, j’ai mal au dos.' },
    ],
    outro: [{ who: J, text: 'Bien joué ! Vous avez géré ça comme des chefs. Comme des chefs étoilés. Comme Top Chef. Vous regardez Top Chef ?' }],
  },
  {
    name: 'Le Dab de la Mort',
    intro: [
      { who: J, text: 'Pour ce défi, j’ai appris à Tung Tung Tung Sahur à faire le dab. Regardez-le. Il dab. C’est TROP 2016.' },
      { who: 'Tung Tung Tung Dab', text: 'TUNG. *dab*. TUNG. *dab*. TUNG TUNG TUNG. *dab dab dab*.' },
      { who: S, text: 'Et il a l’air beaucoup plus solide qu’avant.' },
      { who: J, text: 'Normal, il s’est mis au crossfit. Moi aussi. Enfin, je me suis inscrit.' },
    ],
    outro: [
      { who: 'Tung Tung Tung Dab', text: 'Tung… *mini-dab*… tung…' },
      { who: J, text: 'Respect. Vous méritez un « like ». Un pouce bleu. Un cœur. Un… je sais plus ce qu’on met maintenant.' },
    ],
  },
  {
    name: 'C’est Pas la Hess, C’est la Crise',
    intro: [
      { who: J, text: 'Les jeunes, petit défi économie : tout coûte plus cher. C’est l’inflation. C’est la hess. C’est ce qu’on dit, la hess ?' },
      { who: S, text: 'Les tours sont à +40 %, Général.' },
      { who: J, text: 'Bienvenue dans la vie d’adulte ! Remboursement de prêt, mutuelle, contrôle technique. C’est pas une dinguerie, ça ?' },
    ],
    outro: [
      { who: J, text: 'Vous avez tenu avec un budget serré. Vous êtes des bêtes. Des bêtes de compta. C’est un compliment, je vous jure.' },
      { who: G, text: 'Il nous fatigue, Sergente.' },
    ],
  },
  {
    name: 'Le Seum Ultime',
    intro: [
      { who: J, text: 'Dernier défi. J’ai rebranché Bagou. Je l’ai trouvé sur une clé USB, entre mes photos de vacances à La Baule et mon CV de 2009.' },
      { who: 'Bagou 2 : le Retour (en VF)', text: 'Je suis revenu. J’utilise toujours Linux. Et maintenant j’ai aussi un abonnement à une newsletter sur Linux.' },
      { who: J, text: 'Si vous perdez, vous aurez le seum. Le seum ULTIME. Huit vies, pas une de plus. Allez, gros, force à vous, c’est carré !' },
      { who: S, text: '« Gros » ?' },
      { who: J, text: 'C’est affectueux ! Ma fille m’a dit que c’était affectueux. Elle rigolait un peu en le disant, mais bon.' },
    ],
    outro: [
      { who: 'Bagou 2 : le Retour (en VF)', text: 'sudo shutdown -h now…' },
      { who: J, text: 'Incroyable. Vous avez fini tous mes défis. Vous êtes les boss. Les vrais. Les « big boss de la street du Royaume ».' },
      { who: G, text: 'Merci, Jean-Mi. Vous pouvez rentrer chez vous, maintenant.' },
      { who: J, text: 'Je rentre, je rentre. Mais j’ai une dernière question : est-ce que je suis « cringe » ?' },
      { who: S, text: '…' },
      { who: J, text: 'Je prends ça pour un non ! Salut les jeunes, restez frais comme des gardons !' },
    ],
  },
];

/** Histoire du niveau L (campagne ou bonus). */
export const levelStory = (L: number): LevelStory =>
  inChapter2(L) ? STORY2[L - CHAPTER2_FIRST] : L > LEVEL_COUNT ? BONUS_STORY[L - LEVEL_COUNT - 1] : STORY[L - 1];
