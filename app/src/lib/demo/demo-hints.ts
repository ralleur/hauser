/* ============================================
   Demo-Tipps: gekritzelte Hinweise auf versteckte Gesten (docs/12).

   Die Demo zeigt die Oberfläche, aber nicht, was sich hinter einem langen
   Druck verbirgt — Raum-Editor, zentrale Klimasteuerung, Licht-Detail,
   Layout. Diese Liste beschreibt je einen Tipp: Wo zeigt der Pfeil hin
   (Selektoren in Reihenfolge der Präferenz), auf welcher
   Seite sitzt der Text, und woran erkennt der Layer, dass die Geste
   gelungen ist. Der Layer (DemoHints.svelte) zeigt immer genau einen Tipp:
   den ersten offenen, dessen Ziel gerade im Bild ist. Nur im Panel — die
   Telefon-Oberfläche bleibt ohne Tipps.

   Nur im Demo-Build eingebunden — App.svelte importiert die Komponente hinter
   `VITE_DEMO`, im Produktionsbundle existiert dieser Code nicht.
   ============================================ */

import { centralClimateEdit, deviceDetail, roomEdit } from '../state/overlay.svelte.ts';
import { sceneEdit } from '../state/scene-edit-overlay.svelte.ts';
import { layoutManager } from '../state/layout-manager.svelte.ts';
import { ambientState } from '../state/ambient.svelte.ts';
import { blockedConfigAttempts, editMode } from '../state/edit-mode.svelte.ts';
import { m } from '../../paraglide/messages.js';

export type HintSide = 'above' | 'below' | 'left' | 'right';

export interface HintTarget {
  selector: string;
  side: HintSide;
  /** Abstand zwischen Ziel und Text in px; groß, wenn der Text erst hinter
      der Nachbarkachel Platz hat und der Pfeil darüber hinwegzeichnen soll. */
  gap?: number;
}

export interface DemoHint {
  id: string;
  /** Leer = frei schwebender Tipp ohne Schlaufe und Pfeil, mittig im Bild. */
  targets: readonly HintTarget[];
  text: () => string;
  /** Die Geste ist gelungen — der Tipp gilt als erledigt. */
  done: () => boolean;
  /** Bleibt nach der gelungenen Geste noch so lange stehen — für Tipps, deren
      Pointe erst nach dem Versuch zündet („Nichts passiert, oder?"). */
  lingerMs?: number;
  /** Nur zeigen, solange das gilt; sonst wird der Tipp übersprungen, ohne
      als erledigt zu gelten (etwa die Sperr-Tipps, wenn nie gesperrt wurde). */
  when?: () => boolean;
}

export const DEMO_HINTS: readonly DemoHint[] = [
  {
    id: 'device',
    targets: [{ selector: '.light-tile:not(.is-placeholder)', side: 'left' }],
    text: () => m.demo_hint_device(),
    done: () => deviceDetail.mode !== 'hidden',
  },
  {
    id: 'rooms',
    targets: [
      { selector: '.room-page:not([inert]) .room-btn.is-active', side: 'right', gap: 320 },
      { selector: '.room-page:not([inert]) .room-btn', side: 'right', gap: 320 },
    ],
    text: () => m.demo_hint_rooms(),
    done: () => roomEdit.mode !== 'hidden',
  },
  {
    id: 'climate',
    targets: [{ selector: '.cd-readout', side: 'above' }],
    text: () => m.demo_hint_climate(),
    done: () => centralClimateEdit.mode !== 'hidden',
  },
  {
    id: 'edit',
    targets: [{ selector: '.mode-toggle', side: 'below' }],
    text: () => m.demo_hint_edit(),
    done: () => !editMode.active,
  },
  /* Die beiden Sperr-Tipps ergeben nur Sinn, wenn der Bedienen-Modus
     wirklich an ist — wer die Sonne übersprungen hat, sieht sie nicht. */
  {
    id: 'rooms-locked',
    targets: [
      { selector: '.room-page:not([inert]) .room-btn.is-active', side: 'right', gap: 320 },
      { selector: '.room-page:not([inert]) .room-btn', side: 'right', gap: 320 },
    ],
    text: () => m.demo_hint_rooms_locked(),
    done: () => blockedConfigAttempts.total > 0,
    lingerMs: 3000,
    when: () => !editMode.active,
  },
  {
    id: 'edit-again',
    targets: [{ selector: '.mode-toggle', side: 'below' }],
    text: () => m.demo_hint_edit_again(),
    done: () => editMode.active,
    when: () => !editMode.active,
  },
  {
    id: 'explore',
    targets: [],
    text: () => m.demo_hint_explore(),
    done: () => false,
  },
];

