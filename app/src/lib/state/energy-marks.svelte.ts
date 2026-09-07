/* ── Von Hand gesetzte Zettelplätze des Energie-Screens (R19, docs/23) ──
   Die Vorlage sagt, wo Zettel und Punkte sitzen; wer sie verschiebt, legt
   das im Haushalt ab — je Motiv, damit ein Bildwechsel keine fremden Plätze
   erbt. Gelesen einmal aus dem Laufzeitmodell, danach hält diese Sicht den
   Stand, den der eigene Schreibvorgang zuletzt bestätigt hat. */
import type { EnergyMarksConfig } from '../config/household-config.ts';
import { HOUSEHOLD_RUNTIME_MODEL } from '../config/household-runtime-data.ts';

/* Der Anfangswert entsteht beim Laden des Moduls, nicht beim ersten Lesen:
   Lesen geschieht in Ableitungen, und dort darf kein Zustand geschrieben
   werden. Der Energie-Screen lädt lazy, das Laufzeitmodell steht dann. */
function initial(): EnergyMarksConfig | null {
  const model = HOUSEHOLD_RUNTIME_MODEL as { exteriorMarks?: EnergyMarksConfig | null } | null;
  return model?.exteriorMarks ?? null;
}

const view = $state({ value: initial() });

export function energyMarks(): EnergyMarksConfig | null {
  return view.value;
}

export function setEnergyMarks(marks: EnergyMarksConfig | null): void {
  view.value = marks;
}

/** Schreibt die Plätze ETag-gesichert in den Haushalt; null nimmt sie zurück. */
export async function saveEnergyMarks(marks: EnergyMarksConfig | null): Promise<void> {
  const current = await fetch('/api/household-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!current.ok) throw new Error('HOUSEHOLD_CONFIG_UNREACHABLE');
  await current.text();
  const etag = current.headers.get('etag');
  if (!etag) throw new Error('HOUSEHOLD_CONFIG_ETAG_MISSING');
  const response = await fetch('/api/household-energy-marks', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify({ marks }),
  });
  if (!response.ok) throw new Error('ENERGY_MARKS_WRITE_FAILED');
  setEnergyMarks(marks);
}
