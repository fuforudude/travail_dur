// Tower defense, chapitre 2 (niveaux 26 à 75) : la chasse à la sorcière. Martine, une ignoble
// sorcière, a séduit Youg, un rat, à coups de filtre d'amour au camembert ; il mène pour elle des
// armées de rats. Youg est le boss du milieu (niveau 50), Martine celui de la fin (niveau 75).
// Texte seulement : la difficulté de chaque niveau est dans engine/data.ts.

import type { Act, Line, LevelStory } from './story';

export const ACTS2: Act[] = [
  { name: 'Acte IV · Le Marais des Balais', from: 26 },
  { name: 'Acte V · Les Égouts de Youg', from: 38 },
  { name: 'Acte VI · La Forêt des Chaudrons', from: 51 },
  { name: 'Acte VII · La Tour de Martine', from: 63 },
];

/** Noms des boss du chapitre 2 (les Titans y sont des créatures de la sorcière). */
export const BOSSES2: Record<number, string> = {
  35: 'Le Chaudron Ambulant',
  45: 'Le Balai Géant',
  50: 'Youg',
  55: 'La Gargouille Baveuse',
  65: 'Le Corbeau Titan',
  75: 'Martine',
};

const G = 'Général Moustache';
const S = 'Sergente Gisèle';
const R = 'Le roi Crampté III';
const M = 'Martine';
const Y = 'Youg';
const J = 'Tonton Jean-Mi';
const B = 'Bagou (repenti)';

/** Prologue du chapitre 2 : avant le niveau 26. */
export const PROLOGUE2: Line[] = [
  { who: R, text: 'Général ! La réserve royale de fromage a disparu. Quarante kilos de comté. Il ne reste qu’une odeur de soufre et une crotte de rat.' },
  { who: G, text: 'Encore les brainrots ?' },
  { who: S, text: 'Non, Général. Les éclaireurs parlent d’une sorcière : Martine. Elle aurait séduit un rat, un certain Youg, avec un filtre d’amour au camembert.' },
  { who: R, text: 'Un rat amoureux et une sorcière ignoble. Chassez-la, Général. Et rapportez le comté.' },
  { who: G, text: 'La chasse à la sorcière est ouverte. En avant !' },
];

const L = (name: string, intro: Line[], outro: Line[]): LevelStory => ({ name, intro, outro });

