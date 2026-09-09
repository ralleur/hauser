/* Antworttypen der Hauser-API, auf die `server/api-contract.mjs` per Namen
   verweist. Von Hand gepflegt; die Zuordnung Route → Typ liegt im Vertrag und
   landet über den Generator in `contract.generated.ts`. */

export interface HealthResponse {
  ok: boolean;
  status: 'ready' | 'setup_required' | 'not_ready' | string;
  householdConfigMode?: 'active' | 'shadow' | string;
  schemaVersion?: number;
  code?: string;
  message?: string;
}

export interface BuildInfoResponse {
  version: string;
  revision: string | null;
  license: string;
  sourceUrl: string | null;
}

export interface PairingStartResponse {
  ok: true;
  code: string;
  guest?: boolean;
  expiresAt: number;
  lan: string | null;
  remote: string | null;
  link: string;
}

export interface PairingClaimResponse {
  ok: true;
  deviceId: string;
  name: string;
  token: string;
}

export interface PairedDevice {
  id: string;
  name: string;
  platform: string;
  person: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  lastSeenVia: 'lan' | 'remote' | null;
  guest: boolean;
  expiresAt: string | null;
}

export interface PairingDevicesResponse {
  ok: true;
  devices: PairedDevice[];
}

export interface RemoteStatusResponse {
  ok: true;
  enabled: boolean;
  state: 'unavailable' | 'starting' | 'needs-login' | 'running' | 'funnel-error' | 'stopped' | 'unreachable';
  authUrl?: string;
  hostname?: string;
  url?: string;
  error?: string;
  tailnet?: string;
  ownUrl: string | null;
}

export interface AppStatesResponse {
  ok: true;
  states: Array<{ entityId: string; state: string | null; attributes: Record<string, unknown>; changedAt: string | null }>;
}

export interface AppFileListResponse {
  ok: true;
  version?: string | null;
  revision?: string | null;
  files: Array<{ path: string; hash: string; size: number }>;
}

export interface HaConnectionResponse {
  ok: boolean;
  mode: 'direct' | 'supervisor';
  credentialsRequired: boolean;
  available: boolean;
  gatewayPath: string | null;
}

export interface SharedConfigResponse {
  values: Record<string, string>;
}

export interface HouseholdConfigModeResponse {
  mode: 'active' | 'shadow' | string;
}

export interface NotificationRulesResponse {
  version?: number;
  rules?: unknown;
  [key: string]: unknown;
}

export interface ReminderTask {
  id: string;
  title: string;
  completed: boolean;
  due: string | null;
  description: string | null;
  priority: string | null;
  created?: string | null;
  edited?: string | null;
  source: string;
}

export interface RemindersResponse {
  updated_at: string;
  source_name: string;
  source_color: string;
  items: ReminderTask[];
}

export interface ShoppingResponse {
  updated_at?: string;
  sections?: unknown[];
  [key: string]: unknown;
}

/* Kalendermomente: der Server sagt, was heute ein Moment ist; die Oberfläche
   formuliert den Satz in ihrer Sprache. */
export interface DayMoment {
  id: string;
  kind: 'birthday' | 'holiday' | 'first-snow';
  /** Roher Termintitel — steht bei `birthday` immer, der Name nur wenn eindeutig. */
  title?: string;
  name?: string | null;
  holiday?: string;
}

export interface MomentsResponse {
  ok: boolean;
  version: number;
  day: string;
  updatedAt: string;
  degraded: boolean;
  moments: DayMoment[];
}
