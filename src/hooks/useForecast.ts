import { useEffect, useMemo, useState } from 'react';
import {
 aggregateBySku,
 computeForecastRows,
 distinctVilles,
 fetchWeatherForVilles,
 type ForecastRow,
 type ImportedRow,
 type SkuAggregate,
 type WeatherByVille
} from '../lib/forecast';

export interface UseForecastResult {
 /** Villes distinctes extraites des Point_de_Vente. */
 villes: string[];
 /** weathercode courant par ville (`null` si l'appel a échoué). */
 weather: WeatherByVille;
 /** Vrai pendant les appels Open-Meteo. L'UI reste affichable. */
 isLoadingWeather: boolean;
 /** Lignes du CSV enrichies (coefficient, Prevision_IA, réassort). */
 forecastRows: ForecastRow[];
 /** Agrégats par SKU, du plus gros réassort au plus petit. */
 skus: SkuAggregate[];
 /** Accès direct à un agrégat par son Code_Article. */
 skuMap: Map<string, SkuAggregate>;
}

/**
 * Interroge Open-Meteo pour chaque ville présente dans les données importées,
 * puis applique l'algorithme d'ajustement météo.
 *
 * Les erreurs réseau sont absorbées silencieusement : les villes en échec
 * gardent un weathercode `null`, donc un coefficient de 1.0. Les résultats
 * sont calculés dès le premier rendu (sans météo) puis recalculés à l'arrivée
 * des réponses, l'affichage n'est donc jamais bloqué.
 */
export function useForecast(rows: ImportedRow[]): UseForecastResult {
 const [weather, setWeather] = useState<WeatherByVille>({});
 const [isLoadingWeather, setIsLoadingWeather] = useState(false);

 const villes = useMemo(() => distinctVilles(rows), [rows]);
 // Clé stable : évite de relancer les appels à chaque nouveau rendu.
 const villesKey = villes.join('|');

 useEffect(() => {
  if (villes.length === 0) {
   setWeather({});
   return;
  }

  const controller = new AbortController();
  let cancelled = false;

  setIsLoadingWeather(true);
  fetchWeatherForVilles(villes, controller.signal)
   .then((result) => {
    if (!cancelled) setWeather(result);
   })
   .catch(() => {
    // Fallback silencieux : coefficient 1.0 partout.
    if (!cancelled) setWeather({});
   })
   .finally(() => {
    if (!cancelled) setIsLoadingWeather(false);
   });

  return () => {
   cancelled = true;
   controller.abort();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [villesKey]);

 const forecastRows = useMemo(() => computeForecastRows(rows, weather), [rows, weather]);
 const skus = useMemo(() => aggregateBySku(forecastRows), [forecastRows]);
 const skuMap = useMemo(() => new Map(skus.map((s) => [s.sku, s])), [skus]);

 return { villes, weather, isLoadingWeather, forecastRows, skus, skuMap };
}