/** Niveaux 26 à 75. */
export const STORY2: LevelStory[] = [
  // --- Acte IV · Le Marais des Balais (26 à 37)
  L('La Cave à Fromages Pillée', [
    { who: S, text: 'Des traces de petites pattes partout. Et une trace de balai.' },
    { who: G, text: 'Les rats reviennent chercher le reste. Des tours, vite !' },
  ], [{ who: S, text: 'On a trouvé un mot : « Le comté est délicieux. Bisous, M. »' }]),
  L('Le Marais Qui Bulle', [
    { who: G, text: 'Ce marais fait des bulles.' },
    { who: S, text: 'C’est le chaudron de Martine qui fuit, Général. Il y a une canalisation.' },
  ], [{ who: G, text: 'Notez : la sorcière ne paie pas sa plomberie.' }]),
  L('Les Crapauds Syndiqués', [
    { who: 'Un crapaud', text: 'Avant, j’étais comptable. Martine m’a transformé. Maintenant je défends son marais. Les avantages sociaux sont meilleurs.' },
  ], [{ who: 'Le crapaud', text: 'Bon. Je retourne à mes tableurs. Croa.' }]),
  L('Le Pont des Balais Perdus', [
    { who: S, text: 'Des centaines de balais abandonnés. Elle en change tous les jours.' },
    { who: G, text: 'Une sorcière qui jette ses balais. Quel gaspillage.' },
  ], [{ who: S, text: 'J’en ai gardé un. Il balaie tout seul. C’est pratique pour la caserne.' }]),
  L('La Hutte du Vieux Rebouteux', [
    { who: 'Le rebouteux', text: 'Martine ? Elle venait m’acheter des yeux de triton. Je lui ai vendu des olives. Elle n’a pas vu la différence.' },
  ], [{ who: 'Le rebouteux', text: 'Elle est partie vers les égouts. Elle a dit qu’elle allait « voir son chéri ».' }]),
  L('Le Champ de Citrouilles Mordeuses', [
    { who: G, text: 'Les citrouilles ont des dents.' },
    { who: S, text: 'Et elles sont de mauvaise humeur. Comme vous le lundi.' },
  ], [{ who: G, text: 'Ce soir, soupe de citrouille pour toute l’armée.' }]),
  L('La Brume Qui Chuchote', [
    { who: 'La brume', text: 'Martine… Martine… Martine est la plus belle…' },
    { who: S, text: 'Même la brume a été payée pour faire sa pub.' },
  ], [{ who: G, text: 'La brume se lève. On y voit plus clair. Sauf sur les intentions de Martine.' }]),
  L('Le Moulin des Rats Meuniers', [
    { who: 'Un rat meunier', text: 'On moud le blé du royaume pour en faire des cookies pour Youg. Il adore les cookies.' },
    { who: G, text: 'Volez-vous aussi les pépites de chocolat ?' },
    { who: 'Le rat meunier', text: 'Surtout les pépites.' },
  ], [{ who: S, text: 'Ils ont laissé une recette de cookies. Elle est excellente, Général.' }]),
  L('Le Village Ensorcelé', [
    { who: S, text: 'Tous les villageois parlent en rimes.' },
    { who: 'Un villageois', text: 'Le soleil est beau, Martine aussi, attaquez-les tous, et merci !' },
  ], [{ who: 'Le villageois', text: 'Ah, ça va mieux. Je ne rime plus. Quel soulagement.' }]),
  L('Le Chaudron Ambulant', [
    { who: M, text: '[voix lointaine] Mon chaudron a des jambes, maintenant. Il va vous transformer en soupe !' },
    { who: G, text: 'Un chaudron sur pattes. On aura tout vu.' },
  ], [
    { who: S, text: 'Le chaudron s’est renversé. Il contenait… de la raclette ?' },
    { who: G, text: 'Elle mange bien, cette sorcière. C’est presque vexant.' },
  ]),
  L('Les Chats Noirs en Grève', [
    { who: 'Un chat noir', text: 'On était les animaux préférés de Martine. Maintenant c’est ce Youg. On fait grève.' },
    { who: G, text: 'Rejoignez-nous, alors.' },
    { who: 'Le chat noir', text: 'Un chat ne rejoint personne. Mais on va regarder.' },
  ], [{ who: 'Le chat noir', text: 'Pas mal. On vous suit. De loin. En faisant semblant que non.' }]),
  L('L’Entrée des Égouts', [
    { who: S, text: 'Une grille, une odeur atroce, et un paillasson : « Youg et Martine, pour la vie ».' },
    { who: G, text: 'Il faut descendre. Pincez-vous le nez.' },
  ], [{ who: G, text: 'Les égouts. Le royaume des rats. Courage, mes braves.' }]),

  // --- Acte V · Les Égouts de Youg (38 à 50)
  L('Les Canalisations Grinçantes', [
    { who: 'Un rat', text: 'Youg est notre roi ! Youg est amoureux ! Vive l’amour et les cookies !' },
  ], [{ who: S, text: 'Ils sont très motivés par l’amour de leur chef. C’est presque touchant.' }]),
  L('Le Marché aux Miettes', [
    { who: S, text: 'Les rats échangent des miettes. Il y a une bourse, des cours, des courtiers.' },
    { who: G, text: 'Le cours du gruyère s’effondre. On attaque pendant la panique.' },
  ], [{ who: G, text: 'Krach boursier chez les rats. Notez-le dans les livres d’histoire.' }]),
  L('La Chorale des Rats', [
    { who: 'La chorale', text: '♪ Youg aime Martine, Martine aime Youg, et nous on aime le fromage ♪' },
    { who: S, text: 'Ils chantent faux, Général.' },
  ], [{ who: 'Le chef de chœur', text: 'Vous n’avez aucune oreille musicale. Mais vous tapez fort.' }]),
  L('Le Lac de Lait Caillé', [
    { who: G, text: 'Un lac entier de lait caillé.' },
    { who: S, text: 'C’est là qu’ils font le fromage pour Youg. Il ne mange que du frais.' },
  ], [{ who: S, text: 'On a sauvé le lac. Le royaume aura du fromage pour dix ans.' }]),
  L('Le Laboratoire de Martine', [
    { who: S, text: 'Des fioles partout. Une étiquette : « Filtre d’amour au camembert, dose pour rat ».' },
    { who: G, text: 'Elle l’a vraiment ensorcelé. Le pauvre Youg ne sait pas ce qu’il fait.' },
  ], [{ who: G, text: 'On garde une fiole comme preuve. Ne la buvez pas, Sergente.' }]),
  L('Le Tunnel de Bagou', [
    { who: B, text: 'Salut ! C’est moi, Bagou. Je suis repenti, j’utilise Linux Mint maintenant, c’est plus doux. Ces tunnels, je les avais creusés. Les rats les ont pris.' },
    { who: G, text: 'Alors aide-nous.' },
    { who: B, text: 'sudo aider --tout-de-suite. Allez-y !' },
  ], [{ who: B, text: 'Bon courage. Et si vous croisez Martine, dites-lui que son portail web est plein de failles.' }]),
  L('Les Rats Ninjas', [
    { who: S, text: 'Des rats en pyjama noir. Ils sont invisibles. Enfin, presque.' },
    { who: 'Un rat ninja', text: 'Hiii-ya !' },
  ], [{ who: G, text: 'Des ninjas qui crient leur attaque. Ils ne sont pas très discrets.' }]),
  L('Le Balai Géant', [
    { who: M, text: '[voix dans les tuyaux] Mon balai préféré va balayer votre armée. Au revoir, les nuls !' },
    { who: G, text: 'Un balai de dix mètres. Elle a de l’ambition.' },
  ], [
    { who: S, text: 'Le balai est en miettes. Martine a crié « MON BALAI ! » dans tous les tuyaux.' },
    { who: G, text: 'On approche. Elle s’énerve.' },
  ]),
  L('La Salle du Trésor Rongé', [
    { who: S, text: 'Le comté du roi ! Enfin… ce qu’il en reste. Un tiers. Avec des trous.' },
  ], [{ who: R, text: '[par courrier] Rapportez même les trous. Je les mettrai dans un musée.' }]),
  L('L’Hôpital des Rats', [
    { who: 'Une infirmière rat', text: 'Chut ! Ici, on soigne les rats blessés par vos tours. Vous pourriez faire moins de bruit ?' },
    { who: G, text: 'Ce sont eux qui nous attaquent.' },
    { who: 'L’infirmière rat', text: 'Et vous, vous répondez. C’est pareil.' },
  ], [{ who: S, text: 'On a laissé des pansements. Dans le doute.' }]),
  L('Le Couloir des Lettres d’Amour', [
    { who: S, text: 'Les murs sont couverts de lettres. « Ma Martine, mon cœur de gorgonzola… » Signé Youg.' },
    { who: G, text: 'Il est vraiment très amoureux.' },
  ], [{ who: S, text: 'La dernière lettre dit : « Elle ne me répond plus depuis qu’elle a le comté. »' }]),
  L('La Garde Royale des Rats', [
    { who: 'Le capitaine des rats', text: 'Nul ne passe ! Le roi Youg prépare son discours pour sa bien-aimée.' },
    { who: G, text: 'Nous passerons. Discours ou pas.' },
  ], [{ who: 'Le capitaine des rats', text: 'Bon. Allez-y. Mais il est très sensible, ne riez pas de ses poèmes.' }]),
  L('Le Trône de Youg', [
    { who: Y, text: 'Qui ose déranger Youg ? Youg écrit un poème pour Martine. Ça rime avec « tartine ».' },
    { who: G, text: 'Youg, elle t’a ensorcelé ! Avec un filtre au camembert !' },
    { who: Y, text: 'Mensonge ! Martine m’aime ! Elle me l’a dit… une fois… il y a longtemps… RATS, À L’ATTAQUE !' },
  ], [
    { who: Y, text: 'Couic… Le sort se dissipe… Je sens… je sens que je déteste le camembert.' },
    { who: Y, text: 'Elle m’a utilisé pour voler le comté. Elle ne m’a jamais aimé. Snif.' },
    { who: S, text: 'Il s’enfuit en pleurant. Martine est partie vers la forêt des chaudrons.' },
  ]),

  // --- Acte VI · La Forêt des Chaudrons (51 à 62)
  L('L’Orée de la Forêt Fumante', [
    { who: S, text: 'Chaque arbre a un chaudron accroché. Ça sent la soupe aux orties.' },
    { who: G, text: 'Elle a privatisé une forêt entière pour cuisiner.' },
  ], [{ who: G, text: 'Avancez. Et ne goûtez à rien.' }]),
  L('Les Champignons qui Dansent', [
    { who: 'Un champignon', text: 'On danse pour Martine ! Un pas à gauche, un pas sur votre armée !' },
  ], [{ who: S, text: 'Les champignons ont arrêté de danser. Ils font une pause syndicale, eux aussi.' }]),
  L('Le Cœur Brisé de Youg', [
    { who: Y, text: '[assis sur une souche] Youg est triste. Youg ne veut plus rien. Sauf peut-être un cookie.' },
    { who: G, text: 'Tiens, un cookie. Mais ses rats nous attaquent encore.' },
    { who: Y, text: 'Ils ne savent pas encore. Youg va leur dire. Après le cookie.' },
  ], [{ who: Y, text: 'Merci pour le cookie. Youg va réfléchir. Youg réfléchit lentement.' }]),
  L('Le Puits aux Souhaits Truqué', [
    { who: S, text: 'Un puits aux souhaits. Panneau : « Tous les souhaits reviennent à Martine ».' },
    { who: G, text: 'Même les souhaits sont détournés. Quelle escroquerie.' },
  ], [{ who: S, text: 'J’ai souhaité que vous rasiez cette moustache. Rien ne s’est passé. C’est bien truqué.' }]),
  L('La Gargouille Baveuse', [
    { who: M, text: '[du haut d’un arbre] Ma gargouille bave de l’acide. Bon appétit, les héros !' },
    { who: G, text: 'Une gargouille qui bave. Prévoyez des serviettes.' },
  ], [
    { who: S, text: 'La gargouille est en morceaux. Elle a bavé jusqu’au bout.' },
    { who: M, text: 'Vous me fatiguez. Je retourne dans ma tour. Ne me suivez pas !' },
  ]),
  L('La Clairière des Sorcières Retraitées', [
    { who: 'Une vieille sorcière', text: 'Martine ? Une débutante. Elle a raté son examen de balai trois fois.' },
    { who: G, text: 'Vous pourriez nous aider ?' },
    { who: 'La vieille sorcière', text: 'Je suis à la retraite, mon petit. Mais je vous regarde, ça me fait un spectacle.' },
  ], [{ who: 'La vieille sorcière', text: 'Pas mal ! Sa tour est au nord. Elle a mis le wifi, ça se voit de loin.' }]),
  L('Le Champ de Bave de Crapaud', [
    { who: S, text: 'Ça colle aux bottes, Général.' },
    { who: G, text: 'Tout colle, dans ce royaume. Même Martine à notre fromage.' },
  ], [{ who: S, text: 'On a perdu trois bottes. Les rats les ont gardées comme trophées.' }]),
  L('Le Retour de Tonton Jean-Mi', [
    { who: J, text: 'Wesh les jeunes ! J’ai appris qu’il y avait une sorcière. C’est mon moment : j’ai fait un stage de chamanisme à Pornic.' },
    { who: G, text: 'Vous allez nous aider ?' },
    { who: J, text: 'Je vais vous encourager. C’est déjà beaucoup. ALLEZ LES BLEUS !' },
  ], [{ who: J, text: 'Vous avez assuré grave. C’est le feu. Le feu de la sorcière, mais le feu quand même.' }]),
  L('Les Hiboux Espions', [
    { who: S, text: 'Des hiboux avec des caméras. Ils filment tout pour Martine.' },
    { who: G, text: 'Souriez, on est filmés.' },
  ], [{ who: G, text: 'Plus de caméras. La sorcière est aveugle. Profitons-en.' }]),
  L('La Rivière de Potion', [
    { who: S, text: 'La rivière change de couleur toutes les minutes. Rose, vert, violet…' },
    { who: G, text: 'Ne buvez pas. On ne sait pas ce que ça fait.' },
    { who: S, text: 'Un rat a bu. Il a des ailes, maintenant.' },
  ], [{ who: S, text: 'Le rat volant est très content. Il ne veut plus se battre, il veut voyager.' }]),
  L('Youg Choisit son Camp', [
    { who: Y, text: 'Youg a réfléchi. Youg a beaucoup réfléchi. Youg en veut à Martine. Youg va aider.' },
    { who: G, text: 'Et tes rats ?' },
    { who: Y, text: 'Certains écoutent Youg. D’autres écoutent encore Martine. Attention aux deuxièmes.' },
  ], [{ who: Y, text: 'Youg connaît un passage vers la tour. Il sent le fromage. Suivez Youg.' }]),
  L('Le Pied de la Tour', [
    { who: S, text: 'La tour de Martine. Treize étages, des volets violets et un ascenseur en panne.' },
    { who: M, text: 'Vous ne monterez jamais ! L’ascenseur est en panne exprès !' },
  ], [{ who: G, text: 'On prendra l’escalier. Mes soldats sont sportifs.' }]),

  // --- Acte VII · La Tour de Martine (63 à 75)
  L('Le Hall aux Miroirs', [
    { who: M, text: 'Miroir, mon beau miroir, qui est la plus ignoble ?' },
    { who: 'Le miroir', text: 'C’est toi, Martine. De loin.' },
    { who: M, text: 'Parfait. Attaquez-les !' },
  ], [{ who: 'Le miroir', text: 'Félicitations. Moi, je reste neutre. Je suis un miroir.' }]),
  L('L’Escalier en Colimaçon', [
    { who: S, text: 'Quatre cents marches, Général.' },
    { who: G, text: 'Chaque marche est une victoire.' },
    { who: S, text: 'Chaque marche est surtout une crampe.' },
  ], [{ who: G, text: 'Le royaume des Cramptés n’a jamais aussi bien porté son nom.' }]),
  L('Le Corbeau Titan', [
    { who: M, text: 'Mon corbeau géant vous attend au 3e étage. Il a faim, et vous êtes au menu !' },
    { who: G, text: 'Un corbeau titan. Tenez bon, et visez le bec.' },
  ], [
    { who: S, text: 'Le corbeau s’est envolé par la fenêtre. Il a laissé un fromage tomber.' },
    { who: G, text: 'Un fromage ! La fable était vraie !' },
  ]),
  L('La Bibliothèque Maudite', [
    { who: S, text: 'Les livres volent et mordent. Le rayon « recettes » est le pire.' },
  ], [{ who: S, text: 'J’ai trouvé son grimoire : « Mille façons de voler un fromage ». Elle l’a écrit elle-même.' }]),
  L('Les Cuisines de la Sorcière', [
    { who: S, text: 'La raclette tourne en permanence. Avec le comté du roi.' },
    { who: G, text: 'Le comté royal dans une raclette. C’est une déclaration de guerre.' },
  ], [{ who: R, text: '[par pigeon voyageur] DANS UNE RACLETTE ?! Général, plus de pitié.' }]),
  L('La Salle des Balais de Course', [
    { who: M, text: 'Vous voyez ces balais ? Des modèles de course. Zéro à cent en deux secondes.' },
    { who: G, text: 'Et nous, on a des tours. Zéro balai à la fin.' },
  ], [{ who: S, text: 'On a gardé un balai de course pour Youg. Il est ravi.' }]),
  L('Le Grenier aux Chauves-Souris', [
    { who: S, text: 'Des milliers de chauves-souris. Elles ont toutes le même tatouage : « M ».' },
  ], [{ who: G, text: 'Le grenier est libéré. Les chauves-souris sont parties chez le voisin.' }]),
  L('Le Jardin Suspendu des Plantes Carnivores', [
    { who: 'Une plante carnivore', text: 'Martine nous nourrit de rats. Vous avez l’air plus croquants.' },
  ], [{ who: 'La plante carnivore', text: 'Bon. On se remet au végétarisme. C’est plus sûr.' }]),
  L('La Salle du Grand Chaudron', [
    { who: M, text: 'Mon grand chaudron ! J’y prépare la potion qui changera tout le royaume en crapauds !' },
    { who: G, text: 'Tout le royaume ?' },
    { who: M, text: 'Sauf moi. Et le comté. Le comté, je le garde.' },
  ], [{ who: S, text: 'On a renversé le chaudron. La potion a changé le tapis en crapaud. Il est très perturbé.' }]),
  L('Le Balcon des Rats Fidèles', [
    { who: Y, text: 'Derniers rats de Martine ! Youg vous le dit : elle ne vous aime pas ! Elle n’aime que le comté !' },
    { who: 'Un rat fidèle', text: 'C’est vrai, ça ?' },
    { who: Y, text: 'Youg a lu ses lettres. Elle ne répond jamais.' },
  ], [{ who: 'Le rat fidèle', text: 'On arrête. On rentre aux égouts. On va écrire nos propres poèmes.' }]),
  L('L’Antichambre', [
    { who: S, text: 'Une porte violette. Un écriteau : « Martine. Sonnez. Ne sonnez pas. »' },
    { who: G, text: 'On sonne.' },
  ], [{ who: M, text: 'Qui a sonné ?! J’avais dit de ne pas sonner !' }]),
  L('Le Toit de la Tour', [
    { who: M, text: 'Vous ne m’aurez jamais ! Je m’envole sur mon balai !' },
    { who: S, text: 'Son balai est le dernier, Général. Les autres sont cassés ou chez Youg.' },
  ], [{ who: M, text: 'Mon balai crachote… Très bien. Rendez-vous dans ma chambre secrète. Ce sera la fin !' }]),
  L('La Chambre Secrète de Martine', [
    { who: M, text: 'Assez ! Je vais vous transformer en crapauds, vos tours en nénuphars, et votre roi en fromage frais !' },
    { who: Y, text: 'Martine ! Youg est là. Youg ne t’aime plus.' },
    { who: M, text: 'Youg ? Tu as rompu le sort ? Mais… qui va me rapporter du fromage, maintenant ?' },
    { who: G, text: 'Personne. Pour le roi, pour le comté, et pour Youg : FEU !' },
  ], [
    { who: M, text: 'Nooon… Mon propre sort se retourne contre moi… Croa ?' },
    { who: S, text: 'Elle s’est transformée en crapaud. Un tout petit crapaud violet.' },
    { who: Y, text: 'Youg va s’en occuper. Youg lui apprendra la gentillesse. Et le partage du fromage.' },
    { who: R, text: 'Général ! Le comté est rentré, un peu fondu. Le royaume est sauvé une deuxième fois. Vous aurez une médaille… en fromage.' },
    { who: G, text: 'C’est la plus belle médaille du monde, Majesté.' },
  ]),
];
