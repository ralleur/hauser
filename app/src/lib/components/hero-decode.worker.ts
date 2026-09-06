/* ── Hero-Dekodierung im Worker (Paket 5, docs/20) ──

   Der Worker holt das Bild und dekodiert es mit `createImageBitmap`. Beides
   passiert außerhalb des Hauptthreads; die Bitmap wird sofort wieder
   freigegeben, weil nur der aufgewärmte Cache gebraucht wird — gezeichnet
   wird das Bild anschließend als CSS-Hintergrund. Antwort ist nur „fertig“
   oder „ging nicht“, damit der Aufrufer wie bisher auf den Projekt-Fallback
   ausweichen kann.

   Bewusst ohne Importe: Vite bündelt diese Datei als klassischen Worker. */

interface DecodeRequest {
  id: number;
  url: string;
}

self.addEventListener('message', (event: MessageEvent<DecodeRequest>) => {
  const { id, url } = event.data ?? { id: 0, url: '' };
  void (async () => {
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const bitmap = await createImageBitmap(await response.blob());
      bitmap.close();
      (self as unknown as Worker).postMessage({ id, ok: true });
    } catch {
      (self as unknown as Worker).postMessage({ id, ok: false });
    }
  })();
});
