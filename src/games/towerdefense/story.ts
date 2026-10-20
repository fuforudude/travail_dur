// Tower defense : l'histoire de la campagne (20 niveaux, trois actes). Parodie libre : une
// expédition au-delà des frontières, à travers le désert, la jungle et les profondeurs, jusqu'au
// grand méchant. Texte seulement : la difficulté de chaque niveau est dans engine/data.ts.

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
  { name: 'Acte I · Le Désert Beaucoup Trop Sec', from: 1 },
  { name: 'Acte II · La Jungle Moite', from: 8 },
  { name: 'Acte III · Les Profondeurs Humides', from: 15 },
];
export const actOf = (L: number) => [...ACTS].reverse().find((a) => L >= a.from) ?? ACTS[0];

const G = 'Général Moustache';
const S = 'Sergente Gisèle';
const R = 'Le roi Gaston III';
const O = 'L’Ombrelle';
const M = 'Monsieur Dune';

/** Prologue : avant le niveau 1. */
export const PROLOGUE: Line[] = [
  { who: R, text: 'Catastrophe ! On a volé le Soleil. Il était dans un bocal, sur la cheminée, juste à côté des clés.' },
  { who: G, text: 'Qui oserait voler un bocal, Majesté ?' },
  { who: R, text: 'Quelqu’un qui a laissé une traînée de flaques jusqu’à la frontière. Partez, Général. Et rapportez aussi les clés.' },
  { who: S, text: 'On passe la frontière ? Il y a écrit « Défense d’entrer, même pour rire » sur le panneau.' },
  { who: G, text: 'Je ne ris jamais, Sergente. En avant !' },
];

