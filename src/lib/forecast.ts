/**
 * Algorithme de prévision météo intelligent.
 *
 * Chaîne de traitement :
 *   Point_de_Vente -> Ville -> Open-Meteo (géocodage) -> lat/lon
 *   -> Open-Meteo (forecast) -> weathercode
 *   -> coefficient météo selon Famille_Produit
 *   -> Prevision_IA   = Quantite_Vendue * coefficient
 *   -> Reassort       = max(0, Prevision_IA - Stock_Actuel)   [par boutique]
 *   -> Total SKU      = somme des réassorts de toutes les boutiques (bottom-up)
 *
 * Toute erreur réseau est absorbée silencieusement : le weathercode devient
 * `null`, le coefficient retombe à 1.0 et l'affichage n'est jamais bloqué.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Une ligne du CSV/Excel importé, normalisée. */
export interface ImportedRow {
 Code_Article: string;
 Designation: string;
 Famille_Produit: string;
 Date_Transaction: string;
 Quantite_Vendue: number;
 Stock_Actuel: number;
 CA_HT: number;
 Point_de_Vente: string;
 Ville: string;
}

/** weathercode courant par ville (`null` = météo indisponible). */
export type WeatherByVille = Record<string, number | null>;

/** Une ligne enrichie par l'algorithme. */
export interface ForecastRow extends ImportedRow {
 Weathercode: number | null;
 Coefficient: number;
 Prevision_IA: number;
 /** Unités à recommander pour cette ligne : max(0, Prevision_IA - Stock_Actuel). */
 Reassort: number;
 /** Réassort sans ajustement météo (coefficient 1.0), pour comparaison. */
 Reassort_Base: number;
}

/** Agrégat d'une boutique pour un SKU donné. */
export interface BoutiqueAllocation {
 pointDeVente: string;
 ville: string;
 weathercode: number | null;
 coefficient: number;
 quantiteVendue: number;
 stockActuel: number;
 previsionIA: number;
 /** Unités recommandées pour cette boutique. */
 reassort: number;
 /** Part de cette boutique dans le total global du SKU, en %. */
 allocationPct: number;
}

/** Agrégat global d'un SKU (bottom-up depuis les boutiques). */
export interface SkuAggregate {
 sku: string;
 designation: string;
 famille: string;
 quantiteVendue: number;
 stockActuel: number;
 previsionIA: number;
 /** Total consolidé affiché sur la grande carte « Prévision IA ». */
 totalReassort: number;
 /** Même total, sans ajustement météo (carte « Prévision initiale »). */
 totalReassortBase: number;
 /** Écart de l'IA vs la prévision initiale, en %. */
 upliftPct: number;
 boutiques: BoutiqueAllocation[];
}

// ---------------------------------------------------------------------------
// 1. Extraction de la ville depuis Point_de_Vente
// ---------------------------------------------------------------------------

const NON_VILLE_TOKENS = ['boutique', 'magasin', 'store', 'shop', 'pdv', 'corner'];

/**
 * Extrait le nom propre de la ville depuis un Point_de_Vente.
 * Ex : 'Boutique_Paris_1' -> 'Paris', 'Boutique_Lyon' -> 'Lyon', 'PDV-Lille-03' -> 'Lille'
 */
export const extractVille = (pointDeVente: string): string => {
 if (!pointDeVente) return '';
 const parts = String(pointDeVente).split(/[_\-\s/]+/);
 const ville = parts.find(
  (p) => p && !NON_VILLE_TOKENS.includes(p.toLowerCase()) && !/^\d+$/.test(p)
 );
 return (ville ?? String(pointDeVente)).trim();
};

// ---------------------------------------------------------------------------
// 1 bis. Reconnaissance tolérante des colonnes
// ---------------------------------------------------------------------------

/**
 * Réduit un en-tête à une forme canonique comparable.
 * `'Code_Article (SKU)'`, `'code article'` et `'CODE_ARTICLE'` -> `'code_article'`
 */
const normalizeKey = (key: string): string =>
 String(key)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '') // accents
  .replace(/\([^)]*\)/g, ' ') // annotations entre parenthèses, ex. « (SKU) »
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

/**
 * Noms de colonnes acceptés pour chaque champ, par ordre de priorité.
 * Les exports Excel/Sheets varient (casse, accents, libellés) : on accepte
 * les variantes courantes plutôt que d'exiger l'orthographe exacte.
 */
const COLUMN_ALIASES = {
 Code_Article: ['code_article', 'sku', 'code_sku', 'reference', 'ref', 'code', 'article'],
 Designation: ['designation', 'libelle', 'nom_produit', 'produit', 'nom', 'description'],
 Famille_Produit: ['famille_produit', 'famille', 'categorie', 'category', 'rayon'],
 Date_Transaction: ['date_transaction', 'date_vente', 'date'],
 Quantite_Vendue: ['quantite_vendue', 'qte_vendue', 'quantite', 'qte', 'ventes', 'volume'],
 Stock_Actuel: ['stock_actuel', 'stock_dispo', 'stock'],
 /** Montant déjà consolidé pour la ligne. */
 CA_HT: ['ca_ht', 'chiffre_affaires_ht', 'chiffre_affaires', 'ca', 'montant_ht', 'montant'],
 /**
  * Prix à l'unité. Distinct du CA : sommer des prix unitaires n'a aucun sens,
  * il faut les multiplier par la quantité vendue pour obtenir un CA.
  */
 Prix_Unitaire: ['prix_vente_ht', 'prix_unitaire_ht', 'prix_ht', 'prix_unitaire', 'prix'],
 Point_de_Vente: ['point_de_vente', 'pdv', 'boutique', 'magasin', 'store', 'site']
} as const;

