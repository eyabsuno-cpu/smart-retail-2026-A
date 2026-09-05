/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import ReactGA from "react-ga4";
import { 
 LayoutDashboard, 
 Upload, 
 Database, 
 CheckCircle2, 
 AlertCircle, 
 ChevronDown, 
 ChevronLeft,
 Plus, 
 Trash2, 
 FileText,
 TrendingUp,
 Package,
 CloudRain,
 Target, 
 ArrowRight,
 LogOut,
 Search,
 Bell,
 MoreHorizontal,
 CloudSun,
 Maximize2,
 X,
 Filter, 
 Grid, 
 List, 
 ChevronRight, 
 Store, 
 Link, 
 Cloud, 
 UploadCloud, 
 Home, 
 FileSpreadsheet, 
 Check, 
 Mail,
 Send,
 Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
 LineChart, 
 Line, 
 XAxis, 
 YAxis, 
 CartesianGrid, 
 Tooltip, 
 ResponsiveContainer,
 AreaChart,
 Area
} from 'recharts';
import { AppState, ImportedFile } from './types';

// --- IMPORTATION LOCALE (CSV / EXCEL) ---
import * as XLSX from 'xlsx';
// ----------------------------------------

// --- PRÉVISION MÉTÉO INTELLIGENTE ---
import {
 addDays,
 buildChartSeries,
 buildExportCsv,
 buildHistorique,
 computeIndicateurs,
 debutDeJour,
 joursCouverts,
 mergeImportedRows,
 moisCouverts,
 resumeHistorique,
 computeDashboardKpis,
 filterRowsByRange,
 formatPeriode,
 periodBounds,
 formatRow,
 getBestsellers,
 getRuptures,
 searchSkus,
 weatherLabel,
 type ImportedRow
} from './lib/forecast';
import { useForecast } from './hooks/useForecast';
// ------------------------------------

// Clés de stockage local pour les données importées
const LOCAL_DATA_KEY = 'smartRetail_importedData';
const LOCAL_META_KEY = 'smartRetail_importedFileMeta';

// Relit une valeur JSON du localStorage sans jamais lever d'exception
const readLocal = <T,>(key: string, fallback: T): T => {
 try {
  const stored = localStorage.getItem(key);
  return stored ? (JSON.parse(stored) as T) : fallback;
 } catch {
  return fallback;
 }
};

/**
 * Icône d'aide affichant une explication au survol.
 * Rendue en CSS pur (group-hover) : pas d'état, donc utilisable dans un
 * tableau sans multiplier les re-rendus.
 */
const InfoTooltip = ({ texte, className = '' }: { texte: string; className?: string }) => (
 <span className={`relative inline-flex group align-middle ${className}`}>
  <Info size={14} className="text-black/35 hover:text-[#0958D9] cursor-help transition-colors" />
  <span
   role="tooltip"
   className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-900 text-white text-xs font-normal normal-case leading-relaxed rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-[60] shadow-xl text-left"
  >
   {texte}
  </span>
 </span>
);

// GA4 : INITIALISATION
ReactGA.initialize("G-86B5216X0W");

const SECTORS = [
 "Prêt-à-porter",
 "Articles enfant et bebe",
 "sportwear",
 "Chaussures",
 "Sacs & Maroquinerie",
 "Accessoires de mode",
 "Multimarque / Mode complète"
];

const GOALS = [
 { id: 'reduce-out-of-stock', label: 'Réduire les ruptures' },
 { id: 'optimize-overstock', label: 'Réduire le sur-stockage' },
 { id: 'weather-impact', label: 'Réduire les invendus' },
 { id: 'sales-accuracy', label: 'Repartition du stock' },
];

const LOGO_URL = "https://storage.googleapis.com/firebasestorage.appspot.com/os-public-files/smart-retail-logo.png";

export default function App() {
 const [state, setState] = useState<AppState>({
  step: 'login',
  profile: { name: '', sector: '' },
  objectives: {
   salesTarget: '',
   growthRate: '',
   optimalStock: '',
   alertThreshold: '',
   selectedGoals: ['optimize-overstock', 'weather-impact']
  },
  // Restauré depuis le localStorage pour survivre au rafraîchissement
  importedFile: readLocal<ImportedFile | null>(LOCAL_META_KEY, null),
  isErpConnected: false,
  isConnectingErp: false,
  showNotifications: false
 });

 // --- NOUVEAUX ÉTATS POUR L'AUTHENTIFICATION RÉELLE ---
 const [email, setEmail] = useState('');
 const [otp, setOtp] = useState('');
 const [isVerifying, setIsVerifying] = useState(false);
 const [authLoading, setAuthLoading] = useState(false);
 // -------------------------------------------------------

 // --- DONNÉES IMPORTÉES LOCALEMENT (state + localStorage) ---
 const [importedData, setImportedData] = useState<ImportedRow[]>(
  () => readLocal<ImportedRow[]>(LOCAL_DATA_KEY, [])
 );

 // Prévision météo : géocodage + météo courante par ville, puis application
 // des coefficients et agrégation bottom-up des réassorts par SKU.
 const { villes: villesImportees, skus, skuMap, forecastRows } = useForecast(importedData);

 // Profondeur d'historique accumulée, affichée sur la carte d'import.
 const moisImportes = moisCouverts(importedData);

 // SKU sélectionné depuis le tableau de réassort du dashboard.
 const [selectedSku, setSelectedSku] = useState<string | null>(null);
 const activeSku = (selectedSku ? skuMap.get(selectedSku) : undefined) ?? skus[0];

 // Filtre par ville dans la vue « Boutique Distribution ».
 const [villeFilter, setVilleFilter] = useState<string | null>(null);

 // Tableau de réassort du dashboard : 3 lignes par défaut, tout au clic.
 const [showAllSkus, setShowAllSkus] = useState(false);

 // Décision finale : `null` tant que l'utilisateur n'a rien saisi, on affiche
 // alors la recommandation de l'IA. Chaîne pour autoriser un champ vide.
 const [decisionFinale, setDecisionFinale] = useState<string | null>(null);

 // Répartition saisie à la main, par point de vente.
 const [distributionManuelle, setDistributionManuelle] = useState(false);
 const [allocationsManuelles, setAllocationsManuelles] = useState<Record<string, string>>({});

 // Recherche SKU de l'en-tête.
 const [searchQuery, setSearchQuery] = useState('');
 const searchResults = searchSkus(skus, searchQuery);

 // Période d'analyse du dashboard : 7 ou 30 jours, ou une plage choisie
 // au calendrier (`periodePerso` a la priorité quand elle est définie).
 const [periodeJours, setPeriodeJours] = useState<7 | 30>(7);
 const [periodePerso, setPeriodePerso] = useState<{ debut: Date; fin: Date } | null>(null);

 // Sélection en cours dans le calendrier, avant validation.
 const [selection, setSelection] = useState<{ debut: Date | null; fin: Date | null }>({
  debut: null,
  fin: null
 });

 /** 1er clic = date de début, 2e = date de fin (réordonnées au besoin), 3e = on recommence. */
 const cliquerJour = (jour: Date) => {
  setSelection((prev) => {
   if (!prev.debut || prev.fin) return { debut: jour, fin: null };
   return jour.getTime() < prev.debut.getTime()
    ? { debut: jour, fin: prev.debut }
    : { debut: prev.debut, fin: jour };
  });
 };

 /** Revient à une fenêtre glissante de 7 ou 30 jours. */
 const choisirPeriodeRapide = (jours: 7 | 30) => {
  setPeriodeJours(jours);
  setPeriodePerso(null);
  setSelection({ debut: null, fin: null });
 };

 // Mois affiché dans le calendrier déroulant (mois courant par défaut).
 const [moisAffiche, setMoisAffiche] = useState(() => {
  const now = new Date();
  return { annee: now.getFullYear(), mois: now.getMonth() };
 });
 const decalerMois = (m: { annee: number; mois: number }, delta: number) => {
  const d = new Date(m.annee, m.mois + delta, 1);
  return { annee: d.getFullYear(), mois: d.getMonth() };
 };

 // Menu profil (déconnexion).
 const [showProfileMenu, setShowProfileMenu] = useState(false);

 /** Vide les données locales et ramène l'utilisateur à l'écran de connexion. */
 const handleLogout = () => {
  try {
   localStorage.removeItem(LOCAL_DATA_KEY);
   localStorage.removeItem(LOCAL_META_KEY);
  } catch {
   /* storage indisponible : la réinitialisation du state suffit */
  }
  setImportedData([]);
  setSelectedSku(null);
  setVilleFilter(null);
  setSearchQuery('');
  setShowProfileMenu(false);
  setShowAllSkus(false);
  setEmail('');
  setState({
   step: 'login',
   profile: { name: '', sector: '' },
   objectives: {
    salesTarget: '',
    growthRate: '',
    optimalStock: '',
    alertThreshold: '',
    selectedGoals: ['optimize-overstock', 'weather-impact']
   },
   importedFile: null,
   isErpConnected: false,
   isConnectingErp: false,
   showNotifications: false
  });
 };

 /** Ouvre la fiche d'analyse d'un SKU depuis la recherche. */
 const openSku = (sku: string) => {
  setSelectedSku(sku);
  setVilleFilter(null);
  setSearchQuery('');
  setState(prev => ({ ...prev, step: 'analysis-detail' }));
 };
 // ----------------------------------------------------------

 const [showCalendar, setShowCalendar] = useState(false);
 const [processingSubStep, setProcessingSubStep] = useState<'downloading' | 'analyzing'>('downloading');
 const [progress, setProgress] = useState(0);
 const [exportingState, setExportingState] = useState<'idle' | 'downloading' | 'success' | 'syncing'>('idle');
 const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

 const fileInputRef = useRef<HTMLInputElement>(null);

 // GA4 : TRACKING DES PAGES (CHANGEMENT D'ÉTAPES)
 useEffect(() => {
  ReactGA.send({ hitType: "pageview", page: window.location.pathname + state.step, title: state.step });
 }, [state.step]);

 const handleSendOtp = (e: React.FormEvent) => {
  e.preventDefault();
  setAuthLoading(true);

  // On change l'étape du site immédiatement vers l'onboarding
  setState(prev => ({ 
    ...prev, 
    step: 'onboarding' 
  }));

  setAuthLoading(false);
 };
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    // Cette fonction ne servira plus mais on la laisse pour éviter les erreurs
    setState(prev => ({ ...prev, step: 'onboarding' }));
  };

 const handleErpConnect = () => {
  if (state.isErpConnected) {
   setState(prev => ({ ...prev, isErpConnected: false }));
   return;
  }

  setState(prev => ({ ...prev, isConnectingErp: true }));
  
  setTimeout(() => {
   setState(prev => ({ 
    ...prev, 
    isConnectingErp: false, 
    isErpConnected: true 
   }));
  }, 2000);
 };
