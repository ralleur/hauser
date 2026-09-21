/* Blaupause eines Raumbilds — zur Laufzeit aus dem vorhandenen Motiv gerechnet,
   keine eigene Bildfassung: das Motiv wird zu einem ruhigen Blau, seine Konturen
   liegen als feine helle Zeichenlinien darüber. Geht deshalb mit jedem Bild,
   auch mit eigenen Fotos. Gerechnet wird einmal je Bildadresse, klein (die
   Linien werden dadurch kräftiger) und erst, wenn die Raum-Konfiguration am
   Telefon aufgeht — der Startpfad bleibt unberührt.

   Helle Motive dürfen nicht grell werden: der Blauton ist bewusst eng gefasst,
   die Zeichnung tragen die Linien (Owner-Befund 2026-09-20, Schlafzimmer). */

const LONGEST_EDGE = 1000;
/* Töne als sRGB 0–255: Tiefe, Licht, Tusche. */
const SHADE = [18, 32, 62] as const;
const LIGHT = [44, 66, 104] as const;
const INK = [222, 235, 248] as const;
const INK_STRENGTH = 0.62;
/* Kanten unter der Schwelle sind Rauschen (Holzmaserung, Verläufe), darüber zählt jede. */
const EDGE_FLOOR = 0.09;
const EDGE_GAIN = 2.6;

const cache = new Map<string, Promise<string | null>>();

export function roomBlueprint(url: string): Promise<string | null> {
  let entry = cache.get(url);
  if (!entry) {
    entry = render(url).catch(() => null);
    cache.set(url, entry);
  }
  return entry;
}

async function render(url: string): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  const scale = Math.min(1, LONGEST_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  drawBlueprint(pixels.data, width, height);
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  return blob ? URL.createObjectURL(blob) : null;
}

/** Rechnet die Blaupause in den Puffer (RGBA, in place). Ohne DOM — prüfbar. */
export function drawBlueprint(data: Uint8ClampedArray, width: number, height: number): void {
  const count = width * height;
  const luma = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const at = i * 4;
    luma[i] = (0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2]) / 255;
  }
  /* Leicht beruhigen (3×3), sonst zeichnet jede Körnung eine Linie. */
  const calm = new Float32Array(count);
  for (let y = 0; y < height; y += 1) {
    const up = Math.max(0, y - 1) * width;
    const mid = y * width;
    const down = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - 1);
      const right = Math.min(width - 1, x + 1);
      calm[mid + x] = (luma[up + left] + luma[up + x] + luma[up + right]
        + luma[mid + left] + luma[mid + x] + luma[mid + right]
        + luma[down + left] + luma[down + x] + luma[down + right]) / 9;
    }
  }
  for (let y = 0; y < height; y += 1) {
    const up = Math.max(0, y - 1) * width;
    const mid = y * width;
    const down = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - 1);
      const right = Math.min(width - 1, x + 1);
      /* Sobel: die Helligkeit der Kante wird zur Deckkraft der Tusche. */
      const gx = calm[up + right] + 2 * calm[mid + right] + calm[down + right]
        - calm[up + left] - 2 * calm[mid + left] - calm[down + left];
      const gy = calm[down + left] + 2 * calm[down + x] + calm[down + right]
        - calm[up + left] - 2 * calm[up + x] - calm[up + right];
      const edge = Math.min(1, Math.max(0, (Math.hypot(gx, gy) - EDGE_FLOOR) * EDGE_GAIN)) * INK_STRENGTH;
      const tone = calm[mid + x];
      const at = (mid + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const ground = SHADE[channel] + (LIGHT[channel] - SHADE[channel]) * tone;
        data[at + channel] = ground + (INK[channel] - ground) * edge;
      }
      data[at + 3] = 255;
    }
  }
}
