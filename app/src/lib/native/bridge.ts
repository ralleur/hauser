/* Native-Brücke der Companion-App (Plan 21, §10).

   Die App-Hülle stellt `window.HauserNative` bereit; im Browser und auf dem
   Wandpanel fehlt es. Jede Fähigkeit hat hier ein No-op, damit die Oberfläche
   überall gleich aufgerufen werden kann. Neue Fähigkeit = dieses Interface
   erweitern, in der App implementieren, `BRIDGE_VERSION` anheben. */

export const BRIDGE_VERSION = 2;

export type HapticKind = 'selection' | 'impact' | 'success' | 'warning';

/* ── Plattform-Weg (Plan 21, Stufe 3): Apple Home / Google Home ──
   Die App liefert einen Schnappschuss des Zuhauses in neutraler Form:
   Räume, Zubehör, Dienste, Merkmale. Merkmal-Typen sind lesbare Namen
   (`power`, `brightness`, `targetTemperature` …), nicht die UUIDs der
   Plattform — die Übersetzung passiert nativ. */
export interface HomeCharacteristic {
  id: string;
  type: string;
  value: unknown;
  writable: boolean;
  min?: number;
  max?: number;
  step?: number;
}
export interface HomeService {
  id: string;
  type: string;
  name: string;
  characteristics: HomeCharacteristic[];
}
export interface HomeAccessory {
  id: string;
  name: string;
  roomId: string | null;
  reachable: boolean;
  category: string;
  services: HomeService[];
}
export interface HomeRoom { id: string; name: string }
export interface HomeSnapshot {
  authorized: boolean;
  homes: Array<{ id: string; name: string; primary: boolean; rooms: HomeRoom[]; accessories: HomeAccessory[] }>;
}
export interface HomeBridge {
  snapshot(): Promise<HomeSnapshot>;
  write(characteristicId: string, value: unknown): Promise<void>;
  onChange(cb: (characteristicId: string, value: unknown) => void): () => void;
}

export interface HauserNativeBridge {
  readonly version: number;
  readonly platform: 'ios' | 'android';
  haptic(kind: HapticKind): void;
  /** Öffnet die Kopplung neu, z. B. nach einem Widerruf. */
  unpair?(): void;
  /** Nur im Plattform-Weg vorhanden. */
  home?: HomeBridge;
  /** Widgets und Live Activities (Stufe 4): die App legt den Schnappschuss
      in die App-Gruppe; Bilder werden als lokale Pfade mitgegeben. */
  widgets?: {
    update(json: string, images: Array<{ roomId: string; path: string }>): void;
  };
  /** HA-Person (`person.*`) dieses Telefons aus der Kopplung — oder null. */
  person?: string | null;
  /** Dokumentenscanner (Ablage, Stufe 5): Seiten als JPEG in Base64. */
  documents?: { scan(): Promise<string[]> };
  /** Geführte Raumaufnahme: Querformat, Overlay mit Perspektiv-Hinweisen,
      Wasserwaage. Liefert ein JPEG (Base64) oder null bei Abbruch. */
  camera?: { captureRoom(roomName: string, hints: string[], strings: Record<string, string>): Promise<string | null> };
  /** Systemleiste des Betriebssystems. Die Panel-Shell zeichnet eine eigene
      vollständige Kopfzeile mit Uhr, Datum, Modus und Verbindung — daneben ist
      die iOS-Leiste dieselbe Uhrzeit ein zweites Mal. Die Telefon-Shell hat
      keine eigene Uhr und lässt sie deshalb stehen. */
  statusBar?: { setHidden(hidden: boolean): void };
  /** NFC-Tags (Stufe 6): lesen liefert die URL, schreiben legt sie ab. */
  nfc?: { scan(): Promise<string | null>; write(url: string): Promise<boolean> };
  /** FaceID/TouchID plus Schlüsselbund für ein Geheimnis (Ablage-PIN). */
  biometrics?: {
    authenticate(reason: string): Promise<boolean>;
    secretGet(key: string): Promise<string | null>;
    secretSet(key: string, value: string | null): Promise<void>;
  };
}

/** Navigation von außen (Widget, Push, Deep-Link): die App feuert dieses
    Ereignis, die Phone-Shell folgt ihm. */
export const NAVIGATE_EVENT = 'hauser:navigate';
export interface NavigateDetail { screen?: string; room?: string }

declare global {
  interface Window { HauserNative?: HauserNativeBridge }
}

const NOOP: HauserNativeBridge = Object.freeze({
  version: 0,
  platform: 'android',
  haptic() { /* im Browser gibt es keine Haptik */ },
});

export function nativeBridge(): HauserNativeBridge {
  if (typeof window === 'undefined') return NOOP;
  return window.HauserNative ?? NOOP;
}

export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && !!window.HauserNative;
}
