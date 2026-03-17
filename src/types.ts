export type AppStep = 'login' | 'onboarding' | 'processing' | 'ready' | 'dashboard' | 'analysis-detail' | 'boutique-distribution' | 'export-success';

export interface StoreProfile {
  name: string;
  sector: string;
}

export interface Objectives {
  salesTarget: string;
  growthRate: string;
  optimalStock: string;
  alertThreshold: string;
  selectedGoals: string[];
}

export interface ImportedFile {
  name: string;
  size: string;
  date: string;
  count: number;
}

export interface AppState {
  step: AppStep;
  profile: StoreProfile;
  objectives: Objectives;
  importedFile: ImportedFile | null;
  isErpConnected: boolean;
  isConnectingErp?: boolean;
  showNotifications: boolean;
}