/** Indexe une ligne brute par en-têtes canoniques. */
const buildLookup = (row: any): Map<string, unknown> => {
 const lookup = new Map<string, unknown>();
 for (const key of Object.keys(row ?? {})) {
  const canonical = normalizeKey(key);
  // Le premier en-tête gagne : on n'écrase pas une colonne déjà reconnue.
  if (!lookup.has(canonical)) lookup.set(canonical, row[key]);
 }
 return lookup;
};

/** Première colonne renseignée parmi les alias acceptés. */
const pickField = (lookup: Map<string, unknown>, aliases: readonly string[]): unknown => {
 for (const alias of aliases) {
  const value = lookup.get(alias);
  if (value !== undefined && value !== null && value !== '') return value;
 }
 return undefined;
};

/**
 * Convertit en nombre en tolérant les formats français et les devises :
 * `'185,00 €'` -> 185, `'1 250'` -> 1250, `'2650.00'` -> 2650.
 */
const parseNumber = (value: unknown): number => {
 if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
 if (value === undefined || value === null) return 0;
 const cleaned = String(value)
  .replace(/[\s  ]/g, '') // espaces, y compris insécables
  .replace(/[^0-9.,\-]/g, '') // symboles monétaires et unités
  .replace(/,/g, '.'); // virgule décimale française
 // Si plusieurs points subsistent, les premiers sont des séparateurs de milliers.
 const parts = cleaned.split('.');
 const normalized = parts.length > 2 ? parts.slice(0, -1).join('') + '.' + parts.at(-1) : cleaned;
 const n = Number(normalized);
 return Number.isFinite(n) ? n : 0;
};

