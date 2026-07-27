export const SHARED_CONFIG_KEYS = [
  'hmi:backend',
  'hmi:ha-url',
  'hmi:ha-token',
  'hmi:jf-url',
  'hmi:jf-token',
  'hmi:jf-user',
  'hmi:library',
  'hmi:lock-button',
  'hmi:device-config:v1',
  'hmi:scene-config:v1',
  'hmi:home-layout:v1',
  'hmi:light-icon-overrides:v1',
  'hmi:immersion-light:v1',
  'hmi:calendar-selected',
  'hmi:reminders-selected',
  'hmi:shopping-config:v1',
] as const;

export type SharedConfigKey = (typeof SHARED_CONFIG_KEYS)[number];
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type FetchLike = typeof fetch;

const keys = new Set<string>(SHARED_CONFIG_KEYS);

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function persist(updates: Record<string, string | null>, fetcher: FetchLike = fetch): void {
  void fetcher('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates }),
  }).catch(() => {});
}

/**
 * Synchroner Storage-Seam für bestehende App-Stores: lokal sofort wirksam,
 * zentral best-effort persistiert. bootstrapSharedConfig sorgt beim nächsten
 * Start dafür, dass der Serverstand vor allen App-Singletons geladen ist.
 */
export const sharedStorage: StorageLike = {
  getItem(key: string): string | null {
    try { return browserStorage()?.getItem(key) ?? null; } catch { return null; }
  },
  setItem(key: string, value: string): void {
    try { browserStorage()?.setItem(key, value); } catch { /* zentraler Write bleibt aktiv */ }
    if (keys.has(key)) persist({ [key]: value });
  },
  removeItem(key: string): void {
    try { browserStorage()?.removeItem(key); } catch { /* zentraler Write bleibt aktiv */ }
    if (keys.has(key)) persist({ [key]: null });
  },
};

/**
 * Lädt die zentrale Konfiguration vor dem Import der App. Fehlt ein Wert auf
 * dem Server, wird ein vorhandener Browserwert einmalig migriert. Existiert ein
 * Serverwert, überschreibt er den Browserstand eindeutig.
 */
export async function bootstrapSharedConfig(
  fetcher: FetchLike = fetch,
  storage: StorageLike | null = browserStorage(),
): Promise<void> {
  if (!storage) return;
  try {
    const response = await fetcher('/api/config', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const payload = await response.json() as { values?: Record<string, unknown> };
    const values = payload.values && typeof payload.values === 'object' ? payload.values : {};
    const migration: Record<string, string> = {};

    for (const key of SHARED_CONFIG_KEYS) {
      const central = values[key];
      if (typeof central === 'string') {
        storage.setItem(key, central);
      } else {
        const local = storage.getItem(key);
        if (local !== null) migration[key] = local;
      }
    }

    if (Object.keys(migration).length) {
      await fetcher('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: migration }),
      });
    }
  } catch {
    // Server/Storage nicht erreichbar: bestehender lokaler Stand bleibt nutzbar.
  }
}
