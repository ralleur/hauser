import { describe, expect, it } from 'vitest';
import {
  classifyRunStatus,
  createSseParser,
  decideRunPollHttp,
  deriveTranscriptState,
  activityPhaseForTool,
  firstMessage,
  hideMarkerLines,
  INTERNAL_IMPLEMENTATION_CONTINUE,
  isInternalRunMessage,
  isHmiSession,
  isTitleOnlyResponse,
  newSessionId,
  normalizeRunEvent,
  parseMarkers,
  projectVisibleTranscriptRows,
  rollbackMessage,
  sessionStatus,
  sessionTitle,
  shouldResetMissingSession,
  shouldArchiveResumedSession,
  whimsicalActivity,
  type SseEvent,
} from './ai-customizing.ts';

describe('parseMarkers', () => {
  it('extrahiert einen gültigen Marker und entfernt seine Zeile', () => {
    const { cleanText, markers } = parseMarkers(
      'Erledigt, das Feature ist live.\n<<HMI:{"type":"deployed","commits":["a1b2c3d"]}>>',
    );
    expect(cleanText).toBe('Erledigt, das Feature ist live.');
    expect(markers).toEqual([{ type: 'deployed', commits: ['a1b2c3d'] }]);
  });

  it('parst mehrere Marker in einer Antwort', () => {
    const { markers } = parseMarkers(
      'Fertig.\n<<HMI:{"type":"feature","name":"Energie ohne Hintergrund"}>>\n<<HMI:{"type":"deployed","commits":[]}>>',
    );
    expect(markers.map((m) => m.type)).toEqual(['feature', 'deployed']);
  });

  it('behält Zeilen mit kaputtem JSON als Text', () => {
    const { cleanText, markers } = parseMarkers('Text\n<<HMI:{kein json}>>');
    expect(markers).toEqual([]);
    expect(cleanText).toContain('<<HMI:{kein json}>>');
  });

  it('ignoriert unbekannte Marker-Typen und Marker ohne Pflichtfelder', () => {
    const { markers } = parseMarkers(
      '<<HMI:{"type":"unbekannt"}>>\n<<HMI:{"type":"feature","name":""}>>',
    );
    expect(markers).toEqual([]);
  });

  it('erkennt Marker nur als eigene Zeile, nicht mitten im Text', () => {
    const { cleanText, markers } = parseMarkers('Vorher <<HMI:{"type":"deployed","commits":[]}>> nachher');
    expect(markers).toEqual([]);
    expect(cleanText).toBe('Vorher <<HMI:{"type":"deployed","commits":[]}>> nachher');
  });

  it('füllt fehlende optionale Felder mit Defaults', () => {
    const { markers } = parseMarkers(
      '<<HMI:{"type":"new_feature","name":"Wetteranzeige"}>>\n<<HMI:{"type":"failed"}>>',
    );
    expect(markers).toEqual([
      { type: 'new_feature', name: 'Wetteranzeige', current: '' },
      { type: 'failed', stage: '', detail: '' },
    ]);
  });
});

describe('hideMarkerLines', () => {
  it('blendet vollständige Marker-Zeilen aus', () => {
    expect(hideMarkerLines('Hallo\n<<HMI:{"type":"deployed","commits":[]}>>\n')).toBe('Hallo\n');
  });

  it('blendet ein angefangenes Sentinel am Streamende aus', () => {
    expect(hideMarkerLines('Hallo\n<<HM')).toBe('Hallo');
  });

  it('lässt normale Zeilen, die mit < beginnen, stehen — außer als letztes Fragment', () => {
    expect(hideMarkerLines('<div> bleibt\nText')).toBe('<div> bleibt\nText');
  });
});

describe('createSseParser', () => {
  function collect(chunks: string[]): SseEvent[] {
    const events: SseEvent[] = [];
    const parser = createSseParser((ev) => events.push(ev));
    for (const c of chunks) parser.push(c);
    return events;
  }

  it('parst einen vollständigen Frame', () => {
    const events = collect(['event: assistant.delta\ndata: {"delta":"Hi"}\n\n']);
    expect(events).toEqual([{ event: 'assistant.delta', data: { delta: 'Hi' } }]);
  });

  it('setzt Frames über Chunk-Grenzen zusammen', () => {
    const events = collect(['event: assistant.del', 'ta\ndata: {"del', 'ta":"Hi"}\n', '\nevent: done\ndata: {}\n\n']);
    expect(events.map((e) => e.event)).toEqual(['assistant.delta', 'done']);
  });

  it('ignoriert Keepalive-Kommentare und Frames ohne data', () => {
    const events = collect([': keepalive\n\nevent: done\ndata: {}\n\n']);
    expect(events).toEqual([{ event: 'done', data: {} }]);
  });

  it('verwirft Frames mit kaputtem JSON, ohne den Folgeframe zu stören', () => {
    const events = collect(['event: x\ndata: {kaputt\n\nevent: done\ndata: {}\n\n']);
    expect(events).toEqual([{ event: 'done', data: {} }]);
  });
});

