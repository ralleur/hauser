/* Erzeugt den Energie-Platzhalter (R14a, docs/23): ein generisches Haus von
   außen im Hauser-Stil, komponiert nach docs/energy-hero-safe-area-template.svg.
   Gleicher Provider-Codepfad wie der Raumbild-Assistent. Drei Schritte:
   Komposition aus dem bisherigen Motiv, Stilpass, Nachtvariante aus dem Tag.
   Schreibt PNGs in den Ausgabeordner; die AVIFs für public/energy entstehen
   danach mit `node scripts/energy-placeholder.mjs --pack <ordner>`. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { createChatGptRoomImageProvider, createRoomImageCredentialStore } from '../server.mjs';
import { buildDarkRoomImagePrompt, buildStyleLightRoomImagePrompt } from '../src/lib/room-images/room-image-prompt-policy-v1.ts';

const MODE = process.argv[2]?.startsWith('--') ? process.argv[2] : '--generate';
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : (process.argv[3] || '/tmp/hauser-energy');
const SOURCE = process.argv[3] || resolve(import.meta.dirname, '../public/energy/day.avif');
/* Das Außenrezept (R14b): Das Raumrezept machte aus dem fertigen Haus ein
   Wohnzimmer — der Stilprompt sprach von einem Raum, und das Modell glaubte ihm. */
const SPEC = { stylePreset: 'hauser-exterior-v1', declutter: 'light', tone: 'neutral', preserveFeatures: ['windows', 'doors'] };

/* Vorlage in Bildprozent (3:2-Leinwand, 1536×1024): Himmel oben links ruhig
   (Leitwert), Haus rechts, Sonne oben rechts, Strommast am rechten Rand,
   Wiese unten (Verlaufslinie). Kein Wahrzeichen, keine Stadt: der Platzhalter
   gehört jedem Haushalt. */
const COMPOSITION_PROMPT = [
  'Repaint this as a completely new exterior scene in the same illustration style: a friendly, generic modern family house seen from the garden in three-quarter view, in late-morning summer light.',
  'Composition rules, strict: the house stands in the right half of the picture, its roof ridge around one fifth from the top and its ground line around three quarters down; the roof faces the viewer and carries a neat row of dark-blue solar modules.',
  'The left half above the horizon is calm open sky with only a soft gradient and one or two faint clouds — keep this area empty, nothing may stand there.',
  'A small warm sun sits high in the upper right corner of the sky.',
  'At the far right edge, a simple wooden utility pole with a single power line leads out of the picture toward the house.',
  'The bottom fifth of the picture is a calm lawn with a low hedge and a path, without objects or figures.',
  'A front door, a couple of windows, a few shrubs and one tree beside the house; no cars, no people, no text, no logos, no famous landmarks, no city skyline.',
  'Keep the palette of the reference: warm cream walls, natural greens, blue sky; unmistakably illustrated, clean dark contours, three to five tonal levels per surface.',
].join(' ');

const NIGHT_PROMPT = buildDarkRoomImagePrompt(SPEC);

async function generate({ restyle = false } = {}) {
  mkdirSync(OUT, { recursive: true });
  const credentialStore = createRoomImageCredentialStore({});
  const status = credentialStore.status();
  console.log('Zugang:', status.configured ? `konfiguriert (${status.mode})` : 'FEHLT');
  if (!status.configured) process.exit(1);
  const provider = createChatGptRoomImageProvider({ credentialStore });
  /* --restyle: die Komposition steht schon, nur Stil und Nacht neu. */
  const source = restyle
    ? readFileSync(join(OUT, '1-komposition.png'))
    : await sharp(readFileSync(SOURCE)).jpeg({ quality: 92 }).toBuffer();
  console.log('Quelle:', restyle ? join(OUT, '1-komposition.png') : SOURCE, source.length, 'bytes');
  const steps = [
    ...(restyle ? [] : [['1-komposition', COMPOSITION_PROMPT, new Uint8Array(source)]]),
    ['2-stil', buildStyleLightRoomImagePrompt(SPEC), restyle ? new Uint8Array(source) : null],
    ['3-nacht', NIGHT_PROMPT, null],
  ];
  let previous = null;
  for (const [name, prompt, initial] of steps) {
    const input = initial ?? previous;
    console.log(`\n--- ${name} ---`);
    const result = await provider.edit({ prompt, input });
    if (!result.image) {
      console.log('FEHLGESCHLAGEN:', JSON.stringify({ status: result.status, errorCode: result.errorCode }));
      process.exit(1);
    }
    const file = join(OUT, `${name}.png`);
    writeFileSync(file, Buffer.from(result.image));
    console.log('OK ->', file, result.image.byteLength, 'bytes');
    /* Die Nacht entsteht aus dem Stilbild, nicht aus der Komposition. */
    previous = name === '1-komposition' ? result.image : name === '2-stil' ? result.image : previous;
  }
}

/* AVIF für public/energy: Tag aus 2-stil, Nacht aus 3-nacht. */
async function pack(dir) {
  const target = resolve(import.meta.dirname, '../public/energy');
  for (const [src, dst] of [['2-stil.png', 'day.avif'], ['3-nacht.png', 'night.avif']]) {
    const out = join(target, dst);
    await sharp(join(dir, src)).avif({ quality: 62, effort: 6 }).toFile(out);
    const meta = await sharp(out).metadata();
    console.log(dst, meta.width, 'x', meta.height, readFileSync(out).length, 'bytes');
  }
}

if (MODE === '--pack') await pack(OUT);
else if (MODE === '--restyle') await generate({ restyle: true });
else await generate();
