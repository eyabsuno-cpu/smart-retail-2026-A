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
 CA_HT: ['ca_ht', 'chiffre_affaires_ht', 'chiffre_affaires', 'ca', 'prix_vente_ht', 'prix_ht', 'montant_ht', 'montant'],
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
 return {
  Code_Article: String(get(COLUMN_ALIASES.Code_Article) ?? ''),
  Designation: String(get(COLUMN_ALIASES.Designation) ?? ''),
  Famille_Produit: String(get(COLUMN_ALIASES.Famille_Produit) ?? ''),
  Date_Transaction: normalizeDate(get(COLUMN_ALIASES.Date_Transaction)),
  Quantite_Vendue: parseNumber(get(COLUMN_ALIASES.Quantite_Vendue)),
  Stock_Actuel: parseNumber(get(COLUMN_ALIASES.Stock_Actuel)),
  CA_HT: parseNumber(get(COLUMN_ALIASES.CA_HT)),
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
   stockActuel: sum(skuRows, (r) => r.Stock_Actuel),
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