// GA4 : TRACKING DU CLIC
   ReactGA.event({ category: "Conversion", action: "upload_excel", label: "Version A" });

 /** Lit un fichier et le transforme en lignes normalisées. */
 const lireFichier = (file: File): Promise<ImportedRow[]> =>
  new Promise((resolve, reject) => {
   const reader = new FileReader();
   reader.onerror = () => reject(new Error(`Lecture impossible : ${file.name}`));
   reader.onload = (evt) => {
    try {
     const buffer = new Uint8Array(evt.target?.result as ArrayBuffer);
     const wb = XLSX.read(buffer, {
      type: 'array',
      codepage: 65001, // CSV en UTF-8 : évite « Prêt-à-porter » -> « PrÃªt-Ã -porter »
      cellDates: true, // évite que Date_Transaction arrive en numéro de série Excel
      dateNF: 'dd/mm/yyyy' // dates françaises : 12/03/2026 = 12 mars, pas 3 décembre
     });
     const jsonData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
     resolve((jsonData as any[]).map(formatRow));
    } catch (err: any) {
     reject(new Error(`${file.name} : ${err?.message || 'format non reconnu'}`));
    }
   };
   reader.readAsArrayBuffer(file);
  });

 // --- IMPORTATION LOCALE MULTI-FICHIERS (CSV / EXCEL) ---
 const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const fichiers: File[] = Array.from(e.target.files ?? []);
  if (fichiers.length === 0) return;

  const tropGros = fichiers.filter(f => f.size > 5 * 1024 * 1024);
  if (tropGros.length > 0) {
   alert(`Fichier trop volumineux (5 Mo maximum) : ${tropGros.map(f => f.name).join(', ')}`);
   return;
  }

  try {
   const lots = await Promise.all(fichiers.map(lireFichier));

   // On cumule avec l'historique déjà chargé : un fichier par exercice suffit
   // ainsi à constituer plusieurs années de profondeur. Les doublons stricts
   // sont écartés, un même fichier réimporté ne compte donc pas deux fois.
   const fusion = mergeImportedRows(importedData, ...lots);
   const ajoutees = fusion.length - importedData.length;

   setImportedData(fusion);

   const tailleTotale = fichiers.reduce((somme, f) => somme + f.size, 0);
   const sourcesPrecedentes = state.importedFile?.sources ?? [];
   const sources = Array.from(new Set([...sourcesPrecedentes, ...fichiers.map(f => f.name)]));
   const newFile: ImportedFile = {
    name: sources.length === 1 ? sources[0] : `${sources.length} fichiers importés`,
    size: (tailleTotale / (1024 * 1024)).toFixed(1) + ' MB',
    date: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    count: fusion.length,
    sources
   };

   try {
    localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(fusion));
    localStorage.setItem(LOCAL_META_KEY, JSON.stringify(newFile));
   } catch (storageErr) {
    console.warn("Impossible d'écrire dans le localStorage :", storageErr);
   }

   setState(prev => ({ ...prev, importedFile: newFile }));

   const mois = moisCouverts(fusion);
   const periode = mois.length > 1 ? ` — ${mois.length} mois couverts (${mois[0]} → ${mois[mois.length - 1]})` : '';
   const doublons = lots.reduce((s, l) => s + l.length, 0) - ajoutees;
   alert(
    `Données importées localement et prêtes pour l'analyse\n\n` +
    `${fichiers.length} fichier${fichiers.length > 1 ? 's' : ''} lu${fichiers.length > 1 ? 's' : ''}, ` +
    `${ajoutees} nouvelle${ajoutees > 1 ? 's' : ''} ligne${ajoutees > 1 ? 's' : ''}` +
    `${doublons > 0 ? ` (${doublons} doublon${doublons > 1 ? 's' : ''} ignoré${doublons > 1 ? 's' : ''})` : ''}` +
    `${periode}`
   );
  } catch (err: any) {
   console.error('Erreur de lecture du fichier :', err?.message || err);
   alert('Impossible de lire le fichier : ' + (err?.message || 'format non reconnu'));
  } finally {
   // Permet de réimporter le même fichier juste après.
   e.target.value = '';
  }
 };

 const removeFile = () => {
  setImportedData([]);
  try {
   localStorage.removeItem(LOCAL_DATA_KEY);
   localStorage.removeItem(LOCAL_META_KEY);
  } catch {
   /* ignore */
  }
  setState(prev => ({ ...prev, importedFile: null }));
 };

 const toggleGoal = (goalId: string) => {
  setState(prev => ({
   ...prev,
   objectives: {
    ...prev.objectives,
    selectedGoals: prev.objectives.selectedGoals.includes(goalId)
     ? prev.objectives.selectedGoals.filter(id => id !== goalId)
     : [...prev.objectives.selectedGoals, goalId]
   }
  }));
 };

 const handleStart = () => {
  setState(prev => ({ ...prev, step: 'processing' }));
  setProcessingSubStep('downloading');
  setProgress(0);

  const interval = setInterval(() => {
   setProgress(prev => {
    if (prev >= 100) {
     clearInterval(interval);
     setTimeout(() => {
      setProcessingSubStep('analyzing');
      setTimeout(() => {
       setState(prevStep => ({ ...prevStep, step: 'ready' }));
      }, 3000);
     }, 500);
     return 100;
    }
    return prev + 5;
   });
  }, 100);
 };

 const isFormComplete = 
  state.profile.name && 
  state.profile.sector && 
  state.objectives.salesTarget && 
  state.objectives.growthRate && 
  state.objectives.optimalStock && 
  state.objectives.alertThreshold && 
  (state.importedFile || state.isErpConnected);

 const Sidebar = ({ variant = 'default' }: { variant?: 'default' | 'detail' }) => {
  const menuItems = [
   { icon: LayoutDashboard, label: 'Dashboard', active: true, step: 'dashboard' },
   { icon: TrendingUp, label: 'Forecasting Unit' },
   { icon: Home, label: 'Store Allocation' },
   { icon: Link, label: 'Supplier Connect' },
   { icon: Cloud, label: 'Weather Hub' },
  ];

  const logoSection = variant === 'default' ? (
  <div className="p-6 flex items-center gap-3 mb-8">
    <img src="https://www.hebergement-photo.fr/uploads/20260905/4d081179a9808929eea6199fbe2036dcb91210c8.png" alt="Smart Retail Logo" className="w-8 h-8 object-contain" referrerPolicy="no-referrer" />
    <span className="text-lg font-bold tracking-tight">SMART RETAIL</span>
  </div>
) : (
  <div className="p-8 flex items-center gap-4 mb-4">
    <div className="w-[52px] h-[52px] bg-black flex items-center justify-center relative">
      <div className="w-[17px] h-[22px] bg-[#0958D9]"></div>
    </div>
    <span className="text-2xl font-semibold tracking-tight">SMART RETAIL</span>
  </div>
);

  return (
   <div className="h-full flex flex-col">
    {logoSection}
    <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
     {menuItems.map((item, i) => (
      <button
       key={i}
       onClick={() => {
        if (item.step) setState(prev => ({ ...prev, step: item.step as any }));
        setIsMobileMenuOpen(false);
       }}
       className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
        item.active 
         ? 'bg-[#f0f7ff] text-[#0958D9] border-r-4 border-[#0958D9] rounded-r-none' 
         : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
       }`}
      >
       <item.icon size={variant === 'default' ? 18 : 24} />
       <span className={variant === 'default' ? '' : 'text-[22px]'}>{item.label}</span>
      </button>
     ))}
     <div className="my-4 border-t border-slate-100" />
     <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-all">
      <UploadCloud size={variant === 'default' ? 18 : 24} />
      <span className={variant === 'default' ? '' : 'text-[22px]'}>External Data</span>
     </button>
    </nav>
   </div>
  );
 };

 const MobileMenuButton = ({ className = "bottom-8 right-8" }: { className?: string }) => (
  <button 
   onClick={() => setIsMobileMenuOpen(true)}
   className={`lg:hidden fixed w-16 h-16 bg-[#0958D9] text-white rounded-full shadow-2xl flex items-center justify-center z-[100] active:scale-95 transition-transform ${className}`}
  >
   <Grid size={32} />
  </button>
 );

 const MobileSidebar = ({ variant = 'default' }: { variant?: 'default' | 'detail' }) => (
  <AnimatePresence>
   {isMobileMenuOpen && (
    <>
     <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => setIsMobileMenuOpen(false)}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] lg:hidden"
     />
     <motion.div 
      initial={{ x: '-100%' }}
      animate={{ x: 0 }}
      exit={{ x: '-100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-y-0 left-0 w-[280px] bg-white z-[120] lg:hidden shadow-2xl"
     >
      <div className="absolute top-4 right-4">
       <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-slate-400 hover:text-slate-600">
        <X size={24} />
       </button>
      </div>
      <Sidebar variant={variant} />
     </motion.div>
    </>
   )}
  </AnimatePresence>
 );

 if (state.step === 'processing') {
  return (
   <div className="min-h-screen bg-[#f4f7fa] font-sans text-slate-900">
    <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
            <img src="https://www.hebergement-photo.fr/uploads/20260905/4d081179a9808929eea6199fbe2036dcb91210c8.png" alt="Smart Retail Logo" className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
            <span className="text-xl font-bold tracking-tight">SMART RETAIL</span>
        </div>
     <span className="text-sm text-slate-400">Configuration initiale</span>
    </header>

    <main className="max-w-4xl mx-auto mt-20 p-8">
     <div className="bg-white rounded-3xl p-16 border border-slate-200 shadow-sm text-center">
      <AnimatePresence mode="wait">
       {processingSubStep === 'downloading' ? (
        <motion.div
         key="downloading"
         initial={{ opacity: 0, y: 20 }}
         animate={{ opacity: 1, y: 0 }}
         exit={{ opacity: 0, y: -20 }}
         className="space-y-8"
        >
         <div className="w-24 h-24 bg-[#0958D9] rounded-full flex items-center justify-center text-white mx-auto mb-8">
          <Upload size={40} />
         </div>
         <h2 className="text-4xl font-bold text-slate-900">Téléchargement en cours...</h2>
         <p className="text-slate-500">Nous importons et sécurisons vos données</p>

         <div className="max-w-md mx-auto mt-12">
          <div className="flex justify-between text-sm font-bold mb-2">
           <span className="text-slate-900">Progression du téléchargement</span>
           <span className="text-[#0958D9]">{progress}%</span>
          </div>
          <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden">
           <motion.div 
            className="h-full bg-[#0958D9]"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
           />
          </div>
         </div>

         <div className="max-w-md mx-auto mt-12 space-y-3 p-6 bg-[#f8fbff] rounded-2xl border border-blue-50">
          <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100">
           <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center text-green-500">
             <Database size={20} />
            </div>
            <div className="text-left">
             <p className="font-bold text-sm">Objectifs stratégiques</p>
             <p className="text-[10px] text-slate-400">4 paramètres configurés</p>
            </div>
           </div>
           <CheckCircle2 size={20} className="text-green-500" />
          </div>

          <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100">
           <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-500">
             <FileText size={20} />
            </div>
            <div className="text-left">
             <p className="font-bold text-sm">Données produits</p>
             <p className="text-[10px] text-slate-400">Transfert sécurisé en cours...</p>
            </div>
           </div>
           <div className="w-5 h-5 border-2 border-[#0958D9] border-t-transparent rounded-full animate-spin" />
          </div>

          <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100 opacity-50">
           <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
             <LayoutDashboard size={20} />
            </div>
            <div className="text-left">
             <p className="font-bold text-sm">Configuration IA</p>
             <p className="text-[10px] text-slate-400">En attente...</p>
            </div>
           </div>
           <div className="w-5 h-5 border-2 border-slate-200 rounded-full" />
          </div>
         </div>
         <p className="text-xs text-slate-400 flex items-center justify-center gap-2">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          Veuillez ne pas fermer cette fenêtre
         </p>
        </motion.div>
       ) : (
        <motion.div
         key="analyzing"
         initial={{ opacity: 0, y: 20 }}
         animate={{ opacity: 1, y: 0 }}
         exit={{ opacity: 0, y: -20 }}
         className="space-y-8"
        >
         <div className="w-24 h-24 bg-[#0958D9] rounded-full flex items-center justify-center text-white mx-auto mb-8">
          <motion.div
           animate={{ scale: [1, 1.1, 1] }}
           transition={{ repeat: Infinity, duration: 2 }}
          >
           <Database size={40} />
          </motion.div>
         </div>
         <h2 className="text-4xl font-bold text-slate-900">Analyse en cours...</h2>
         <p className="text-slate-500">Notre intelligence artificielle traite vos données</p>

         <div className="max-w-md mx-auto mt-12 space-y-3 p-6 bg-[#f8fbff] rounded-2xl border border-blue-50">
          <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100">
           <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center text-green-500">
             <CheckCircle2 size={20} />
            </div>
            <div className="text-left">
             <p className="font-bold text-sm">Données importées avec succès</p>
             <p className="text-[10px] text-slate-400">Tous vos fichiers ont été transférés en toute sécurité</p>
            </div>
           </div>
           <CheckCircle2 size={20} className="text-green-500" />
          </div>

          <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100">
           <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-500">
             <TrendingUp size={20} />
            </div>
            <div className="text-left">
             <p className="font-bold text-sm">Calibrage des modèles prédictifs</p>
             <p className="text-[10px] text-slate-400">Analyse des patterns et création des prévisions</p>
            </div>
           </div>
           <div className="w-5 h-5 border-2 border-[#0958D9] border-t-transparent rounded-full animate-spin" />
          </div>

          <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100 opacity-50">
           <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
             <LayoutDashboard size={20} />
            </div>
            <div className="text-left">
             <p className="font-bold text-sm">Finalisation du tableau de bord</p>
             <p className="text-[10px] text-slate-400">Préparation de votre interface personnalisée</p>
            </div>
           </div>
           <div className="w-5 h-5 border-2 border-slate-200 rounded-full" />
          </div>
         </div>
         <div className="text-xs text-slate-400 flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          Traitement presque terminé...
         </div>
        </motion.div>
       )}
      </AnimatePresence>
     </div>
    </main>
   </div>
  );
 }

 if (state.step === 'ready') {
  return (
   <div className="min-h-screen bg-[#f4f7fa] font-sans text-slate-900">
    <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
            <img src="https://www.hebergement-photo.fr/uploads/20260905/4d081179a9808929eea6199fbe2036dcb91210c8.png" alt="Smart Retail Logo" className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
            <span className="text-xl font-bold tracking-tight">SMART RETAIL</span>
        </div>
     <span className="text-sm text-slate-400">Configuration terminée</span>
    </header>

    <main className="max-w-4xl mx-auto mt-20 p-8">
     <motion.div 
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white rounded-3xl p-16 border border-slate-200 shadow-sm text-center space-y-8"
     >
      <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center text-white mx-auto mb-8">
       <CheckCircle2 size={48} />
      </div>
      <h2 className="text-4xl font-bold text-slate-900">Votre tableau de bord est prêt !</h2>
      <p className="text-slate-500 text-lg max-w-md mx-auto">
       L'IA a terminé l'analyse de vos données. Vous pouvez maintenant accéder à vos prévisions et optimiser vos stocks.
      </p>

      <div className="pt-8">
       <button 
        onClick={() => setState(prev => ({ ...prev, step: 'dashboard' }))}
        className="bg-[#0958D9] text-white px-12 py-4 rounded-xl font-bold text-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98] flex items-center gap-3 mx-auto"
       >
        Accéder à mon tableau de bord
        <ArrowRight size={24} />
       </button>
      </div>
      </motion.div>
    </main>
   </div>
  );
 }

 if (state.step === 'dashboard') {
  // Tout le dashboard se lit sur la période active : la plage choisie au
  // calendrier si elle existe, sinon la fenêtre glissante de 7 / 30 jours.
  const aujourdhui = new Date();
  const bornes =
   periodePerso ??
   periodBounds(forecastRows, periodeJours) ??
   { debut: addDays(aujourdhui, -(periodeJours - 1)), fin: aujourdhui };

  const rowsPeriode = filterRowsByRange(forecastRows, bornes.debut, bornes.fin);
  const seuilAlerte = Number(state.objectives.alertThreshold) > 0
   ? Number(state.objectives.alertThreshold)
   : null;

  const libellePeriode = formatPeriode(bornes.debut, bornes.fin);

  // Géométrie du mois affiché dans le calendrier : lundi = première colonne.
  const joursDansLeMois = new Date(moisAffiche.annee, moisAffiche.mois + 1, 0).getDate();
  const decalagePremierJour = (new Date(moisAffiche.annee, moisAffiche.mois, 1).getDay() + 6) % 7;
  const debutDuJour = new Date(
   aujourdhui.getFullYear(),
   aujourdhui.getMonth(),
   aujourdhui.getDate()
  ).getTime();

  // Une décimale sous 10 unités, pour ne pas afficher « 0/sem » sur un article vendu.
  const formatVentes = (v: number) => (v > 0 && v < 10 ? v.toFixed(1) : Math.round(v).toString());

  // On passe l'historique complet : la courbe N-1 lit des jours antérieurs
  // à la période affichée.
  const CHART_SERIES = buildChartSeries(forecastRows, bornes.debut, bornes.fin);
  const RUPTURES = getRuptures(rowsPeriode, seuilAlerte);
  const BESTSELLERS = getBestsellers(rowsPeriode);

  // Indicateurs calculés sur les données importées et les objectifs saisis
  // à l'onboarding (seuils « stock faible » et « stock optimal »).
  const kpis = computeDashboardKpis(rowsPeriode, state.objectives);
  const formatEuros = (montant: number) =>
   new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0
   }).format(montant);
  const signe = (n: number) => (n >= 0 ? '+' : '');

  // La bascule démo/réel dépend de la présence d'un fichier, pas du contenu de
  // la période : une plage sans vente doit afficher des zéros, pas la démo.
  const KPI_CARDS = forecastRows.length > 0
   ? [
      {
       label: 'FORECAST SALES',
       value: formatEuros(kpis.caPrevu),
       sub: `${signe(kpis.ecartCaPct)}${Math.round(kpis.ecartCaPct)}% ${kpis.ecartCaLabel}`,
       trend: kpis.ecartCaPct >= 0 ? 'up' : 'none',
       color: 'blue',
       icon: TrendingUp,
       period: 'CA HT PONDÉRÉ MÉTÉO'
      },
      {
       label: 'ALERTE STOCK FAIBLE',
       value: kpis.skusEnAlerte === null ? '—' : String(kpis.skusEnAlerte),
       sub: state.objectives.alertThreshold
        ? `sous ${state.objectives.alertThreshold} unités`
        : 'seuil non défini',
       trend: 'alert',
       color: 'red',
       icon: AlertCircle,
       unit: 'SKUs'
      },
      {
       label: 'SUR STOCKAGE',
       value: kpis.skusSurStock === null ? '—' : String(kpis.skusSurStock),
       sub: state.objectives.optimalStock
        ? `au-dessus de ${state.objectives.optimalStock} unités`
        : 'seuil non défini',
       trend: 'none',
       color: 'blue',
       icon: Package,
       unit: 'SKUs'
      },
      {
       label: 'IMPACT METEO',
       value: `${signe(kpis.impactMeteoPct)}${Math.round(kpis.impactMeteoPct)}%`,
       sub: 'sur les ventes prévues',
       trend: kpis.impactMeteoPct > 0 ? 'up' : 'none',
       color: 'yellow',
       icon: CloudSun,
       cat: kpis.familleImpactee ? `CAT: ${kpis.familleImpactee.toUpperCase()}` : 'AUCUN AJUSTEMENT'
      }
     ]
   : [
      { label: 'FORECAST SALES', value: '€42,850', sub: '+14% vs last period', trend: 'up', color: 'blue', icon: TrendingUp, period: 'NEXT 7 DAYS' },
      { label: 'ALERTE STOCK FAIBLE', value: '12', sub: 'Urgent SKUs', trend: 'alert', color: 'red', icon: AlertCircle, unit: 'SKUs' },
      { label: 'SUR STOCKAGE', value: '57', sub: '', trend: 'none', color: 'blue', icon: Package, unit: 'SKUs' },
      { label: 'IMPACT METEO', value: '+22%', sub: '+5% vs periode precedente', trend: 'up', color: 'yellow', icon: CloudSun, cat: 'CAT: VESTE' },
     ];

  // Réassort recommandé par SKU (données réelles si un fichier a été importé,
  // sinon le jeu de démonstration).
  const REASSORT_ROWS = skus.length > 0
   ? (showAllSkus ? skus : skus.slice(0, 3)).map(s => ({
      key: s.sku,
      sku: s.sku,
      designation: s.designation,
      uplift: s.upliftPct,
      units: s.totalReassort,
      img: `https://picsum.photos/seed/${encodeURIComponent(s.sku)}/100/100`
     }))
   : [0, 1, 2].map(i => ({
      key: `demo-${i}`,
      sku: '859163YCUA21000',
      designation: '',
      uplift: 45,
      units: 120,
      img: `https://picsum.photos/seed/prod${i}/100/100`
     }));

  return (
   <div className="flex h-screen bg-[#f4f7fa] font-sans text-slate-900 overflow-hidden relative">
    <MobileMenuButton />
    <MobileSidebar />

    <aside className="hidden lg:flex w-64 bg-white border-r border-slate-200 flex-col shrink-0">
     <Sidebar />
    </aside>

    <div className="flex-1 flex flex-col overflow-hidden">
     <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-8 shrink-0">
      <h1 className="text-lg lg:text-2xl font-bold text-slate-800 truncate mr-4">Système de Prévision de stock</h1>

      <div className="flex items-center gap-2 lg:gap-6">
       {/* Recherche SKU : filtre en direct les données importées. */}
       <div className="relative hidden md:block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
         type="text"
         value={searchQuery}
         onChange={(e) => setSearchQuery(e.target.value)}
         onKeyDown={(e) => {
          if (e.key === 'Enter' && searchResults.length > 0) openSku(searchResults[0].sku);
          if (e.key === 'Escape') setSearchQuery('');
         }}
         placeholder="Recherche SKU ou produit"
         className="pl-10 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm w-40 lg:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        {searchQuery && (
         <button
          onClick={() => setSearchQuery('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
         >
          <X size={14} />
         </button>
        )}

        <AnimatePresence>
         {searchQuery.trim().length > 0 && (
          <>
           <div className="fixed inset-0 z-40" onClick={() => setSearchQuery('')} />
           <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden max-h-80 overflow-y-auto"
           >
            {searchResults.length === 0 ? (
             <p className="px-4 py-3 text-xs text-slate-400">
              {skus.length === 0
               ? 'Importez un fichier pour activer la recherche.'
               : `Aucun résultat pour « ${searchQuery} »`}
             </p>
            ) : (
             searchResults.slice(0, 8).map((s) => (
              <button
               key={s.sku}
               onClick={() => openSku(s.sku)}
               className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
              >
               <p className="text-xs font-bold text-slate-800 truncate">{s.sku}</p>
               <p className="text-[10px] text-slate-500 truncate">{s.designation}</p>
               <p className="text-[10px] text-[#0958D9] font-bold mt-0.5">
                {s.totalReassort} u. à réassortir · stock {s.stockActuel}
               </p>
              </button>
             ))
            )}
           </motion.div>
          </>
         )}
        </AnimatePresence>
       </div>

       <div className="flex items-center gap-2 lg:gap-4">
        <button
         onClick={() => setState(prev => ({ ...prev, showNotifications: true }))}
         className="p-2 text-slate-400 hover:text-slate-600 relative"
        >
         <Bell size={20} />
         <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white">2</span>
        </button>

        {/* Profil : menu déroulant avec déconnexion. */}
        <div className="relative pl-2 lg:pl-4 border-l border-slate-200">
         <button
          onClick={() => setShowProfileMenu(!showProfileMenu)}
          className="flex items-center gap-2 lg:gap-3 hover:opacity-80 transition-opacity"
         >
          <img src="https://i.pravatar.cc/150?u=emily" alt="User" className="w-8 h-8 rounded-full border border-slate-200" referrerPolicy="no-referrer" />
          <div className="text-left hidden sm:block">
           <p className="text-sm font-bold">{state.profile.name || 'Emily'}</p>
          </div>
          <ChevronDown size={14} className={`text-slate-400 transition-transform ${showProfileMenu ? 'rotate-180' : ''}`} />
         </button>

         <AnimatePresence>
          {showProfileMenu && (
           <>
            <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
            <motion.div
             initial={{ opacity: 0, y: -4 }}
             animate={{ opacity: 1, y: 0 }}
             exit={{ opacity: 0, y: -4 }}
             className="absolute right-0 mt-2 w-60 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden"
            >
             <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-bold text-slate-800 truncate">{state.profile.name || 'Emily'}</p>
              <p className="text-[10px] text-slate-400 truncate">{email || state.profile.sector || 'Compte Smart Retail'}</p>
             </div>
             {state.importedFile && (
              <div className="px-4 py-2 border-b border-slate-100">
               <p className="text-[10px] text-slate-400">Fichier chargé</p>
               <p className="text-xs text-slate-600 truncate">{state.importedFile.name}</p>
              </div>
             )}
             <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
             >
              <LogOut size={16} />
              Déconnexion
             </button>
             <p className="px-4 pb-3 text-[10px] text-slate-400 leading-snug">
              Efface les données importées de cet appareil.
             </p>
            </motion.div>
           </>
          )}
         </AnimatePresence>
        </div>
       </div>
      </div>
     </header>

     <main className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 lg:space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
       {KPI_CARDS.map((stat, i) => (
        <div key={i} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
         <div className="flex justify-between items-start mb-4">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{stat.label}</span>
          <div className={`p-2 rounded-lg ${
           stat.color === 'red' ? 'bg-red-50 text-red-500' : 
           stat.color === 'yellow' ? 'bg-yellow-50 text-yellow-600' : 
           'bg-blue-50 text-blue-500'
          }`}>
           <stat.icon size={18} />
          </div>
         </div>
         <div className="flex items-baseline gap-2 mb-1">
          <span className="text-3xl font-bold">{stat.value}</span>
          {stat.unit && <span className="text-xs text-slate-400 font-medium">{stat.unit}</span>}
         </div>
         <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
           {stat.trend === 'up' && <TrendingUp size={12} className="text-green-500" />}
           <span className={`text-[10px] font-bold ${stat.trend === 'up' ? 'text-green-500' : stat.color === 'red' ? 'text-red-500' : 'text-slate-400'}`}>
            {stat.sub}
           </span>
          </div>
          {stat.period && <span className="text-[10px] text-slate-400 font-bold">{stat.period}</span>}
          {stat.cat && <span className="text-[10px] text-slate-400 font-bold">{stat.cat}</span>}
         </div>
        </div>
       ))}
      </div>

      {/* Pourquoi « IMPACT METEO » affiche +0% : la raison exacte, pas un texte générique. */}
      {kpis.explicationMeteo && (
       <div className="flex items-start gap-3 p-4 bg-[#f8fbff] border border-[#BAE0FF] rounded-2xl">
        <CloudSun size={18} className="text-[#0958D9] shrink-0 mt-0.5" />
        <div>
         <p className="text-xs font-bold text-[#0958D9] mb-1">Pourquoi l'impact météo est nul ?</p>
         <p className="text-xs text-slate-600 leading-relaxed">{kpis.explicationMeteo}</p>
        </div>
       </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
       <div className="lg:col-span-2 bg-white p-4 lg:p-8 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
         <h3 className="text-lg font-bold">Chiffre d'affaire Global</h3>
         <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="relative w-full sm:w-auto">
           <div
            onClick={() => {
             // À l'ouverture, on se place sur le mois de la période affichée :
             // les données peuvent être bien antérieures au mois courant.
             if (!showCalendar) {
              setMoisAffiche({ annee: bornes.fin.getFullYear(), mois: bornes.fin.getMonth() });
             }
             setShowCalendar(!showCalendar);
            }}
            className="flex items-center gap-2 bg-slate-50 p-1 px-3 py-1.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
           >
            <FileText size={14} className="text-slate-400" />
            <span className="text-xs font-medium">{libellePeriode}</span>
            <ChevronDown size={12} className={`text-slate-400 transition-transform ${showCalendar ? 'rotate-180' : ''}`} />
           </div>

           <AnimatePresence>
            {showCalendar && (
             <>
              <div 
               className="fixed inset-0 z-40" 
               onClick={() => setShowCalendar(false)} 
              />
              <motion.div
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: 10 }}
               className="absolute right-0 mt-2 w-72 bg-white rounded-2xl border border-slate-200 shadow-xl z-50 p-4"
              >
               <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-bold capitalize">
                 {new Date(moisAffiche.annee, moisAffiche.mois, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                </span>
                <div className="flex gap-1">
                 <button
                  onClick={() => setMoisAffiche(decalerMois(moisAffiche, -1))}
                  className="p-1 hover:bg-slate-100 rounded-md"
                 >
                  <ChevronLeft size={16} />
                 </button>
                 <button
                  onClick={() => setMoisAffiche(decalerMois(moisAffiche, 1))}
                  className="p-1 hover:bg-slate-100 rounded-md"
                 >
                  <ChevronLeft size={16} className="rotate-180" />
                 </button>
                </div>
               </div>
               <div className="grid grid-cols-7 gap-1 mb-2">
                {['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'].map(day => (
                 <span key={day} className="text-[10px] font-bold text-slate-400 text-center uppercase">{day}</span>
                ))}
               </div>
               <div className="grid grid-cols-7 gap-1">
                {/* Cases vides pour aligner le 1er du mois sur le bon jour de semaine. */}
                {Array.from({ length: decalagePremierJour }, (_, i) => (
                 <span key={`vide-${i}`} className="h-8 w-8" />
                ))}
                {Array.from({ length: joursDansLeMois }, (_, i) => i + 1).map(day => {
                 const date = new Date(moisAffiche.annee, moisAffiche.mois, day);
                 const jour = date.getTime();
                 const debutSel = selection.debut?.getTime();
                 const finSel = selection.fin?.getTime();
                 // Sélection en cours : bornes en plein, jours intermédiaires en clair.
                 const estBorne = jour === debutSel || jour === finSel;
                 const dansSelection =
                  debutSel !== undefined && finSel !== undefined && jour > debutSel && jour < finSel;
                 // À défaut de sélection, on montre la période actuellement appliquée.
                 const dansPeriodeActive =
                  !selection.debut &&
                  jour >= debutDeJour(bornes.debut).getTime() &&
                  jour <= debutDeJour(bornes.fin).getTime();
                 const estAujourdhui = jour === debutDuJour;
                 return (
                  <button
                   key={day}
                   onClick={() => cliquerJour(date)}
                   className={`h-8 w-8 text-xs rounded-lg flex items-center justify-center transition-colors ${
                    estBorne
                     ? 'bg-[#0958D9] text-white font-bold'
                     : dansSelection || dansPeriodeActive
                       ? 'bg-blue-100 text-[#0958D9] font-medium'
                       : estAujourdhui
                         ? 'border border-[#0958D9] text-[#0958D9] font-bold'
                         : 'hover:bg-slate-100 text-slate-600'
                   }`}
                  >
                   {day}
                  </button>
                 );
                })}
               </div>
               <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                <p className="text-[10px] text-slate-500 leading-tight">
                 {!selection.debut
                  ? 'Cliquez sur une date de début.'
                  : !selection.fin
                    ? `Début : ${selection.debut.toLocaleDateString('fr-FR')} — cliquez sur la date de fin.`
                    : `Du ${selection.debut.toLocaleDateString('fr-FR')} au ${selection.fin.toLocaleDateString('fr-FR')}`}
                </p>
                <div className="flex items-center justify-between gap-2">
                 <button
                  onClick={() => {
                   setSelection({ debut: null, fin: null });
                   setPeriodePerso(null);
                  }}
                  className="px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
                 >
                  Réinitialiser
                 </button>
                 <button
                  disabled={!selection.debut || !selection.fin}
                  onClick={() => {
                   if (selection.debut && selection.fin) {
                    setPeriodePerso({ debut: selection.debut, fin: selection.fin });
                    setShowCalendar(false);
                   }
                  }}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors shrink-0 ${
                   selection.debut && selection.fin
                    ? 'bg-[#0958D9] text-white hover:bg-[#0044ee]'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                 >
                  Valider
                 </button>
                </div>
               </div>
              </motion.div>
             </>
            )}
           </AnimatePresence>
          </div>
          {/* Bascule la période de tout le dashboard : graphique, KPI, ruptures. */}
          <div className="flex bg-slate-50 p-1 rounded-lg border border-slate-200">
           {([7, 30] as const).map((jours) => (
            <button
             key={jours}
             onClick={() => choisirPeriodeRapide(jours)}
             className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
              !periodePerso && periodeJours === jours
               ? 'bg-white shadow-sm text-slate-900'
               : 'text-slate-400 hover:text-slate-600'
             }`}
            >
             {jours} Jours
            </button>
           ))}
           {periodePerso && (
            <span className="px-3 py-1 text-[10px] font-bold bg-white shadow-sm rounded-md text-[#0958D9]">
             Personnalisé
            </span>
           )}
          </div>
         </div>
        </div>
        
        <div className="h-[300px] w-full">
         {forecastRows.length === 0 && (
          <div className="h-full flex items-center justify-center text-center px-6">
           <p className="text-xs text-slate-400">
            Importez un fichier pour afficher le chiffre d'affaires réel.
           </p>
          </div>
         )}
         {forecastRows.length > 0 && CHART_SERIES.length > 0 && (
         <ResponsiveContainer width="100%" height="100%">
          <LineChart data={CHART_SERIES}>
           <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
           <XAxis 
            dataKey="name" 
            axisLine={false} 
            tickLine={false} 
            tick={{fontSize: 10, fill: '#94a3b8'}}
            dy={10}
           />
           <YAxis 
            axisLine={false} 
            tickLine={false} 
            tick={{fontSize: 10, fill: '#94a3b8'}}
           />
           <Tooltip 
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
           />
           <Line type="monotone" dataKey="n1" stroke="#22d3ee" strokeWidth={2} dot={false} />
           <Line type="monotone" dataKey="n" stroke="#0958D9" strokeWidth={2} dot={false} />
           <Line type="monotone" dataKey="forecast" stroke="#a855f7" strokeWidth={2} strokeDasharray="5 5" dot={false} />
          </LineChart>
         </ResponsiveContainer>
         )}
        </div>
        
        <div className="flex justify-center gap-6 mt-6">
         <div className="flex items-center gap-2">
          <div className="w-3 h-1 bg-purple-500 rounded-full"></div>
          <span className="text-[10px] font-bold text-slate-400 uppercase">Forecast</span>
         </div>
         <div className="flex items-center gap-2">
          <div className="w-3 h-1 bg-blue-500 rounded-full"></div>
          <span className="text-[10px] font-bold text-slate-400 uppercase">N</span>
         </div>
         <div className="flex items-center gap-2">
          <div className="w-3 h-1 bg-cyan-400 rounded-full"></div>
          <span className="text-[10px] font-bold text-slate-400 uppercase">N-1</span>
         </div>
        </div>
       </div>

       <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
        <div className="flex items-center justify-between mb-8">
         <h3 className="text-lg font-bold">SKU en rupture</h3>
         <span className="px-2 py-1 bg-red-50 text-red-500 text-[10px] font-bold rounded">
          {kpis.skusEnAlerte ?? RUPTURES.length} en alerte
         </span>
        </div>

        {/* Articles dont le stock ne couvre pas le seuil d'alerte de l'onboarding. */}
        <div className="flex-1 space-y-6">
         {RUPTURES.length === 0 ? (
          <p className="text-xs text-slate-400">
           {forecastRows.length === 0
            ? 'Importez un fichier pour suivre vos ruptures.'
            : 'Aucun article sous le seuil d’alerte sur cette période.'}
          </p>
         ) : (
          RUPTURES.map((item) => (
           <button
            key={item.sku}
            onClick={() => openSku(item.sku)}
            className="w-full flex items-center gap-4 text-left hover:bg-slate-50 rounded-lg transition-colors"
           >
            <img
             src={`https://picsum.photos/seed/${encodeURIComponent(item.sku)}/100/100`}
             alt={item.designation}
             className="w-12 h-12 rounded-lg object-cover bg-slate-50"
             referrerPolicy="no-referrer"
            />
            <div className="flex-1 min-w-0">
             <h4 className="text-sm font-bold truncate">{item.designation}</h4>
             <p className="text-[10px] text-slate-400 truncate">{item.boutique}</p>
            </div>
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
             item.statut === 'red' ? 'bg-red-500' : 'bg-yellow-400'
            }`} />
            {/* Valeur exacte du Stock_Actuel plutôt qu'une moyenne de ventes. */}
            <div className="text-right shrink-0">
             <p className={`text-sm font-bold ${item.statut === 'red' ? 'text-red-500' : 'text-slate-900'}`}>
              {item.stock}
             </p>
             <p className="text-[10px] text-slate-400 uppercase font-bold">Stock actuel</p>
            </div>
           </button>
          ))
         )}
        </div>

        <button
         onClick={() => setShowAllSkus(true)}
         className="w-full py-3 mt-8 border border-slate-100 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors"
        >
         Voir plus de produits
        </button>
       </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
       <div className="lg:col-span-2 bg-white p-4 lg:p-8 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <h3 className="text-lg font-bold mb-8">Recommandation de reassort</h3>
        
        <div className="overflow-x-auto -mx-4 lg:mx-0">
         <div className="min-w-[600px] px-4 lg:px-0">
          <table className="w-full">
           <thead>
            <tr className="text-left border-b border-slate-50">
             <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Produit</th>
             <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">SKU</th>
             <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">AI Prevision</th>
             <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">Action</th>
            </tr>
           </thead>
           <tbody className="divide-y divide-slate-50">
            {REASSORT_ROWS.map((row) => (
             <tr key={row.key} className="group">
              <td className="py-4">
               <img src={row.img} className="w-12 h-12 rounded-lg object-cover bg-slate-50" referrerPolicy="no-referrer" />
              </td>
              <td className="py-4">
               <span className="text-xs font-medium text-slate-600">{row.sku}</span>
               {row.designation && <p className="text-[10px] text-slate-400 truncate max-w-[180px]">{row.designation}</p>}
              </td>
              <td className="py-4 text-center">
               <span className={`text-sm font-bold ${row.uplift >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {row.uplift >= 0 ? '+' : ''}{Math.round(row.uplift)}%
               </span>
               <p className="text-[10px] text-slate-400">{row.units} u. à réassortir</p>
              </td>
              <td className="py-4 text-right">
               <button
                onClick={() => {
                 setSelectedSku(row.sku);
                 setVilleFilter(null);
                 setState(prev => ({ ...prev, step: 'analysis-detail' }));
                }}
                className="px-6 py-2 bg-[#0958D9] text-white text-[10px] font-bold rounded-lg hover:bg-blue-700 transition-colors uppercase"
               >
                Analyse
               </button>
              </td>
             </tr>
            ))}
           </tbody>
          </table>
         </div>
        </div>
        
        <div className="mt-8 flex justify-center">
         <button
          onClick={() => setShowAllSkus(v => !v)}
          className="px-12 py-3 border border-slate-100 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors"
         >
          {skus.length > 3
           ? (showAllSkus ? 'Réduire la liste' : `Voir les ${skus.length} produits`)
           : 'Voir plus de produits'}
         </button>
        </div>
       </div>

       <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
        <h3 className="text-lg font-bold mb-8">SKU en Bestseller</h3>

        {/* Articles classés par chiffre d'affaires HT réalisé sur la période. */}
        <div className="flex-1 space-y-6">
         {BESTSELLERS.length === 0 ? (
          <p className="text-xs text-slate-400">
           {forecastRows.length === 0
            ? 'Importez un fichier pour voir vos meilleures ventes.'
            : 'Aucune vente enregistrée sur cette période.'}
          </p>
         ) : (
          BESTSELLERS.map((item) => (
           <button
            key={item.sku}
            onClick={() => openSku(item.sku)}
            className="w-full flex items-center gap-4 text-left hover:bg-slate-50 rounded-lg transition-colors"
           >
            <img
             src={`https://picsum.photos/seed/${encodeURIComponent(item.sku)}/100/100`}
             alt={item.designation}
             className="w-12 h-12 rounded-lg object-cover bg-slate-50"
             referrerPolicy="no-referrer"
            />
            <div className="flex-1 min-w-0">
             <h4 className="text-sm font-bold truncate">{item.designation}</h4>
             <p className="text-[10px] text-slate-400">
              {formatEuros(item.caHt)} · {item.quantite} u. vendues
             </p>
            </div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
            <div className="text-right shrink-0">
             <p className="text-sm font-bold">{formatVentes(item.ventesHebdo)}/sem</p>
             <p className="text-[10px] text-slate-400 uppercase font-bold">Ventes moy.</p>
            </div>
           </button>
          ))
         )}
        </div>

        <button
         onClick={() => setShowAllSkus(true)}
         className="w-full py-3 mt-8 border border-slate-100 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors"
        >
         Voir plus de produits
        </button>
       </div>
      </div>
     </main>
    </div>

    <AnimatePresence>
     {state.showNotifications && (
      <>
       <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => setState(prev => ({ ...prev, showNotifications: false }))}
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
       />
       
       <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed right-0 top-0 bottom-0 w-[400px] bg-white shadow-2xl z-[70] flex flex-col"
       >
        <div className="p-8 border-b border-slate-100 flex items-center justify-between">
         <div>
          <div className="flex items-center gap-2">
           <div className="w-1 h-6 bg-[#0958D9] rounded-full" />
           <h2 className="text-2xl font-bold text-slate-900">Notifications</h2>
          </div>
          <p className="text-sm text-slate-400 mt-1">2 unread messages</p>
         </div>
         <button 
          onClick={() => setState(prev => ({ ...prev, showNotifications: false }))}
          className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
         >
          <X size={24} />
         </button>
        </div>

        <div className="flex-1 overflow-y-auto">
         {[
          { id: 1, type: 'alert', title: 'Alerte de stock critique', message: 'Jimmy Veste en laine et toile de soie (859163YCUA21000) est en rupture de stock dans le....', time: '5 min ago', unread: true, icon: AlertCircle, iconBg: 'bg-red-50', iconColor: 'text-red-500' },
          { id: 2, type: 'weather', title: 'Impact météo détecté', message: 'Températures élevées prévues. La catégorie Lin d\'été devrait bondir de +22 %.', time: '15 min ago', unread: true, icon: AlertCircle, iconBg: 'bg-red-50', iconColor: 'text-red-500' },
          { id: 3, type: 'success', title: 'Transmission ERP Confirmée', message: 'La commande n°MF-2025-091 a été transmise avec succès à l\'ERP', time: '1 hour ago', unread: false, icon: CheckCircle2, iconBg: 'bg-green-50', iconColor: 'text-green-500' },
          { id: 4, type: 'event', title: 'Début de la Fashion Week de Paris', message: 'Événement détecté : Préparez-vous à une hausse de la demande pour les collections de créateurs.', time: '1 hour ago', unread: false, icon: Package, iconBg: 'bg-blue-50', iconColor: 'text-blue-500' }
         ].map((notif) => (
          <div key={notif.id} className="p-8 border-b border-slate-50 hover:bg-slate-50/50 transition-colors relative group cursor-pointer">
           <div className="flex gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${notif.iconBg} ${notif.iconColor}`}>
             <notif.icon size={24} />
            </div>
            <div className="flex-1 min-w-0">
             <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-slate-900 text-base">{notif.title}</h3>
              {notif.unread && ( <div className="w-2 h-2 bg-[#0958D9] rounded-full" /> )}
             </div>
             <p className="text-sm text-slate-500 leading-relaxed mb-3"> {notif.message} </p>
             <span className="text-xs text-slate-400 font-medium">{notif.time}</span>
            </div>
           </div>
          </div>
         ))}
        </div>

        <div className="p-8">
         <button className="w-full py-4 bg-[#0958D9] text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]">
          Tout marquer comme lu
         </button>
        </div>
       </motion.div>
      </>
     )}
    </AnimatePresence>
   </div>
  );
 }

 if (state.step === 'analysis-detail') {
  // Fenêtre réellement couverte par le fichier pour ce SKU : sert de base au
  // calcul de la demande journalière.
  const lignesSku = activeSku
   ? forecastRows.filter(r => r.Code_Article === activeSku.sku)
   : [];
  const jours = joursCouverts(lignesSku);

  // Couverture et risque, tous deux ramenés à l'horizon fixe de 7 jours :
  // sur la quantité brute d'abord, sur la prévision météo ensuite.
  const indicInitial = activeSku
   ? computeIndicateurs(activeSku.stockActuel, activeSku.quantiteVendue, jours)
   : null;
  const indicIA = activeSku
   ? computeIndicateurs(activeSku.stockActuel, activeSku.previsionIA, jours)
   : null;

  const HISTORIQUE = activeSku ? buildHistorique(forecastRows, activeSku.sku) : [];
  const bilan = resumeHistorique(HISTORIQUE);

  // Recommandation de l'IA et valeur effectivement retenue par l'utilisateur.
  const recommandation = activeSku ? activeSku.totalReassort : 120;
  const quantiteRetenue = decisionFinale === null ? recommandation : Number(decisionFinale) || 0;
  const decisionModifiee = decisionFinale !== null && quantiteRetenue !== recommandation;

  const formatJours = (j: number) => (j > 0 && j < 10 ? j.toFixed(1) : Math.round(j).toString());

  return (
   <div className="flex h-screen bg-[#F8FBFF]/50 font-sans text-slate-900 overflow-hidden relative">
    <MobileMenuButton />
    <MobileSidebar variant="detail" />

    <aside className="hidden lg:flex w-[310px] bg-white border-r border-[#D9D9D9] flex-col shrink-0">
     <Sidebar variant="detail" />
    </aside>

    <div className="flex-1 flex flex-col overflow-hidden bg-[#F8FBFF]/30">
     <header className="bg-white border-b border-[#D9D9D9] px-4 lg:px-6 py-4 lg:py-8 flex flex-col lg:flex-row lg:items-center justify-between shrink-0 gap-4">
      <div className="flex items-center gap-4 lg:gap-6">
       <button 
        onClick={() => setState(prev => ({ ...prev, step: 'dashboard' }))}
        className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 transition-colors"
       >
        <ChevronLeft size={24} />
       </button>
       
       <div className="flex items-center gap-4 lg:gap-6">
        <img 
         src="https://www.hebergement-photo.fr/uploads/20260905/765dea14accea4b9078bf8ce3129ca9848d89d9f.jpg" 
         alt="Jimmy Veste" 
         className="w-[60px] h-[80px] lg:w-[90px] lg:h-[120px] object-cover"
         referrerPolicy="no-referrer"
        />
        <div>
         <h1 className="text-xl lg:text-[38px] font-semibold text-black leading-tight">{activeSku ? activeSku.designation : 'Jimmy Veste en laine et toile de soie'}</h1>
         <div className="flex flex-col lg:flex-row lg:items-center gap-1 lg:gap-4 mt-1 lg:mt-2">
          <span className="text-sm lg:text-xl text-black/45">SKU: {activeSku ? activeSku.sku : '859163YCUA21000'}</span>
          <span className="text-sm lg:text-xl text-black/45">Category: {activeSku ? activeSku.famille : 'Summer 25 Veste'}</span>
         </div>
        </div>
       </div>
      </div>

      <div className="flex items-center justify-between lg:justify-end">
       <div className="px-4 lg:px-6 border-r border-[#D9D9D9] text-right">
        <p className="text-xs lg:text-base text-black/65 mb-1 lg:mb-2">Stock Actuel</p>
        <p className="text-lg lg:text-[28.85px] font-semibold text-[#101828]">{activeSku ? activeSku.stockActuel : 45} <span className="text-xs lg:text-base font-normal text-black/45">unités</span></p>
       </div>
       <div className="px-4 lg:px-6 text-right">
        <p className="text-xs lg:text-base text-black/65 mb-1 lg:mb-2">Ventes Moy. Hebdo</p>
        <p className="text-lg lg:text-[28.85px] font-semibold text-[#101828]">{activeSku ? activeSku.quantiteVendue : 32} <span className="text-xs lg:text-base font-normal text-black/45">unités/sem</span></p>
       </div>
      </div>
     </header>

     <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 lg:space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
       <div className="lg:col-span-8 bg-[#F8FBFF] p-4 lg:p-6 rounded-lg border border-[#BAE0FF] flex flex-col gap-6 lg:gap-8">
        <div className="flex justify-between items-start">
         <div className="flex items-center gap-2 text-[#0958D9]">
          <Target size={20} />
          <span className="text-sm lg:text-[22.44px] font-medium uppercase">PRÉVISION INITIALE</span>
         </div>
         <div className="flex items-center gap-1 lg:gap-2 px-2 py-1 lg:py-2 bg-[#FFFBE6] rounded text-[#D48806]">
          <AlertCircle size={18} />
          <span className="text-sm lg:text-xl font-semibold">Moyenne</span>
         </div>
        </div>
        
        <div>
         <div className="text-4xl lg:text-[48px] font-bold text-[#101828] leading-none">{activeSku ? activeSku.totalReassortBase : 95}</div>
         <p className="text-sm lg:text-xl text-black/45 mt-2">Unités</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
         <div className="bg-white p-4 rounded shadow-sm">
          <p className="text-xs lg:text-base text-black/65 mb-1 lg:mb-2">Ventes prévues</p>
          <p className="text-xl lg:text-[30px] font-semibold text-black">{activeSku ? activeSku.quantiteVendue : 140}</p>
          <p className="text-sm lg:text-[19.23px] text-[#0958D9] font-normal">sans météo</p>
         </div>
         <div className="bg-white p-4 rounded shadow-sm">
          <p className="text-xs lg:text-base text-black/65 mb-1 lg:mb-2 flex items-center gap-1.5">
           Couverture
           <InfoTooltip texte={`Autonomie en jours une fois le réassort reçu : (stock ${activeSku ? activeSku.stockActuel : 0} + commande) divisé par la demande journalière moyenne, mesurée sur les ${jours} jours couverts par votre fichier.`} />
          </p>
          <p className="text-xl lg:text-[30px] font-semibold text-black">
           {indicInitial ? `${formatJours(indicInitial.couvertureJours)}J` : '5J'}
          </p>
          <p className="text-sm lg:text-[19.23px] text-black/45 font-normal">stock actuel / ventes 7J</p>
         </div>
         <div className="bg-white p-4 rounded shadow-sm">
          <p className="text-xs lg:text-base text-black/65 mb-1 lg:mb-2 flex items-center gap-1.5">
           Risque
           <InfoTooltip texte="Part de la demande prévue que le stock actuel ne couvre pas, si aucune commande n'est passée. 0 % signifie que le stock suffit." />
          </p>
          <p className="text-xl lg:text-[30px] font-semibold text-black">
           {indicInitial ? `${Math.round(indicInitial.risquePct)}%` : '65%'}
          </p>
          <p className="text-sm lg:text-[19.23px] text-[#CF1322] font-normal">sur 7 jours, sans commande</p>
         </div>
        </div>
       </div>

       <div className="lg:col-span-4 bg-white p-4 lg:p-6 rounded-lg border border-[#D9D9D9] flex flex-col gap-6 lg:gap-8">
        <div className="flex justify-between items-start">
         <div className="flex items-center gap-2 text-[#0958D9]">
          <TrendingUp size={20} />
          <div>
           <span className="text-sm lg:text-[22.44px] font-medium uppercase block leading-tight">PRÉVISION IA</span>
           <span className="text-[10px] lg:text-sm text-black/45 font-normal uppercase tracking-wide">Sur 7 jours</span>
          </div>
         </div>
         <div className="flex items-center gap-1 lg:gap-2 px-2 py-1 lg:py-2 bg-[#E6F7FF] rounded text-[#0958D9]">
          <CheckCircle2 size={18} />
          <span className="text-sm lg:text-xl font-semibold">Haute</span>
         </div>
        </div>

        <div>
         <div className="text-4xl lg:text-[48px] font-bold text-[#101828] leading-none">{activeSku ? activeSku.totalReassort : 120}</div>
         <p className="text-sm lg:text-xl text-black/45 mt-2">Unités recommandées sur 7 jours</p>
         {activeSku && (
          <p className="text-xs lg:text-base text-black/45 mt-1">
           Consolidé sur {activeSku.boutiques.length} boutique{activeSku.boutiques.length > 1 ? 's' : ''}
          </p>
         )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
         <div className="bg-white p-2 rounded">
          <p className="text-xs lg:text-base text-black/65 mb-1 lg:mb-2">Ventes prévues</p>
          <p className="text-xl lg:text-[30px] font-semibold text-black">{activeSku ? activeSku.previsionIA : 165}</p>
          <p className="text-sm lg:text-[19.23px] text-[#0958D9] font-normal flex items-center gap-1.5">
           {activeSku ? `${activeSku.upliftPct >= 0 ? '+' : ''}${Math.round(activeSku.upliftPct)}% vs initiale` : '+28% vs moy'}
           <InfoTooltip
            texte={
             activeSku
              ? `Écart entre la prévision IA (${activeSku.previsionIA} u.) et la prévision initiale (${activeSku.quantiteVendue} u.), qui reprend l'historique de ventes sans correction. L'IA croise cet historique avec la météo courante relevée par Open-Meteo dans chaque ville : selon la famille de produit et le temps du jour, un coefficient de 1.3 (pluie), 1.5 (beau temps) ou 1.0 est appliqué.`
              : "Écart entre la prévision IA et la prévision initiale. L'IA croise l'historique de ventes avec la météo courante relevée par Open-Meteo dans chaque ville."
            }
           />
          </p>
         </div>
         <div className="bg-white p-2 rounded">
          <p className="text-xs lg:text-base text-black/65 mb-1 lg:mb-2 flex items-center gap-1.5">
           Couverture
           <InfoTooltip texte="Autonomie en jours après réception du réassort recommandé, face à la demande ajustée par la météo. Elle est plus courte que la couverture initiale quand l'IA anticipe une hausse des ventes." />
          </p>
          <p className="text-xl lg:text-[30px] font-semibold text-black">
           {indicIA ? `${formatJours(indicIA.couvertureJours)}J` : '7J'}
          </p>
          <p className="text-sm lg:text-[19.23px] text-black/45 font-normal">stock actuel / ventes 7J</p>
         </div>
         <div className="bg-white p-2 rounded">
          <p className="text-xs lg:text-base text-black/65 mb-1 lg:mb-2 flex items-center gap-1.5">
           Risque
           <InfoTooltip texte="Part de la demande ajustée par la météo que le stock actuel ne couvre pas. Plus élevé que le risque initial lorsque la météo pousse les ventes à la hausse." />
          </p>
          <p className="text-xl lg:text-[30px] font-semibold text-black">
           {indicIA ? `${Math.round(indicIA.risquePct)}%` : '92%'}
          </p>
          <p className="text-sm lg:text-[19.23px] text-[#CF1322] font-normal">sur 7 jours, sans commande</p>
         </div>
        </div>
       </div>

       <div className="lg:col-span-8 bg-white p-4 lg:p-8 rounded-lg border border-[#D9D9D9] space-y-6 lg:space-y-8">
        <h3 className="text-xl lg:text-2xl font-semibold text-black/88">Données Historiques de Référence</h3>
        
        <div className="overflow-x-auto -mx-4 lg:mx-0">
         <div className="min-w-[800px] px-4 lg:px-0">
          <table className="w-full">
           <thead>
            <tr className="text-left border-b border-[#D9D9D9]">
             <th className="py-4 text-sm lg:text-xl font-semibold text-black/65 uppercase">DATE</th>
             <th className="py-4 text-sm lg:text-xl font-semibold text-black/65 uppercase">CONTEXTE MÉTÉO</th>
             <th className="py-4 text-sm lg:text-xl font-semibold text-black/65 uppercase">PREVISIONS IA</th>
             <th className="py-4 text-sm lg:text-xl font-semibold text-black/65 uppercase">PREVISIONS INITIALES</th>
             <th className="py-4 text-sm lg:text-xl font-semibold text-black/65 uppercase">VENTES REALISÉES</th>
             <th className="py-4 text-sm lg:text-xl font-semibold text-black/65 uppercase">
              <span className="flex items-center gap-1.5">
               ÉCART DE PRÉCISION
               <InfoTooltip texte="Différence entre la prévision et les ventes réellement constatées ce mois-là. Le libellé indique quel modèle est tombé le plus juste, et le nombre entre parenthèses de combien d'unités il s'est écarté : négatif = sous-estimation, positif = surestimation." />
              </span>
             </th>
            </tr>
           </thead>
           <tbody className="divide-y divide-slate-50">
            {HISTORIQUE.length === 0 ? (
             <tr>
              <td colSpan={6} className="py-6 text-base text-black/45">
               {forecastRows.length === 0
                ? 'Importez un fichier pour rejouer le modèle sur votre historique.'
                : "Ce SKU ne couvre qu'un seul mois : il faut au moins deux mois pour comparer une prévision aux ventes constatées."}
              </td>
             </tr>
            ) : (
             HISTORIQUE.map((h) => (
              <tr key={h.cle}>
               <td className="py-6 text-base lg:text-[22.44px] text-[#101828] capitalize">{h.periode}</td>
               <td className="py-6">
                <div className="flex items-center gap-2 text-black">
                 <Cloud size={20} className="text-black/45" />
                 <span className="text-base lg:text-[22.44px]">
                  {weatherLabel(h.weathercode)}
                  {h.coefficient !== 1 && (
                   <span className="text-[#0958D9] font-semibold"> ×{h.coefficient.toFixed(2)}</span>
                  )}
                 </span>
                </div>
               </td>
               <td className="py-6 text-base lg:text-[22.44px] font-semibold text-black/88">{h.previsionIA} unités</td>
               <td className="py-6 text-base lg:text-[22.44px] font-semibold text-black/88">{h.previsionInitiale} unités</td>
               <td className="py-6 text-base lg:text-[22.44px] font-semibold text-black/88">{h.ventesRealisees} unités</td>
               <td className="py-6">
                <span className={`text-base lg:text-[22.44px] font-semibold ${h.iaMeilleure ? 'text-[#0958D9]' : 'text-[#D48806]'}`}>
                 {h.iaMeilleure ? 'IA' : 'Initiale'} ({h.iaMeilleure ? (h.ecartIA > 0 ? '+' : '') + h.ecartIA : (h.ecartInitiale > 0 ? '+' : '') + h.ecartInitiale})
                </span>
               </td>
              </tr>
             ))
            )}
           </tbody>
          </table>
         </div>
        </div>

        <div className="p-4 lg:p-6 bg-[#F8FBFF] rounded-lg border border-[#91CAFF]">
         {bilan.total === 0 ? (
          <p className="text-base lg:text-[22.44px] text-[#1C398E] leading-relaxed">
           Le bilan de précision apparaîtra dès que votre fichier couvrira au moins deux mois de ventes pour ce produit.
          </p>
         ) : (
          <p className="text-base lg:text-[22.44px] text-[#1C398E] leading-relaxed">
           l'IA a été plus précise dans <span className="font-bold">{bilan.victoiresIA}/{bilan.total} cas</span>, avec une marge d'erreur moyenne de <span className="font-bold">{Math.round(bilan.erreurMoyenneIA)} unités</span> vs {Math.round(bilan.erreurMoyenneInitiale)} unités pour la prévision initiale.
          </p>
         )}
         <p className="text-xs lg:text-base text-[#1C398E]/70 mt-3 leading-relaxed">
          Méthode : la prévision initiale d'un mois reprend le volume vendu le mois précédent ; la prévision IA y applique le coefficient météo. Le fichier ne contenant pas la météo passée, c'est le coefficient courant de la famille qui est utilisé.
         </p>
        </div>

        <div className="flex justify-center">
         <button className="w-full py-4 bg-white border border-[#D9D9D9] rounded-lg text-lg lg:text-xl text-black/65 hover:bg-slate-50 transition-colors shadow-sm">
          Voir plus detail
         </button>
        </div>
       </div>

       <div className="lg:col-span-4">
        <div className="bg-white p-4 lg:p-6 rounded-lg border border-[#E5E7EB] flex flex-col gap-6">
         <h3 className="text-xl lg:text-2xl font-semibold text-black/88">Votre Décision Finale</h3>
         <div className="flex items-baseline gap-4">
          <span className="text-4xl lg:text-[48px] font-bold text-[#0958D9] leading-none">{quantiteRetenue}</span>
          <span className="text-sm lg:text-xl text-black/45">unités</span>
         </div>

         <div className="space-y-3">
          <label htmlFor="decision-finale" className="block text-sm lg:text-xl text-[#364153]">
           Modifier les quantités Manuellement
          </label>
          <input
           id="decision-finale"
           type="number"
           min="0"
           inputMode="numeric"
           value={decisionFinale ?? String(recommandation)}
           onChange={(e) => setDecisionFinale(e.target.value)}
           className="w-full px-4 lg:px-6 py-3 lg:py-4 border border-[#D1D5DC] rounded bg-white text-xl lg:text-[24px] font-semibold text-[#0A0A0A] focus:outline-none focus:ring-2 focus:ring-[#0958D9]/30 focus:border-[#0958D9] transition-all"
          />
          <p className="text-sm lg:text-[19.23px] text-[#6A7282]">
           Modifiez la recommandation de l'IA si nécessaire.
          </p>

          {decisionModifiee && (
           <div className="flex items-start gap-2 p-3 bg-[#FFFBE6] border border-[#FFE58F] rounded">
            <AlertCircle size={16} className="text-[#D48806] shrink-0 mt-0.5" />
            <p className="text-xs lg:text-sm text-[#874D00] leading-relaxed">
             Vous vous écartez de la recommandation ({recommandation} u.). La répartition
             entre boutiques passera en <span className="font-bold">mode manuel</span> :
             c'est vous qui attribuerez les quantités.
            </p>
           </div>
          )}
          {decisionFinale !== null && !decisionModifiee && (
           <button
            onClick={() => setDecisionFinale(null)}
            className="text-xs text-[#0958D9] font-semibold hover:underline"
           >
            Revenir à la recommandation de l'IA
           </button>
          )}
         </div>

         <button
          onClick={() => {
           // Une quantité saisie différente de la recommandation bascule la
           // page suivante en répartition manuelle, avec des champs vierges.
           setDistributionManuelle(decisionModifiee);
           if (decisionModifiee) setAllocationsManuelles({});
           setState(prev => ({ ...prev, step: 'boutique-distribution' }));
          }}
          className="w-full py-4 bg-[#0958D9] text-white text-lg lg:text-xl rounded hover:bg-blue-800 transition-all"
         >
          Valider et Répartir
         </button>
        </div>
       </div>
      </div>
     </div>
    </div>
   </div>
  );
 }

 if (state.step === 'boutique-distribution') {
  // Répartition réelle issue du CSV + météo, sinon jeu de démonstration.
  const ALL_BOUTIQUES = activeSku
   ? activeSku.boutiques.map(b => ({
      name: b.pointDeVente,
      type: b.ville,
      ville: b.ville,
      units: b.reassort,
      tag: b.coefficient !== 1
       ? `${weatherLabel(b.weathercode)} à ${b.ville} · prévision ajustée ×${b.coefficient}`
       : `${weatherLabel(b.weathercode)} à ${b.ville} · aucun ajustement météo`,
      avgSales: b.quantiteVendue,
      stock: b.stockActuel,
      prevision: b.previsionIA,
      allocation: b.allocationPct,
      img: `https://picsum.photos/seed/${encodeURIComponent(b.pointDeVente)}/400/300`
     }))
   : [
      { name: 'Paris Champs-Élysées', type: 'Flagship store', ville: 'Paris', units: 50, tag: 'Fashion Week proximity, highest foot traffic.', avgSales: 120, stock: 30, prevision: 80, allocation: 41.7, img: 'https://picsum.photos/seed/paris1/400/300' },
      { name: 'Lyon Part-Dieu', type: 'Boutique', ville: 'Lyon', units: 25, tag: 'Strong summer category performance, regional hub', avgSales: 120, stock: 45, prevision: 70, allocation: 20.8, img: 'https://picsum.photos/seed/lyon1/400/300' },
      { name: 'Lille Grand Place', type: 'Boutique', ville: 'Lille', units: 20, tag: 'Forte affluence en semaine', avgSales: 120, stock: 40, prevision: 60, allocation: 16.7, img: 'https://picsum.photos/seed/lille1/400/300' },
      { name: 'Nice Promenade', type: 'Flagship store', ville: 'Nice', units: 15, tag: 'Fashion Week proximity, highest foot traffic.', avgSales: 120, stock: 50, prevision: 65, allocation: 12.5, img: 'https://picsum.photos/seed/nice1/400/300' },
      { name: 'Bordeaux Centre', type: 'Flagship store', ville: 'Bordeaux', units: 10, tag: 'Tourist hotspot, but smaller store size', avgSales: 120, stock: 55, prevision: 65, allocation: 8.3, img: 'https://picsum.photos/seed/bordeaux1/400/300' },
     ];

  // Onglets de villes : dérivés des données réelles quand elles existent.
  const VILLE_TABS = Array.from(new Set(ALL_BOUTIQUES.map(b => b.ville).filter(Boolean)));
  const BOUTIQUES = villeFilter
   ? ALL_BOUTIQUES.filter(b => b.ville === villeFilter)
   : ALL_BOUTIQUES;

  // En mode manuel, l'objectif est la quantité saisie par l'utilisateur et
  // les quantités par boutique viennent de sa saisie, pas du calcul.
  const recommandationSku = activeSku ? activeSku.totalReassort : 120;
  const objectifTotal =
   distributionManuelle && decisionFinale !== null
    ? Number(decisionFinale) || 0
    : recommandationSku;

  const quantiteBoutique = (nom: string, calculee: number) =>
   distributionManuelle ? Number(allocationsManuelles[nom] ?? '') || 0 : calculee;

  const totalReparti = ALL_BOUTIQUES.reduce(
   (somme, b) => somme + quantiteBoutique(b.name, b.units),
   0
  );
  const resteAReparti = objectifTotal - totalReparti;

  const totalAllocation = distributionManuelle ? totalReparti : recommandationSku;

  // --- Bilan prévisionnel : aucune valeur en dur ---
  const lignesSkuDistrib = activeSku
   ? forecastRows.filter(r => r.Code_Article === activeSku.sku)
   : [];
  const joursDistrib = joursCouverts(lignesSkuDistrib);
  const indicDistrib = activeSku
   ? computeIndicateurs(activeSku.stockActuel, activeSku.previsionIA, joursDistrib)
   : null;
  // Prix unitaire moyen constaté = CA réalisé / quantités vendues.
  const prixUnitaireMoyen =
   activeSku && activeSku.quantiteVendue > 0 ? activeSku.caHt / activeSku.quantiteVendue : 0;
  const caPrevu = objectifTotal * prixUnitaireMoyen;

  /** Génère et télécharge le rapport CSV complet. */
  const telechargerRapportCsv = () => {
   const allocationsNumeriques: Record<string, number> = {};
   for (const [pdv, valeur] of Object.entries(allocationsManuelles)) {
    allocationsNumeriques[pdv] = Number(valeur) || 0;
   }
   const csv = buildExportCsv(activeSku ? [activeSku] : skus, {
    decisions: activeSku ? { [activeSku.sku]: objectifTotal } : {},
    allocations: allocationsNumeriques,
    modeManuel: distributionManuelle
   });

   // BOM UTF-8 : sans lui, Excel affiche « PrÃªt-Ã -porter ».
   const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
   const url = URL.createObjectURL(blob);
   const lien = document.createElement('a');
   lien.href = url;
   lien.download = `smart-retail-previsions-${new Date().toISOString().slice(0, 10)}.csv`;
   document.body.appendChild(lien);
   lien.click();
   document.body.removeChild(lien);
   URL.revokeObjectURL(url);
  };

  return (
   <div className="flex h-screen bg-white font-sans text-slate-900 overflow-hidden relative">
    <MobileMenuButton className="bottom-64 right-6" />
    <MobileSidebar variant="detail" />

    <aside className="hidden lg:flex w-[310px] bg-white border-r border-[#D9D9D9] flex-col shrink-0">
     <Sidebar variant="detail" />
    </aside>

    <div className="flex-1 flex flex-col overflow-hidden bg-[#F8FBFF]/30">
     <header className="bg-white border-b border-[#0958D9] px-4 lg:px-6 py-3 lg:py-8 flex flex-col lg:flex-row lg:items-center justify-between shrink-0 gap-2 lg:gap-4">
      <div className="flex items-center justify-between lg:justify-start w-full lg:w-auto gap-4 lg:gap-6">
       <div className="flex items-center gap-2 lg:gap-6">
        <button 
         onClick={() => setState(prev => ({ ...prev, step: 'analysis-detail' }))}
         className="text-black hover:text-[#0958D9] transition-colors"
        >
         <ChevronLeft size={20} className="lg:w-6 lg:h-6" />
        </button>
        <div className="flex items-center gap-2 lg:gap-4">
         <img 
          src="https://picsum.photos/seed/veste/150/200" 
          alt="Product" 
          className="w-[40px] h-[53px] lg:w-[75px] lg:h-[100px] object-cover"
          referrerPolicy="no-referrer"
         />
         <div>
          <h1 className="text-sm lg:text-[38px] font-semibold leading-tight">Boutique Distribution</h1>
          <p className="text-[10px] lg:text-xl text-black/45 truncate max-w-[120px] sm:max-w-[200px] lg:max-w-none">
           SKU: {activeSku ? `${activeSku.sku} · ${activeSku.designation}` : '859163YCUA... Jimmy Veste'}
          </p>
         </div>
        </div>
       </div>

       <div className="lg:hidden text-right shrink-0">
        <p className="text-[10px] text-[#4A5565] leading-none mb-0.5">Total</p>
        <p className="text-sm font-semibold leading-none">
         <span className="text-[#0958D9]">{totalAllocation}</span> <span className="text-black/45 text-[10px] font-normal">u.</span>
        </p>
       </div>
      </div>

      <div className="hidden lg:block text-right">
       <p className="text-base text-[#4A5565] mb-2">Allocation Total</p>
       <p className="text-[28px] font-semibold">
        <span className="text-[#0958D9]">{totalAllocation}</span> <span className="text-black/45 text-base font-normal">unités</span>
       </p>
      </div>
     </header>

     <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
      <div className="flex-none lg:flex-1 lg:overflow-y-auto p-4 lg:p-6 space-y-6">
       <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
         <div className="relative w-full lg:w-[400px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-black/45" size={18} />
          <input 
           type="text" 
           placeholder="Recherche la boutique"
           className="w-full pl-10 pr-10 py-2 border border-[#D9D9D9] rounded focus:outline-none text-sm"
          />
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-black/45" size={18} />
         </div>
         <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-4 py-2 border border-[#D9D9D9] rounded text-sm hover:bg-slate-50">
           <Filter size={18} className="text-black/88" />
           <span>Filter</span>
          </button>
         </div>
        </div>

        <div className="flex items-center justify-between border-b border-[#F0F0F0]">
         <div className="flex items-center gap-4 lg:gap-8 overflow-x-auto no-scrollbar">
          {[null, ...VILLE_TABS].map((tab) => {
           const isActive = villeFilter === tab;
           return (
            <button
             key={tab ?? 'all'}
             onClick={() => setVilleFilter(tab)}
             className={`pb-4 text-sm font-semibold relative whitespace-nowrap ${isActive ? 'text-[#0958D9]' : 'text-[#828282]'}`}
            >
             {tab ?? 'Tout les boutiques'}
             {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0958D9] rounded" />}
            </button>
           );
          })}
          <button className="pb-4 text-sm text-[#828282] whitespace-nowrap flex items-center gap-1">
           <Plus size={14} /> <span>Ajouter plus Tag</span>
          </button>
         </div>
         <div className="hidden lg:flex items-center gap-2 pb-4">
          <button className="p-2 bg-[#F5F5F5] rounded text-[#0958D9]"> <Grid size={20} /> </button>
          <button className="p-2 text-black/45 hover:bg-slate-50 rounded"> <List size={20} /> </button>
         </div>
        </div>
       </div>

       {/* Suivi de la répartition saisie à la main. */}
       {distributionManuelle && (
        <div className={`p-4 rounded-lg border flex flex-wrap items-center justify-between gap-4 ${
         resteAReparti === 0
          ? 'bg-[#F6FFED] border-[#B7EB8F]'
          : 'bg-[#FFFBE6] border-[#FFE58F]'
        }`}>
         <div className="flex items-start gap-3">
          {resteAReparti === 0
           ? <CheckCircle2 size={20} className="text-green-600 shrink-0 mt-0.5" />
           : <AlertCircle size={20} className="text-[#D48806] shrink-0 mt-0.5" />}
          <div>
           <p className="text-sm font-bold text-black/80">Répartition manuelle</p>
           <p className="text-xs text-black/60 leading-relaxed">
            Vous avez retenu {objectifTotal} unités au lieu des {recommandationSku} recommandées.
            Saisissez la quantité de chaque boutique.
           </p>
          </div>
         </div>
         <div className="flex items-center gap-6">
          <div className="text-right">
           <p className="text-[10px] text-black/45 uppercase font-bold">Réparti</p>
           <p className="text-lg font-bold text-[#0958D9]">{totalReparti} / {objectifTotal}</p>
          </div>
          <div className="text-right">
           <p className="text-[10px] text-black/45 uppercase font-bold">Reste</p>
           <p className={`text-lg font-bold ${
            resteAReparti === 0 ? 'text-green-600' : resteAReparti < 0 ? 'text-red-500' : 'text-[#D48806]'
           }`}>
            {resteAReparti > 0 ? resteAReparti : resteAReparti < 0 ? `+${-resteAReparti} en trop` : '0'}
           </p>
          </div>
          <button
           onClick={() => {
            setDistributionManuelle(false);
            setDecisionFinale(null);
            setAllocationsManuelles({});
           }}
           className="px-4 py-2 border border-[#D9D9D9] bg-white rounded text-xs font-bold text-black/65 hover:bg-slate-50 transition-colors"
          >
           Revenir à la répartition IA
          </button>
         </div>
        </div>
       )}

       <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {BOUTIQUES.map((boutique, i) => (
         <div key={i} className="bg-white border border-[#D9D9D9] rounded-lg p-4 lg:p-6 space-y-4 shadow-sm">
          <div className="flex gap-4">
           <img src={boutique.img} alt={boutique.name} className="w-20 h-20 lg:w-24 lg:h-24 object-cover rounded" referrerPolicy="no-referrer" />
           <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start">
             <div>
              <h3 className="text-base lg:text-xl font-bold text-black/88 truncate">{boutique.name}</h3>
              <p className="text-xs lg:text-sm text-black/45 mb-2">{boutique.type}</p>
             </div>
             <div className="text-right shrink-0">
              {distributionManuelle ? (
               <>
                <input
                 type="number"
                 min="0"
                 inputMode="numeric"
                 placeholder="0"
                 value={allocationsManuelles[boutique.name] ?? ''}
                 onChange={(e) =>
                  setAllocationsManuelles(prev => ({ ...prev, [boutique.name]: e.target.value }))
                 }
                 className="w-20 lg:w-24 px-2 py-1 text-right text-xl lg:text-3xl font-bold text-[#0958D9] border border-[#D9D9D9] rounded focus:outline-none focus:ring-2 focus:ring-[#0958D9]/30 focus:border-[#0958D9] transition-all"
                />
                <p className="text-[10px] lg:text-xs text-black/45 mt-1">unités à saisir</p>
               </>
              ) : (
               <>
                <p className="text-xl lg:text-3xl font-bold text-[#0958D9] leading-none">{boutique.units}</p>
                <p className="text-[10px] lg:text-xs text-black/45">unités</p>
               </>
              )}
             </div>
            </div>
            <div className="bg-[#F0F7FF] border border-[#BAE0FF] rounded p-2">
             <p className="text-[10px] lg:text-xs text-[#0958D9] leading-tight">{boutique.tag}</p>
            </div>
           </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-2">
           <div> <p className="text-[10px] lg:text-xs text-black/45 mb-1">Quantité vendue</p> <p className="text-sm lg:text-base font-bold">{boutique.avgSales}</p> <p className="text-[10px] text-black/45">unités</p> </div>
           <div> <p className="text-[10px] lg:text-xs text-black/45 mb-1">Stock actuel</p> <p className="text-sm lg:text-base font-bold">{boutique.stock}</p> <p className="text-[10px] text-black/45">unités</p> </div>
           <div> <p className="text-[10px] lg:text-xs text-black/45 mb-1">Prévision IA</p> <p className="text-sm lg:text-base font-bold">{boutique.prevision}</p> <p className="text-[10px] text-black/45">unités</p> </div>
          </div>
          {(() => {
           // En mode manuel, le pourcentage se recalcule sur la saisie.
           const quantite = quantiteBoutique(boutique.name, boutique.units);
           const pourcentage = distributionManuelle
            ? (objectifTotal > 0 ? (quantite / objectifTotal) * 100 : 0)
            : boutique.allocation;
           return (
            <div className="pt-2">
             <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] lg:text-xs text-black/45">
               {distributionManuelle ? 'Part de votre objectif' : 'Allocation %'}
              </span>
              <span className="text-[10px] lg:text-xs font-bold">{pourcentage.toFixed(1)}%</span>
             </div>
             <div className="w-full h-2 bg-[#F5F5F5] rounded-full overflow-hidden">
              <div
               className="h-full bg-[#0958D9] transition-all duration-500"
               style={{ width: `${Math.min(100, Math.max(0, pourcentage))}%` }}
              />
             </div>
            </div>
           );
          })()}
         </div>
        ))}
       </div>

       <div className="hidden lg:flex items-center justify-between pt-8 pb-12">
        <div className="flex items-center gap-2">
         <span className="text-sm text-black/65">Page Total :</span>
         <select className="border border-[#D9D9D9] rounded px-2 py-1 text-sm"> <option>6</option> </select>
        </div>
        <div className="flex items-center gap-2">
         <button className="p-1 text-black/25"><ChevronLeft size={16} /></button>
         <button className="w-8 h-8 flex items-center justify-center bg-[#0958D9] text-white rounded text-sm">1</button>
         <button className="w-8 h-8 flex items-center justify-center text-black/65 rounded text-sm">2</button>
         <button className="w-8 h-8 flex items-center justify-center text-black/65 rounded text-sm">3</button>
         <span className="text-black/25">...</span>
         <button className="w-8 h-8 flex items-center justify-center text-black/65 rounded text-sm">10</button>
         <button className="p-1 text-black/65"><ChevronRight size={16} /></button>
        </div>
        <div className="flex items-center gap-2">
         <div className="flex items-center border border-[#D9D9D9] rounded overflow-hidden">
          <input type="text" defaultValue="10" className="w-10 px-2 py-1 text-sm text-center border-r border-[#D9D9D9]" />
          <span className="px-2 py-1 text-sm text-black/45">/20 Page</span>
         </div>
        </div>
       </div>
      </div>

      <div className="w-full lg:w-[400px] bg-white border-l border-[#D9D9D9] p-4 lg:p-8 lg:overflow-y-auto shrink-0 pb-80 lg:pb-8">
       <div className="space-y-8">
        <div className="space-y-6">
         <h3 className="text-lg lg:text-2xl font-semibold text-black/88">Finalisation et Export</h3>
         <div className="fixed bottom-0 left-0 right-0 bg-white p-3 border-t border-[#D9D9D9] lg:static lg:p-0 lg:border-none lg:bg-transparent space-y-2 lg:space-y-4 z-40 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] lg:shadow-none">
          <button 
           onClick={() => {
            setExportingState('syncing');
            setTimeout(() => {
             setExportingState('idle');
             setState(prev => ({ ...prev, step: 'export-success' }));
            }, 2500);
           }}
           className="w-full py-2 lg:py-4 bg-[#0958D9] text-white rounded text-sm lg:text-base font-semibold hover:bg-blue-700 transition-all flex items-center justify-center gap-3"
          >
           {exportingState === 'syncing' ? ( <> <div className="w-4 h-4 lg:w-6 lg:h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" /> Synchronisation... </> ) : ( 'Envoyer vers l’ERP' )}
          </button>
          {/* Génère et télécharge réellement le fichier, puis confirme. */}
          <button
           onClick={() => {
            setExportingState('downloading');
            try {
             telechargerRapportCsv();
            } catch (err: any) {
             console.error('Export CSV impossible :', err?.message || err);
            }
            setTimeout(() => {
             setExportingState('idle');
             setState(prev => ({ ...prev, step: 'download-success' }));
            }, 1200);
           }}
           className="w-full py-2 lg:py-4 bg-white border-2 border-[#0958D9] text-[#0958D9] rounded text-sm lg:text-base font-bold shadow-sm hover:bg-[#F0F7FF] transition-all flex items-center justify-center gap-2"
          >
           <UploadCloud size={18} className="rotate-180" />
           Exporter le rapport CSV
          </button>
          <button 
           onClick={() => {
            setExportingState('downloading');
            setTimeout(() => {
             setExportingState('idle');
             setState(prev => ({ ...prev, step: 'email-success' }));
            }, 1500);
           }}
           className="w-full py-2 lg:py-4 bg-white border border-[#D9D9D9] text-black/65 rounded text-sm lg:text-base font-semibold shadow-sm hover:bg-slate-50 transition-all"
          >
           Envoyer à l’email
          </button>
         </div>
        </div>

        <div className="p-4 lg:p-8 bg-white border border-[#D9D9D9] rounded-xl space-y-8">
         <h3 className="text-lg lg:text-2xl font-semibold text-black/88">Bilan prévisionnel</h3>
         {/* Chaque ligne est recalculée : rien n'est écrit en dur. */}
         <div className="space-y-6">
          <div className="flex justify-between items-center gap-4">
           <span className="text-base lg:text-xl text-black/65 flex items-center gap-1.5">
            CA Prévu
            <InfoTooltip texte={`Quantité retenue (${objectifTotal} u.) multipliée par le prix unitaire moyen constaté dans votre fichier (${prixUnitaireMoyen.toFixed(2)} € HT), obtenu en divisant le CA réalisé par les quantités vendues.`} />
           </span>
           <span className="text-lg lg:text-2xl font-bold text-black/88 text-right">
            {activeSku
             ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(caPrevu)
             : '—'}
           </span>
          </div>
          <div className="flex justify-between items-center gap-4">
           <span className="text-base lg:text-xl text-black/65 flex items-center gap-1.5">
            Impact météo
            <InfoTooltip texte="Écart entre la prévision ajustée par Open-Meteo et la prévision brute issue du seul historique. La marge bénéficiaire n'est pas affichée : votre fichier ne contient aucune donnée de coût d'achat." />
           </span>
           <span className="text-lg lg:text-2xl font-bold text-[#0958D9] text-right">
            {activeSku ? `${activeSku.upliftPct >= 0 ? '+' : ''}${Math.round(activeSku.upliftPct)}%` : '—'}
           </span>
          </div>
          <div className="flex justify-between items-center gap-4">
           <span className="text-base lg:text-xl text-black/65 flex items-center gap-1.5">
            Fiabilité Stock
            <InfoTooltip texte="Part de la demande des 7 prochains jours que le stock actuel couvre déjà, avant réassort. Complément du risque de rupture." />
           </span>
           <span className={`text-lg lg:text-2xl font-bold text-right ${
            indicDistrib && indicDistrib.fiabilitePct < 50 ? 'text-[#CF1322]' : 'text-[#0958D9]'
           }`}>
            {indicDistrib ? `${Math.round(indicDistrib.fiabilitePct)}%` : '—'}
           </span>
          </div>
          <div className="flex justify-between items-center gap-4">
           <span className="text-base lg:text-xl text-black/65 flex items-center gap-1.5">
            Période de couverture
            <InfoTooltip texte="Stock actuel divisé par les ventes journalières moyennes mesurées sur la période couverte par votre fichier." />
           </span>
           <span className="text-lg lg:text-2xl font-bold text-black/88 text-right">
            {indicDistrib
             ? `${indicDistrib.couvertureJours < 10 ? indicDistrib.couvertureJours.toFixed(1) : Math.round(indicDistrib.couvertureJours)} Jours`
             : '—'}
           </span>
          </div>
         </div>
        </div>
       </div>
      </div>
     </div>
    </div>

    <AnimatePresence>
     {exportingState !== 'idle' && (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6" >
       <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white rounded-[32px] p-12 max-w-lg w-full shadow-2xl text-center space-y-8" >
        {exportingState === 'downloading' ? (
         <>
          <div className="w-24 h-24 bg-[#F8FBFF] rounded-full flex items-center justify-center mx-auto relative">
           <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} className="absolute inset-0 border-4 border-[#0958D9] border-t-transparent rounded-full" />
           <UploadCloud size={40} className="text-[#0958D9]" />
          </div>
          <div> <h2 className="text-3xl font-semibold text-black mb-2">Préparation du fichier...</h2> <p className="text-xl text-black/45">Votre export CSV est en cours de génération.</p> </div>
          <div className="h-2 bg-[#F5F5F5] rounded-full overflow-hidden"> <motion.div initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: 2 }} className="h-full bg-[#0958D9]" /> </div>
         </>
        ) : (
         <>
          <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mx-auto"> <CheckCircle2 size={48} className="text-green-500" /> </div>
          <div> <h2 className="text-3xl font-semibold text-black mb-2">Export Réussi !</h2> <p className="text-xl text-black/45">Le fichier <span className="font-semibold text-black">boutique_distribution.csv</span> a été téléchargé avec succès.</p> </div>
          <button onClick={() => setExportingState('idle')} className="w-full py-4 bg-[#0958D9] text-white rounded-xl text-xl font-semibold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20" > Fermer </button>
         </>
        )}
       </motion.div>
      </motion.div>
     )}
    </AnimatePresence>
   </div>
  );
 }

 if (state.step === 'email-success') {
  return (
   <div className="min-h-screen bg-[#F8FBFF] flex items-center justify-center p-6">
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl w-full bg-white rounded-[40px] p-16 shadow-2xl border border-blue-100 text-center space-y-10 relative overflow-hidden" >
     <div className="absolute top-0 right-0 p-8 opacity-5"> <Mail size={200} /> </div>
     <div className="relative mx-auto w-32 h-32">
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", damping: 12, stiffness: 200 }} className="w-full h-full bg-blue-50 rounded-full flex items-center justify-center" > <Send size={56} className="text-[#0958D9] -rotate-12" /> </motion.div>
      <motion.div initial={{ x: -20, y: 20, opacity: 0 }} animate={{ x: 0, y: 0, opacity: 1 }} transition={{ delay: 0.4, duration: 0.6 }} className="absolute -top-2 -right-2 w-12 h-12 bg-green-500 rounded-full border-4 border-white flex items-center justify-center" > <Check size={24} className="text-white" /> </motion.div>
     </div>
     <div className="space-y-4"> <h2 className="text-4xl font-bold text-slate-900 tracking-tight">E-mail envoyé !</h2> <p className="text-xl text-slate-500 leading-relaxed"> Le rapport détaillé des prévisions a été envoyé à l'adresse :<br /> <span className="text-slate-900 font-semibold">{email}</span> </p> </div>
     <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 text-left space-y-4">
      <div className="flex items-start gap-4">
       <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-100"> <FileText size={20} className="text-slate-400" /> </div>
       <div> <p className="text-sm font-bold text-slate-900">Rapport_Previsions_2026.pdf</p> <p className="text-xs text-slate-400">Pièce jointe • 2.4 MB</p> </div>
      </div>
     </div>
     <div className="pt-6 space-y-4">
      <button onClick={() => setState(prev => ({ ...prev, step: 'dashboard' }))} className="w-full py-5 bg-[#0958D9] text-white rounded-2xl text-xl font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 flex items-center justify-center gap-3" > Retour au Dashboard <ArrowRight size={24} /> </button>
      <button onClick={() => setState(prev => ({ ...prev, step: 'boutique-distribution' }))} className="w-full py-4 bg-white text-slate-500 rounded-2xl text-lg font-semibold hover:bg-slate-50 transition-all border border-slate-200" > Envoyer à une autre adresse </button>
     </div>
    </motion.div>
   </div>
  );
 }

 if (state.step === 'download-success') {
  return (
   <div className="min-h-screen bg-[#F8FBFF] flex items-center justify-center p-6">
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-3xl w-full bg-white rounded-[48px] p-20 shadow-2xl border border-blue-100 text-center space-y-12 relative overflow-hidden" >
     <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#0958D9] via-blue-400 to-[#0958D9]" />
     <div className="relative mx-auto w-40 h-40">
      <motion.div initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", damping: 15, stiffness: 200 }} className="w-full h-full bg-[#E6F4FF] rounded-full flex items-center justify-center" > <FileSpreadsheet size={80} className="text-[#0958D9]" /> </motion.div>
      <motion.div initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }} className="absolute -bottom-2 -right-2 w-16 h-16 bg-green-500 rounded-full border-8 border-white flex items-center justify-center" > <Check size={32} className="text-white" /> </motion.div>
     </div>
     <div className="space-y-6"> <h2 className="text-5xl font-bold text-slate-900 tracking-tight">Export CSV Réussi</h2> <p className="text-2xl text-slate-500 max-w-xl mx-auto leading-relaxed"> Votre fichier <span className="text-[#0958D9] font-bold">boutique_distribution.csv</span> est prêt et a été téléchargé. </p> </div>
     <div className="grid grid-cols-3 gap-6">
      <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100"> <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mb-2">Format</p> <p className="text-xl font-bold text-slate-900">CSV (UTF-8)</p> </div>
      <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100"> <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mb-2">Taille</p> <p className="text-xl font-bold text-slate-900">1.2 MB</p> </div>
      <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100"> <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mb-2">Lignes</p> <p className="text-xl font-bold text-slate-900">1,240</p> </div>
     </div>
     <div className="pt-8 flex flex-col sm:flex-row gap-4 justify-center">
      <button onClick={() => setState(prev => ({ ...prev, step: 'boutique-distribution' }))} className="px-12 py-5 bg-[#0958D9] text-white rounded-2xl text-xl font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 flex items-center justify-center gap-3" > Retour à la liste </button>
      <button onClick={() => setState(prev => ({ ...prev, step: 'dashboard' }))} className="px-12 py-5 bg-white text-slate-600 rounded-2xl text-xl font-bold hover:bg-slate-50 transition-all border border-slate-200" > Tableau de bord </button>
     </div>
    </motion.div>
   </div>
  );
 }

 if (state.step === 'export-success') {
  return (
   <div className="min-h-screen bg-[#F8FBFF] flex items-center justify-center p-6">
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="max-w-3xl w-full bg-white rounded-[48px] p-20 shadow-2xl border border-blue-100 text-center space-y-12 relative overflow-hidden" >
     <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-green-400 via-emerald-500 to-green-400" />
     <div className="absolute -right-20 -top-20 w-64 h-64 bg-green-50 rounded-full opacity-50 blur-3xl" />
     <div className="relative mx-auto w-40 h-40">
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", damping: 12, stiffness: 200 }} className="w-full h-full bg-green-50 rounded-full flex items-center justify-center" > <Database size={80} className="text-Blu-500" /> </motion.div>
      <motion.div initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }} className="absolute -bottom-2 -right-2 w-16 h-16 bg-green-500 rounded-full border-8 border-white flex items-center justify-center" > <Check size={32} className="text-white" /> </motion.div>
      <motion.div animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 3, repeat: Infinity }} className="absolute inset-0 border-4 border-green-200 rounded-full -m-4" />
     </div>
     <div className="space-y-6"> <h2 className="text-5xl font-bold text-slate-900 tracking-tight">Synchronisation Réussie</h2> <p className="text-2xl text-slate-500 max-w-xl mx-auto leading-relaxed"> Vos prévisions ont été injectées dans <span className="text-blue-500 font-bold">ERP Central</span>. Les stocks seront mis à jour dans <span className="font-bold text-slate-900">5 minutes</span>. </p> </div>
     <div className="bg-slate-50 rounded-[32px] p-10 border border-slate-100 space-y-6 text-left">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
       <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm"> <TrendingUp size={24} className="text-blue-500" /> </div>
        <div> <p className="text-sm text-slate-400 font-bold uppercase tracking-wider">Référence Flux</p> <p className="text-xl font-bold text-slate-900">ERP-SYNC-2026-0042</p> </div>
       </div>
       <div className="text-right"> <p className="text-sm text-slate-400 font-bold uppercase tracking-wider">Statut</p> <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-green-100 text-green-700 rounded-full font-bold text-sm"> <div className="w-2 h-2 bg-green-500 rounded-full animate-ping" /> Actif </span> </div>
      </div>
      <div className="grid grid-cols-2 gap-8 pt-2">
       <div> <p className="text-sm text-slate-400 font-bold uppercase tracking-wider mb-1">Articles Impactés</p> <p className="text-2xl font-bold text-slate-900">1,240 SKUs</p> </div>
       <div> <p className="text-sm text-slate-400 font-bold uppercase tracking-wider mb-1">Entrepôt Cible</p> <p className="text-2xl font-bold text-slate-900">Logistique Nord</p> </div>
      </div>
     </div>
     <div className="pt-8 flex flex-col sm:flex-row gap-4 justify-center">
      <button onClick={() => setState(prev => ({ ...prev, step: 'dashboard' }))} className="px-12 py-5 bg-[#0958D9] text-white rounded-2xl text-xl font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 flex items-center justify-center gap-3" > Retour au Dashboard <ArrowRight size={24} /> </button>
      <button onClick={() => window.print()} className="px-12 py-5 bg-white text-slate-600 rounded-2xl text-xl font-bold hover:bg-slate-50 transition-all border border-slate-200" > Ouvrir ERP </button>
     </div>
    </motion.div>
   </div>
  );
 }

 if (state.step === 'login') {
  return (
   <div className="min-h-screen bg-white flex">
    <div className="hidden lg:flex lg:w-1/2 bg-[#f0f7ff] flex-col justify-end p-16 relative overflow-hidden">
     <div className="relative z-10">
      <div className="flex items-center gap-4">
       <img src="https://www.hebergement-photo.fr/uploads/20260905/4d081179a9808929eea6199fbe2036dcb91210c8.png" alt="Smart Retail Logo" className="w-16 h-16 object-contain" referrerPolicy="no-referrer" />
       <span className="text-3xl font-bold tracking-tight text-slate-900">SMART RETAIL</span>
      </div>
     </div>
     <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] opacity-10"> <div className="absolute top-0 left-0 w-full h-full border-[100px] border-blue-500 rounded-full animate-pulse"></div> </div>
    </div>
    <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
     <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full" >
      <h1 className="text-4xl font-bold text-[#003399] mb-2">Bienvenue</h1>
      <p className="text-slate-500 mb-10">Connectez-vous pour commencer l'onboarding.</p>
      
      {/* --- FORMULAIRE RÉEL CONDITIONNEL --- */}
      {!isVerifying ? (
        <form onSubmit={handleSendOtp} className="space-y-6">
          <div>
           <label className="block text-sm font-medium text-slate-700 mb-2">E-mail</label>
           <input 
             type="email" 
             placeholder="Votre@email.com" 
             className="w-full px-4 py-3 bg-[#f8fbff] border-l-4 border-l-[#0055ff] border-y border-r border-slate-100 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" 
             required 
             value={email}
             onChange={(e) => setEmail(e.target.value)}
             pattern="[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$" 
           />
          </div>
          <button type="submit" disabled={authLoading} className="w-full bg-[#0958D9] text-white font-semibold py-4 rounded-lg hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]" > 
            {authLoading ? "Envoi du code..." : "Recevoir un code par mail"} 
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-6">
          <div>
           <label className="block text-sm font-medium text-slate-700 mb-2">Code de vérification</label>
           <input 
             type="text" 
             placeholder="Code à 6 chiffres" 
             className="w-full px-4 py-3 bg-[#f8fbff] border-l-4 border-l-[#0055ff] border-y border-r border-slate-100 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-center text-2xl font-bold tracking-widest" 
             required 
             value={otp}
             onChange={(e) => setOtp(e.target.value)}
             maxLength={6}
           />
           <p className="text-xs text-slate-400 mt-2">Vérifiez vos emails pour trouver le code.</p>
          </div>
          <button type="submit" disabled={authLoading} className="w-full bg-[#0958D9] text-white font-semibold py-4 rounded-lg hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]" > 
            {authLoading ? "Vérification..." : "Valider et Entrer"} 
          </button>
          <button type="button" onClick={() => setIsVerifying(false)} className="w-full text-center text-sm text-blue-600 hover:underline">
            Modifier l'email
          </button>
        </form>
      )}
      {/* ------------------------------------- */}
      
      <p className="text-center text-sm text-slate-500 mt-6"> Vous n'avez pas de compte? <a href="#" className="text-blue-600 font-medium hover:underline">Inscrivez-vous</a> </p>
     </motion.div>
    </div>
   </div>
  );
 }

 return (
  <div className="min-h-screen bg-[#f4f7fa] font-sans text-slate-900">
   <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-50">
    <div className="flex items-center gap-3">
     <img src="https://www.hebergement-photo.fr/uploads/20260905/4d081179a9808929eea6199fbe2036dcb91210c8.png" alt="Smart Retail Logo" className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
     <span className="text-xl font-bold tracking-tight">SMART RETAIL</span>
    </div>
    <div className="flex items-center gap-6">
     <span className="text-sm text-slate-400">Configuration initiale</span>
     <button onClick={() => setState(prev => ({ ...prev, step: 'login' }))} className="p-2 text-slate-400 hover:text-slate-600 transition-colors" > <LogOut size={20} /> </button>
    </div>
   </header>

   <main className="max-w-[1600px] mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
    <div className="lg:col-span-7 space-y-8">
     <section className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
      <h2 className="text-3xl font-bold text-[#003399] mb-2">Bienvenue sur Smart Retail</h2>
      <p className="text-slate-500 mb-8">Configurez votre système intelligent de prévision des ventes</p>
      <div className="space-y-6">
       <div>
        <h3 className="text-lg font-bold mb-1">Profil de l'enseigne</h3>
        <p className="text-sm text-slate-500 mb-6">Remplissez les informations ci-dessous pour personnaliser votre expérience et optimiser la gestion de votre commerce.</p>
        <div className="grid grid-cols-2 gap-6">
         <div> <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Nom de l'entreprise</label> <input type="text" placeholder="Ex: Mode & Co" value={state.profile.name} onChange={(e) => setState(prev => ({ ...prev, profile: { ...prev.profile, name: e.target.value } }))} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" /> </div>
         <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Secteur d'activité</label>
          <div className="relative">
           <select value={state.profile.sector} onChange={(e) => setState(prev => ({ ...prev, profile: { ...prev.profile, sector: e.target.value } }))} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" >
            <option value="">Sélectionnez</option>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
           </select>
           <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
          </div>
         </div>
        </div>
       </div>
      </div>
     </section>

     <section className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
      <h3 className="text-xl font-bold mb-2">Définissez vos objectifs</h3>
      <p className="text-sm text-slate-500 mb-8">Ces informations personnaliseront vos prévisions</p>
      <div className="flex flex-wrap gap-3 mb-8">
       {GOALS.map(goal => (
        <button key={goal.id} onClick={() => toggleGoal(goal.id)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${ state.objectives.selectedGoals.includes(goal.id) ? 'bg-[#0958D9] text-white border-[#0958D9]' : 'bg-[#f8fbff] text-slate-600 border-slate-100 hover:border-slate-300' }`} > {goal.label} </button>
       ))}
      </div>
      <div className="grid grid-cols-2 gap-8">
       <div className="space-y-6">
        <div> <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2"> <TrendingUp size={14} className="text-blue-500" /> Objectif de ventes (7 jours) </label> <div className="relative"> <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">€</span> <input type="number" min="0" placeholder="42850" value={state.objectives.salesTarget} onChange={(e) => setState(prev => ({ ...prev, objectives: { ...prev.objectives, salesTarget: e.target.value } }))} className="w-full pl-8 pr-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" /> </div> <p className="text-[10px] text-slate-400 mt-1">CA souhaité pour la semaine prochaine</p> </div>
        <div> <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2"> <Package size={14} className="text-purple-500" /> Niveau de stock optimal </label> <input type="number" min="0" placeholder="57" value={state.objectives.optimalStock} onChange={(e) => setState(prev => ({ ...prev, objectives: { ...prev.objectives, optimalStock: e.target.value } }))} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" /> <p className="text-[10px] text-slate-400 mt-1">Nombre de SKUs à maintenir en stock</p> </div>
       </div>
       <div className="space-y-6">
        <div> <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2"> <TrendingUp size={14} className="text-green-500" /> Taux de croissance cible </label> <div className="relative"> <input type="number" min="0" placeholder="14" value={state.objectives.growthRate} onChange={(e) => setState(prev => ({ ...prev, objectives: { ...prev.objectives, growthRate: e.target.value } }))} className="w-full pl-4 pr-8 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" /> <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span> </div> <p className="text-[10px] text-slate-400 mt-1">Croissance vs période précédente</p> </div>
        <div> <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2"> <AlertCircle size={14} className="text-red-500" /> Seuil d'alerte stock faible </label> <input type="number" min="0" placeholder="12" value={state.objectives.alertThreshold} onChange={(e) => setState(prev => ({ ...prev, objectives: { ...prev.objectives, alertThreshold: e.target.value } }))} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" /> <p className="text-[10px] text-slate-400 mt-1">SKUs en dessous duquel être alerté</p> </div>
       </div>
      </div>
     </section>
    </div>

    <div className="lg:col-span-5 flex flex-col gap-8">
     <section className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
      <h3 className="text-xl font-bold mb-1">Ajoutez vos données</h3>
      <p className="text-sm text-slate-500 mb-8">Importez ou saisissez vos produits</p>
      {/* Champ de sélection monté en permanence, hors d'AnimatePresence qui ne
          gère que des enfants animés : il doit rester accessible après un
          premier import pour pouvoir compléter l'historique. */}
      <input
       type="file"
       multiple
       ref={fileInputRef}
       onChange={handleFileUpload}
       className="hidden"
       accept=".csv, .xlsx, .xls"
      />

      <AnimatePresence mode="wait">
       {state.importedFile ? (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="space-y-4" >
         <div className="p-6 border-2 border-blue-100 bg-blue-50/30 rounded-2xl">
          <div className="flex items-center gap-4">
           <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600"> <FileText size={24} /> </div>
           <div className="flex-1 min-w-0">
            <h4 className="font-bold text-slate-900 truncate">{state.importedFile.name}</h4>
            <p className="text-xs text-slate-500">{state.importedFile.size} • Importé le {state.importedFile.date}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
             <span className="inline-flex items-center px-2 py-1 bg-white rounded-md text-[10px] font-bold text-slate-600 border border-slate-100">
              {state.importedFile.count} lignes importées
             </span>
             {villesImportees.length > 0 && (
              <span className="inline-flex items-center px-2 py-1 bg-white rounded-md text-[10px] font-bold text-slate-600 border border-slate-100">
               {villesImportees.length} ville{villesImportees.length > 1 ? 's' : ''} : {villesImportees.join(', ')}
              </span>
             )}
             {moisImportes.length > 0 && (
              <span className="inline-flex items-center px-2 py-1 bg-white rounded-md text-[10px] font-bold text-slate-600 border border-slate-100">
               {moisImportes.length} mois : {moisImportes[0]} → {moisImportes[moisImportes.length - 1]}
              </span>
             )}
            </div>
           </div>
           <div className="flex items-center gap-2 shrink-0">
            <button
             onClick={() => fileInputRef.current?.click()}
             title="Ajouter un autre fichier"
             className="p-2 text-slate-400 hover:text-[#0958D9] transition-colors"
            >
             <Plus size={18} />
            </button>
            <button onClick={removeFile} title="Tout supprimer" className="p-2 text-slate-400 hover:text-red-500 transition-colors">
             <Trash2 size={18} />
            </button>
           </div>
          </div>

          {/* Liste des fichiers cumulés dans l'historique. */}
          {(state.importedFile.sources?.length ?? 0) > 0 && (
           <div className="mt-4 pt-4 border-t border-blue-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
             Fichier{state.importedFile.sources!.length > 1 ? 's' : ''} chargé{state.importedFile.sources!.length > 1 ? 's' : ''}
            </p>
            <ul className="space-y-1">
             {state.importedFile.sources!.map((nom) => (
              <li key={nom} className="flex items-center gap-2 text-xs text-slate-600">
               <FileSpreadsheet size={13} className="text-slate-400 shrink-0" />
               <span className="truncate">{nom}</span>
              </li>
             ))}
            </ul>
           </div>
          )}
         </div>

         {/* Champ dédié pour compléter l'historique avec un autre exercice. */}
         <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center gap-4 p-4 border-2 border-dashed border-slate-200 rounded-2xl hover:border-blue-400 hover:bg-blue-50/50 transition-all group text-left"
         >
          <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-500 shrink-0 group-hover:scale-110 transition-transform">
           <Plus size={20} />
          </div>
          <div className="min-w-0">
           <span className="block font-bold text-sm text-slate-800">Ajouter un autre fichier</span>
           <span className="block text-[10px] text-slate-400">
            Les lignes s'ajoutent à l'historique existant. Réimporter le même fichier ne crée pas de doublon.
           </span>
          </div>
         </button>
        </motion.div>
       ) : (
        <div className="grid grid-cols-2 gap-4">
         <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-200 rounded-2xl hover:border-blue-400 hover:bg-blue-50/50 transition-all group" > <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-500 mb-4 group-hover:scale-110 transition-transform"> <Upload size={24} /> </div> <span className="font-bold text-sm mb-1">Importer des fichiers</span> <span className="text-[10px] text-slate-400 text-center">Plusieurs fichiers acceptés : un par exercice pour bâtir l'historique</span> </button>
         <button onClick={handleErpConnect} disabled={state.isConnectingErp} className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl transition-all group ${ state.isErpConnected ? 'border-purple-400 bg-purple-50/50' : state.isConnectingErp ? 'border-purple-200 bg-purple-50/30 cursor-wait' : 'border-slate-200 hover:border-purple-400 hover:bg-purple-50/50' }`} >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform ${ state.isErpConnected ? 'bg-purple-100 text-purple-600' : state.isConnectingErp ? 'bg-purple-50 text-purple-400' : 'bg-purple-50 text-purple-500' }`}> {state.isConnectingErp ? ( <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" /> ) : state.isErpConnected ? ( <CheckCircle2 size={24} /> ) : ( <Database size={24} /> )} </div>
          <span className="font-bold text-sm mb-1"> {state.isConnectingErp ? 'Connexion...' : state.isErpConnected ? 'ERP Connecté' : 'acceder a ERP'} </span>
          <span className="text-[10px] text-slate-400 text-center"> {state.isConnectingErp ? 'Veuillez patienter' : state.isErpConnected ? 'Synchronisé avec succès' : 'Synchronisez votre système'} </span>
         </button>
        </div>
       )}
      </AnimatePresence>
     </section>

     <section className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm flex flex-col flex-1">
      <div className="flex-1">
       <div className="flex items-center gap-2 text-[#0958D9] mb-6"> <TrendingUp size={20} /> <h3 className="text-lg font-bold">Prochaines étapes</h3> </div>
       <ul className="space-y-4">
        <li className="flex items-start gap-3"> <CheckCircle2 size={18} className={isFormComplete ? "text-green-500 mt-0.5" : "text-slate-200 mt-0.5"} /> <span className={`text-sm ${isFormComplete ? "text-slate-700" : "text-slate-400"}`}>Accédez à votre tableau de bord personnalisé</span> </li>
        <li className="flex items-start gap-3"> <CheckCircle2 size={18} className={isFormComplete ? "text-green-500 mt-0.5" : "text-slate-200 mt-0.5"} /> <span className={`text-sm ${isFormComplete ? "text-slate-700" : "text-slate-400"}`}>Consultez vos premières prévisions de ventes</span> </li>
       </ul>
      </div>
      <div className="mt-12">
       <button disabled={!isFormComplete} onClick={handleStart} className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${ isFormComplete ? "bg-[#0958D9] text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700 active:scale-[0.98]" : "bg-slate-200 text-slate-400 cursor-not-allowed" }`} > Commencer à utiliser Smart Retail {isFormComplete && <ArrowRight size={20} />} </button>
      </div>
     </section>
    </div>
   </main>
  </div>
 );
}