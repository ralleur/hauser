/* ============================================
   Lastaufteilung (B-19) — reine Berechnung der Kuchen-/Donut-Segmente aus den
   aktuellen Leistungen der `ENERGY_SENSORS.load`-Quellen. Kein DOM, kein
   Framework, keine Adapter-Kenntnis: Eingabe sind bereits gelesene kW-Werte
   (null = unavailable), Ausgabe sind sortierte Segmente mit Anteil + kumuliertem
   Offset (für `stroke-dashoffset`). Die Summe hier ist NUR fürs Overlay; die
   offizielle „Erfasste Last" bleibt `energyView().load` (identische Rohsumme).
   ============================================ */

export interface LoadInput {
  /** menschenlesbares Label (Legende/Segment) */
  label: string;
  /** aktuelle Leistung in kW; null/unavailable → als 0 behandelt (ausgeblendet) */
  value: number | null;
  /** optionale Gruppe: gleich benannte Eingaben fallen zu EINEM Segment zusammen */
  group?: string;
}

export interface LoadSegment {
  /** stabiler Schlüssel fürs `{#each}` (Gruppenname bzw. Label) */
  key: string;
  label: string;
  /** Leistung des Segments in kW */
  value: number;
  /** Anteil an der Gesamtlast, 0..1 */
  fraction: number;
  /** kumulierter Anteil am Segmentstart (0..1), für `stroke-dashoffset` */
  offset: number;
}

export interface LoadBreakdown {
  /** Summe aller berücksichtigten Segmente in kW */
  total: number;
  segments: LoadSegment[];
}

export interface LoadBreakdownOptions {
  /** Anteilsschwelle: Quellen darunter wandern in „Sonstige" (Default 4 %). */
  otherThreshold?: number;
  /** Label des Sammelsegments (Default „Sonstige"). */
  otherLabel?: string;
}

interface Bucket {
  key: string;
  label: string;
  value: number;
}

/* Eingaben → Kuchensegmente. Reihenfolge der Schritte:
   1. null/≤0 ausblenden (keine Fake-/Platzhalterwerte),
   2. nach `group` zusammenfassen,
   3. kleine Quellen (< Schwelle) zu „Sonstige" bündeln — aber nur ab 2 Stück,
      damit ein einzelner kleiner Verbraucher nicht sinnlos umbenannt wird,
   4. absteigend sortieren („Sonstige" immer zuletzt),
   5. Anteil + kumulierten Offset berechnen. */
export function computeLoadBreakdown(
  inputs: readonly LoadInput[],
  options: LoadBreakdownOptions = {},
): LoadBreakdown {
  const otherThreshold = options.otherThreshold ?? 0.04;
  const otherLabel = options.otherLabel ?? 'Sonstige';

  // 1 + 2: gültige Werte nach Gruppe (bzw. Label) zusammenfassen.
  const merged = new Map<string, Bucket>();
  for (const input of inputs) {
    if (input.value === null || input.value <= 0) continue;
    const key = input.group ? `group:${input.group}` : `src:${input.label}`;
    const label = input.group ?? input.label;
    const existing = merged.get(key);
    if (existing) existing.value += input.value;
    else merged.set(key, { key, label, value: input.value });
  }

  const buckets = [...merged.values()];
  const total = buckets.reduce((sum, b) => sum + b.value, 0);
  if (total <= 0) return { total: 0, segments: [] };

  // 3: kleine Quellen einsammeln; erst ab 2 Stück zu „Sonstige" bündeln.
  const small = buckets.filter((b) => b.value / total < otherThreshold);
  let visible = buckets;
  if (small.length >= 2) {
    const smallKeys = new Set(small.map((b) => b.key));
    const otherValue = small.reduce((sum, b) => sum + b.value, 0);
    visible = buckets.filter((b) => !smallKeys.has(b.key));
    visible.push({ key: 'other', label: otherLabel, value: otherValue });
  }

  // 4: absteigend, „Sonstige" ans Ende.
  visible.sort((a, b) => {
    if (a.key === 'other') return 1;
    if (b.key === 'other') return -1;
    return b.value - a.value;
  });

  // 5: Anteil + kumulierter Offset.
  let offset = 0;
  const segments = visible.map((b) => {
    const fraction = b.value / total;
    const segment: LoadSegment = { key: b.key, label: b.label, value: b.value, fraction, offset };
    offset += fraction;
    return segment;
  });

  return { total, segments };
}