describe('Session-Konventionen', () => {
  it('erzeugt IDs mit hmi_-Prefix, die isHmiSession erkennt', () => {
    const id = newSessionId();
    expect(isHmiSession(id)).toBe(true);
    expect(isHmiSession('api_123_abc')).toBe(false);
    expect(isHmiSession(null)).toBe(false);
  });

  it('mappt end_reason auf den Session-Status', () => {
    expect(sessionStatus(null)).toBe('active');
    expect(sessionStatus(undefined)).toBe('active');
    expect(sessionStatus('branched')).toBe('active');
    expect(sessionStatus('rolled_back')).toBe('rolled_back');
  });

  it('stellt der ersten Nachricht die Session-ID voran', () => {
    expect(firstMessage('hmi_x_y', 'Mach was')).toBe('[Session-ID: hmi_x_y]\n\nMach was');
  });

  it('nennt im Rollback-Auftrag Skript und Session-ID', () => {
    const msg = rollbackMessage('hmi_x_y');
    expect(msg).toContain('./tools/ai-rollback.sh hmi_x_y');
  });

  it('erkennt die interne Nachricht für den unsichtbaren automatischen Weiterlauf', () => {
    expect(isInternalRunMessage(INTERNAL_IMPLEMENTATION_CONTINUE)).toBe(true);
    expect(isInternalRunMessage('Feature bauen')).toBe(false);
  });

  it('erkennt ausschließlich aus einem Titelmarker bestehende Fehlstarts', () => {
    expect(isTitleOnlyResponse('<<HMI:{"type":"feature","name":"Feature bauen"}>>')).toBe(true);
    expect(isTitleOnlyResponse('Los gehts.\n<<HMI:{"type":"feature","name":"Feature bauen"}>>')).toBe(false);
    expect(isTitleOnlyResponse('<<HMI:{"type":"deployed","commits":[]}>>')).toBe(false);
  });
});

describe('Runs-API', () => {
  it('übernimmt den Eventnamen aus dem JSON-data-Frame', () => {
    const events: SseEvent[] = [];
    const parser = createSseParser((event) => events.push(event));
    parser.push('data: {"event":"message.delta","delta":"Hi"}\n\n');
    expect(events).toEqual([{ event: 'message.delta', data: { event: 'message.delta', delta: 'Hi' } }]);
  });

  it('normalisiert Delta-, Tool- und Abschlussereignisse', () => {
    expect(normalizeRunEvent({ event: 'message.delta', delta: 'Hallo' })).toEqual({
      type: 'message.delta', delta: 'Hallo', output: '', toolName: '', error: '',
    });
    expect(normalizeRunEvent({ event: 'tool.started', tool: 'terminal' }).toolName).toBe('terminal');
    expect(normalizeRunEvent({ event: 'tool.completed', tool: 'write_file' }).toolName).toBe('write_file');
    expect(normalizeRunEvent({ event: 'run.completed', output: 'Fertig' }).output).toBe('Fertig');
  });

  it('klassifiziert aktive und terminale Run-Status fail-closed', () => {
    for (const status of ['queued', 'running', 'waiting_for_approval', 'stopping']) {
      expect(classifyRunStatus(status)).toBe('busy');
    }
    expect(classifyRunStatus('completed')).toBe('completed');
    expect(classifyRunStatus('failed')).toBe('failed');
    expect(classifyRunStatus('cancelled')).toBe('failed');
    expect(classifyRunStatus('mystery')).toBe('failed');

    expect(decideRunPollHttp(200)).toBe('read_status');
    expect(decideRunPollHttp(204)).toBe('read_status');
    expect(decideRunPollHttp(401)).toBe('unauthorized');
    expect(decideRunPollHttp(404)).toBe('missing');
    expect(decideRunPollHttp(429)).toBe('retry');
    expect(decideRunPollHttp(503)).toBe('retry');

    expect(shouldResetMissingSession(404)).toBe(true);
    expect(shouldResetMissingSession(401)).toBe(false);
    expect(shouldResetMissingSession(500)).toBe(false);
  });
});

describe('sessionTitle', () => {
  it('verwendet bis zum KI-abgeleiteten Feature-Namen keinen Prompt-Ausschnitt', () => {
    expect(sessionTitle('  Energie\n   ohne   Hintergrund   ')).toBe('Titel wird ermittelt…');
    expect(sessionTitle('1234567890123456789012345678901234567890-extra')).toBe('Titel wird ermittelt…');
  });

  it('liefert für leeren Text einen neutralen Titel', () => {
    expect(sessionTitle(' \n\t ')).toBe('Neues Feature');
  });
});