/** Origine du calendrier Excel (1899-12-30) pour convertir les dates sérialisées. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Formate une Date en `AAAA-MM-JJ` à partir de ses composantes locales. */
const toISODate = (d: Date): string =>
 `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Ramène une date au format `AAAA-MM-JJ`.
 * Accepte un objet Date, un numéro de série Excel (ex. 46029) et les chaînes
 * `JJ/MM/AAAA` (convention française) ou `AAAA-MM-JJ`.
 */
const normalizeDate = (value: unknown): string => {
 if (value instanceof Date && !Number.isNaN(value.getTime())) return toISODate(value);
 if (typeof value === 'number' && Number.isFinite(value)) {
  return toISODate(new Date(EXCEL_EPOCH_MS + Math.round(value) * 86400000));
 }
 const text = String(value ?? '').trim();
 const fr = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
 if (fr) {
  const [, jour, mois, annee] = fr;
  return `${annee}-${mois.padStart(2, '0')}-${jour.padStart(2, '0')}`;
 }
 const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
 return iso ? iso[0] : text;
};

/**
 * Normalise une ligne brute du fichier : retrouve les colonnes attendues quelle
 * que soit la variante d'en-tête, puis ajoute la propriété `Ville` déduite de
 * `Point_de_Vente`.
 */
export const formatRow = (row: any): ImportedRow => {
 const lookup = buildLookup(row);
 const get = (aliases: readonly string[]) => pickField(lookup, aliases);
 const pointDeVente = String(get(COLUMN_ALIASES.Point_de_Vente) ?? '');
 const quantite = parseNumber(get(COLUMN_ALIASES.Quantite_Vendue));

 // Le fichier fournit soit un CA de ligne, soit un prix unitaire : dans le
 // second cas on reconstitue le CA en multipliant par la quantité vendue.
 const montant = get(COLUMN_ALIASES.CA_HT);
 const caHt =
  montant !== undefined
   ? parseNumber(montant)
   : parseNumber(get(COLUMN_ALIASES.Prix_Unitaire)) * quantite;

 return {
  Code_Article: String(get(COLUMN_ALIASES.Code_Article) ?? ''),
  Designation: String(get(COLUMN_ALIASES.Designation) ?? ''),
  Famille_Produit: String(get(COLUMN_ALIASES.Famille_Produit) ?? ''),
  Date_Transaction: normalizeDate(get(COLUMN_ALIASES.Date_Transaction)),
  Quantite_Vendue: quantite,
  Stock_Actuel: parseNumber(get(COLUMN_ALIASES.Stock_Actuel)),
  CA_HT: caHt,
  Point_de_Vente: pointDeVente,
  Ville: extractVille(pointDeVente)
 };
};

/** Villes distinctes présentes dans un jeu de données. */
export const distinctVilles = (rows: ImportedRow[]): string[] =>
 Array.from(new Set(rows.map((r) => r.Ville).filter(Boolean)));

// ---------------------------------------------------------------------------
// 2. Appels Open-Meteo (géocodage puis météo courante)
// ---------------------------------------------------------------------------

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const WEATHER_CACHE_KEY = 'smartRetail_weatherCache';
const WEATHER_CACHE_TTL = 60 * 60 * 1000; // 1 heure

type WeatherCache = Record<string, { code: number | null; ts: number }>;

const readWeatherCache = (): WeatherCache => {
 try {
  const raw = localStorage.getItem(WEATHER_CACHE_KEY);
  return raw ? (JSON.parse(raw) as WeatherCache) : {};
 } catch {
  return {};
 }
};

const writeWeatherCache = (cache: WeatherCache): void => {
 try {
  localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
 } catch {
  /* quota plein ou storage indisponible : sans conséquence */
 }
};

/**
 * Étape A : géocodage de la ville -> latitude / longitude.
 * Renvoie `null` si la ville est introuvable ou si l'appel échoue.
 */
export const geocodeVille = async (
 ville: string,
 signal?: AbortSignal
): Promise<{ latitude: number; longitude: number } | null> => {
 try {
  const res = await fetch(
   `${GEOCODING_URL}?name=${encodeURIComponent(ville)}&count=1`,
   { signal }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const hit = data?.results?.[0];
  if (typeof hit?.latitude !== 'number' || typeof hit?.longitude !== 'number') return null;
  return { latitude: hit.latitude, longitude: hit.longitude };
 } catch {
  return null; // échec silencieux
 }
};

/**
 * Étape B : météo courante -> weathercode.
 * Renvoie `null` si l'appel échoue.
 */
export const fetchWeathercode = async (
 latitude: number,
 longitude: number,
 signal?: AbortSignal
): Promise<number | null> => {
 try {
  const res = await fetch(
   `${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}&current_weather=true`,
   { signal }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const code = data?.current_weather?.weathercode;
  return typeof code === 'number' ? code : null;
 } catch {
  return null; // échec silencieux
 }
};

/** Enchaîne géocodage + météo pour une ville, avec cache local (TTL 1 h). */
export const fetchWeathercodeForVille = async (
 ville: string,
 signal?: AbortSignal
): Promise<number | null> => {
 const key = ville.toLowerCase();
 const cache = readWeatherCache();
 const cached = cache[key];
 if (cached && Date.now() - cached.ts < WEATHER_CACHE_TTL) return cached.code;

 const coords = await geocodeVille(ville, signal);
 const code = coords ? await fetchWeathercode(coords.latitude, coords.longitude, signal) : null;

 // On ne met en cache que les succès : un échec doit pouvoir être retenté.
 if (code !== null) writeWeatherCache({ ...readWeatherCache(), [key]: { code, ts: Date.now() } });
 return code;
};

/**
 * Récupère en parallèle le weathercode de chaque ville.
 * Ne rejette jamais : une ville en échec vaut `null`.
 */
export const fetchWeatherForVilles = async (
 villes: string[],
 signal?: AbortSignal
): Promise<WeatherByVille> => {
 const entries = await Promise.all(
  villes.map(async (ville): Promise<[string, number | null]> => [
   ville,
   await fetchWeathercodeForVille(ville, signal)
  ])
 );
 return Object.fromEntries(entries);
};

// ---------------------------------------------------------------------------
// 3. Algorithme d'ajustement météo
// ---------------------------------------------------------------------------

/** weathercode >= 50 : bruine, pluie, neige, averses, orage. */
export const isRainy = (code: number | null | undefined): boolean =>
 typeof code === 'number' && code >= 50;

/** weathercode <= 3 : ciel clair à partiellement couvert. */
export const isSunny = (code: number | null | undefined): boolean =>
 typeof code === 'number' && code <= 3;

/** Racines des familles dopées par la pluie. */
const RAIN_FAMILY_STEMS = ['accessoire', 'manteau'];
/** Racines des familles dopées par le beau temps. */
const SUN_FAMILY_STEMS = ['bain'];

/**
 * Vrai si l'un des mots de la famille commence par l'une des racines.
 * Tolère le pluriel et les libellés composés : « Manteaux », « Manteau Laine »
 * et « Maillot de bain » sont reconnus.
 */
const familleMatches = (familleProduit: string, stems: readonly string[]): boolean =>
 String(familleProduit ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean)
  .some((mot) => stems.some((stem) => mot.startsWith(stem)));

/**
 * Coefficient multiplicateur appliqué à Quantite_Vendue.
 *  - Accessoires / Manteaux + pluie (code >= 50) -> 1.3
 *  - Bain + beau temps (code <= 3)               -> 1.5
 *  - sinon (météo indisponible incluse)          -> 1.0
 */
export const getWeatherCoefficient = (
 familleProduit: string,
 weathercode: number | null | undefined
): number => {
 if (familleMatches(familleProduit, RAIN_FAMILY_STEMS) && isRainy(weathercode)) return 1.3;
 if (familleMatches(familleProduit, SUN_FAMILY_STEMS) && isSunny(weathercode)) return 1.5;
 return 1.0;
};

/** Libellé lisible d'un weathercode WMO. */
export const weatherLabel = (code: number | null | undefined): string => {
 if (typeof code !== 'number') return 'Météo indisponible';
 if (code <= 1) return 'Ensoleillé';
 if (code <= 3) return 'Éclaircies';
 if (code < 50) return 'Brouillard';
 if (code < 60) return 'Bruine';
 if (code < 70) return 'Pluie';
 if (code < 80) return 'Neige';
 if (code < 90) return 'Averses';
 return 'Orage';
};

// ---------------------------------------------------------------------------
// 4. Calcul du réassort local (par ligne / boutique)
// ---------------------------------------------------------------------------

export const computeForecastRows = (
 rows: ImportedRow[],
 weather: WeatherByVille
): ForecastRow[] =>
 rows.map((row) => {
  const weathercode = weather[row.Ville] ?? null;
  const coefficient = getWeatherCoefficient(row.Famille_Produit, weathercode);
  const previsionIA = Math.round(row.Quantite_Vendue * coefficient);
  return {
   ...row,
   Weathercode: weathercode,
   Coefficient: coefficient,
   Prevision_IA: previsionIA,
   Reassort: Math.max(0, previsionIA - row.Stock_Actuel),
   Reassort_Base: Math.max(0, row.Quantite_Vendue - row.Stock_Actuel)
  };
 });

// ---------------------------------------------------------------------------
// 5. Agrégation globale bottom-up (boutiques -> SKU)
// ---------------------------------------------------------------------------

export const aggregateBySku = (rows: ForecastRow[]): SkuAggregate[] => {
 const bySku = new Map<string, ForecastRow[]>();
 for (const row of rows) {
  const sku = row.Code_Article || '—';
  const bucket = bySku.get(sku);
  if (bucket) bucket.push(row);
  else bySku.set(sku, [row]);
 }

 const aggregates: SkuAggregate[] = [];

 for (const [sku, skuRows] of bySku) {
  // Regroupement par point de vente (plusieurs dates possibles par boutique).
  const byBoutique = new Map<string, ForecastRow[]>();
  for (const row of skuRows) {
   const pdv = row.Point_de_Vente || row.Ville || '—';
   const bucket = byBoutique.get(pdv);
   if (bucket) bucket.push(row);
   else byBoutique.set(pdv, [row]);
  }

  const sum = (list: ForecastRow[], pick: (r: ForecastRow) => number) =>
   list.reduce((acc, r) => acc + pick(r), 0);

  // Total global = somme des réassorts de toutes les boutiques (bottom-up).
  const totalReassort = sum(skuRows, (r) => r.Reassort);
  const totalReassortBase = sum(skuRows, (r) => r.Reassort_Base);

  const boutiques: BoutiqueAllocation[] = Array.from(byBoutique, ([pdv, list]) => {
   const reassort = sum(list, (r) => r.Reassort);
   const last = list[list.length - 1];
   return {
    pointDeVente: pdv,
    ville: last.Ville,
    weathercode: last.Weathercode,
    coefficient: last.Coefficient,
    quantiteVendue: sum(list, (r) => r.Quantite_Vendue),
    stockActuel: last.Stock_Actuel,
    previsionIA: sum(list, (r) => r.Prevision_IA),
    reassort,
    // Pourcentage d'allocation exact de la boutique dans le total global.
    allocationPct: totalReassort > 0 ? (reassort / totalReassort) * 100 : 0
   };
  }).sort((a, b) => b.reassort - a.reassort);

  const first = skuRows[0];
  aggregates.push({
   sku,
   designation: first.Designation || sku,
   famille: first.Famille_Produit,
   quantiteVendue: sum(skuRows, (r) => r.Quantite_Vendue),
   // Le stock est un état, pas un flux : on somme une valeur par boutique et
   // non toutes les lignes, sinon une boutique présente sur 20 dates verrait
   // son stock compté 20 fois.
   stockActuel: boutiques.reduce((total, b) => total + b.stockActuel, 0),
   previsionIA: sum(skuRows, (r) => r.Prevision_IA),
   totalReassort,
   totalReassortBase,
   upliftPct:
    totalReassortBase > 0
     ? ((totalReassort - totalReassortBase) / totalReassortBase) * 100
     : 0,
   boutiques
  });
 }

 return aggregates.sort((a, b) => b.totalReassort - a.totalReassort);
};

// ---------------------------------------------------------------------------
// 6. Indicateurs du tableau de bord
// ---------------------------------------------------------------------------

/** Objectifs saisis à l'onboarding (stockés en chaînes de caractères). */
export interface Objectifs {
 salesTarget?: string;
 optimalStock?: string;
 alertThreshold?: string;
}

export interface DashboardKpis {
 /** Faux si aucun fichier n'a été importé : l'UI garde ses valeurs de démo. */
 hasData: boolean;
 /** CA prévu = somme des CA_HT repondérés par le coefficient météo. */
 caPrevu: number;
 /** Écart du CA prévu, vs l'objectif de ventes si renseigné, sinon vs le CA brut. */
 ecartCaPct: number;
 ecartCaLabel: string;
 /** SKU ayant au moins une boutique sous le seuil d'alerte. `null` si seuil absent. */
 skusEnAlerte: number | null;
 /** SKU ayant au moins une boutique au-dessus du stock optimal. `null` si absent. */
 skusSurStock: number | null;
 /** Écart global entre Prevision_IA et Quantite_Vendue, en %. */
 impactMeteoPct: number;
 /** Famille de produits la plus dopée par la météo, si l'une l'est. */
 familleImpactee: string | null;
 /**
  * Phrase expliquant à l'utilisateur pourquoi la météo n'a rien changé.
  * `null` dès qu'au moins une ligne a été ajustée.
  */
 explicationMeteo: string | null;
}

/** Convertit un objectif saisi en seuil exploitable (`null` si vide ou invalide). */
const parseSeuil = (value: unknown): number | null => {
 const n = Number(String(value ?? '').trim());
 return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Calcule les quatre cartes du tableau de bord.
 *
 * Les seuils « stock faible » et « sur-stockage » sont ceux saisis à
 * l'onboarding et sont comparés au `Stock_Actuel` **de chaque boutique** :
 * un SKU est compté dès qu'au moins un de ses points de vente franchit le
 * seuil. Comparer un stock cumulé multi-boutiques à un seuil unitaire n'aurait
 * pas de sens.
 */
export const computeDashboardKpis = (
 rows: ForecastRow[],
 objectifs: Objectifs = {}
): DashboardKpis => {
 const seuilAlerte = parseSeuil(objectifs.alertThreshold);
 const stockOptimal = parseSeuil(objectifs.optimalStock);
 const objectifCa = parseSeuil(objectifs.salesTarget);

 if (rows.length === 0) {
  return {
   hasData: false,
   caPrevu: 0,
   ecartCaPct: 0,
   ecartCaLabel: '',
   skusEnAlerte: null,
   skusSurStock: null,
   impactMeteoPct: 0,
   familleImpactee: null,
   explicationMeteo: null
  };
 }

 const sum = (pick: (r: ForecastRow) => number) => rows.reduce((acc, r) => acc + pick(r), 0);

 const caPrevu = sum((r) => r.CA_HT * r.Coefficient);
 const caBrut = sum((r) => r.CA_HT);
 const quantiteTotale = sum((r) => r.Quantite_Vendue);
 const previsionTotale = sum((r) => r.Prevision_IA);

 // Comparaison prioritaire à l'objectif de ventes quand il est renseigné.
 const ecartCaPct = objectifCa
  ? ((caPrevu - objectifCa) / objectifCa) * 100
  : caBrut > 0
    ? ((caPrevu - caBrut) / caBrut) * 100
    : 0;
 const ecartCaLabel = objectifCa ? 'vs objectif' : 'avec météo';

 const compterSkus = (garder: (r: ForecastRow) => boolean): number =>
  new Set(rows.filter(garder).map((r) => r.Code_Article)).size;

 // Famille la plus dopée par la météo.
 const parFamille = new Map<string, { quantite: number; prevision: number }>();
 for (const r of rows) {
  const famille = r.Famille_Produit || '—';
  const acc = parFamille.get(famille) ?? { quantite: 0, prevision: 0 };
  acc.quantite += r.Quantite_Vendue;
  acc.prevision += r.Prevision_IA;
  parFamille.set(famille, acc);
 }
 let familleImpactee: string | null = null;
 let meilleurUplift = 0;
 for (const [famille, { quantite, prevision }] of parFamille) {
  if (quantite <= 0) continue;
  const uplift = (prevision - quantite) / quantite;
  if (uplift > meilleurUplift) {
   meilleurUplift = uplift;
   familleImpactee = famille;
  }
 }

 return {
  hasData: true,
  caPrevu,
  ecartCaPct,
  ecartCaLabel,
  skusEnAlerte: seuilAlerte === null ? null : compterSkus((r) => r.Stock_Actuel < seuilAlerte),
  skusSurStock: stockOptimal === null ? null : compterSkus((r) => r.Stock_Actuel > stockOptimal),
  impactMeteoPct:
   quantiteTotale > 0 ? ((previsionTotale - quantiteTotale) / quantiteTotale) * 100 : 0,
  familleImpactee,
  explicationMeteo: expliquerAbsenceDImpact(rows)
 };
};

/**
 * Explique pourquoi aucun coefficient météo ne s'est appliqué.
 * Trois causes possibles, distinguées ici pour ne pas laisser l'utilisateur
 * devant un « +0% » inexpliqué. Renvoie `null` dès qu'une ligne est ajustée.
 */
const expliquerAbsenceDImpact = (rows: ForecastRow[]): string | null => {
 if (rows.some((r) => r.Coefficient !== 1)) return null;

 // Cause 1 : les appels Open-Meteo ont tous échoué.
 if (rows.every((r) => typeof r.Weathercode !== 'number')) {
  return "Météo indisponible pour vos villes : les prévisions n'ont pas été ajustées (coefficient 1.0). Vérifiez votre connexion, puis réimportez le fichier.";
 }

 // Cause 2 : aucune des familles du fichier n'est sensible à la météo.
 const famillesSensibles = rows.filter(
  (r) =>
   familleMatches(r.Famille_Produit, RAIN_FAMILY_STEMS) ||
   familleMatches(r.Famille_Produit, SUN_FAMILY_STEMS)
 );
 if (famillesSensibles.length === 0) {
  return "Aucune famille sensible à la météo dans vos données. Seules les familles Accessoires et Manteaux (majorées par la pluie) et Bain (majorée par le beau temps) sont ajustées.";
 }

 // Cause 3 : les familles sont présentes mais la météo du jour ne déclenche rien.
 const villes = Array.from(new Set(rows.map((r) => r.Ville).filter(Boolean)));
 const pluie = villes.filter((v) =>
  rows.some((r) => r.Ville === v && isRainy(r.Weathercode))
 ).length;
 const contexte =
  pluie === 0
   ? `aucune pluie sur vos ${villes.length} ville${villes.length > 1 ? 's' : ''} aujourd'hui`
   : `la météo du jour ne correspond à aucune de vos familles sensibles`;
 return `Conditions neutres : ${contexte}. Accessoires et Manteaux ne sont majorés que par temps de pluie, Bain que par beau temps.`;
};

