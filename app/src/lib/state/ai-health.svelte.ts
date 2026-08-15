/* Public product: the Hermes customization runtime — repository access,
   deployment toolchain, feature chat — is not part of the portable product,
   and neither is the gateway it probes.

   Ordinary settings sections (Ambient, Media, Services) only read whether an
   AI gateway can answer at all. Without one the status stays 'unauthorized',
   which those sections already render as "needs access". */

export const aiHealth = $state({
  status: 'unauthorized' as 'unknown' | 'ok' | 'offline' | 'unauthorized',
  checking: false,
});

export async function checkAiHealth(): Promise<void> {
  /* No gateway to probe in the portable product. */
}
