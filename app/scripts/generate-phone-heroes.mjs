/* B-27 D4: Phone-Ableitungen der Projekt-Heroes.
   Analog zu `icons:assets` im prebuild/predev eingehängt. Die erzeugten
   Dateien werden NICHT committet — sie entstehen deterministisch aus den
   eingecheckten Originalen und derselben Policy, die auch der Server für
   Nutzerbilder verwendet. Damit kann Panel- und Phone-Fassung nicht
   auseinanderlaufen. */
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const heroRoot = join(appRoot, 'public', 'hero');

const { deriveRoomImagePhoneVariant } = await import(
  join(appRoot, 'src', 'lib', 'room-images', 'room-image-phone-derivation-policy-v1.ts')
);

/* Der Phone-Resolver fragt weder `all` noch `dark-off` an (siehe
   PHONE_HERO_ROOMS und PhoneHeroVariant in room-hero-assets.ts). Was nie
   angefordert wird, wird auch nicht erzeugt. */
const ROOMS = ['bad', 'flur', 'kinderzimmer', 'kueche', 'schlafzimmer', 'wohnzimmer'];
const VARIANTS = ['light', 'dark'];

let written = 0;
let skipped = 0;
for (const room of ROOMS) {
  for (const variant of VARIANTS) {
    const source = join(heroRoot, `${room}-${variant}.avif`);
    try {
      await access(source);
    } catch {
      skipped += 1;
      console.warn(`[phone-heroes] Quelle fehlt, übersprungen: ${room}-${variant}.avif`);
      continue;
    }
    const target = join(heroRoot, `${room}-${variant}-phone.avif`);
    const derived = await deriveRoomImagePhoneVariant(new Uint8Array(await readFile(source)));
    await writeFile(target, derived);
    written += 1;
  }
}
console.log(`[phone-heroes] ${written} Phone-Ableitung(en) erzeugt${skipped ? `, ${skipped} übersprungen` : ''}.`);
