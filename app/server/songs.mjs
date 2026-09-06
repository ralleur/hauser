/* Songs: AceStep-Proxy, Songplanung und lokale Bibliothek.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { resolve, sep } from 'node:path';
import {
  ACESTEP_AUDIO_ROOT,
  ALLOWED_ORIGINS,
  SONG_BODY_MAX,
  SONG_ERAS,
  SONG_LIBRARY_DIR,
  SONG_LIBRARY_PATH,
  SONG_LYRICS_MODEL,
  SONG_STYLES,
  SONG_VOICES,
} from './runtime-env.mjs';
import { jsonResponse, requestOriginAllowed } from './shared.mjs';

export function songTargetPath(url) {
  const parsed = new URL(url, 'http://hmi.local');
  if (parsed.pathname === '/api/songs/health') return { kind: 'health', path: '/health', method: 'GET' };
  if (parsed.pathname === '/api/songs/generate') return { kind: 'generate', path: '/release_task', method: 'POST' };
  if (parsed.pathname === '/api/songs/status') return { kind: 'status', path: '/query_result', method: 'POST' };
  if (parsed.pathname === '/api/songs/library') {
    if (parsed.searchParams.size) return null;
    return { kind: 'library', path: '', method: null };
  }
  const libraryMatch = parsed.pathname.match(/^\/api\/songs\/library\/([0-9a-f-]{36})(?:\/(audio))?$/i);
  if (libraryMatch && !parsed.searchParams.size) {
    return { kind: libraryMatch[2] ? 'library-audio' : 'library-item', path: '', method: null, id: libraryMatch[1] };
  }
  if (parsed.pathname === '/api/songs/audio') {
    const path = parsed.searchParams.get('path') || '';
    if (!path || path.length > 2048 || path.includes('\0')) return null;
    return { kind: 'audio', path: `/v1/audio?path=${encodeURIComponent(path)}`, method: 'GET' };
  }
  return null;
}

export function songRequestAllowed(req, target, allowedOrigins = ALLOWED_ORIGINS) {
  if (!target) return false;
  const methodAllowed = target.method
    ? req.method === target.method
    : (target.kind === 'library' && ['GET', 'POST'].includes(req.method || ''))
      || (target.kind === 'library-item' && ['PATCH', 'DELETE'].includes(req.method || ''))
      || (target.kind === 'library-audio' && ['GET', 'HEAD'].includes(req.method || ''));
  return methodAllowed && requestOriginAllowed(req, allowedOrigins);
}

function proxyAce(req, res, path, upstreamHost, upstreamPort, body = null) {
  const headers = { accept: req.headers.accept || '*/*' };
  if (body !== null) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(body);
  }
  const upstream = http.request({
    hostname: upstreamHost, port: upstreamPort, method: req.method, path, headers,
  }, (upstreamResponse) => {
    const responseHeaders = { 'cache-control': 'no-store' };
    for (const name of ['content-type', 'content-length', 'content-disposition', 'accept-ranges']) {
      if (upstreamResponse.headers[name] !== undefined) responseHeaders[name] = upstreamResponse.headers[name];
    }
    res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(res);
  });
  upstream.on('error', () => jsonResponse(res, 502, { error: 'ACE-Step ist nicht erreichbar' }));
  req.on('aborted', () => upstream.destroy());
  upstream.end(body ?? undefined);
}

function readSongJson(req, res, callback) {
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > SONG_BODY_MAX) oversized = true;
  });
  req.on('end', () => {
    if (oversized) return jsonResponse(res, 413, { error: 'Songidee ist zu groß' });
    try { callback(JSON.parse(body)); }
    catch { jsonResponse(res, 400, { error: 'Ungültige Song-Anfrage' }); }
  });
}

export function buildSongPlanMessages({ idea, style, era, voice, experimental }) {
  return [
    {
      role: 'system',
      content: [
        'Du schreibst Liedtexte für eine deutsche Songgenerierung.',
        'Antworte ausschließlich als valides JSON mit den Schlüsseln caption und lyrics.',
        'caption ist eine präzise englische Produktionsbeschreibung für ein Musikmodell.',
        'lyrics ist ein vollständig ausformulierter, verständlicher deutscher Liedtext.',
        'Verwende mindestens [Verse 1], [Chorus] und [Verse 2].',
        'Keine Fantasiesprache, keine Lautmalerei außer wenn sie ausdrücklich gewünscht wurde.',
        'Der Refrain muss die zentrale Idee des Nutzers klar und wiedererkennbar aufgreifen.',
      ].join(' '),
    },
    {
      role: 'user',
      content: `Thema: ${idea}\nStil: ${style}\nEpoche: ${era}\nStimme: ${voice}\nExperimentiergrad: ${experimental}%`,
    },
  ];
}

