import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Das Projekt benötigt für diesen nativen Node-Smoke keine @types/node-Laufzeitabhängigkeit.
import http from 'node:http';
// @ts-expect-error Nativer Node-Test ohne @types/node.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Nativer Node-Test ohne @types/node.
import { tmpdir } from 'node:os';
// @ts-expect-error Nativer Node-Test ohne @types/node.
import { join } from 'node:path';
// Der Produktionsserver bleibt absichtlich natives Node-ESM ohne Build-Schritt.
// @ts-expect-error Für die .mjs-Laufzeitdatei existiert keine separate Declaration.
import { ablageRequestAllowed, ambientRequestAllowed, buildAceSongRequest, buildSongPlanMessages, configRequestAllowed, createAblageAccess, createFamilyDataStore, createHmiServer, createHouseholdConfigReader, createSongLibrary, familyDataRequestAllowed, householdConfigRequestAllowed, normalizeHouseholdConfigMode, notionBridgeRequestAllowed, notionBridgeTargetPath, paperlessTargetPath, parseSongPlan, proxyRequestAllowed, proxyTargetPath, serveHouseholdConfig, serveHouseholdConfigMode, songRequestAllowed, songTargetPath, staticCacheControl, staticPathFor } from '../../server.mjs';

const servers: Array<{ close: (callback: () => void) => void }> = [];
const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('HMI-Backend-Proxy', () => {
  it('erlaubt nur die schmalen ACE-Step- und Bibliotheksrouten', () => {
    const allowed = new Set(['http://test-client.local']);
    expect(songTargetPath('/api/songs/health')).toEqual({ kind: 'health', path: '/health', method: 'GET' });
    expect(songTargetPath('/api/songs/audio?path=%2Ftmp%2Fsong.mp3')).toEqual({ kind: 'audio', path: '/v1/audio?path=%2Ftmp%2Fsong.mp3', method: 'GET' });
    expect(songTargetPath('/api/songs/library')).toEqual({ kind: 'library', path: '', method: null });
    expect(songTargetPath('/api/songs/library/550e8400-e29b-41d4-a716-446655440000/audio')).toEqual({
      kind: 'library-audio', path: '', method: null, id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(songTargetPath('/api/songs/library?path=/tmp/song.mp3')).toBeNull();
    expect(songTargetPath('/api/songs/models')).toBeNull();
    expect(songRequestAllowed({ method: 'POST', headers: { origin: 'http://test-client.local' } }, songTargetPath('/api/songs/generate'), allowed)).toBe(true);
    expect(songRequestAllowed({ method: 'DELETE', headers: {} }, songTargetPath('/api/songs/library/550e8400-e29b-41d4-a716-446655440000'), allowed)).toBe(true);
    expect(songRequestAllowed({ method: 'PATCH', headers: {} }, songTargetPath('/api/songs/library/550e8400-e29b-41d4-a716-446655440000'), allowed)).toBe(true);
    expect(songRequestAllowed({ method: 'GET', headers: { origin: 'https://evil.invalid' } }, songTargetPath('/api/songs/health'), allowed)).toBe(false);
  });

  it('speichert Songs zentral, liefert Range-Audio und löscht Katalog samt Datei', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hmi-song-library-'));
    tempDirs.push(root);
    const source = join(root, 'source');
    const libraryDir = join(root, 'library');
    const catalog = join(libraryDir, 'library.json');
    const sourceFile = join(source, 'song.mp3');
    mkdirSync(source, { recursive: true });
    writeFileSync(sourceFile, '0123456789abcdef');
    const library = createSongLibrary(libraryDir, catalog, source);
    const song = {
      id: '550e8400-e29b-41d4-a716-446655440000', title: 'Jamie muss ins Bett', idea: 'Jamie muss ins Bett',
      style: 'Pop', era: 'Heute', voice: 'Weiblich', duration: 170, createdAt: '2026-07-23T18:48:00.000Z',
      sourceAudioUrl: `/api/songs/audio?path=${encodeURIComponent(sourceFile)}`,
    };
    expect(library.register(song).song?.audioUrl).toBe(`/api/songs/library/${song.id}/audio`);
    expect(JSON.parse(readFileSync(catalog, 'utf8'))[0].title).toBe(song.title);

    const server = createHmiServer('server-secret', { songLibrary: library, allowedOrigins: new Set(['http://test-client.local']) });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const list = await fetch(`http://127.0.0.1:${port}/api/songs/library`);
    expect((await list.json()).songs).toEqual([expect.objectContaining({ id: song.id, title: song.title })]);
    const renamed = await fetch(`http://127.0.0.1:${port}/api/songs/library/${song.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '  Jamies Gute-Nacht-Lied  ' }),
    });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).song.title).toBe('Jamies Gute-Nacht-Lied');
    expect(JSON.parse(readFileSync(catalog, 'utf8'))[0].title).toBe('Jamies Gute-Nacht-Lied');
    const invalidRename = await fetch(`http://127.0.0.1:${port}/api/songs/library/${song.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '   ' }),
    });
    expect(invalidRename.status).toBe(400);
    const audio = await fetch(`http://127.0.0.1:${port}/api/songs/library/${song.id}/audio`, { headers: { Range: 'bytes=2-5' } });
    expect(audio.status).toBe(206);
    expect(audio.headers.get('content-range')).toBe('bytes 2-5/16');
    expect(await audio.text()).toBe('2345');
    const removed = await fetch(`http://127.0.0.1:${port}/api/songs/library/${song.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(existsSync(join(libraryDir, `${song.id}.mp3`))).toBe(false);
  });

  it('erzeugt einen strukturierten deutschen Liedtext und übergibt ihn unverändert an ACE-Step', async () => {
    let observedPlanRequest: any = null;
    let observedAceBody: any = null;
    const lyrics = '[Verse 1]\nJamie, draußen wird es still, weil der Mond schon schlafen will.\n\n[Chorus]\nJamie muss ins Bett, gute Nacht, bis der neue Morgen lacht.\n\n[Verse 2]\nDein Kuscheltier liegt im Arm, deine Decke hält dich warm.';
    const planner = http.createServer((req: any, res: any) => {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk.toString(); });
      req.on('end', () => {
        observedPlanRequest = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          caption: 'A gentle German bedtime pop song with soft female vocals and warm piano.', lyrics,
        }) } }] }));
      });
    });
    servers.push(planner);
    await new Promise<void>((resolve) => planner.listen(0, '127.0.0.1', resolve));

    const ace = http.createServer((req: any, res: any) => {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk.toString(); });
      req.on('end', () => {
        observedAceBody = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"data":{"task_id":"550e8400-e29b-41d4-a716-446655440000"}}');
      });
    });
    servers.push(ace);
    await new Promise<void>((resolve) => ace.listen(0, '127.0.0.1', resolve));
    const server = createHmiServer('server-secret', {
      aceStepPort: (ace.address() as { port: number }).port,
      ambientPort: (planner.address() as { port: number }).port,
      allowedOrigins: new Set(['http://test-client.local']),
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/songs/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://test-client.local' },
      body: JSON.stringify({ idea: 'Jamie muss ins Bett', style: 'Pop', era: 'Heute', voice: 'Weiblich', experimental: 35, model: 'attacker-model', batch_size: 8 }),
    });
    expect(response.status).toBe(200);
    expect(observedPlanRequest.model).toBe('gpt-5.6-luna');
    expect(observedPlanRequest.messages[1].content).toContain('Jamie muss ins Bett');
    expect(observedAceBody).toMatchObject({
      prompt: 'A gentle German bedtime pop song with soft female vocals and warm piano.',
      lyrics,
      thinking: true,
      batch_size: 1,
      inference_steps: 8,
      vocal_language: 'de',
      use_cot_caption: false,
      use_cot_language: false,
    });
    expect(observedAceBody.sample_query).toBeUndefined();
    expect(observedAceBody.model).toBeUndefined();
  });

  it('validiert Liedtextpläne und pinnt die deutsche Sprachkonditionierung', () => {
    const input = { idea: 'Jamie muss ins Bett', style: 'Pop', era: 'Heute', voice: 'Weiblich', experimental: 35 };
    expect(buildSongPlanMessages(input)[0].content).toContain('verständlicher deutscher Liedtext');
    const plan = parseSongPlan('```json\n{"caption":"A gentle German bedtime pop song.","lyrics":"[Verse 1] Jamie wird müde und der Abend wird still. [Chorus] Jamie muss ins Bett und schläft ganz sacht. [Verse 2] Der Mond wacht über ihre gute Nacht."}\n```');
    expect(plan?.lyrics).toContain('Jamie muss ins Bett');
    expect(buildAceSongRequest(input, plan)).toMatchObject({ lyrics: plan?.lyrics, vocal_language: 'de', use_cot_language: false });
    expect(parseSongPlan('{"caption":"zu kurz","lyrics":"Fantasietext"}')).toBeNull();
  });

  it('mappt nur valide Ablage-Zeiträume auf Paperless-Datumsfilter', () => {
    expect(paperlessTargetPath('/api/ablage/documents?query=Police&from=2026-01-02&to=2026-07-21&page=2')).toEqual({
      kind: 'documents',
      path: '/api/documents/?page=2&page_size=30&ordering=-created&query=Police&created__date__gte=2026-01-02&created__date__lte=2026-07-21',
    });
    expect(paperlessTargetPath('/api/ablage/documents?from=gestern&to=2026-7-2')?.path).not.toContain('created__');
    expect(paperlessTargetPath('/api/ablage/documents/import')).toEqual({
      kind: 'upload', path: '/api/documents/post_document/',
    });
    expect(paperlessTargetPath('/api/ablage/tasks')).toEqual({
      kind: 'tasks', path: '/api/tasks/?page=1&page_size=100&ordering=-date_created&task_name=consume_file',
    });
  });

  it('begrenzt Ablage-PIN-Fehlversuche serverseitig', () => {
    let now = 1_000;
    const access = createAblageAccess('246810', 'paperless-secret', () => now);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(access.unlock('000000', 'client-a')).toEqual({ ok: false, limited: false });
    }
    expect(access.unlock('000000', 'client-a')).toEqual({ ok: false, limited: true });
    expect(access.unlock('246810', 'client-a')).toEqual({ ok: false, limited: true });
    now += 60_001;
    expect(access.unlock('246810', 'client-a').ok).toBe(true);
  });

  it('schützt Paperless serverseitig per PIN und gibt den API-Token nie an den Browser', async () => {
    let observedAuthorization = '';
    let observedPath = '';
    const paperless = http.createServer((req: any, res: any) => {
      observedAuthorization = req.headers.authorization || '';
      observedPath = req.url || '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ count: 1, next: null, previous: null, results: [{
        id: 42, title: 'Versicherung', created: '2026-07-20', content: 'sensitiver OCR-Volltext',
      }] }));
    });
    servers.push(paperless);
    await new Promise<void>((resolve) => paperless.listen(0, '127.0.0.1', resolve));
    const paperlessPort = (paperless.address() as { port: number }).port;
    const allowed = new Set(['http://test-client.local']);
    expect(ablageRequestAllowed({ method: 'GET', headers: { origin: 'http://test-client.local' } }, allowed)).toBe(true);
    expect(ablageRequestAllowed({ method: 'GET', headers: { origin: 'https://evil.invalid' } }, allowed)).toBe(false);

    const server = createHmiServer('server-secret', {
      paperlessPort, paperlessPin: '246810', paperlessToken: 'paperless-secret', allowedOrigins: allowed,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const locked = await fetch(`http://127.0.0.1:${port}/api/ablage/documents?query=Police`, {
      headers: { Origin: 'http://test-client.local' },
    });
    expect(locked.status).toBe(401);

    const unlock = await fetch(`http://127.0.0.1:${port}/api/ablage/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://test-client.local' },
      body: JSON.stringify({ pin: '246810' }),
    });
    expect(unlock.status).toBe(200);
    const cookie = unlock.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toMatch(/^hmi_ablage=[a-f0-9]{64}$/);
    expect(unlock.headers.get('set-cookie')).toContain('HttpOnly');
    expect(unlock.headers.get('set-cookie')).toContain('SameSite=Strict');

    const documents = await fetch(`http://127.0.0.1:${port}/api/ablage/documents?query=Police`, {
      headers: { Cookie: cookie!, Origin: 'http://test-client.local' },
    });
    expect(documents.status).toBe(200);
    expect(observedAuthorization).toBe('Token paperless-secret');
    expect(observedPath).toContain('/api/documents/?');
    expect(observedPath).toContain('query=Police');
    const payload = await documents.json();
    expect(payload.results).toEqual([expect.objectContaining({ id: 42, title: 'Versicherung' })]);
    expect(JSON.stringify(payload)).not.toContain('paperless-secret');
    expect(JSON.stringify(payload)).not.toContain('sensitiver OCR-Volltext');

    await fetch(`http://127.0.0.1:${port}/api/ablage/lock`, {
      method: 'POST', headers: { Cookie: cookie!, Origin: 'http://test-client.local' },
    });
    const relocked = await fetch(`http://127.0.0.1:${port}/api/ablage/documents`, {
      headers: { Cookie: cookie!, Origin: 'http://test-client.local' },
    });
    expect(relocked.status).toBe(401);
  });

  it('leitet Dateiimporte nur mit PIN-Freigabe an den festen Paperless-Endpunkt', async () => {
    let observedAuthorization = '';
    let observedPath = '';
    let observedBody = '';
    const paperless = http.createServer((req: any, res: any) => {
      observedAuthorization = req.headers.authorization || '';
      observedPath = req.url || '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => { observedBody += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('"task-id"');
      });
    });
    servers.push(paperless);
    await new Promise<void>((resolve) => paperless.listen(0, '127.0.0.1', resolve));
    const paperlessPort = (paperless.address() as { port: number }).port;
    const allowed = new Set(['http://test-client.local']);
    const server = createHmiServer('server-secret', {
      paperlessPort, paperlessPin: '246810', paperlessToken: 'paperless-secret', allowedOrigins: allowed,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const lockedForm = new FormData();
    lockedForm.append('document', new Blob(['gesperrt'], { type: 'text/plain' }), 'gesperrt.txt');
    const locked = await fetch(`http://127.0.0.1:${port}/api/ablage/documents/import`, {
      method: 'POST', headers: { Origin: 'http://test-client.local' }, body: lockedForm,
    });
    expect(locked.status).toBe(401);

    const unlock = await fetch(`http://127.0.0.1:${port}/api/ablage/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://test-client.local' },
      body: JSON.stringify({ pin: '246810' }),
    });
    const cookie = unlock.headers.get('set-cookie')?.split(';')[0];
    const form = new FormData();
    form.append('document', new Blob(['Importtest'], { type: 'text/plain' }), 'importtest.txt');
    const imported = await fetch(`http://127.0.0.1:${port}/api/ablage/documents/import`, {
      method: 'POST', headers: { Cookie: cookie!, Origin: 'http://test-client.local' }, body: form,
    });
    expect(imported.status).toBe(202);
    expect(await imported.json()).toEqual({ imported: true });
    expect(observedAuthorization).toBe('Token paperless-secret');
    expect(observedPath).toBe('/api/documents/post_document/');
    expect(observedBody).toContain('filename="importtest.txt"');
    expect(observedBody).toContain('Importtest');
  });

  it('liefert nur laufende Paperless-Dokumentverarbeitungen an die Ablage', async () => {
    let observedPath = '';
    const paperless = http.createServer((req: any, res: any) => {
      observedPath = req.url || '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ results: [
        { id: 1, task_id: 'task-active', task_name: 'consume_file', task_file_name: 'scan.pdf', status: 'STARTED', result: null },
        { id: 2, task_id: 'task-done', task_name: 'consume_file', task_file_name: 'fertig.pdf', status: 'SUCCESS', result: 'sensitiver OCR-Text' },
        { id: 3, task_id: 'task-other', task_name: 'train_classifier', task_file_name: null, status: 'STARTED', result: null },
      ] }));
    });
    servers.push(paperless);
    await new Promise<void>((resolve) => paperless.listen(0, '127.0.0.1', resolve));
    const paperlessPort = (paperless.address() as { port: number }).port;
    const allowed = new Set(['http://test-client.local']);
    const server = createHmiServer('server-secret', {
      paperlessPort, paperlessPin: '246810', paperlessToken: 'paperless-secret', allowedOrigins: allowed,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const unlock = await fetch(`http://127.0.0.1:${port}/api/ablage/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://test-client.local' },
      body: JSON.stringify({ pin: '246810' }),
    });
    const cookie = unlock.headers.get('set-cookie')?.split(';')[0];
    const tasks = await fetch(`http://127.0.0.1:${port}/api/ablage/tasks`, {
      headers: { Cookie: cookie!, Origin: 'http://test-client.local' },
    });
    expect(tasks.status).toBe(200);
    expect(observedPath).toBe('/api/tasks/?page=1&page_size=100&ordering=-date_created&task_name=consume_file');
    expect(await tasks.json()).toEqual({ processing: [
      { id: 'task-active', fileName: 'scan.pdf', status: 'STARTED' },
    ] });
  });

  it('mappt ausschließlich den Same-Origin-Hermes-Prefix', () => {
    expect(proxyTargetPath('/hermes/health')).toBe('/health');
    expect(proxyTargetPath('/hermes/v1/runs/x?full=1')).toBe('/v1/runs/x?full=1');
    expect(proxyTargetPath('/hermes')).toBeNull();
    expect(proxyTargetPath('/hermes/v1/models')).toBeNull();
    expect(proxyTargetPath('/hermes/api/config')).toBeNull();
    expect(proxyTargetPath('/hermes-evil/api')).toBeNull();
    expect(proxyTargetPath('/api/sessions')).toBeNull();
  });

  it('startet ohne macOS-Schlüsselbund und deaktiviert den optionalen Hermes-Proxy fail-safe', async () => {
    const server = createHmiServer('', { paperlessPin: '', paperlessToken: '' });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/hermes/health`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Hermes-Integration ist nicht konfiguriert' });
  });

  it('weist fremde Browser-Origins und unbekannte Methoden ab', () => {
    const allowed = new Set(['http://localhost:4173']);
    expect(proxyRequestAllowed({ method: 'GET', headers: { host: 'localhost:4173' } }, allowed)).toBe(true);
    expect(proxyRequestAllowed({ method: 'POST', headers: { host: 'localhost:4173', origin: 'http://localhost:4173' } }, allowed)).toBe(true);
    expect(proxyRequestAllowed({ method: 'POST', headers: { host: 'attacker.example', origin: 'http://attacker.example' } }, allowed)).toBe(false);
    expect(proxyRequestAllowed({ method: 'POST', headers: { host: 'localhost:4173', origin: 'https://evil.invalid' } }, allowed)).toBe(false);
    expect(proxyRequestAllowed({ method: 'PATCH', headers: { host: 'localhost:4173' } }, allowed)).toBe(true);
    expect(proxyRequestAllowed({ method: 'PUT', headers: { host: 'localhost:4173' } }, allowed)).toBe(false);
  });

  it('speichert Erinnerungen zentral im HMI-Backend', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hmi-family-data-'));
    tempDirs.push(dir);
    const dataPath = join(dir, 'family-data.json');
    const seedPath = join(dir, 'seed.json');
    writeFileSync(seedPath, JSON.stringify({
      version: 1,
      updatedAt: '2026-07-23T16:49:00.000Z',
      reminders: [{
        id: '3a658ddc-b17b-81c1-a49c-f17aba753448', title: 'Sam - Schimmelspray benutzen',
        completed: false, due: null, description: null, priority: null,
        created: '2026-07-23T16:49:00.000Z', edited: '2026-07-23T16:49:00.000Z', source: 'hmi',
      }],
      shopping: [{ id: 'rewe', title: 'Rewe', items: [] }],
    }));
    const allowed = new Set(['https://dashboard.example.com']);
    expect(familyDataRequestAllowed({ method: 'POST', headers: { origin: 'https://dashboard.example.com' } }, allowed)).toBe(true);
    expect(familyDataRequestAllowed({ method: 'POST', headers: { origin: 'https://evil.invalid' } }, allowed)).toBe(false);

    const familyData = createFamilyDataStore(dataPath, seedPath);
    const server = createHmiServer('server-secret', { familyData, allowedOrigins: allowed });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const created = await fetch(`http://127.0.0.1:${port}/api/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://dashboard.example.com' },
      body: JSON.stringify({ who: 'alex', title: 'Fenster schließen', due: '2026-08-01' }),
    });
    expect(created.status).toBe(201);

    const reminders = await fetch(`http://127.0.0.1:${port}/api/reminders`);
    const reminderData = await reminders.json();
    expect(reminderData.items.map((item: { title: string }) => item.title)).toEqual([
      'Sam - Schimmelspray benutzen', 'Alex - Fenster schließen',
    ]);
    const createdReminder = reminderData.items[1];
    expect(createdReminder.due).toBe('2026-08-01');

    const edited = await fetch(`http://127.0.0.1:${port}/api/reminders/${createdReminder.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: 'https://dashboard.example.com' },
      body: JSON.stringify({ title: 'Alex - Terrassentür schließen', due: '2026-08-02' }),
    });
    expect(edited.status).toBe(200);
    const editedData = await (await fetch(`http://127.0.0.1:${port}/api/reminders`)).json();
    expect(editedData.items[1]).toMatchObject({
      title: 'Alex - Terrassentür schließen', due: '2026-08-02',
    });

  });

  it('erlaubt nur die Shopping-Routen der Notion-Bridge', () => {
    const allowed = new Set(['https://dashboard.example.com']);
    expect(notionBridgeTargetPath('/notion-bridge/health')).toBe('/health');
    expect(notionBridgeTargetPath('/notion-bridge/shopping/add')).toBe('/shopping/add');
    expect(notionBridgeTargetPath('/notion-bridge/shopping/toggle')).toBe('/shopping/toggle');
    expect(notionBridgeTargetPath('/notion-bridge/tasks/add')).toBeNull();
    expect(notionBridgeTargetPath('/notion-bridge/tasks/complete')).toBeNull();
    expect(notionBridgeRequestAllowed({ method: 'POST', headers: { origin: 'https://dashboard.example.com' } }, '/shopping/add', allowed)).toBe(true);
    expect(notionBridgeRequestAllowed({ method: 'GET', headers: {} }, '/health', allowed)).toBe(true);
    expect(notionBridgeRequestAllowed({ method: 'GET', headers: {} }, '/shopping/add', allowed)).toBe(false);
    expect(notionBridgeRequestAllowed({ method: 'POST', headers: { origin: 'https://evil.invalid' } }, '/shopping/add', allowed)).toBe(false);
  });

  it('reicht Shopping-POSTs zur lokalen Notion-Bridge weiter', async () => {
    const snapshotDir = mkdtempSync(join(tmpdir(), 'hmi-notion-shopping-'));
    tempDirs.push(snapshotDir);
    const notionShoppingPath = join(snapshotDir, 'notion-shopping.json');
    writeFileSync(notionShoppingPath, JSON.stringify({ sections: [{ id: 'aldi', title: 'Aldi', items: [] }] }));
    let observedPath = '';
    let observedBody = '';
    const notionBridge = http.createServer((req: any, res: any) => {
      observedPath = req.url || '';
      req.on('data', (chunk: any) => { observedBody += chunk.toString(); });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    servers.push(notionBridge);
    await new Promise<void>((resolve) => notionBridge.listen(0, '127.0.0.1', resolve));
    const server = createHmiServer('server-secret', {
      notionBridgePort: (notionBridge.address() as { port: number }).port,
      notionShoppingPath,
      allowedOrigins: new Set(['https://dashboard.example.com']),
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/notion-bridge/shopping/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://dashboard.example.com' },
      body: '{"store":"aldi","title":"Test"}',
    });
    expect(response.status).toBe(200);
    expect(observedPath).toBe('/shopping/add');
    expect(observedBody).toBe('{"store":"aldi","title":"Test"}');

    const snapshot = await fetch(`http://127.0.0.1:${port}/notion-shopping.json`);
    expect(snapshot.status).toBe(200);
    expect(snapshot.headers.get('content-type')).toContain('application/json');
    expect((await snapshot.json()).sections[0].id).toBe('aldi');

    const obsoleteCompanionRoute = await fetch(`http://127.0.0.1:${port}/api/shopping`);
    expect(obsoleteCompanionRoute.status).toBe(410);
  });

  it('erlaubt den Ambient-LLM-Pfad nur als POST vom freigegebenen Origin', () => {
    const allowed = new Set(['http://localhost:4173']);
    expect(ambientRequestAllowed({ method: 'POST', headers: { origin: 'http://localhost:4173' } }, allowed)).toBe(true);
    expect(ambientRequestAllowed({ method: 'GET', headers: { origin: 'http://localhost:4173' } }, allowed)).toBe(false);
    expect(ambientRequestAllowed({ method: 'POST', headers: { origin: 'https://evil.invalid' } }, allowed)).toBe(false);
  });

  it('hält normalisierte statische Pfade innerhalb von dist', () => {
    expect(staticPathFor('/assets/index.js')).toContain('/app/dist/assets/index.js');
    expect(staticPathFor('/../../etc/passwd')).toContain('/app/dist/etc/passwd');
    expect(staticPathFor('/%2e%2e/%2e%2e/etc/passwd')).toContain('/app/dist/etc/passwd');
    expect(staticPathFor('/../../etc/passwd')).not.toBe('/etc/passwd');
  });

  it('serves an injected static root without changing the default dist root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hmi-static-root-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Neutral harness</title>');
    writeFileSync(join(root, 'assets', 'neutral.js'), 'export const neutral = true;');

    expect(staticPathFor('/index.html')).toContain('/app/dist/index.html');
    expect(staticPathFor('/index.html', root)).toBe(join(root, 'index.html'));
    expect(staticPathFor('/../../etc/passwd', root)).toBe(join(root, 'etc', 'passwd'));

    const server = createHmiServer('server-secret', {
      staticRoot: root,
      paperlessPin: '',
      paperlessToken: '',
      allowedOrigins: new Set(),
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const document = await fetch(`http://127.0.0.1:${port}/`);
    expect(document.status).toBe(200);
    expect(document.headers.get('cache-control')).toBe('no-cache');
    expect(await document.text()).toContain('Neutral harness');

    const asset = await fetch(`http://127.0.0.1:${port}/assets/neutral.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await asset.text()).toContain('neutral = true');
  });

  it('cached veränderliche PWA-Ressourcen nicht unveränderlich', () => {
    expect(staticCacheControl('/app/dist/sw.js')).toBe('no-cache');
    expect(staticCacheControl('/app/dist/index.html')).toBe('no-cache');
    expect(staticCacheControl('/app/dist/manifest.webmanifest')).toBe('no-cache');
    expect(staticCacheControl('/app/dist/assets/index-abc.js')).toBe('public, max-age=31536000, immutable');
  });

  it('ersetzt clientseitige Authorization durch den serverseitigen Key', async () => {
    let observedAuthorization = '';
    const upstream = http.createServer((req: any, res: any) => {
      observedAuthorization = req.headers.authorization || '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as { port: number }).port;
    const server = createHmiServer('server-secret', { upstreamPort });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/hermes/api/sessions`, {
      headers: { Authorization: 'Bearer client-controlled' },
    });

    expect(response.status).toBe(200);
    expect(observedAuthorization).toBe('Bearer server-secret');
  });

  it('reicht POST-Body und JSON-Content-Type unverändert weiter', async () => {
    let observedBody = '';
    let observedType = '';
    const upstream = http.createServer((req: any, res: any) => {
      observedType = req.headers['content-type'] || '';
      req.on('data', (chunk: any) => { observedBody += chunk.toString(); });
      req.on('end', () => {
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end('{"run_id":"run_test"}');
      });
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as { port: number }).port;
    const server = createHmiServer('server-secret', {
      upstreamPort,
      allowedOrigins: new Set(['http://test-client.local']),
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/hermes/v1/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://test-client.local' },
      body: '{"input":"test"}',
    });

    expect(response.status).toBe(202);
    expect(observedType).toBe('application/json');
    expect(observedBody).toBe('{"input":"test"}');
  });

  it('speichert die gemeinsame Konfiguration zentral und ignoriert unbekannte Schlüssel', async () => {
    const configPath = `/tmp/hmi-config-${crypto.randomUUID()}.json`;
    const allowed = new Set(['http://test-client.local']);
    expect(configRequestAllowed({ method: 'GET', headers: { origin: 'http://test-client.local' } }, allowed)).toBe(true);
    expect(configRequestAllowed({ method: 'PUT', headers: { origin: 'https://evil.invalid' } }, allowed)).toBe(false);

    const server = createHmiServer('server-secret', { configPath, allowedOrigins: allowed });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const put = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: 'http://test-client.local' },
      body: JSON.stringify({ updates: {
        'hmi:ha-url': 'http://zentral:8123',
        'hmi:device-config:v1': '{"version":1,"devices":{},"order":{}}',
        'nicht:erlaubt': 'nein',
      } }),
    });
    expect(put.status).toBe(200);

    const response = await fetch(`http://127.0.0.1:${port}/api/config`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ values: {
      'hmi:ha-url': 'http://zentral:8123',
      'hmi:device-config:v1': '{"version":1,"devices":{},"order":{}}',
    } });
  });

  it('pinnt Ambient-Anfragen serverseitig auf GPT-5.6 Luna', async () => {
    let observedBody: any = null;
    const ambientUpstream = http.createServer((req: any, res: any) => {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk.toString(); });
      req.on('end', () => {
        observedBody = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"choices":[{"message":{"content":"Luna kommentiert trocken."}}]}');
      });
    });
    servers.push(ambientUpstream);
    await new Promise<void>((resolve) => ambientUpstream.listen(0, '127.0.0.1', resolve));
    const ambientPort = (ambientUpstream.address() as { port: number }).port;
    const server = createHmiServer('server-secret', {
      ambientPort,
      allowedOrigins: new Set(['http://test-client.local']),
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/ambient-llm/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://test-client.local' },
      body: JSON.stringify({
        model: 'attacker-controlled', stream: true, tools: [{ type: 'function' }],
        messages: [{ role: 'system', content: 'Regeln' }, { role: 'user', content: 'Kontext' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(observedBody.model).toBe('gpt-5.6-luna');
    expect(observedBody.stream).toBe(false);
    expect(observedBody.tools).toBeUndefined();
    expect(observedBody.messages).toEqual([
      { role: 'system', content: 'Regeln' }, { role: 'user', content: 'Kontext' },
    ]);
  });

  it('liest die Haushaltskonfiguration ausschließlich read-only vom expliziten Pfad', () => {
    const root = mkdtempSync(join(tmpdir(), 'hmi-household-config-'));
    tempDirs.push(root);
    const configPath = join(root, 'current-v1.json');
    const body = '{"schemaVersion":2,"rooms":[]}';
    writeFileSync(configPath, body);
    const allowed = new Set(['http://test-client.local']);

    expect(householdConfigRequestAllowed({
      method: 'GET', headers: { origin: 'http://test-client.local' },
    }, allowed)).toBe(true);
    expect(householdConfigRequestAllowed({ method: 'POST', headers: {} }, allowed)).toBe(false);
    expect(householdConfigRequestAllowed({
      method: 'GET', headers: { origin: 'https://evil.invalid' },
    }, allowed)).toBe(false);

    const response = invokeHouseholdConfig(createHouseholdConfigReader(configPath));
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toBe(body);
  });

  it('liefert den serverseitigen Household-Modus als Header und aktiviert nur explizites active', () => {
    const reader = { read: () => ({ ok: true, body: '{"schemaVersion":2}' }) };

    expect(normalizeHouseholdConfigMode(undefined)).toBe('shadow');
    expect(normalizeHouseholdConfigMode('shadow')).toBe('shadow');
    expect(normalizeHouseholdConfigMode('active')).toBe('active');
    expect(() => normalizeHouseholdConfigMode('enabled')).toThrow(/HMI_HOUSEHOLD_CONFIG_MODE/);

    expect(invokeHouseholdConfig(reader, 'GET', 'shadow').headers['x-hmi-household-config-mode']).toBe('shadow');
    expect(invokeHouseholdConfig(reader, 'GET', 'active').headers['x-hmi-household-config-mode']).toBe('active');
  });

  it('liefert den Modus über einen separaten nicht cachebaren Read-Kanal', async () => {
    const direct = invokeHouseholdConfigMode('active');
    expect(direct).toMatchObject({
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'x-hmi-household-config-mode': 'active',
      },
      json: { mode: 'active' },
    });

    const server = createHmiServer('server-secret', {
      householdConfigMode: 'shadow',
      paperlessPin: '',
      paperlessToken: '',
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/household-config-mode`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-hmi-household-config-mode')).toBe('shadow');
    expect(await response.json()).toEqual({ mode: 'shadow' });
  });

  it('setzt den Mode-Header auch auf Household-Fehlerantworten und weist ungültige Servermodi fail-closed ab', async () => {
    const missing = invokeHouseholdConfig(createHouseholdConfigReader(null), 'GET', 'active');
    expect(missing.status).toBe(503);
    expect(missing.headers['x-hmi-household-config-mode']).toBe('active');

    expect(() => createHmiServer('server-secret', {
      householdConfigMode: 'enabled',
      paperlessPin: '',
      paperlessToken: '',
    })).toThrow(/HMI_HOUSEHOLD_CONFIG_MODE/);

    const server = createHmiServer('server-secret', {
      householdConfigMode: 'active',
      householdConfigPath: null,
      paperlessPin: '',
      paperlessToken: '',
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/household-config`);
    expect(response.status).toBe(503);
    expect(response.headers.get('x-hmi-household-config-mode')).toBe('active');
  });

  it('meldet fehlende Pfadkonfiguration, Datei und falsche Methode fail-closed', () => {
    expect(invokeHouseholdConfig(createHouseholdConfigReader(null))).toMatchObject({
      status: 503,
      json: { code: 'HOUSEHOLD_CONFIG_NOT_CONFIGURED' },
    });
    expect(invokeHouseholdConfig(createHouseholdConfigReader('/definitely/missing/current-v1.json')))
      .toMatchObject({ status: 404, json: { code: 'HOUSEHOLD_CONFIG_NOT_FOUND' } });
    expect(invokeHouseholdConfig(createHouseholdConfigReader(null), 'PUT')).toMatchObject({
      status: 405,
      json: { code: 'METHOD_NOT_ALLOWED' },
    });
  });

  it('nutzt für die Serverroute nie den vorhandenen zentralen configPath als Household-Fallback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hmi-household-no-fallback-'));
    tempDirs.push(root);
    const configPath = join(root, 'central-config.json');
    writeFileSync(configPath, '{"hmi:backend":"fake"}');

    const server = createHmiServer('server-secret', {
      configPath,
      householdConfigPath: null,
      allowedOrigins: new Set(['http://test-client.local']),
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/api/household-config`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'HOUSEHOLD_CONFIG_NOT_CONFIGURED',
    });
  });

  it('weist nicht lesbare und zu große Haushaltsdateien verständlich ab', () => {
    const root = mkdtempSync(join(tmpdir(), 'hmi-household-config-limits-'));
    tempDirs.push(root);

    expect(invokeHouseholdConfig(createHouseholdConfigReader(root))).toMatchObject({
      status: 500,
      json: { code: 'HOUSEHOLD_CONFIG_NOT_READABLE' },
    });

    const oversizedPath = join(root, 'oversized.json');
    writeFileSync(oversizedPath, 'x'.repeat(1025));
    expect(invokeHouseholdConfig(createHouseholdConfigReader(oversizedPath, 1024))).toMatchObject({
      status: 413,
      json: { code: 'HOUSEHOLD_CONFIG_TOO_LARGE' },
    });
  });
});

function invokeHouseholdConfig(reader: unknown, method = 'GET', mode = 'shadow'): {
  status: number;
  headers: Record<string, string>;
  body: string;
  json: Record<string, unknown> | null;
} {
  let status = 0;
  let headers: Record<string, string> = {};
  let body = '';
  const response = {
    writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end(chunk = '') { body += chunk; },
  };
  serveHouseholdConfig({ method, headers: {} }, response, reader, mode);
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(body); } catch { /* Success is the raw JSON file. */ }
  return { status, headers, body, json };
}

function invokeHouseholdConfigMode(mode = 'shadow', method = 'GET') {
  let status = 0;
  let headers: Record<string, string> = {};
  let body = '';
  const response = {
    writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end(chunk = '') { body += chunk; },
  };
  serveHouseholdConfigMode({ method, headers: {} }, response, mode);
  return { status, headers, body, json: JSON.parse(body) as Record<string, unknown> };
}