// ---------------------------------------------------------------------------
// 7. Période, graphique, recherche, ruptures et best-sellers
// ---------------------------------------------------------------------------

const JOUR_MS = 86400000;

/**
 * Minuit local du jour d'une date, utilisé comme clé d'agrégation.
 * On passe par les composantes calendaires et non par un calcul en
 * millisecondes : les jours de changement d'heure ne durent pas 24 h.
 */
export const debutDeJour = (d: Date): Date =>
 new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Décale une date d'un nombre de jours calendaires (robuste au passage à l'heure d'été). */
export const addDays = (d: Date, jours: number): Date =>
 new Date(d.getFullYear(), d.getMonth(), d.getDate() + jours);

/** Parse une date `AAAA-MM-JJ` en Date locale. `null` si invalide. */
export const parseISODate = (iso: string): Date | null => {
 const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if (!m) return null;
 const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
 return Number.isNaN(d.getTime()) ? null : d;
};

/** Étendue des dates présentes dans les données. */
export const datasetRange = (rows: ImportedRow[]): { debut: Date; fin: Date } | null => {
 const dates = rows
  .map((r) => parseISODate(r.Date_Transaction))
  .filter((d): d is Date => d !== null)
  .sort((a, b) => a.getTime() - b.getTime());
 return dates.length === 0 ? null : { debut: dates[0], fin: dates[dates.length - 1] };
};

