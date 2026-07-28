const host = process.env.HMI_HEALTH_HOST || '127.0.0.1';
const port = Number(process.env.HMI_PORT || 4173);
const url = `http://${host}:${port}/api/health`;

try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(2500),
    headers: { accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null);
  const healthyStatus = payload?.status === 'ready' || payload?.status === 'setup_required';
  if (!response.ok || payload?.ok !== true || !healthyStatus) {
    throw new Error(payload?.code || `HTTP_${response.status}`);
  }
} catch (error) {
  console.error(`Hauser healthcheck failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
}