export function parseSongPlan(content) {
  const normalized = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let plan;
  try { plan = JSON.parse(normalized); } catch { return null; }
  const caption = typeof plan?.caption === 'string' ? plan.caption.trim() : '';
  const lyrics = typeof plan?.lyrics === 'string' ? plan.lyrics.trim() : '';
  if (caption.length < 20 || caption.length > 2_000 || lyrics.length < 80 || lyrics.length > 8_000) return null;
  if (!/\[Verse 1\]/i.test(lyrics) || !/\[Chorus\]/i.test(lyrics) || !/\[Verse 2\]/i.test(lyrics)) return null;
  return { caption, lyrics };
}

export function buildAceSongRequest({ idea, style, era, voice, experimental }, plan = null) {
  const instrumental = voice === 'Instrumental';
  const intensity = experimental < 34 ? 'accessible' : experimental < 67 ? 'creative' : 'experimental';
  return {
    prompt: instrumental
      ? `${style}, ${era}, instrumental, no vocals, ${intensity} arrangement. ${idea}`
      : plan.caption,
    lyrics: instrumental ? '[Instrumental]' : plan.lyrics,
    thinking: true,
    vocal_language: instrumental ? 'unknown' : 'de',
    audio_format: 'mp3',
    batch_size: 1,
    inference_steps: 8,
    lm_temperature: 0.55 + experimental * 0.004,
    use_cot_caption: false,
    use_cot_language: false,
  };
}

function requestSongPlan(payload, upstreamHost, upstreamPort, callback) {
  const upstreamBody = JSON.stringify({
    model: SONG_LYRICS_MODEL,
    messages: buildSongPlanMessages(payload),
    stream: false,
    temperature: 0.4,
    max_tokens: 1_600,
    reasoning_effort: 'none',
  });
  const upstream = http.request({
    hostname: upstreamHost,
    port: upstreamPort,
    method: 'POST',
    path: '/v1/chat/completions',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(upstreamBody) },
  }, (upstreamResponse) => {
    let body = '';
    upstreamResponse.setEncoding('utf8');
    upstreamResponse.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > 64 * 1024) upstreamResponse.destroy();
    });
    upstreamResponse.on('end', () => {
      let response;
      try { response = JSON.parse(body); } catch { response = null; }
      const plan = parseSongPlan(response?.choices?.[0]?.message?.content);
      callback(plan, plan ? null : 'Der deutsche Liedtext konnte nicht erstellt werden.');
    });
  });
  upstream.setTimeout(90_000, () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => callback(null, 'Der Liedtext-Dienst ist nicht erreichbar.'));
  upstream.end(upstreamBody);
}

function isSongId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
}