/** Libellé de période, ex. « 2 JAN 2026 - 30 MAR 2026 ». */
export const formatPeriode = (debut: Date, fin: Date): string => {
 const fmt = (d: Date) =>
  d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase().replace('.', '');
 return `${fmt(debut)} - ${fmt(fin)}`;
};

/**
 * Bornes des `jours` derniers jours du jeu de données.
 * La référence est la date la plus récente du fichier, pas la date du jour :
 * un export historique reste ainsi exploitable.
 */
export const periodBounds = (
 rows: ImportedRow[],
 jours: number
): { debut: Date; fin: Date } | null => {
 const range = datasetRange(rows);
 if (!range) return null;
 const fin = debutDeJour(range.fin);
 return { debut: addDays(fin, -(jours - 1)), fin };
};

/** Restreint les lignes à un intervalle de dates inclusif. */
export const filterRowsByRange = (
 rows: ForecastRow[],
 debut: Date,
 fin: Date
): ForecastRow[] => {
 const min = debutDeJour(debut).getTime();
 const max = debutDeJour(fin).getTime();
 return rows.filter((r) => {
  const d = parseISODate(r.Date_Transaction);
  // Une date illisible n'est pas exclue : mieux vaut la compter que la perdre.
  if (d === null) return true;
  const t = d.getTime();
  return t >= min && t <= max;
 });
};

