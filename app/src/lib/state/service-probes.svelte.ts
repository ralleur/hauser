/* ============================================
   Erreichbarkeit der Dienste, die nicht über den HA-Adapter laufen: die
   private Ablage (Paperless hinter dem HMI-Server) und die Songwerkstatt
   (lokaler ACE-Step-Dienst).

   Beide bringen bereits einen Status-Endpunkt mit, deshalb genügt hier ein
   dünner Probe-Aufruf. Bewusst kein Polling: die Dienste-Sektion fragt beim
   Öffnen einmal, mehr Aktualität braucht eine Einstellungsseite nicht.
   ============================================ */

export type ProbeState = 'unknown' | 'checking' | 'ok' | 'error';

export const serviceProbes = $state({
  /* Ablage: konfiguriert = PIN + Token liegen im Schlüsselbund des Servers.
     unlocked spiegelt die aktive PIN-Session dieses Browsers. */
  ablage: { state: 'unknown' as ProbeState, configured: false, unlocked: false },
});

const TIMEOUT_MS = 4000;

export async function probeAblage(): Promise<void> {
  serviceProbes.ablage.state = 'checking';
  try {
    const response = await fetch('/api/ablage/status', {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('status');
    const payload = await response.json();
    serviceProbes.ablage.configured = Boolean(payload?.configured);
    serviceProbes.ablage.unlocked = Boolean(payload?.unlocked);
    serviceProbes.ablage.state = 'ok';
  } catch {
    serviceProbes.ablage.state = 'error';
    serviceProbes.ablage.configured = false;
    serviceProbes.ablage.unlocked = false;
  }
}

export async function probeLocalServices(): Promise<void> {
  await probeAblage();
}