export const STORY: LevelStory[] = [
  {
    name: 'Le Poste-Frontière Abandonné',
    intro: [
      { who: S, text: 'Le poste-frontière est vide. Il reste un mot : « Partis en pause, reviens jamais. »' },
      { who: G, text: 'Des rôdeurs arrivent ! Construisez des tours. Avec des pierres. Ou des Arbalètes, c’est plus pratique.' },
    ],
    outro: [{ who: G, text: 'Victoire ! Notez dans le journal : « Jour 1. Personne n’est mort. Sauf eux. »' }],
  },
  {
    name: 'Les Dunes Qui Bougent Toutes Seules',
    intro: [
      { who: S, text: 'Général, la dune vient de se déplacer de trois mètres.' },
      { who: G, text: 'C’est le vent, Sergente.' },
      { who: S, text: 'Il n’y a pas de vent.' },
      { who: G, text: '… Tours en position !' },
    ],
    outro: [{ who: S, text: 'Le marchand du coin nous vend des fioles d’alchimiste. Elles sentent le chou, mais elles piquent.' }],
  },
  {
    name: 'L’Oasis Payante',
    intro: [
      { who: M, text: 'Bienvenue à l’Oasis ! L’eau, c’est 3 pièces le verre. Les ennemis, c’est gratuit.' },
      { who: G, text: 'Des ennemis ? Où ça ?' },
      { who: M, text: 'Derrière vous. Je les ai fait venir. C’est un service compris.' },
    ],
    outro: [{ who: M, text: 'Bon, d’accord, je vous dis tout : un grand parapluie noir est passé par ici avec un bocal lumineux. Vers le sud.' }],
  },
  {
    name: 'Le Caravansérail des Chameaux Vexés',
    intro: [
      { who: S, text: 'Les chameaux nous regardent bizarrement.' },
      { who: G, text: 'Ne les regardez pas dans les yeux. Regardez plutôt les momies en peignoir qui arrivent.' },
    ],
    outro: [{ who: S, text: 'Nos ingénieurs ont fabriqué une Tesla avec une dynamo de vélo et beaucoup de courage.' }],
  },
  {
    name: 'La Pyramide du Pharaon Ensablé',
    intro: [
      { who: 'Le Pharaon Ensablé', text: 'QUI OSE RÉVEILLER LE PHARAON ? J’avais mis un réveil pour dans trois mille ans !' },
      { who: G, text: 'Nous cherchons le Soleil. Un parapluie l’a volé.' },
      { who: 'Le Pharaon Ensablé', text: 'L’Ombrelle ? Elle m’a promis de l’ombre éternelle en échange de ma pyramide. Écrasez-les, mes momies !' },
    ],
    outro: [
      { who: 'Le Pharaon Ensablé', text: 'Aïe. Bon. Elle a filé vers les ruines. Et elle ne m’a même pas rendu ma pyramide.' },
      { who: S, text: 'Général, nos tours ont appris à se spécialiser. Elles ont lu un livre de développement personnel.' },
    ],
  },
  {
    name: 'Les Ruines de Pas-Grand-Chose',
    intro: [
      { who: S, text: 'D’après la carte, c’était une grande cité antique.' },
      { who: G, text: 'Il reste un mur.' },
      { who: S, text: 'Et des ennemis invisibles. La carte n’en parlait pas.' },
    ],
    outro: [{ who: G, text: 'Un tireur d’élite s’engage chez nous. Il dit qu’il voit tout. Il porte des lunettes de soleil la nuit.' }],
  },
  {
    name: 'Le Canyon de l’Écho Écho',
    intro: [
      { who: G, text: 'ATTENTION, ENNEMIS !' },
      { who: 'L’écho', text: 'Ennemis… nemis… mis…' },
      { who: S, text: 'Vous les avez prévenus de notre arrivée, là.' },
    ],
    outro: [{ who: S, text: 'Au bout du canyon, il fait de plus en plus humide. On entre dans la jungle.' }],
  },
  {
    name: 'L’Orée de la Jungle',
    intro: [
      { who: S, text: 'Il fait 40 degrés et il pleut. En même temps.' },
      { who: G, text: 'C’est l’Ombrelle. Elle teste ses averses. Gardez vos tours au sec.' },
      { who: 'Un lézard en tongs', text: 'Hé ! Vous marchez sur ma serviette !' },
    ],
    outro: [{ who: G, text: 'On a récupéré un lance-flammes. Parfait pour sécher les chaussettes. Et le reste.' }],
  },
  {
    name: 'Le Marais aux Moustiques Syndiqués',
    intro: [
      { who: 'Un moustique', text: 'On est en grève. Sauf pour vous piquer : ça, c’est le cœur du métier.' },
      { who: S, text: 'Les chauves-souris volent : prévoyez des tours qui tirent en l’air.' },
    ],
    outro: [{ who: S, text: 'Nos tours peuvent désormais finir leur spécialisation. Elles sont insupportables.' }],
  },
  {
    name: 'Le Temple du Gros Caillou',
    intro: [
      { who: 'Le Chaman Kiwi', text: 'Le Gros Caillou va vous écraser ! L’Ombrelle lui a promis un parapluie à sa taille.' },
      { who: G, text: 'C’est un caillou. Il n’a pas besoin de parapluie.' },
      { who: 'Le Gros Caillou', text: 'J’AI LE DROIT DE RÊVER.' },
    ],
    outro: [
      { who: 'Le Chaman Kiwi', text: 'Le Gros Caillou est en miettes… L’Ombrelle a creusé un tunnel sous le volcan. Elle veut faire pleuvoir pour toujours !' },
      { who: G, text: 'Un comptoir commercial nous suit maintenant. Il vend des bannières et prend des intérêts.' },
    ],
  },
  {
    name: 'Les Lianes Qui Collent',
    intro: [
      { who: S, text: 'Les lianes sont gluantes, Général.' },
      { who: G, text: 'Ce ne sont pas des lianes, Sergente. Ce sont des serpents très calmes.' },
    ],
    outro: [{ who: S, text: 'On a trouvé des traces de bocal. Le Soleil a laissé une petite brûlure sur un rocher.' }],
  },
  {
    name: 'Le Village des Lézards en Tongs',
    intro: [
      { who: 'Le chef des lézards', text: 'Ici, on fait la sieste. Vous faites du bruit. Donc on vous attaque.' },
      { who: G, text: 'C’est la logique la plus solide qu’on ait entendue depuis le début.' },
    ],
    outro: [{ who: 'Le chef des lézards', text: 'L’Ombrelle nous avait promis de l’ombre pour les siestes. Mais nous, on aime bien le soleil, en fait.' }],
  },
  {
    name: 'Les Chutes de Pas-Si-Loin',
    intro: [
      { who: S, text: 'Une cascade. Et derrière, une porte avec un paillasson « Bienvenue dans les Profondeurs ».' },
      { who: G, text: 'Elle a un paillasson. Cette Ombrelle est diabolique.' },
    ],
    outro: [{ who: S, text: 'Les ingénieurs ont monté un Railgun. Ils ont perdu un sourcil chacun. Ça valait le coup.' }],
  },
  {
    name: 'Le Volcan Pas Content',
    intro: [
      { who: 'Le volcan', text: 'BLOUB.' },
      { who: G, text: 'Il dit qu’il n’est pas content.' },
      { who: S, text: 'Vous parlez volcan, maintenant ?' },
      { who: G, text: 'Tout le monde parle volcan quand il fait BLOUB.' },
    ],
    outro: [{ who: G, text: 'Le tunnel est ouvert. En bas, on entend de la musique d’orgue et le bruit de la pluie.' }],
  },
  {
    name: 'L’Entrée des Profondeurs',
    intro: [
      { who: 'Le Videur des Profondeurs', text: 'Pas de baskets, pas de lumière, pas d’entrée. C’est le règlement de l’Ombrelle.' },
      { who: G, text: 'Nous avons des tours.' },
      { who: 'Le Videur des Profondeurs', text: 'Les tours, c’est encore pire que les baskets.' },
    ],
    outro: [{ who: S, text: 'Le videur a démissionné. Il dit que le salaire ne valait pas les Arbalètes.' }],
  },
  {
    name: 'Les Galeries des Taupes Gothiques',
    intro: [
      { who: 'Une taupe gothique', text: 'La lumière, c’est surfait. Le soleil, c’est surfait. Votre tête, c’est surfait.' },
      { who: S, text: 'Elles creusent sous le chemin. Gardez des tours le long de la sortie.' },
    ],
    outro: [{ who: G, text: 'On a trouvé un plan pour une Singularité. C’est un trou noir dans une boîte à chaussures. Ne l’ouvrez pas en intérieur.' }],
  },
  {
    name: 'Le Lac Souterrain des Parapluies Perdus',
    intro: [
      { who: S, text: 'Des milliers de parapluies flottent sur le lac. Tous ceux qu’on a oubliés dans le train.' },
      { who: O, text: 'Mes enfants ! Vengez-vous de ceux qui vous ont abandonnés !' },
    ],
    outro: [{ who: O, text: 'Vous n’arriverez jamais jusqu’à moi. Il pleut trop. Vos tours vont rouiller.' }],
  },
  {
    name: 'La Cathédrale des Gouttières',
    intro: [
      { who: G, text: 'Tout ruisselle. Même les murs pleurent.' },
      { who: S, text: 'Non, ça, c’est la tuyauterie. Mais l’ambiance est la même.' },
    ],
    outro: [{ who: S, text: 'On voit une lueur au fond : c’est le bocal ! Le Soleil est là-bas, il fait des appels de phares.' }],
  },
  {
    name: 'Le Pont Qui Grince',
    intro: [
      { who: O, text: 'Ce pont grince. À chaque pas. Je l’ai fait installer exprès pour vous énerver.' },
      { who: G, text: 'Ça marche. Tout le monde en position !' },
    ],
    outro: [{ who: O, text: 'Très bien. Vous l’aurez voulu. Je vais fusionner avec le Dévoreur, la créature qui mange les week-ends.' }],
  },
  {
    name: 'Le Trône de l’Ombrelle',
    intro: [
      { who: O, text: 'Plus jamais de soleil ! Plus jamais de terrasses ! Plus jamais de lunettes de soleil !' },
      { who: S, text: 'Elle s’est collée au Dévoreur. Elle va couper nos tours et foncer vers la sortie.' },
      { who: G, text: 'Alors on la referme. Pour le Roi, pour le Soleil… et pour les clés !' },
    ],
    outro: [
      { who: O, text: 'Non… je me retourne… avec le vent… comme toutes les ombrelles…' },
      { who: G, text: 'Le bocal est intact ! Le Soleil se lève sur les Profondeurs. Les taupes gothiques mettent des lunettes.' },
      { who: R, text: 'Bravo, Général ! Et les clés ?' },
      { who: G, text: '…' },
      { who: S, text: 'On y retourne en mode infini, Majesté. Elles sont forcément quelque part.' },
    ],
  },
];