/** Restreint les lignes aux `jours` derniers jours du jeu de données. */
export const filterRowsByPeriod = (rows: ForecastRow[], jours: number): ForecastRow[] => {
 const bornes = periodBounds(rows, jours);
 return bornes ? filterRowsByRange(rows, bornes.debut, bornes.fin) : rows;
};

export interface ChartPoint {
 name: string;
 /** CA HT réalisé sur la période courante. */
 n: number;
 /** CA HT de la période précédente (même jour, décalé de `jours`). */
 n1: number;
 /** CA HT repondéré par le coefficient météo. */
 forecast: number;
}

/**
 * Série du graphique « Chiffre d'affaire Global » entre deux dates incluses.
 *
 * `rows` doit contenir **tout** l'historique, pas seulement la période
 * affichée : la courbe N-1 reprend le CA du même jour de la période
 * précédente, qui se situe par construction avant `debut`.
 */
export const buildChartSeries = (
 rows: ForecastRow[],
 debut: Date,
 fin: Date
): ChartPoint[] => {
 const premier = debutDeJour(debut);
 const dernier = debutDeJour(fin);
 if (dernier.getTime() < premier.getTime()) return [];

 // CA et CA pondéré, agrégés par jour, sur l'historique complet.
 const parJour = new Map<number, { ca: number; forecast: number }>();
 for (const r of rows) {
  const d = parseISODate(r.Date_Transaction);
  if (!d) continue;
  const cle = d.getTime();
  const acc = parJour.get(cle) ?? { ca: 0, forecast: 0 };
  acc.ca += r.CA_HT;
  acc.forecast += r.CA_HT * r.Coefficient;
  parJour.set(cle, acc);
 }

 const jours = Math.round((dernier.getTime() - premier.getTime()) / JOUR_MS) + 1;
 const points: ChartPoint[] = [];
 for (let i = 0; i < jours; i++) {
  // Décalage calendaire : un jour de changement d'heure ne fait pas 24 h.
  const jour = addDays(premier, i);
  const courant = parJour.get(jour.getTime());
  const precedent = parJour.get(addDays(jour, -jours).getTime());
  points.push({
   name: jour.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
   n: Math.round(courant?.ca ?? 0),
   n1: Math.round(precedent?.ca ?? 0),
   forecast: Math.round(courant?.forecast ?? 0)
  });
 }
 return points;
};