export function createSongLibrary(
  directory = SONG_LIBRARY_DIR,
  catalogPath = SONG_LIBRARY_PATH,
  sourceRoot = ACESTEP_AUDIO_ROOT,
) {
  function read() {
    try {
      const parsed = JSON.parse(readFileSync(catalogPath, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter((song) => song && isSongId(song.id)) : [];
    } catch { return []; }
  }
  function write(songs) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${catalogPath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(songs, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, catalogPath);
    chmodSync(catalogPath, 0o600);
  }
  function publicSong(song) {
    return { ...song, audioUrl: `/api/songs/library/${song.id}/audio` };
  }
  function list() {
    return read().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicSong);
  }
  function register(payload) {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    const sourceAudioUrl = typeof payload?.sourceAudioUrl === 'string' ? payload.sourceAudioUrl : '';
    if (!isSongId(id)) return { error: 'Ungültige Song-ID' };
    let sourcePath = '';
    try {
      const parsed = new URL(sourceAudioUrl, 'http://hmi.local');
      if (parsed.pathname !== '/api/songs/audio') return { error: 'Ungültige Audioquelle' };
      sourcePath = resolve(parsed.searchParams.get('path') || '');
    } catch { return { error: 'Ungültige Audioquelle' }; }
    const root = resolve(sourceRoot);
    if (!sourcePath.startsWith(`${root}${sep}`) || !sourcePath.toLowerCase().endsWith('.mp3') || !existsSync(sourcePath)) {
      return { error: 'Audiodatei wurde nicht gefunden' };
    }
    const fields = ['title', 'idea', 'style', 'era', 'voice', 'createdAt'];
    if (fields.some((field) => typeof payload?.[field] !== 'string' || payload[field].length > 800)) {
      return { error: 'Ungültige Song-Metadaten' };
    }
    const duration = Number(payload?.duration);
    if (!Number.isFinite(duration) || duration < 0 || duration > 3_600) return { error: 'Ungültige Songdauer' };
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const targetPath = resolve(directory, `${id}.mp3`);
    copyFileSync(sourcePath, targetPath);
    chmodSync(targetPath, 0o600);
    const song = {
      id,
      title: payload.title.trim() || 'Unbenannter Song',
      idea: payload.idea.trim(),
      style: payload.style,
      era: payload.era,
      voice: payload.voice,
      duration,
      createdAt: payload.createdAt,
    };
    write([song, ...read().filter((entry) => entry.id !== id)]);
    return { song: publicSong(song) };
  }
  function remove(id) {
    if (!isSongId(id)) return false;
    const songs = read();
    if (!songs.some((song) => song.id === id)) return false;
    write(songs.filter((song) => song.id !== id));
    const audioPath = resolve(directory, `${id}.mp3`);
    if (existsSync(audioPath)) unlinkSync(audioPath);
    return true;
  }
  function rename(id, title) {
    if (!isSongId(id)) return { error: 'Ungültige Song-ID' };
    const normalizedTitle = typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : '';
    if (!normalizedTitle || normalizedTitle.length > 120) return { error: 'Ungültiger Songtitel' };
    const songs = read();
    const index = songs.findIndex((song) => song.id === id);
    if (index < 0) return { error: 'Song wurde nicht gefunden', notFound: true };
    songs[index] = { ...songs[index], title: normalizedTitle };
    write(songs);
    return { song: publicSong(songs[index]) };
  }
  function audioPath(id) {
    if (!isSongId(id) || !read().some((song) => song.id === id)) return null;
    const path = resolve(directory, `${id}.mp3`);
    return existsSync(path) ? path : null;
  }
  return { audioPath, list, register, remove, rename };
}

function serveLibraryAudio(req, res, path) {
  const size = statSync(path).size;
  const range = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = size - 1;
  if (range) {
    start = range[1] ? Number(range[1]) : 0;
    end = range[2] ? Number(range[2]) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      res.end();
      return;
    }
  }
  res.writeHead(range ? 206 : 200, {
    'content-type': 'audio/mpeg',
    'content-length': end - start + 1,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=86400',
    ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(path, { start, end }).pipe(res);
}

export function serveSongs(req, res, target, upstreamHost, upstreamPort, lyricsHost, lyricsPort, library) {
  if (target.kind === 'health' || target.kind === 'audio') {
    proxyAce(req, res, target.path, upstreamHost, upstreamPort);
    return;
  }
  if (target.kind === 'library' && req.method === 'GET') {
    jsonResponse(res, 200, { songs: library.list() });
    return;
  }
  if (target.kind === 'library-audio') {
    const path = library.audioPath(target.id);
    if (!path) jsonResponse(res, 404, { error: 'Song wurde nicht gefunden' });
    else serveLibraryAudio(req, res, path);
    return;
  }
  if (target.kind === 'library-item' && req.method === 'DELETE') {
    if (!library.remove(target.id)) jsonResponse(res, 404, { error: 'Song wurde nicht gefunden' });
    else jsonResponse(res, 200, { ok: true });
    return;
  }
  readSongJson(req, res, (payload) => {
    if (target.kind === 'library-item') {
      const result = library.rename(target.id, payload?.title);
      if (result.error) jsonResponse(res, result.notFound ? 404 : 400, { error: result.error });
      else jsonResponse(res, 200, result);
      return;
    }
    if (target.kind === 'library') {
      const result = library.register(payload);
      if (result.error) jsonResponse(res, 400, { error: result.error });
      else jsonResponse(res, 201, result);
      return;
    }
    if (target.kind === 'status') {
      const taskId = typeof payload?.taskId === 'string' ? payload.taskId : '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
        jsonResponse(res, 400, { error: 'Ungültige Song-ID' });
        return;
      }
      proxyAce(req, res, target.path, upstreamHost, upstreamPort, JSON.stringify({ task_id_list: [taskId] }));
      return;
    }

    const idea = typeof payload?.idea === 'string' ? payload.idea.trim() : '';
    const style = SONG_STYLES.has(payload?.style) ? payload.style : null;
    const era = SONG_ERAS.has(payload?.era) ? payload.era : null;
    const voice = SONG_VOICES.has(payload?.voice) ? payload.voice : null;
    const experimental = Number(payload?.experimental);
    if (!idea || idea.length > 800 || !style || !era || !voice || !Number.isFinite(experimental) || experimental < 0 || experimental > 100) {
      jsonResponse(res, 400, { error: 'Songparameter sind ungültig' });
      return;
    }
    const song = { idea, style, era, voice, experimental };
    if (voice === 'Instrumental') {
      proxyAce(req, res, target.path, upstreamHost, upstreamPort, JSON.stringify(buildAceSongRequest(song)));
      return;
    }
    requestSongPlan(song, lyricsHost, lyricsPort, (plan, planError) => {
      if (!plan) {
        jsonResponse(res, 502, { error: planError });
        return;
      }
      proxyAce(req, res, target.path, upstreamHost, upstreamPort, JSON.stringify(buildAceSongRequest(song, plan)));
    });
  });
}