describe('Reload-Abschluss und Aktivitätsanzeige', () => {
  it('archiviert nur terminale Sessions ohne aktiven Run beim initialen Resume', () => {
    expect(shouldArchiveResumedSession({ deployed: true, rolledBack: false }, false)).toBe(true);
    expect(shouldArchiveResumedSession({ deployed: false, rolledBack: true }, false)).toBe(true);
    expect(shouldArchiveResumedSession({ deployed: true, rolledBack: false }, true)).toBe(false);
    expect(shouldArchiveResumedSession({ deployed: false, rolledBack: false }, false)).toBe(false);
  });

  it('verwendet große getrennte Textpools für Start, Arbeit und Abschluss', () => {
    const starting = Array.from({ length: 12 }, (_, i) => whimsicalActivity('starting', i));
    const working = Array.from({ length: 12 }, (_, i) => whimsicalActivity('working', i));
    const finishing = Array.from({ length: 12 }, (_, i) => whimsicalActivity('finishing', i));
    expect(new Set(starting).size).toBe(12);
    expect(new Set(working).size).toBe(12);
    expect(new Set(finishing).size).toBe(12);
    expect(starting.join(' ')).not.toMatch(/gleich|letzte|endspurt/i);
    expect(working.join(' ')).not.toMatch(/gleich|letzte|endspurt/i);
    expect(finishing.join(' ')).toMatch(/endspurt|ziel|letzte/i);
  });

  it('wechselt erst bei erkennbaren Abschlussarbeiten in die Endphase', () => {
    expect(activityPhaseForTool('read_file', '/app/src/AiChat.svelte')).toBe('working');
    expect(activityPhaseForTool('write_file', '/app/src/AiChat.svelte')).toBe('working');
    expect(activityPhaseForTool('terminal', 'npm run test && git push origin main')).toBe('finishing');
    expect(activityPhaseForTool('terminal', './tools/redeploy.sh --fast')).toBe('finishing');
  });
});

describe('sichtbare Transcript-Projektion', () => {
  it('entfernt den internen File-Mutation-Verifier und das dadurch entstandene Duplikat', () => {
    const clean = 'Die Änderung ist live.\n\n<<HMI:{"type":"deployed","commits":["abc"]}>>';
    const polluted = `${clean}\n\n⚠️ File-mutation verifier: 1 file(s) were NOT modified this turn.\n  • /tmp/check.py`;
    expect(projectVisibleTranscriptRows([
      { role: 'user', content: 'Mach etwas' },
      { role: 'assistant', content: clean },
      { role: 'assistant', content: polluted },
    ])).toEqual([
      { role: 'user', content: 'Mach etwas' },
      { role: 'assistant', content: clean },
    ]);
  });

  it('zeigt bei ausschließlich verschmutzter Persistenz nur den bereinigten Nutztext', () => {
    expect(projectVisibleTranscriptRows([
      { role: 'assistant', content: 'Fertig.\n\n⚠️ File-mutation verifier: intern' },
    ])).toEqual([{ role: 'assistant', content: 'Fertig.' }]);
  });
});

describe('terminale Markerreduktion', () => {
  const user = (text: string) => ({ role: 'user' as const, text, wireText: text, markers: [] });
  const assistant = (...markers: ReturnType<typeof parseMarkers>['markers']) => ({
    role: 'assistant' as const, text: '', wireText: '', markers,
  });

  it('löscht bei einem neuen User-Turn den alten terminalen Zustand', () => {
    const state = deriveTranscriptState([
      user('Erster Versuch'),
      assistant({ type: 'failed', stage: 'test', detail: 'rot' }),
      user('Retry'),
      assistant({ type: 'deployed', commits: ['abc'] }),
    ]);
    expect(state.deployed).toBe(true);
    expect(state.failed).toBeNull();
  });

  it('lässt innerhalb einer Assistant-Antwort den spätesten terminalen Marker gewinnen', () => {
    const deployedLast = deriveTranscriptState([
      user('Retry'),
      assistant(
        { type: 'failed', stage: 'test', detail: 'erst rot' },
        { type: 'deployed', commits: ['abc'] },
      ),
    ]);
    expect(deployedLast.deployed).toBe(true);
    expect(deployedLast.failed).toBeNull();

    const failedLast = deriveTranscriptState([
      user('Noch einmal'),
      assistant(
        { type: 'deployed', commits: ['abc'] },
        { type: 'failed', stage: 'verify', detail: 'später rot' },
      ),
    ]);
    expect(failedLast.deployed).toBe(false);
    expect(failedLast.failed).toEqual({ stage: 'verify', detail: 'später rot' });
  });
});