/** Normalise un texte pour une comparaison insensible à la casse et aux accents. */
const normalizeTexte = (texte: string): string =>
 String(texte ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

/**
 * Recherche libre sur le code article, la désignation et la famille.
 * Une requête vide ne renvoie rien : l'UI n'affiche alors aucun résultat.
 */
export const searchSkus = (skus: SkuAggregate[], query: string): SkuAggregate[] => {
 const terme = normalizeTexte(query);
 if (terme.length === 0) return [];
 return skus.filter((s) =>
  normalizeTexte(`${s.sku} ${s.designation} ${s.famille}`).includes(terme)
 );
};

export interface RuptureItem {
 sku: string;
 designation: string;
 /** Stock cumulé sur l'ensemble des boutiques. */
 stock: number;
 /** Ventes moyennes hebdomadaires réellement observées. */
 ventesHebdo: number;
 /** `red` = rupture ou stock critique, `yellow` = sous le seuil d'alerte. */
 statut: 'red' | 'yellow';
}

/** Nombre de semaines couvertes par le fichier (au moins une). */
const semainesCouvertes = (rows: ImportedRow[]): number => {
 const range = datasetRange(rows);
 if (!range) return 1;
 const jours = Math.round((range.fin.getTime() - range.debut.getTime()) / JOUR_MS) + 1;
 return Math.max(1, jours / 7);
};

/** Agrège stock, quantité et CA par SKU. */
const totauxParSku = (rows: ForecastRow[]) => {
 const map = new Map<
  string,
  {
   sku: string;
   designation: string;
   stock: number;
   /** Stock de la boutique la plus basse : c'est là que la rupture survient. */
   stockMin: number;
   quantite: number;
   caHt: number;
  }
 >();
 for (const r of rows) {
  const sku = r.Code_Article || '—';
  const acc =
   map.get(sku) ??
   { sku, designation: r.Designation || sku, stock: 0, stockMin: Infinity, quantite: 0, caHt: 0 };
  acc.stock += r.Stock_Actuel;
  acc.stockMin = Math.min(acc.stockMin, r.Stock_Actuel);
  acc.quantite += r.Quantite_Vendue;
  acc.caHt += r.CA_HT;
  if (!acc.designation || acc.designation === sku) acc.designation = r.Designation || sku;
  map.set(sku, acc);
 }
 return map;
};

/**
 * SKU dont le stock est faible ou critique, du plus urgent au moins urgent.
 *
 * Le seuil vient des objectifs saisis à l'onboarding ; à défaut, on retient
 * les SKU dont le stock ne couvre pas une semaine de ventes. La comparaison
 * porte sur la boutique la plus basse, exactement comme le KPI « alerte stock
 * faible » : le compteur et la liste restent ainsi cohérents.
 */
export const getRuptures = (
 rows: ForecastRow[],
 seuilAlerte: number | null,
 limite = 3
): RuptureItem[] => {
 const semaines = semainesCouvertes(rows);
 const items: RuptureItem[] = [];

 for (const t of totauxParSku(rows).values()) {
  const ventesHebdo = t.quantite / semaines;
  const seuil = seuilAlerte ?? Math.ceil(ventesHebdo);
  if (t.stockMin >= seuil) continue;
  items.push({
   sku: t.sku,
   designation: t.designation,
   stock: t.stockMin,
   // Non arrondi : l'UI décide de l'affichage (« 0,5/sem » plutôt que « 0/sem »).
   ventesHebdo,
   // Rupture totale ou moins de la moitié du seuil : critique.
   statut: t.stockMin === 0 || t.stockMin < seuil / 2 ? 'red' : 'yellow'
  });
 }

 return items.sort((a, b) => a.stock - b.stock).slice(0, limite);
};

export interface BestsellerItem {
 sku: string;
 designation: string;
 caHt: number;
 quantite: number;
 ventesHebdo: number;
 stock: number;
}

/** SKU les plus performants, classés par chiffre d'affaires HT décroissant. */
export const getBestsellers = (rows: ForecastRow[], limite = 3): BestsellerItem[] => {
 const semaines = semainesCouvertes(rows);
 return Array.from(totauxParSku(rows).values())
  .filter((t) => t.quantite > 0)
  .map((t) => ({
   sku: t.sku,
   designation: t.designation,
   caHt: t.caHt,
   quantite: t.quantite,
   ventesHebdo: t.quantite / semaines,
   stock: t.stock
  }))
  .sort((a, b) => b.caHt - a.caHt || b.quantite - a.quantite)
  .slice(0, limite);
};

// ---------------------------------------------------------------------------
// 8. Fiche SKU : couverture, risque et historique
// ---------------------------------------------------------------------------

/** Nombre de jours couverts par les données (au moins un). */
export const joursCouverts = (rows: ImportedRow[]): number => {
 const range = datasetRange(rows);
 if (!range) return 1;
 return Math.max(1, Math.round((range.fin.getTime() - range.debut.getTime()) / JOUR_MS) + 1);
};

export interface IndicateursSku {
 /** Jours de vente que couvrent le stock et le réassort recommandé. */
 couvertureJours: number;
 /** Part de la demande prévue que le stock seul ne couvre pas, en %. */
 risquePct: number;
}

/**
 * Couverture et risque de rupture d'un SKU.
 *
 * - couverture = (stock + réassort commandé) / demande journalière prévue,
 *   d'où le libellé « avec commande » : c'est l'autonomie après réassort.
 * - risque = fraction de la demande prévue non couverte par le stock seul,
 *   d'où le libellé « sans commande ». Borné à [0, 100].
 */
export const computeIndicateurs = (
 stock: number,
 demandePrevue: number,
 reassort: number,
 jours: number
): IndicateursSku => {
 const demandeJournaliere = jours > 0 ? demandePrevue / jours : 0;
 return {
  couvertureJours: demandeJournaliere > 0 ? (stock + reassort) / demandeJournaliere : 0,
  risquePct:
   demandePrevue > 0
    ? Math.max(0, Math.min(100, ((demandePrevue - stock) / demandePrevue) * 100))
    : 0
 };
};

export interface HistoriqueRow {
 cle: string;
 /** Mois analysé, ex. « mars 2026 ». */
 periode: string;
 weathercode: number | null;
 coefficient: number;
 ventesRealisees: number;
 /** Référence naïve : les ventes du mois précédent. */
 previsionInitiale: number;
 /** Même référence, repondérée par le coefficient météo. */
 previsionIA: number;
 ecartIA: number;
 ecartInitiale: number;
 /** Vrai si l'IA s'est approchée davantage des ventes réelles. */
 iaMeilleure: boolean;
}

/**
 * Rejoue le modèle sur l'historique du fichier, mois par mois.
 *
 * La prévision de référence d'un mois est le volume vendu le mois précédent ;
 * la prévision IA applique en plus le coefficient météo. Les deux sont
 * confrontées aux ventes réellement constatées, ce qui donne un écart de
 * précision mesuré et non déclaratif.
 *
 * Limite assumée : le fichier ne contient pas la météo passée, c'est donc le
 * coefficient courant de la famille qui est appliqué. Le premier mois du
 * fichier est écarté puisqu'il n'a pas de mois de référence.
 */
export const buildHistorique = (
 rows: ForecastRow[],
 sku: string,
 limite = 3
): HistoriqueRow[] => {
 const lignes = rows.filter((r) => r.Code_Article === sku);

 const parMois = new Map<
  string,
  { date: Date; ventes: number; poidsCoef: number; poids: number; weathercode: number | null }
 >();
 for (const r of lignes) {
  const d = parseISODate(r.Date_Transaction);
  if (!d) continue;
  const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const acc =
   parMois.get(cle) ??
   { date: new Date(d.getFullYear(), d.getMonth(), 1), ventes: 0, poidsCoef: 0, poids: 0, weathercode: r.Weathercode };
  acc.ventes += r.Quantite_Vendue;
  // Coefficient moyen pondéré par les volumes du mois.
  acc.poidsCoef += r.Coefficient * r.Quantite_Vendue;
  acc.poids += r.Quantite_Vendue;
  if (acc.weathercode === null) acc.weathercode = r.Weathercode;
  parMois.set(cle, acc);
 }

 const mois = Array.from(parMois.entries()).sort(
  (a, b) => a[1].date.getTime() - b[1].date.getTime()
 );

 const historique: HistoriqueRow[] = [];
 for (let i = 1; i < mois.length; i++) {
  const [cle, courant] = mois[i];
  const precedent = mois[i - 1][1];
  const coefficient = courant.poids > 0 ? courant.poidsCoef / courant.poids : 1;
  const previsionInitiale = precedent.ventes;
  const previsionIA = Math.round(previsionInitiale * coefficient);
  const ecartIA = previsionIA - courant.ventes;
  const ecartInitiale = previsionInitiale - courant.ventes;
  historique.push({
   cle,
   periode: courant.date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
   weathercode: courant.weathercode,
   coefficient,
   ventesRealisees: courant.ventes,
   previsionInitiale,
   previsionIA,
   ecartIA,
   ecartInitiale,
   iaMeilleure: Math.abs(ecartIA) < Math.abs(ecartInitiale)
  });
 }

 // Du plus récent au plus ancien.
 return historique.reverse().slice(0, limite);
};

/** Synthèse de performance affichée sous le tableau historique. */
export const resumeHistorique = (
 historique: HistoriqueRow[]
): { total: number; victoiresIA: number; erreurMoyenneIA: number; erreurMoyenneInitiale: number } => {
 const total = historique.length;
 if (total === 0) return { total: 0, victoiresIA: 0, erreurMoyenneIA: 0, erreurMoyenneInitiale: 0 };
 return {
  total,
  victoiresIA: historique.filter((h) => h.iaMeilleure).length,
  erreurMoyenneIA: historique.reduce((s, h) => s + Math.abs(h.ecartIA), 0) / total,
  erreurMoyenneInitiale: historique.reduce((s, h) => s + Math.abs(h.ecartInitiale), 0) / total
 };
};
