/* Update-Hinweis (P28, Postfach Cpt.Hardy 2026-10-03): „ein Hinweis, wenn ein
   Hauser-Update verfügbar ist — in Home Assistant geht das schnell unter.“
   Home Assistant legt für jedes Add-on selbst eine Update-Entität an
   (`update.hauser_update`, Titel „Hauser“); sie steht auf „on“, sobald der
   Supervisor eine neuere Fassung kennt. Der Server liest sie über den
   vorhandenen Core-Zugang — keine neue Berechtigung, keine Anfrage nach
   außen. Außerhalb des Add-ons gibt es nichts zu melden. Panel und iOS-App
   lesen dieselbe Antwort unter /api/hauser-update. */

const CACHE_MS = 30 * 60_000;
const ENTITY_ID = 'update.hauser_update';

function fromState(state) {
  if (!state || typeof state !== 'object') return { available: false };
  const attributes = state.attributes ?? {};
  const latest = typeof attributes.latest_version === 'string' ? attributes.latest_version.slice(0, 40) : null;
  const installed = typeof attributes.installed_version === 'string' ? attributes.installed_version.slice(0, 40) : null;
  return { available: state.state === 'on' && !!latest && latest !== installed, installed, latest };
}

export function createHauserUpdateWatch({ connectionMode, supervisorClientFactory, now = Date.now }) {
  let cached = null;
  let cachedAt = 0;
  let pending = null;

  async function read() {
    if (connectionMode !== 'supervisor') return { available: false };
    const client = supervisorClientFactory();
    try {
      const direct = await client.rest('GET', `/api/states/${ENTITY_ID}`).catch(() => null);
      if (direct?.status === 200) return fromState(direct.body);
      /* Anders benanntes Add-on: die Update-Entität mit dem Titel „Hauser“. */
      const all = await client.rest('GET', '/api/states');
      const states = Array.isArray(all?.body) ? all.body : [];
      return fromState(states.find((state) => typeof state?.entity_id === 'string'
        && state.entity_id.startsWith('update.') && state.attributes?.title === 'Hauser'));
    } finally {
      client.close?.();
    }
  }

  return {
    status() {
      if (cached && now() - cachedAt < CACHE_MS) return Promise.resolve(cached);
      pending ??= read()
        .catch(() => ({ available: false }))
        .then((value) => { cached = value; cachedAt = now(); pending = null; return value; });
      return pending;
    },
  };
}