/** Solange ein Overlay oder der Bildschirmschoner offen ist, bleibt der
    Tipp weg — er würde sonst über dem Dialog schweben, den er angekündigt hat. */
export function somethingCovers(): boolean {
  return deviceDetail.mode !== 'hidden'
    || roomEdit.mode !== 'hidden'
    || centralClimateEdit.mode !== 'hidden'
    || sceneEdit.mode !== 'hidden'
    || layoutManager.open
    || ambientState.active;
}

/* ── Handgezeichnete Pfade ──
   Der Zitter-Anteil kommt aus einem Zufallsgenerator mit festem Saatwert,
   damit derselbe Tipp bei jeder Neuvermessung gleich aussieht statt zu
   flimmern. mulberry32 reicht dafür völlig. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Point { x: number; y: number }

/** Leicht gebogener Pfeil mit Zitterlinie und zweistrichiger Spitze. */
export function roughArrow(from: Point, to: Point, seed: number): string {
  const rnd = seededRandom(seed);
  const jitter = () => (rnd() - 0.5) * 3;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = (rnd() - 0.5) * Math.min(80, len * 0.45);
  const ctrl = { x: (from.x + to.x) / 2 - (dy / len) * bend, y: (from.y + to.y) / 2 + (dx / len) * bend };
  const steps = Math.max(6, Math.min(18, Math.round(len / 24)));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * from.x + 2 * mt * t * ctrl.x + t * t * to.x;
    const y = mt * mt * from.y + 2 * mt * t * ctrl.y + t * t * to.y;
    const wobble = i === 0 || i === steps ? 0 : 1;
    points.push({ x: x + jitter() * wobble, y: y + jitter() * wobble });
  }
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
  const head = 14 + rnd() * 4;
  const spread = 0.5;
  const wing = (a: number) => `M${last.x.toFixed(1)} ${last.y.toFixed(1)} L${(last.x - Math.cos(a) * head).toFixed(1)} ${(last.y - Math.sin(a) * head).toFixed(1)}`;
  return `${line} ${wing(angle - spread + jitter() * 0.05)} ${wing(angle + spread + jitter() * 0.05)}`;
}

/** Ein rundlicher Kreis ums Ziel, knapp mehr als ein Umlauf. Bei breiten
    Zielen bleibt er ein Oval, aber deutlich näher am Kreis als das Ziel. */
export function roughLoop(rect: { x: number; y: number; width: number; height: number }, seed: number): string {
  const rnd = seededRandom(seed ^ 0x9e3779b9);
  const pad = 12;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const round = Math.max(rect.width, rect.height) / 2;
  const rx = (rect.width / 2) * 0.4 + round * 0.6 + pad;
  const ry = (rect.height / 2) * 0.4 + round * 0.6 + pad;
  const start = rnd() * Math.PI * 2;
  const turns = 1.05 + rnd() * 0.05;
  const steps = 32;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + (i / steps) * Math.PI * 2 * turns;
    const grow = 1 + (i / steps) * 0.03;
    const x = cx + Math.cos(a) * rx * grow + (rnd() - 0.5) * 3;
    const y = cy + Math.sin(a) * ry * grow + (rnd() - 0.5) * 3;
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return parts.join(' ');
}
