import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { join } from 'node:path';
// @ts-expect-error The production server intentionally remains native Node ESM without declarations.
import { createDeterministicRoomImageFakeProvider, createHmiServer, createRoomImageAuthConfig, createRoomImageJobRunner, createRoomImageJobStore, createRoomImageProviderBoundary, createRoomImageUploadStore, validateRoomImagePreviewBytes } from '../../../server.mjs';
import { snapRoomImageCrop } from './room-image-transform-policy-v1';

const roots: string[] = [];
const servers: any[] = [];
const runners: any[] = [];
const ORIGIN = 'http://room-image-b3.fixture';
const IDENTITY_HEADER = 'x-room-user';
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

function root(prefix = 'hauser-room-image-b3-') {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  const activeRunners = runners.splice(0);
  for (const runner of activeRunners) {
    for (const jobId of [runner.activeJobId, ...runner.queuedJobIds].filter(Boolean)) runner.cancel(jobId);
  }
  const settledRunners = await Promise.allSettled(activeRunners.map((runner) => runner.waitForIdle()));
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
  const rejectedRunner = settledRunners.find((result) => result.status === 'rejected');
  if (rejectedRunner?.status === 'rejected') throw rejectedRunner.reason;
});

function auth() {
  return createRoomImageAuthConfig({
    mode: 'trusted_proxy', trustedProxyCidrs: '127.0.0.1/32', identityHeader: IDENTITY_HEADER,
  });
}

function headers(extra: Record<string, string> = {}) {
  return { [IDENTITY_HEADER]: 'fixture-user', origin: ORIGIN, ...extra };
}

async function start(options: Record<string, any> = {}) {
  const sandbox = root();
  const staticRoot = join(sandbox, 'dist');
  mkdirSync(staticRoot);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>');
  const now = options.now ?? (() => Date.now());
  const uploadStore = options.uploadStore ?? createRoomImageUploadStore({
    root: join(sandbox, 'uploads'), now, ...(options.uploadStoreOptions ?? {}),
  });
  const jobStore = options.jobStore ?? createRoomImageJobStore({
    metadataRoot: join(sandbox, 'jobs'), tempRoot: join(sandbox, 'private'), now,
    ...(options.jobStoreOptions ?? {}),
  });
  const provider = options.provider ?? createDeterministicRoomImageFakeProvider();
  const runner = createRoomImageJobRunner({ store: jobStore, provider, ...(options.runnerOptions ?? {}) });
  runners.push(runner);
  const serverRunner = typeof options.serverRunner === 'function'
    ? options.serverRunner({ jobStore, runner })
    : runner;
  const server = createHmiServer('', {
    staticRoot,
    paperlessPin: '', paperlessToken: '',
    allowedOrigins: new Set([ORIGIN]),
    roomImageAuthConfig: auth(), roomImageUploadStore: uploadStore,
    roomImageJobStore: jobStore, roomImageJobRunner: serverRunner,
    roomImagePreviewValidator: options.roomImagePreviewValidator,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, jobStore, provider, runner, sandbox, uploadStore };
}

async function createMain(
  base: string,
  candidateCount: 1 | 2 = 2,
  clientRequestId = '11111111-1111-4111-8111-111111111111',
) {
  const source = fixture('neutral-alpha.png');
  const uploaded = await fetch(`${base}/api/room-image-uploads`, {
    method: 'POST',
    headers: headers({ 'content-type': 'image/png', 'content-length': String(source.byteLength) }),
    body: source,
  });
  const upload = await uploaded.json();
  const crop = { x: 0.1, y: 0.1, width: 0.795, height: 0.75 };
  const snapped = snapRoomImageCrop(upload.width, upload.height, crop);
  return fetch(`${base}/api/room-image-jobs`, {
    method: 'POST', headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      kind: 'main_candidates',
      clientRequestId,
      uploadId: upload.uploadId,
      crop,
      canonicalCropPixels: { x: snapped.left, y: snapped.top, width: snapped.width, height: snapped.height },
      focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
      stylePreset: 'hauser-room-v1',
      adjustments: { declutter: 'light', tone: 'neutral', preserveFeatures: ['windows', 'doors'] },
      candidateCount,
      noticeVersion: 'room-image-v1', costConfirmed: true,
      confirmedProviderCalls: candidateCount + 1,
    }),
  });
}

async function uploadAndMainPayload(
  base: string,
  clientRequestId: string,
  candidateCount: 1 | 2 = 1,
) {
  const source = fixture('neutral-alpha.png');
  const uploaded = await fetch(`${base}/api/room-image-uploads`, {
    method: 'POST',
    headers: headers({ 'content-type': 'image/png', 'content-length': String(source.byteLength) }),
    body: source,
  });
  const upload = await uploaded.json();
  const crop = { x: 0.1, y: 0.1, width: 0.795, height: 0.75 };
  const snapped = snapRoomImageCrop(upload.width, upload.height, crop);
  return {
    upload,
    payload: {
      kind: 'main_candidates', clientRequestId, uploadId: upload.uploadId, crop,
      canonicalCropPixels: { x: snapped.left, y: snapped.top, width: snapped.width, height: snapped.height },
      focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
      stylePreset: 'hauser-room-v1',
      adjustments: { declutter: 'light', tone: 'neutral', preserveFeatures: ['windows', 'doors'] },
      candidateCount, noticeVersion: 'room-image-v1', costConfirmed: true,
      confirmedProviderCalls: candidateCount + 1,
    },
  };
}

async function postMainPayload(base: string, payload: Record<string, any>) {
  return fetch(`${base}/api/room-image-jobs`, {
    method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(payload),
  });
}

/* Bildverarbeitungs-Budget: die CI-Maschine ist deutlich langsamer als eine
   Entwickler-Workstation. `waitFor` wartet dort schon länger (attempts unten) —
   ohne ein passendes Test-Budget läuft aber die Stoppuhr des Tests vorher ab,
   und die längere Geduld bleibt wirkungslos. */
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
const IMAGE_BUDGET_MS = process.env.CI === 'true' ? 90_000 : 15_000;
/* CI-Runner brauchen fuer die AVIF-Encodes dieser Datei ein Vielfaches der
   lokalen Zeit (b3 laeuft dort ueber 400 s). Der Wait auf den Validierungs-
   start skaliert deshalb mit, bleibt aber unter dem 60-s-Testtimeout. */
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
const VALIDATION_WAIT_ATTEMPTS = process.env.CI === 'true' ? 6_000 : 2_000;

async function waitFor(base: string, jobId: string, statuses: string[]) {
  // @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
  const attempts = process.env.CI === 'true' ? 1_000 : 100;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(`${base}/api/room-image-jobs/${jobId}`, { headers: headers() });
    const job = await response.json();
    if (statuses.includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('job did not settle');
}

function expectStoredJobRejected(record: any, label: string, relatedRecords: any[] = []) {
  const sandbox = root('hauser-room-image-b3-invalid-');
  const metadataRoot = join(sandbox, 'jobs');
  const tempRoot = join(sandbox, 'private');
  const tempKinds = ['sources', 'compositions', 'candidates', 'finals', 'partials'];
  mkdirSync(metadataRoot);
  mkdirSync(tempRoot);
  for (const kind of tempKinds) mkdirSync(join(tempRoot, kind));
  const metadataPath = join(metadataRoot, `${record.jobId}.json`);
  const partialName = `.job-${record.jobId}-${'p'.repeat(16)}.tmp`;
  const partialPath = join(metadataRoot, partialName);
  const orphanPath = join(tempRoot, 'candidates', 'must-survive-invalid-startup.avif');
  writeFileSync(metadataPath, `${JSON.stringify(record)}\n`);
  for (const related of relatedRecords) {
    writeFileSync(join(metadataRoot, `${related.jobId}.json`), `${JSON.stringify(related)}\n`);
  }
  writeFileSync(partialPath, 'metadata-partial');
  writeFileSync(orphanPath, 'private-temp');
  const metadataNames = readdirSync(metadataRoot).sort();
  const metadataContents = Object.fromEntries(metadataNames.map((name: string) => (
    [name, readFileSync(join(metadataRoot, name), 'utf8')]
  )));
  const tempNames = Object.fromEntries(tempKinds.map((kind) => [kind, readdirSync(join(tempRoot, kind)).sort()]));
  const metadataBytes = readFileSync(metadataPath);

  expect(() => createRoomImageJobStore({ metadataRoot, tempRoot }), label)
    .toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));
  expect(readFileSync(metadataPath)).toEqual(metadataBytes);
  expect(readFileSync(partialPath, 'utf8')).toBe('metadata-partial');
  expect(readFileSync(orphanPath, 'utf8')).toBe('private-temp');
  expect(readdirSync(metadataRoot).sort()).toEqual(metadataNames);
  expect(Object.fromEntries(metadataNames.map((name: string) => (
    [name, readFileSync(join(metadataRoot, name), 'utf8')]
  )))).toEqual(metadataContents);
  expect(Object.fromEntries(tempKinds.map((kind) => [kind, readdirSync(join(tempRoot, kind)).sort()])))
    .toEqual(tempNames);
}

function directMainRequest(clientRequestId: string, candidateCount: 1 | 2 = 1) {
  return {
    kind: 'main_candidates', clientRequestId, uploadId: 'u'.repeat(43),
    crop: { x: 0.1, y: 0.1, width: 0.795, height: 0.75 },
    canonicalCropPixels: { x: 64, y: 48, width: 530, height: 375 },
    focus: { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } },
    stylePreset: 'hauser-room-v1',
    adjustments: { declutter: 'light', tone: 'neutral', preserveFeatures: ['windows'] },
    candidateCount, noticeVersion: 'room-image-v1', costConfirmed: true,
    confirmedProviderCalls: candidateCount + 1,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitUntil(predicate: () => boolean, label: string, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function manualTimers(clock = { value: 1_000 }) {
  const entries: Array<{ callback: () => void; delay: number; active: boolean }> = [];
  return {
    clock,
    entries,
    setTimer(callback: () => void, delay: number) {
      const entry = { callback, delay, active: true };
      entries.push(entry);
      return entry;
    },
    clearTimer(entry: { active: boolean } | undefined) {
      if (entry) entry.active = false;
    },
    fire(index = 0) {
      const entry = entries[index];
      if (!entry?.active) throw new Error(`timer ${index} is not active`);
      clock.value += entry.delay;
      entry.active = false;
      entry.callback();
    },
  };
}

function directRunnerFixture({
  provider,
  runnerOptions = {},
  clientRequestId = '13131313-1313-4313-8313-131313131313',
}: {
  provider: any;
  runnerOptions?: Record<string, any>;
  clientRequestId?: string;
}) {
  const sandbox = root('hauser-room-image-b3-runner-');
  const store = createRoomImageJobStore({
    metadataRoot: join(sandbox, 'jobs'), tempRoot: join(sandbox, 'private'),
  });
  const record = store.createMain(
    'fixture-user', directMainRequest(clientRequestId), fixture('orientation-1.jpg'), 'f'.repeat(64),
  ).record;
  const runner = createRoomImageJobRunner({ store, provider, ...runnerOptions });
  runners.push(runner);
  expect(runner.enqueue(record.jobId)).toBe(true);
  return { record, runner, sandbox, store };
}

async function persistedFinalAtValidatingSet() {
  const sandbox = root('hauser-room-image-b3-restart-final-');
  const metadataRoot = join(sandbox, 'jobs');
  const tempRoot = join(sandbox, 'private');
  const store = createRoomImageJobStore({ metadataRoot, tempRoot });
  const main = store.createMain(
    'fixture-user', directMainRequest('22222222-2222-4222-8222-222222222222'),
    fixture('orientation-1.jpg'), '2'.repeat(64),
  ).record;
  const [compositionAttempt, styleAttempt] = main.attempts;
  store.transition(main.jobId, compositionAttempt.providerAttemptId, 'fixture-composition-start', 'started');
  store.commitProviderTransition(main.jobId, compositionAttempt.providerAttemptId, 'fixture-composition-valid', {
    target: 'completed', outcome: 'result_valid', errorCode: null,
    result: { type: 'composition', bytes: fixture('orientation-1.jpg') },
  });
  store.transition(main.jobId, styleAttempt.providerAttemptId, 'fixture-style-start', 'started');
  const candidateId = 'c'.repeat(43);
  store.commitProviderTransition(main.jobId, styleAttempt.providerAttemptId, 'fixture-style-valid', {
    target: 'completed', outcome: 'result_valid', errorCode: null,
    result: {
      type: 'candidate', candidateId,
      previewBytes: new Uint8Array([1, 2, 3]), providerBytes: fixture('orientation-1.jpg'),
    },
    jobState: {
      status: 'succeeded', phase: 'complete', cancellable: true,
      retryable: false, discardable: false, retry: null, error: null,
    },
  });
  const parent = store.get(main.jobId);
  const final = store.createFinal('fixture-user', {
    kind: 'variant_set', clientRequestId: '23232323-2323-4323-8323-232323232323',
    parentJobId: parent.jobId, candidateId,
    focus: { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } },
    noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
  }, parent, '3'.repeat(64)).record;
  for (const [index, attempt] of final.attempts.entries()) {
    store.transition(final.jobId, attempt.providerAttemptId, `fixture-final-${index}-start`, 'started');
    store.commitProviderTransition(final.jobId, attempt.providerAttemptId, `fixture-final-${index}-valid`, {
      target: 'completed', outcome: 'result_valid', errorCode: null,
      result: {
        type: 'final', variant: index === 0 ? 'dark' : 'darkOff',
        previewBytes: new Uint8Array([index + 4, index + 5, index + 6]),
      },
    });
  }
  store.setJobState(final.jobId, { phase: 'validating_set' });
  return { sandbox, metadataRoot, tempRoot, store, final: store.get(final.jobId) };
}

describe('B-08E10 B3 persistent job flow', () => {
  it('fails closed on corrupt metadata and keeps image bytes out of metadata', () => {
    const sandbox = root();
    const metadataRoot = join(sandbox, 'jobs');
    const tempRoot = join(sandbox, 'private');
    mkdirSync(metadataRoot);
    writeFileSync(join(metadataRoot, `${'a'.repeat(43)}.json`), '{broken');
    expect(() => createRoomImageJobStore({ metadataRoot, tempRoot }))
      .toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));
    expect(existsSync(tempRoot)).toBe(false);
  });

  it('validates transaction journals before startup mutates jobs or private temps', () => {
    const sandbox = root();
    const metadataRoot = join(sandbox, 'jobs');
    const tempRoot = join(sandbox, 'private');
    mkdirSync(metadataRoot);
    mkdirSync(tempRoot);
    for (const kind of ['sources', 'compositions', 'candidates', 'finals', 'partials']) mkdirSync(join(tempRoot, kind));
    const transactionId = 't'.repeat(43);
    const journal = join(metadataRoot, `.room-image-transaction-${transactionId}.json`);
    const privateFile = join(tempRoot, 'candidates', 'must-survive-invalid-journal.avif');
    writeFileSync(journal, `${JSON.stringify({
      version: 1, transactionId, type: 'retry_supersede', state: 'prepared', lineageId: 'l'.repeat(43),
      before: [], after: [], cleanupRefs: [], unexpected: true,
    })}\n`);
    writeFileSync(privateFile, 'private');
    const before = readFileSync(journal);
    expect(() => createRoomImageJobStore({ metadataRoot, tempRoot }))
      .toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));
    expect(readFileSync(journal)).toEqual(before);
    expect(readFileSync(privateFile, 'utf8')).toBe('private');
  });

  it('rejects every adversarial nested metadata family before startup mutates metadata or temps', async () => {
    const mainApp = await start();
    const mainResponse = await createMain(mainApp.base, 1, '55555555-5555-4555-8555-555555555555');
    await mainApp.runner.waitForIdle();
    const mainPublic = await waitFor(mainApp.base, (await mainResponse.json()).jobId, ['succeeded']);
    const initialMain = structuredClone(mainApp.jobStore.get(mainPublic.jobId));
    const finalResponse = await fetch(`${mainApp.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        kind: 'variant_set', clientRequestId: '66666666-6666-4666-8666-666666666666',
        parentJobId: initialMain.jobId, candidateId: initialMain.temp.candidates[0].candidateId,
        focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
        noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
      }),
    });
    await mainApp.runner.waitForIdle();
    const finalPublic = await waitFor(mainApp.base, (await finalResponse.json()).jobId, ['awaiting_confirmation']);
    const final = structuredClone(mainApp.jobStore.get(finalPublic.jobId));
    const main = initialMain;
    const finalParent = structuredClone(mainApp.jobStore.get(mainPublic.jobId));

    const failedApp = await start({ provider: createRoomImageProviderBoundary() });
    const failedResponse = await createMain(failedApp.base, 1, '77777777-7777-4777-8777-777777777777');
    await failedApp.runner.waitForIdle();
    const failedPublic = await waitFor(failedApp.base, (await failedResponse.json()).jobId, ['failed']);
    const failed = structuredClone(failedApp.jobStore.get(failedPublic.jobId));
    const retried = failedApp.jobStore.retry('fixture-user', failed.jobId, {
      clientRequestId: '88888888-8888-4888-8888-888888888888',
      noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    }, '8'.repeat(64));
    expect(retried.type).toBe('created');
    const retry = structuredClone(retried.record);
    const superseded = structuredClone(failedApp.jobStore.get(failed.jobId));

    const cancelledApp = await start();
    const cancelledResponse = await createMain(cancelledApp.base, 1, '99999999-9999-4999-8999-999999999999');
    await cancelledApp.runner.waitForIdle();
    const cancelledPublic = await waitFor(cancelledApp.base, (await cancelledResponse.json()).jobId, ['succeeded']);
    expect(cancelledApp.runner.cancel(cancelledPublic.jobId)).toBe('cancelled');
    const cancelled = structuredClone(cancelledApp.jobStore.get(cancelledPublic.jobId));

    const cases: Array<[string, any, (record: any) => void]> = [
      ['unknown request key', main, (record) => { record.request.focus.panel.extra = true; }],
      ['wrong main request type', main, (record) => { record.request.candidateCount = '1'; }],
      ['unsafe canonical crop counter', main, (record) => { record.request.canonicalCropPixels.width = Number.MAX_SAFE_INTEGER + 1; }],
      ['variant request reference mismatch', final, (record) => { record.request.candidateId = 'z'.repeat(43); }],
      ['missing variant parent reference', final, (record) => { record.request.parentJobId = 'p'.repeat(43); }],
      ['unknown temp key', main, (record) => { record.temp.path = '/tmp/leak'; }],
      ['wrong temp namespace', main, (record) => { record.temp.source = 'finals/source.jpg'; }],
      ['unknown candidate key', main, (record) => { record.temp.candidates[0].extra = true; }],
      ['candidate filename mismatch', main, (record) => { record.temp.candidates[0].preview = 'candidates/not-the-candidate.avif'; }],
      ['unknown final variant', final, (record) => { record.temp.finals.dusk = record.temp.finals.dark; }],
      ['incomplete awaiting final set', final, (record) => { delete record.temp.finals.light; }],
      ['unknown policy key', main, (record) => { record.policy.extra = true; }],
      ['wrong policy version', main, (record) => { record.policy.version = 'room-image-prompt-policy-v2'; }],
      ['wrong policy phase order', main, (record) => { record.policy.phases.reverse(); }],
      ['policy spec does not match main request', main, (record) => { record.policy.spec.tone = 'warm'; }],
      ['unknown attempt key', main, (record) => { record.attempts[0].extra = true; }],
      ['attempt lineage mismatch', main, (record) => { record.attempts[0].lineageId = 'l'.repeat(43); }],
      ['duplicate provider attempt id', final, (record) => { record.attempts[1].providerAttemptId = record.attempts[0].providerAttemptId; }],
      ['completed attempt without completed time', main, (record) => { record.attempts[0].completedAt = null; }],
      ['completed valid attempt with error code', main, (record) => { record.attempts[0].errorCode = 'PROVIDER_RESULT_INVALID'; }],
      ['unknown attempt outcome', main, (record) => { record.attempts[0].outcome = 'maybe'; }],
      ['attempt time before planned time', main, (record) => { record.attempts[0].startedAt = record.attempts[0].plannedAt - 1; }],
      ['unknown counter key', main, (record) => { record.providerCalls.attempt.extra = 0; }],
      ['unsafe counter', main, (record) => { record.providerCalls.lineage.plannedCount = Number.MAX_SAFE_INTEGER + 1; }],
      ['counter does not match attempts', main, (record) => { record.providerCalls.attempt.completedCount -= 1; }],
      ['counter ordering impossible', final, (record) => { record.providerCalls.wizard.startedCount = 0; }],
      ['duplicate transition id', main, (record) => { record.transitionIds[1] = record.transitionIds[0]; }],
      ['transition count does not match attempts', main, (record) => { record.transitionIds.pop(); }],
      ['non-string transition id', main, (record) => { record.transitionIds[0] = 1; }],
      ['unknown error key', failed, (record) => { record.error.detail = 'raw'; }],
      ['unknown error code', failed, (record) => { record.error.code = 'PROVIDER_RAW_FAILURE'; }],
      ['failed job without error', failed, (record) => { record.error = null; }],
      ['unknown retry key', failed, (record) => { record.retry.uploadId = record.request.uploadId; }],
      ['retry kind mismatch', failed, (record) => { record.retry.kind = 'variant_set'; }],
      ['retry object while not retryable', cancelled, (record) => { record.retry = { kind: record.kind, requiredProviderCalls: 1, noticeVersion: 'room-image-v1' }; }],
      ['superseded job without successor', superseded, (record) => { record.supersededByJobId = null; }],
      ['superseded job with missing successor', superseded, (record) => { record.supersededByJobId = 's'.repeat(43); }],
      ['non-superseded job with successor', retry, (record) => { record.supersededByJobId = main.jobId; }],
      ['retry with missing parent attempt', retry, (record) => { record.parentAttemptId = 'a'.repeat(43); record.attempts.forEach((attempt: any) => { attempt.parentAttemptId = record.parentAttemptId; }); }],
      ['retry lineage aggregate mismatch', retry, (record) => { record.providerCalls.lineage.plannedCount += 1; }],
      ['self superseded reference', superseded, (record) => { record.supersededByJobId = record.jobId; }],
      ['status phase mismatch', main, (record) => { record.phase = 'queued'; }],
      ['terminal cancellable flag mismatch', cancelled, (record) => { record.cancellable = true; }],
      ['queued discardable flag mismatch', retry, (record) => { record.discardable = true; }],
      ['retryable status mismatch', failed, (record) => { record.status = 'cancelled'; }],
      ['retryable job not discardable', failed, (record) => { record.discardable = false; }],
      ['unsafe top-level time', main, (record) => { record.updatedAt = Number.MAX_SAFE_INTEGER + 1; }],
      ['expiry invariant mismatch', main, (record) => { record.expiresAt += 1; }],
      ['updated time before creation', main, (record) => { record.updatedAt = record.createdAt - 1; }],
    ];

    for (const [label, source, mutate] of cases) {
      const record = structuredClone(source);
      mutate(record);
      const related = source === final ? [main]
        : source === retry ? [superseded]
          : source === superseded ? [retry] : [];
      expectStoredJobRejected(record, label, related);
    }

    const finalDeadlineMismatch = structuredClone(final);
    finalDeadlineMismatch.expiresAt -= 1;
    expectStoredJobRejected(finalDeadlineMismatch, 'final expiry differs from parent lineage', [finalParent]);
    const finalNonPositiveLifetime = structuredClone(final);
    finalNonPositiveLifetime.expiresAt = finalNonPositiveLifetime.createdAt;
    expectStoredJobRejected(finalNonPositiveLifetime, 'inherited expiry is not after creation', [finalParent]);
    const retryDeadlineMismatch = structuredClone(retry);
    retryDeadlineMismatch.expiresAt -= 1;
    expectStoredJobRejected(retryDeadlineMismatch, 'retry expiry differs from old attempt', [superseded]);
    const retryBeyondMaximum = structuredClone(retry);
    retryBeyondMaximum.expiresAt = retryBeyondMaximum.createdAt + 24 * 60 * 60 * 1000 + 1;
    expectStoredJobRejected(retryBeyondMaximum, 'retry expiry exceeds 24 hours', [superseded]);
  }, IMAGE_BUDGET_MS);

  it('runs composition and two independent styles through the real runner and survives restart', async () => {
    const app = await start();
    const created = await createMain(app.base, 2);
    expect(created.status).toBe(202);
    const accepted = await created.json();
    const job = await waitFor(app.base, accepted.jobId, ['succeeded', 'failed']);
    expect(job.status).toBe('succeeded');
    expect(job.phase).toBe('complete');
    expect(job.providerCalls.attempt).toMatchObject({ confirmedCount: 3, plannedCount: 3, startedCount: 3, completedCount: 3, outcomeUnknownCount: 0 });
    // Kandidaten = Komposition + je Stilvariante einer.
    expect(job.candidates).toHaveLength(3);
    expect(app.provider.calls.map((call: any) => call.phase)).toEqual(['composition', 'style-light', 'style-light']);
    expect(app.provider.calls[1].inputHash).toBe(app.provider.calls[2].inputHash);

    const preview = await fetch(`${app.base}${job.candidates[0].previewUrl}`, { headers: headers() });
    expect(preview.status).toBe(200);
    expect(preview.headers.get('cache-control')).toBe('private, no-store');
    expect(await sharp(new Uint8Array(await preview.arrayBuffer())).metadata()).toMatchObject({ width: 3392, height: 2400 });

    const replayRequest = app.jobStore.getOwn('fixture-user', job.jobId).request;
    const replay = await fetch(`${app.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(replayRequest),
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()).jobId).toBe(job.jobId);
    expect(app.provider.calls).toHaveLength(3);

    const restarted = createRoomImageJobStore({
      metadataRoot: join(app.sandbox, 'jobs'), tempRoot: join(app.sandbox, 'private'),
    });
    expect(restarted.getOwn('fixture-user', job.jobId)?.status).toBe('succeeded');
    expect(readdirSync(join(app.sandbox, 'jobs')).filter((name: string) => name.endsWith('.json'))).toHaveLength(1);
  });

  it('accepts exactly one parallel final job and transfers exclusive temp ownership', async () => {
    const app = await start();
    const mainResponse = await createMain(app.base, 2, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await app.runner.waitForIdle();
    const mainPublic = await waitFor(app.base, (await mainResponse.json()).jobId, ['succeeded']);
    const parentBefore = structuredClone(app.jobStore.get(mainPublic.jobId));
    const candidateId = parentBefore.temp.candidates[0].candidateId;
    const payload = (clientRequestId: string) => ({
      kind: 'variant_set', clientRequestId,
      parentJobId: mainPublic.jobId, candidateId,
      focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
      noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    });

    const responses = await Promise.all([
      fetch(`${app.base}/api/room-image-jobs`, {
        method: 'POST', headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(payload('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
      }),
      fetch(`${app.base}/api/room-image-jobs`, {
        method: 'POST', headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(payload('cccccccc-cccc-4ccc-8ccc-cccccccccccc')),
      }),
    ]);
    await app.runner.waitForIdle();
    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    const metadata = readdirSync(join(app.sandbox, 'jobs')).filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name));
    expect(metadata).toHaveLength(2);
    const parent = app.jobStore.get(mainPublic.jobId);
    const final = metadata.map((name: string) => app.jobStore.get(name.slice(0, -5)))
      .find((record: any) => record.kind === 'variant_set');
    await waitFor(app.base, final.jobId, ['awaiting_confirmation', 'failed']);
    const parentRefs = new Set([
      parent.temp.source, parent.temp.composition,
      ...parent.temp.candidates.flatMap((candidate: any) => [candidate.preview, candidate.providerInput]),
    ].filter(Boolean));
    const finalRefs = [final.temp.source, final.temp.selectedPreview, final.temp.selectedProvider].filter(Boolean);
    expect(finalRefs.every((reference: string) => !parentRefs.has(reference))).toBe(true);
    expect(parent.temp.candidates).toEqual([]);
    expect(parentBefore.temp.candidates.slice(1).every((candidate: any) => (
      !app.jobStore.tempExists(candidate.preview) && !app.jobStore.tempExists(candidate.providerInput)
    ))).toBe(true);
  }, IMAGE_BUDGET_MS);

  it('recovers final-accept journals deterministically and resumes committed cleanup', async () => {
    const createFinalCrashFixture = async (crashStep: string) => {
      const app = await start();
      const mainResponse = await createMain(app.base, 2, `78787878-7878-4787-8787-${crashStep === 'after_1_persisted' ? '787878787878' : '909090909090'}`);
      await app.runner.waitForIdle();
      const main = await waitFor(app.base, (await mainResponse.json()).jobId, ['succeeded']);
      const parent = app.jobStore.get(main.jobId);
      const request = {
        kind: 'variant_set', clientRequestId: crashStep === 'after_1_persisted'
          ? 'abababab-abab-4aba-8aba-abababababab' : 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd',
        parentJobId: parent.jobId, candidateId: parent.temp.candidates[0].candidateId,
        focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
        noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
      };
      const store = createRoomImageJobStore({
        metadataRoot: join(app.sandbox, 'jobs'), tempRoot: join(app.sandbox, 'private'),
        transactionStep(step: string) {
          if (step === crashStep) throw Object.assign(new Error(`crash at ${step}`), { simulateCrash: true });
        },
      });
      expect(() => store.createFinal('fixture-user', request, parent, 'f'.repeat(64))).toThrow(`crash at ${crashStep}`);
      return { app, parent, request };
    };

    const prepared = await createFinalCrashFixture('after_1_persisted');
    const preparedRecovered = createRoomImageJobStore({
      metadataRoot: join(prepared.app.sandbox, 'jobs'), tempRoot: join(prepared.app.sandbox, 'private'),
    });
    const preparedParent = preparedRecovered.get(prepared.parent.jobId);
    expect(preparedParent.status).toBe('succeeded');
    expect(preparedParent.temp.candidates).toHaveLength(3);
    expect(readdirSync(join(prepared.app.sandbox, 'jobs')).filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name))).toHaveLength(1);

    const committed = await createFinalCrashFixture('journal_committed');
    const committedRecovered = createRoomImageJobStore({
      metadataRoot: join(committed.app.sandbox, 'jobs'), tempRoot: join(committed.app.sandbox, 'private'),
    });
    const committedParent = committedRecovered.get(committed.parent.jobId);
    const finalFiles = readdirSync(join(committed.app.sandbox, 'jobs')).filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name));
    const committedFinal = finalFiles.map((name: string) => committedRecovered.get(name.slice(0, -5)))
      .find((record: any) => record.kind === 'variant_set');
    expect(committedParent.temp).toEqual({
      source: null, composition: null, candidates: [], selectedProvider: null, selectedPreview: null, finals: {},
    });
    expect(committedFinal).toMatchObject({ status: 'failed', request: { candidateId: committed.request.candidateId } });
    expect(committedRecovered.tempExists(committedFinal.temp.source)).toBe(true);
    expect(committedRecovered.tempExists(committedFinal.temp.selectedProvider)).toBe(true);
    expect(readdirSync(join(committed.app.sandbox, 'jobs')).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(false);

    let rejectedCandidateId = '';
    let failCandidateCleanup = false;
    const cleanupApp = await start({
      jobStoreOptions: {
        removeFile(path: string) {
          if (failCandidateCleanup && path.endsWith(`candidate-${rejectedCandidateId}.avif`)) {
            throw Object.assign(new Error('candidate cleanup failed'), { code: 'EIO' });
          }
          unlinkSync(path);
        },
      },
    });
    const cleanupMainResponse = await createMain(cleanupApp.base, 2, 'efefefef-efef-4efe-8efe-efefefefefef');
    const cleanupMain = await waitFor(cleanupApp.base, (await cleanupMainResponse.json()).jobId, ['succeeded']);
    await cleanupApp.runner.waitForIdle();
    const cleanupParent = cleanupApp.jobStore.get(cleanupMain.jobId);
    const selected = cleanupParent.temp.candidates[0];
    const rejected = cleanupParent.temp.candidates[1];
    rejectedCandidateId = rejected.candidateId;
    const cleanupRequest = {
      kind: 'variant_set', clientRequestId: '10101010-1010-4010-8010-101010101010',
      parentJobId: cleanupParent.jobId, candidateId: selected.candidateId,
      focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
      noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    };
    const storeResultTypes: string[] = [];
    let finalJobId = '';
    const createFinal = cleanupApp.jobStore.createFinal.bind(cleanupApp.jobStore);
    cleanupApp.jobStore.createFinal = (...args: any[]) => {
      const result = createFinal(...args);
      storeResultTypes.push(result.type);
      finalJobId ||= result.record?.jobId ?? '';
      return result;
    };
    const enqueued: string[] = [];
    const enqueue = cleanupApp.runner.enqueue.bind(cleanupApp.runner);
    cleanupApp.runner.enqueue = (jobId: string, reservation: any) => {
      expect(readdirSync(join(cleanupApp.sandbox, 'jobs')).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(false);
      enqueued.push(jobId);
      return enqueue(jobId, reservation);
    };

    failCandidateCleanup = true;
    const cleanupFailure = await fetch(`${cleanupApp.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(cleanupRequest),
    });
    expect(cleanupFailure.status).toBe(503);
    const cleanupFailureBody = await cleanupFailure.json();
    expect(cleanupFailureBody).toMatchObject({ ok: false, code: 'ROOM_IMAGE_STORE_INVALID', retryable: false });
    expect(JSON.stringify(cleanupFailureBody)).not.toMatch(/candidate cleanup failed|EIO|candidate-|\/private\//);
    expect(storeResultTypes).toEqual(['cleanup_pending']);
    expect(finalJobId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(enqueued).toEqual([]);
    expect(cleanupApp.provider.calls).toHaveLength(3);
    expect(cleanupApp.runner.capacityUsed).toBe(0);
    expect(readdirSync(join(cleanupApp.sandbox, 'jobs')).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(true);
    expect(cleanupApp.jobStore.tempExists(rejected.preview)).toBe(true);
    expect(cleanupApp.jobStore.tempExists(rejected.providerInput)).toBe(false);

    const repeatedCleanupFailure = await fetch(`${cleanupApp.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(cleanupRequest),
    });
    expect(repeatedCleanupFailure.status).toBe(503);
    expect(storeResultTypes).toEqual(['cleanup_pending', 'cleanup_pending']);
    expect(enqueued).toEqual([]);
    expect(cleanupApp.provider.calls).toHaveLength(3);
    expect(readdirSync(join(cleanupApp.sandbox, 'jobs')).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(true);

    const conflict = await fetch(`${cleanupApp.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        ...cleanupRequest,
        focus: { ...cleanupRequest.focus, panel: { x: 0.6, y: 0.48 } },
      }),
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(storeResultTypes).toEqual(['cleanup_pending', 'cleanup_pending']);
    expect(enqueued).toEqual([]);
    expect(readdirSync(join(cleanupApp.sandbox, 'jobs')).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(true);

    failCandidateCleanup = false;
    const resumedResponses = await Promise.all([1, 2].map(() => fetch(`${cleanupApp.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(cleanupRequest),
    })));
    expect(resumedResponses.map((response) => response.status)).toEqual([200, 200]);
    const resumedBodies = await Promise.all(resumedResponses.map((response) => response.json()));
    expect(resumedBodies.map((body) => body.jobId)).toEqual([finalJobId, finalJobId]);
    expect(storeResultTypes).toEqual(['cleanup_pending', 'cleanup_pending', 'resumed']);
    expect(enqueued).toEqual([finalJobId]);
    expect(readdirSync(join(cleanupApp.sandbox, 'jobs')).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(false);
    expect(cleanupApp.jobStore.tempExists(rejected.preview)).toBe(false);
    expect(cleanupApp.jobStore.tempExists(rejected.providerInput)).toBe(false);
    expect(cleanupApp.jobStore.tempExists(selected.preview)).toBe(true);
    expect(cleanupApp.jobStore.tempExists(selected.providerInput)).toBe(true);
    await cleanupApp.runner.waitForIdle();
    expect(cleanupApp.provider.calls.map((call: any) => call.phase)).toEqual([
      'composition', 'style-light', 'style-light', 'dark', 'dark-off',
    ]);

    const replay = await fetch(`${cleanupApp.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(cleanupRequest),
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()).jobId).toBe(finalJobId);
    await cleanupApp.runner.waitForIdle();
    expect(enqueued).toEqual([finalJobId]);
    expect(cleanupApp.provider.calls).toHaveLength(5);
  }, IMAGE_BUDGET_MS);

  it('locks pending committed cleanup across lineage mutations, TTL cleanup and restart', async () => {
    let timestamp = 1_700_000_000_000;
    let rejectedCandidateId = '';
    let failCandidateCleanup = false;
    const app = await start({
      now: () => timestamp,
      jobStoreOptions: {
        removeFile(path: string) {
          if (failCandidateCleanup && path.endsWith(`candidate-${rejectedCandidateId}.avif`)) {
            throw Object.assign(new Error('private cleanup detail'), { code: 'EIO' });
          }
          unlinkSync(path);
        },
      },
    });
    const mainResponse = await createMain(app.base, 2, '14141414-1414-4414-8414-141414141414');
    const main = await waitFor(app.base, (await mainResponse.json()).jobId, ['succeeded']);
    await app.runner.waitForIdle();
    const parent = app.jobStore.get(main.jobId);
    const selected = parent.temp.candidates[0];
    const rejected = parent.temp.candidates[1];
    rejectedCandidateId = rejected.candidateId;
    const request = {
      kind: 'variant_set', clientRequestId: '15151515-1515-4515-8515-151515151515',
      parentJobId: parent.jobId, candidateId: selected.candidateId,
      focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
      noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    };
    const enqueued: string[] = [];
    const enqueue = app.runner.enqueue.bind(app.runner);
    app.runner.enqueue = (jobId: string, reservation: any) => {
      enqueued.push(jobId);
      return enqueue(jobId, reservation);
    };

    failCandidateCleanup = true;
    const cleanupFailure = await fetch(`${app.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(request),
    });
    expect(cleanupFailure.status).toBe(503);
    const metadataNames = readdirSync(join(app.sandbox, 'jobs'));
    const finalId = metadataNames
      .filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name))
      .map((name: string) => name.slice(0, -5))
      .find((jobId: string) => app.jobStore.get(jobId).kind === 'variant_set');
    expect(finalId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const beforeParent = structuredClone(app.jobStore.get(parent.jobId));
    const beforeFinal = structuredClone(app.jobStore.get(finalId));
    const beforeMetadata = Object.fromEntries([parent.jobId, finalId].map((jobId) => [
      jobId, readFileSync(join(app.sandbox, 'jobs', `${jobId}.json`), 'utf8'),
    ]));
    const tempInventory = () => Object.fromEntries(
      ['sources', 'compositions', 'candidates', 'finals', 'partials'].map((kind) => (
        [kind, readdirSync(join(app.sandbox, 'private', kind)).sort()]
      )),
    );
    const beforeTemps = tempInventory();
    const beforeCalls = structuredClone(app.provider.calls);
    let directMutationEntered = false;
    expect(() => app.jobStore.update(parent.jobId, () => { directMutationEntered = true; }))
      .toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));
    expect(directMutationEntered).toBe(false);

    const cancelled = await fetch(`${app.base}/api/room-image-jobs/${parent.jobId}/cancel`, {
      method: 'POST', headers: headers(),
    });
    expect(cancelled.status).toBe(503);
    const cancelledBody = await cancelled.json();
    expect(cancelledBody).toMatchObject({ ok: false, code: 'ROOM_IMAGE_STORE_INVALID', retryable: false });
    expect(JSON.stringify(cancelledBody)).not.toMatch(/private cleanup detail|EIO|candidate-|\/private\//);
    expect(app.jobStore.get(parent.jobId)).toEqual(beforeParent);
    expect(app.jobStore.get(finalId)).toEqual(beforeFinal);
    expect(readFileSync(join(app.sandbox, 'jobs', `${parent.jobId}.json`), 'utf8')).toBe(beforeMetadata[parent.jobId]);
    expect(readFileSync(join(app.sandbox, 'jobs', `${finalId}.json`), 'utf8')).toBe(beforeMetadata[finalId]);
    expect(tempInventory()).toEqual(beforeTemps);
    expect(app.provider.calls).toEqual(beforeCalls);
    expect(enqueued).toEqual([]);
    expect(app.runner.capacityUsed).toBe(0);

    const restartRoot = join(root('hauser-room-image-b3-pending-restart-'), 'snapshot');
    cpSync(app.sandbox, restartRoot, { recursive: true });

    const unrelated = app.jobStore.createMain(
      'fixture-user', directMainRequest('16161616-1616-4616-8616-161616161616'),
      fixture('orientation-1.jpg'), '1'.repeat(64),
    ).record;
    const unrelatedSource = unrelated.temp.source;
    timestamp = beforeParent.expiresAt + 1;
    const status = await fetch(`${app.base}/api/room-image-jobs/${parent.jobId}`, { headers: headers() });
    expect(status.status).toBe(200);
    expect((await status.json()).status).toBe('succeeded');
    expect(app.jobStore.get(parent.jobId)).toEqual(beforeParent);
    expect(app.jobStore.get(finalId)).toEqual(beforeFinal);
    expect(tempInventory()).toEqual({
      ...beforeTemps,
      sources: beforeTemps.sources,
    });
    expect(app.jobStore.get(unrelated.jobId)).toMatchObject({ status: 'expired', retryable: false });
    expect(app.jobStore.tempExists(unrelatedSource)).toBe(false);

    failCandidateCleanup = false;
    const restarted = createRoomImageJobStore({
      metadataRoot: join(restartRoot, 'jobs'), tempRoot: join(restartRoot, 'private'),
      now: () => 1_700_000_000_000,
    });
    const restartedParent = restarted.get(parent.jobId);
    const restartedFinal = restarted.get(finalId);
    expect(restartedParent).toEqual(beforeParent);
    expect(restartedFinal).toMatchObject({
      status: 'failed', phase: 'complete', retryable: true,
      request: { parentJobId: parent.jobId, candidateId: selected.candidateId },
      providerCalls: {
        attempt: { startedCount: 0, completedCount: 0, outcomeUnknownCount: 0 },
        lineage: { startedCount: 0, completedCount: 0, outcomeUnknownCount: 0 },
      },
    });
    expect(readdirSync(join(restartRoot, 'jobs')).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(false);
    expect(readdirSync(join(restartRoot, 'private', 'partials'))).toEqual([]);
    const referenced = new Set([
      restartedFinal.temp.source, restartedFinal.temp.selectedProvider, restartedFinal.temp.selectedPreview,
    ].filter(Boolean));
    const retained = new Set(['sources', 'compositions', 'candidates', 'finals'].flatMap((kind) => (
      readdirSync(join(restartRoot, 'private', kind)).map((name: string) => `${kind}/${name}`)
    )));
    expect(retained).toEqual(referenced);
  }, 20_000);

  it('separates legacy committed handoffs from the closed B3 result protocol', async () => {
    const crop = { x: 0.1, y: 0.1, width: 0.795, height: 0.75 };
    const cases: Array<[string, unknown, boolean]> = [
      ['legacy string', 'persisted', false],
      ['legacy object resembling replay', { type: 'replay', legacy: true }, false],
      ['B3 created', { type: 'created', record: {} }, false],
      ['B3 replay', { type: 'replay', record: {} }, true],
      ['B3 conflict', { type: 'conflict', record: {} }, true],
      ['B3 upload already', { type: 'upload_already', record: {} }, true],
      ['B3 already', { type: 'already' }, true],
    ];

    for (const [label, result, remainsAvailable] of cases) {
      const uploadRoot = root(`hauser-room-image-b3-handoff-${label.replaceAll(' ', '-')}-`);
      const store = createRoomImageUploadStore({ root: uploadRoot });
      const created = store.create('fixture-user', {
        buffer: fixture('neutral-alpha.png'), width: 640, height: 480, mimeType: 'image/png',
      });
      const binding = await store.bindForJob('fixture-user', created.uploadId);
      expect(binding, label).not.toBeNull();
      await expect(binding.materializeProviderJpeg(crop, async () => result), label).resolves.toBe(result);
      expect(store.hasOwn('fixture-user', created.uploadId), label).toBe(remainsAvailable);
    }
  });

  it('rolls back a main handoff on upload cleanup failure and preserves unrelated conflict uploads', async () => {
    let failCleanupOnce = true;
    const app = await start({
      uploadStoreOptions: {
        removeFile(path: string) {
          if (failCleanupOnce && path.endsWith('.png') && !path.includes('.upload-')) {
            failCleanupOnce = false;
            throw Object.assign(new Error('injected upload cleanup failure'), { code: 'EIO' });
          }
          unlinkSync(path);
        },
      },
    });
    const first = await uploadAndMainPayload(app.base, '56565656-5656-4656-8656-565656565656');
    const failedHandoff = await postMainPayload(app.base, first.payload);
    expect(failedHandoff.status).toBe(503);
    expect(app.uploadStore.hasOwn('fixture-user', first.upload.uploadId)).toBe(true);
    expect(readdirSync(join(app.sandbox, 'jobs')).filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name))).toHaveLength(0);
    expect(app.runner.capacityUsed).toBe(0);

    const accepted = await postMainPayload(app.base, first.payload);
    expect(accepted.status).toBe(202);
    const acceptedJob = await waitFor(app.base, (await accepted.json()).jobId, ['succeeded', 'failed']);
    expect(acceptedJob.status).toBe('succeeded');
    expect(app.uploadStore.hasOwn('fixture-user', first.upload.uploadId)).toBe(false);

    const second = await uploadAndMainPayload(app.base, first.payload.clientRequestId);
    const conflict = await postMainPayload(app.base, second.payload);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(app.uploadStore.hasOwn('fixture-user', second.upload.uploadId)).toBe(true);
    expect(readdirSync(join(app.sandbox, 'jobs')).filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name))).toHaveLength(1);
    expect(app.runner.capacityUsed).toBe(0);
  });

  it('creates a final temporary set from one selected light input without publishing an asset', async () => {
    const app = await start();
    const main = await createMain(app.base, 1);
    const mainJob = await waitFor(app.base, (await main.json()).jobId, ['succeeded']);
    const finalResponse = await fetch(`${app.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        kind: 'variant_set', clientRequestId: '22222222-2222-4222-8222-222222222222',
        parentJobId: mainJob.jobId, candidateId: mainJob.candidates[0].candidateId,
        focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
        noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
      }),
    });
    expect(finalResponse.status).toBe(202);
    const finalJob = await waitFor(app.base, (await finalResponse.json()).jobId, ['awaiting_confirmation', 'failed']);
    expect(finalJob).toMatchObject({ status: 'awaiting_confirmation', phase: 'awaiting_confirmation', asset: null });
    expect(finalJob.temporaryVariants).toEqual({
      light: `/api/room-image-jobs/${finalJob.jobId}/final-previews/light`,
      dark: `/api/room-image-jobs/${finalJob.jobId}/final-previews/dark`,
      darkOff: `/api/room-image-jobs/${finalJob.jobId}/final-previews/dark-off`,
    });
    const darkCalls = app.provider.calls.slice(-2);
    expect(darkCalls.map((call: any) => call.phase)).toEqual(['dark', 'dark-off']);
    expect(darkCalls[0].inputHash).toBe(darkCalls[1].inputHash);
    for (const previewUrl of Object.values(finalJob.temporaryVariants) as string[]) {
      const preview = await fetch(`${app.base}${previewUrl}`, { headers: headers() });
      expect(preview.status).toBe(200);
      expect(preview.headers.get('cache-control')).toBe('private, no-store');
      expect(await sharp(new Uint8Array(await preview.arrayBuffer())).metadata()).toMatchObject({
        format: 'heif', width: 3392, height: 2400, space: 'srgb', hasAlpha: false, pages: 1,
      });
      const head = await fetch(`${app.base}${previewUrl}`, { method: 'HEAD', headers: headers() });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-length')).toBe(preview.headers.get('content-length'));
      expect(await head.text()).toBe('');
    }
    const restarted = createRoomImageJobStore({
      metadataRoot: join(app.sandbox, 'jobs'), tempRoot: join(app.sandbox, 'private'),
    });
    expect(restarted.getOwn('fixture-user', finalJob.jobId)?.status).toBe('awaiting_confirmation');
    const cancelled = await fetch(`${app.base}/api/room-image-jobs/${finalJob.jobId}/cancel`, {
      method: 'POST', headers: headers(),
    });
    expect(cancelled.status).toBe(200);
    for (const previewUrl of Object.values(finalJob.temporaryVariants) as string[]) {
      expect((await fetch(`${app.base}${previewUrl}`, { headers: headers() })).status).toBe(410);
    }
  });

  it('authenticates before body parsing and hides jobs across identities', async () => {
    const app = await start();
    const unauthenticated = await fetch(`${app.base}/api/room-image-jobs`, {
      method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{broken',
    });
    expect(unauthenticated.status).toBe(401);
    const forbiddenOrigin = await fetch(`${app.base}/api/room-image-jobs`, {
      method: 'POST', headers: { [IDENTITY_HEADER]: 'fixture-user', 'content-type': 'application/json' }, body: '{broken',
    });
    expect(forbiddenOrigin.status).toBe(403);
    const malformed = await fetch(`${app.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: '{broken',
    });
    expect(malformed.status).toBe(400);
    expect(app.provider.calls).toHaveLength(0);

    const created = await createMain(app.base, 1);
    const own = await waitFor(app.base, (await created.json()).jobId, ['succeeded']);
    const foreign = await fetch(`${app.base}/api/room-image-jobs/${own.jobId}`, {
      headers: { [IDENTITY_HEADER]: 'other-user' },
    });
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).code).toBe('ROOM_IMAGE_JOB_NOT_FOUND');
  });

  it('enforces one active slot plus three FIFO waiters and releases the slot on cancel', async () => {
    let releaseFirst: (() => void) | undefined;
    let first = true;
    const provider = createDeterministicRoomImageFakeProvider({
      delay: () => {
        if (!first) return Promise.resolve();
        first = false;
        return new Promise<void>((resolve) => { releaseFirst = resolve; });
      },
    });
    const app = await start({ provider });
    const accepted = [];
    for (let index = 1; index <= 4; index += 1) {
      const response = await createMain(app.base, 1, `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`);
      expect(response.status).toBe(202);
      accepted.push(await response.json());
      if (index === 1) {
        for (let spin = 0; spin < 50 && provider.calls.length === 0; spin += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
    }
    const rejected = await createMain(app.base, 1, '11111111-1111-4111-8111-000000000005');
    expect(rejected.status).toBe(429);
    expect((await rejected.json()).code).toBe('ROOM_IMAGE_QUEUE_FULL');
    expect(app.runner.capacityUsed).toBe(4);

    const cancelled = await fetch(`${app.base}/api/room-image-jobs/${accepted[0].jobId}/cancel`, {
      method: 'POST', headers: headers(),
    });
    expect(cancelled.status).toBe(200);
    const cancelledJob = await waitFor(app.base, accepted[0].jobId, ['cancelled']);
    expect(cancelledJob.providerCalls.attempt).toMatchObject({ startedCount: 1, completedCount: 0, outcomeUnknownCount: 1 });
    releaseFirst?.();
    await app.runner.waitForIdle();
    const lastResponse = await fetch(`${app.base}/api/room-image-jobs/${accepted[3].jobId}`, { headers: headers() });
    const last = await lastResponse.json();
    expect(last.status).toBe('succeeded');
    expect(provider.calls).toHaveLength(7);
    const restarted = createRoomImageJobStore({
      metadataRoot: join(app.sandbox, 'jobs'), tempRoot: join(app.sandbox, 'private'),
    });
    expect(restarted.getOwn('fixture-user', accepted[0].jobId)?.status).toBe('cancelled');
  }, IMAGE_BUDGET_MS);

  it('makes retry supersede atomic at every journal/write step and recovers prepared or committed crashes', () => {
    const createFailedFixture = (transactionStep: ((step: string) => void) | undefined = undefined) => {
      const sandbox = root('hauser-room-image-b3-retry-transaction-');
      const metadataRoot = join(sandbox, 'jobs');
      const tempRoot = join(sandbox, 'private');
      const initial = createRoomImageJobStore({ metadataRoot, tempRoot });
      const request = {
        kind: 'main_candidates', clientRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        uploadId: 'u'.repeat(43), crop: { x: 0.1, y: 0.1, width: 0.795, height: 0.75 },
        canonicalCropPixels: { x: 64, y: 48, width: 530, height: 375 },
        focus: { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } },
        stylePreset: 'hauser-room-v1', adjustments: { declutter: 'light', tone: 'neutral', preserveFeatures: ['windows'] },
        candidateCount: 1, noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
      };
      const created = initial.createMain('fixture-user', request, fixture('orientation-1.jpg'), 'd'.repeat(64)).record;
      for (const [index, attempt] of created.attempts.entries()) {
        initial.transition(created.jobId, attempt.providerAttemptId, `local-${index}`, 'failed_local');
      }
      initial.setJobState(created.jobId, {
        status: 'failed', phase: 'complete', cancellable: false, retryable: true, discardable: true,
        retry: { kind: 'main_candidates', requiredProviderCalls: 2, noticeVersion: 'room-image-v1' },
        error: { code: 'LOCAL_PROVIDER_REQUEST_NOT_SENT', message: 'Lokal geschlossen.' },
      });
      return {
        sandbox, metadataRoot, tempRoot, oldJobId: created.jobId,
        store: createRoomImageJobStore({ metadataRoot, tempRoot, ...(transactionStep ? { transactionStep } : {}) }),
      };
    };
    const retryPayload = {
      clientRequestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    };

    for (const failedStep of ['journal_prepared', 'after_1_persisted', 'after_2_persisted', 'journal_committed']) {
      const fixtureState = createFailedFixture((step) => {
        if (step === failedStep) throw new Error(`persist failure at ${step}`);
      });
      const before = structuredClone(fixtureState.store.get(fixtureState.oldJobId));
      const refs = [before.temp.source, before.temp.composition].filter(Boolean);
      expect(() => fixtureState.store.retry('fixture-user', fixtureState.oldJobId, retryPayload, 'e'.repeat(64)), failedStep)
        .toThrow(`persist failure at ${failedStep}`);
      const restarted = createRoomImageJobStore({ metadataRoot: fixtureState.metadataRoot, tempRoot: fixtureState.tempRoot });
      expect(restarted.get(fixtureState.oldJobId)).toMatchObject({ status: 'failed', retryable: true, supersededByJobId: null });
      expect(refs.every((reference: string) => restarted.tempExists(reference))).toBe(true);
      expect(readdirSync(fixtureState.metadataRoot).filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name))).toHaveLength(1);
      expect(readdirSync(fixtureState.metadataRoot).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(false);
    }

    const preparedCrash = createFailedFixture((step) => {
      if (step === 'after_1_persisted') throw Object.assign(new Error('simulated prepared crash'), { simulateCrash: true });
    });
    expect(() => preparedCrash.store.retry('fixture-user', preparedCrash.oldJobId, retryPayload, 'e'.repeat(64)))
      .toThrow('simulated prepared crash');
    const preparedRecovered = createRoomImageJobStore({ metadataRoot: preparedCrash.metadataRoot, tempRoot: preparedCrash.tempRoot });
    expect(preparedRecovered.get(preparedCrash.oldJobId)).toMatchObject({ status: 'failed', retryable: true });
    expect(readdirSync(preparedCrash.metadataRoot).filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name))).toHaveLength(1);

    const committedCrash = createFailedFixture((step) => {
      if (step === 'journal_committed') throw Object.assign(new Error('simulated committed crash'), { simulateCrash: true });
    });
    expect(() => committedCrash.store.retry('fixture-user', committedCrash.oldJobId, retryPayload, 'e'.repeat(64)))
      .toThrow('simulated committed crash');
    const committedRecovered = createRoomImageJobStore({ metadataRoot: committedCrash.metadataRoot, tempRoot: committedCrash.tempRoot });
    const old = committedRecovered.get(committedCrash.oldJobId);
    const successor = committedRecovered.get(old.supersededByJobId);
    expect(old).toMatchObject({ status: 'superseded', retryable: false });
    expect(successor).toMatchObject({ parentAttemptId: old.attemptId, lineageId: old.lineageId, status: 'failed' });
    const oldRefs = new Set([
      old.temp.source, old.temp.composition, old.temp.selectedProvider, old.temp.selectedPreview,
    ].filter(Boolean));
    expect([successor.temp.source, successor.temp.composition, successor.temp.selectedProvider, successor.temp.selectedPreview]
      .filter(Boolean).every((reference: string) => !oldRefs.has(reference))).toBe(true);
    expect(readdirSync(committedCrash.metadataRoot).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(false);
  });

  it('fails retry supersede closed until committed journal cleanup resumes exactly once', async () => {
    let failTransport = true;
    let failJournalCleanup = false;
    const fake = createDeterministicRoomImageFakeProvider();
    const app = await start({
      provider: {
        available: true,
        calls: fake.calls,
        probe: fake.probe,
        edit(args: any) {
          if (failTransport) throw new Error('injected initial transport failure');
          return fake.edit(args);
        },
      },
      jobStoreOptions: {
        removeFile(path: string) {
          if (failJournalCleanup && path.includes('/jobs/.room-image-transaction-') && path.endsWith('.json')) {
            throw Object.assign(new Error('journal cleanup failed'), { code: 'EIO' });
          }
          unlinkSync(path);
        },
      },
    });
    const mainResponse = await createMain(app.base, 1, '36363636-3636-4636-8636-363636363636');
    const failed = await waitFor(app.base, (await mainResponse.json()).jobId, ['failed']);
    await app.runner.waitForIdle();
    expect(fake.calls).toHaveLength(0);

    const resultTypes: string[] = [];
    const retry = app.jobStore.retry.bind(app.jobStore);
    app.jobStore.retry = (...args: any[]) => {
      const result = retry(...args);
      resultTypes.push(result.type);
      return result;
    };
    const enqueued: string[] = [];
    const enqueue = app.runner.enqueue.bind(app.runner);
    app.runner.enqueue = (jobId: string, reservation: any) => {
      expect(readdirSync(join(app.sandbox, 'jobs')).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(false);
      enqueued.push(jobId);
      return enqueue(jobId, reservation);
    };
    const payload = {
      clientRequestId: '37373737-3737-4737-8737-373737373737',
      noticeVersion: 'room-image-v1', costConfirmed: true,
      confirmedProviderCalls: failed.retry.requiredProviderCalls,
    };

    failTransport = false;
    failJournalCleanup = true;
    const cleanupFailure = await fetch(`${app.base}/api/room-image-jobs/${failed.jobId}/retry`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(payload),
    });
    expect(cleanupFailure.status).toBe(503);
    const cleanupFailureBody = await cleanupFailure.json();
    expect(cleanupFailureBody).toMatchObject({ ok: false, code: 'ROOM_IMAGE_STORE_INVALID', retryable: false });
    expect(JSON.stringify(cleanupFailureBody)).not.toMatch(/journal cleanup failed|EIO|transaction-|\/jobs\//);
    expect(resultTypes).toEqual(['cleanup_pending']);
    expect(enqueued).toEqual([]);
    expect(fake.calls).toHaveLength(0);
    expect(app.runner.capacityUsed).toBe(0);
    expect(readdirSync(join(app.sandbox, 'jobs')).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(true);
    const successorId = app.jobStore.get(failed.jobId).supersededByJobId;
    expect(successorId).toMatch(/^[A-Za-z0-9_-]{43}$/);

    failJournalCleanup = false;
    const resumed = await fetch(`${app.base}/api/room-image-jobs/${failed.jobId}/retry`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(payload),
    });
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).jobId).toBe(successorId);
    expect(resultTypes).toEqual(['cleanup_pending', 'resumed']);
    expect(enqueued).toEqual([successorId]);
    expect(readdirSync(join(app.sandbox, 'jobs')).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(false);
    await app.runner.waitForIdle();
    expect(fake.calls.map((call: any) => call.phase)).toEqual(['composition', 'style-light']);

    const replay = await fetch(`${app.base}/api/room-image-jobs/${failed.jobId}/retry`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(payload),
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()).jobId).toBe(successorId);
    await app.runner.waitForIdle();
    expect(enqueued).toEqual([successorId]);
    expect(fake.calls).toHaveLength(2);
  });

  it('serializes parallel retry keys and preserves same-key replay/conflict semantics', async () => {
    const app = await start({ provider: createRoomImageProviderBoundary() });
    const response = await createMain(app.base, 1, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    const failed = await waitFor(app.base, (await response.json()).jobId, ['failed']);
    const retryPayload = (clientRequestId: string, confirmedProviderCalls = 2) => ({
      clientRequestId, noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls,
    });
    const keys = ['12121212-1212-4212-8212-121212121212', '34343434-3434-4343-8343-343434343434'];
    const responses = await Promise.all(keys.map((key) => fetch(`${app.base}/api/room-image-jobs/${failed.jobId}/retry`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(retryPayload(key)),
    })));
    expect(responses.map((entry) => entry.status).sort()).toEqual([202, 409]);
    const bodies = await Promise.all(responses.map((entry) => entry.json()));
    expect(bodies.find((body) => body.code)?.code).toBe('RETRY_ALREADY_CREATED');
    const winner = bodies.find((body) => body.jobId);
    const replay = await fetch(`${app.base}/api/room-image-jobs/${failed.jobId}/retry`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(retryPayload(winner.clientRequestId)),
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()).jobId).toBe(winner.jobId);
    const conflict = await fetch(`${app.base}/api/room-image-jobs/${failed.jobId}/retry`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(retryPayload(winner.clientRequestId, 1)),
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('IDEMPOTENCY_CONFLICT');
    await waitFor(app.base, winner.jobId, ['failed']);
    expect(readdirSync(join(app.sandbox, 'jobs')).filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name))).toHaveLength(2);
    expect(app.runner.capacityUsed).toBe(0);

    const throwingApp = await start({ provider: createRoomImageProviderBoundary() });
    const throwingMain = await createMain(throwingApp.base, 1, '45454545-4545-4454-8454-454545454545');
    const throwingFailed = await waitFor(throwingApp.base, (await throwingMain.json()).jobId, ['failed']);
    throwingApp.jobStore.retry = () => { throw new Error('injected retry store failure'); };
    const failedReservation = await fetch(`${throwingApp.base}/api/room-image-jobs/${throwingFailed.jobId}/retry`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(retryPayload('67676767-6767-4676-8676-676767676767')),
    });
    expect(failedReservation.status).toBe(500);
    expect(throwingApp.runner.capacityUsed).toBe(0);
    expect(readdirSync(join(throwingApp.sandbox, 'jobs')).filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name))).toHaveLength(1);
  });

  it('keeps the productive provider closed locally and retries only missing lineage calls', async () => {
    const app = await start({ provider: createRoomImageProviderBoundary() });
    const response = await createMain(app.base, 1);
    const failed = await waitFor(app.base, (await response.json()).jobId, ['failed']);
    expect(failed.providerCalls.attempt).toMatchObject({
      confirmedCount: 2, plannedCount: 2, startedCount: 0, completedCount: 0, outcomeUnknownCount: 0,
    });
    expect(failed.retry).toEqual({ kind: 'main_candidates', requiredProviderCalls: 2, noticeVersion: 'room-image-v1' });

    const retryPayload = {
      clientRequestId: '33333333-3333-4333-8333-333333333333',
      noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    };
    const retried = app.jobStore.retry('fixture-user', failed.jobId, retryPayload, 'b'.repeat(64));
    expect(retried.type).toBe('created');
    const fake = createDeterministicRoomImageFakeProvider();
    const retryRunner = createRoomImageJobRunner({ store: app.jobStore, provider: fake });
    expect(retryRunner.enqueue(retried.record.jobId)).toBe(true);
    await retryRunner.waitForIdle();
    const green = app.jobStore.getOwn('fixture-user', retried.record.jobId);
    expect(green.status).toBe('succeeded');
    expect(green.parentAttemptId).toBe(failed.attemptId);
    expect(green.lineageId).toBe(failed.lineageId);
    expect(green.providerCalls.lineage).toMatchObject({ plannedCount: 4, startedCount: 2, completedCount: 2, outcomeUnknownCount: 0 });
    expect(app.jobStore.getOwn('fixture-user', failed.jobId).status).toBe('superseded');
    expect(app.jobStore.discard('fixture-user', failed.jobId)).toBe('discarded');
    const restarted = createRoomImageJobStore({
      metadataRoot: join(app.sandbox, 'jobs'), tempRoot: join(app.sandbox, 'private'),
    });
    expect(restarted.getOwn('fixture-user', retried.record.jobId)?.status).toBe('succeeded');
    expect(restarted.getOwn('fixture-user', failed.jobId)?.status).toBe('superseded');
  });

  it('commits provider results, terminal transitions and all aggregate copies as one recoverable exactly-once transaction', () => {
    const crashSteps = [
      'before_result_write', 'after_result_write_before_prepared', 'journal_prepared',
      'results_installed', 'after_1_persisted', 'journal_committed', 'journal_cleanup',
    ];
    for (const [index, crashStep] of crashSteps.entries()) {
      const sandbox = root(`hauser-room-image-b3-provider-${index}-`);
      const metadataRoot = join(sandbox, 'jobs');
      const tempRoot = join(sandbox, 'private');
      let armed = false;
      const initial = createRoomImageJobStore({
        metadataRoot, tempRoot,
        transactionStep(step: string) {
          if (armed && step === crashStep) throw Object.assign(new Error(`crash at ${step}`), { simulateCrash: true });
        },
      });
      const created = initial.createMain(
        'fixture-user', directMainRequest(`91919191-9191-4191-8191-${String(index).padStart(12, '0')}`),
        fixture('orientation-1.jpg'), '9'.repeat(64),
      ).record;
      const attempt = created.attempts[0];
      initial.transition(created.jobId, attempt.providerAttemptId, `start-${index}`, 'started');
      armed = true;
      const transitionId = `valid-${index}`;
      expect(() => initial.commitProviderTransition(created.jobId, attempt.providerAttemptId, transitionId, {
        target: 'completed', outcome: 'result_valid', errorCode: null,
        result: { type: 'composition', bytes: fixture('orientation-1.jpg') },
      }), crashStep).toThrow(`crash at ${crashStep}`);

      const recovered = createRoomImageJobStore({ metadataRoot, tempRoot });
      const record = recovered.get(created.jobId);
      const committed = ['journal_committed', 'journal_cleanup'].includes(crashStep);
      if (committed) {
        expect(record.attempts[0]).toMatchObject({ status: 'completed', outcome: 'result_valid', errorCode: null });
        expect(record.providerCalls.attempt).toMatchObject({ startedCount: 1, completedCount: 1, outcomeUnknownCount: 0 });
        expect(record.temp.composition).toBe(`compositions/composition-${record.lineageId}.jpg`);
        expect(recovered.tempExists(record.temp.composition)).toBe(true);
        const beforeBytes = readFileSync(join(tempRoot, record.temp.composition));
        const beforeCounters = structuredClone(record.providerCalls);
        expect(recovered.commitProviderTransition(record.jobId, attempt.providerAttemptId, transitionId, {
          target: 'completed', outcome: 'result_valid', errorCode: null,
          result: { type: 'composition', bytes: fixture('orientation-1.jpg') },
        }).result).toBe(false);
        expect(recovered.get(record.jobId).providerCalls).toEqual(beforeCounters);
        expect(readFileSync(join(tempRoot, record.temp.composition))).toEqual(beforeBytes);
      } else {
        expect(record.attempts[0]).toMatchObject({ status: 'outcome_unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' });
        expect(record.providerCalls.attempt).toMatchObject({ startedCount: 1, completedCount: 0, outcomeUnknownCount: 1 });
        expect(record.temp.composition).toBeNull();
        expect(readdirSync(join(tempRoot, 'compositions'))).toEqual([]);
      }
      expect(readdirSync(join(tempRoot, 'partials'))).toEqual([]);
      expect(readdirSync(metadataRoot).some((name: string) => name.startsWith('.room-image-transaction-'))).toBe(false);
    }
  });

  it('keeps every transition kind exactly once and never attaches bytes for invalid or HTTP results', async () => {
    const transitionCases = [
      ['failed_local', null, 'LOCAL_PROVIDER_REQUEST_NOT_SENT'],
      ['cancelled_before_start', null, 'JOB_CANCELLED'],
    ] as const;
    for (const [index, [target, outcome, errorCode]] of transitionCases.entries()) {
      const sandbox = root(`hauser-room-image-b3-transition-${target}-`);
      const store = createRoomImageJobStore({ metadataRoot: join(sandbox, 'jobs'), tempRoot: join(sandbox, 'private') });
      const record = store.createMain(
        'fixture-user', directMainRequest(`95959595-9595-4595-8595-${String(index).padStart(12, '0')}`),
        fixture('orientation-1.jpg'), 'c'.repeat(64),
      ).record;
      expect(record.providerCalls.attempt).toMatchObject({ plannedCount: 2, startedCount: 0, completedCount: 0, outcomeUnknownCount: 0 });
      const attempt = record.attempts[0];
      const transitionId = `${target}-${attempt.providerAttemptId}`;
      expect(store.transition(record.jobId, attempt.providerAttemptId, transitionId, target, outcome, errorCode).result).toBe(true);
      expect(store.transition(record.jobId, attempt.providerAttemptId, transitionId, target, outcome, errorCode).result).toBe(false);
      const changed = store.get(record.jobId);
      expect(changed.attempts[0]).toMatchObject({ status: target, outcome, errorCode });
      expect(changed.providerCalls.attempt).toMatchObject({ plannedCount: 2, startedCount: 0, completedCount: 0, outcomeUnknownCount: 0 });
      expect(changed.providerCalls.lineage).toEqual({ plannedCount: 2, startedCount: 0, completedCount: 0, outcomeUnknownCount: 0 });
      expect(changed.providerCalls.wizard).toEqual(changed.providerCalls.lineage);
    }

    const unknownSandbox = root('hauser-room-image-b3-transition-unknown-');
    const unknownStore = createRoomImageJobStore({
      metadataRoot: join(unknownSandbox, 'jobs'), tempRoot: join(unknownSandbox, 'private'),
    });
    const unknown = unknownStore.createMain(
      'fixture-user', directMainRequest('96969696-9696-4696-8696-969696969696'),
      fixture('orientation-1.jpg'), 'd'.repeat(64),
    ).record;
    const unknownAttempt = unknown.attempts[0];
    unknownStore.transition(unknown.jobId, unknownAttempt.providerAttemptId, 'unknown-start', 'started');
    unknownStore.transition(unknown.jobId, unknownAttempt.providerAttemptId, 'unknown-terminal', 'outcome_unknown');
    const unknownBeforeLate = structuredClone(unknownStore.get(unknown.jobId));
    expect(unknownStore.transition(
      unknown.jobId, unknownAttempt.providerAttemptId, 'unknown-late', 'completed', 'http_error', 'PROVIDER_HTTP_ERROR',
    ).result).toBe(false);
    expect(unknownStore.get(unknown.jobId)).toEqual(unknownBeforeLate);
    expect(unknownBeforeLate.providerCalls.attempt).toMatchObject({ plannedCount: 2, startedCount: 1, completedCount: 0, outcomeUnknownCount: 1 });
    expect(unknownBeforeLate.providerCalls.lineage).toEqual({ plannedCount: 2, startedCount: 1, completedCount: 0, outcomeUnknownCount: 1 });
    expect(unknownBeforeLate.providerCalls.wizard).toEqual(unknownBeforeLate.providerCalls.lineage);

    for (const [index, providerResult] of [
      { definitiveResponse: true, status: 503 },
      { definitiveResponse: true, status: 200, image: new Uint8Array([1, 2, 3]) },
    ].entries()) {
      const provider = {
        available: true,
        async probe() { return { definitiveResponse: true, status: 200 }; },
        async edit() { return providerResult; },
      };
      const app = await start({ provider });
      const response = await createMain(
        app.base, 1, `97979797-9797-4797-8797-${String(index).padStart(12, '0')}`,
      );
      const failed = await waitFor(app.base, (await response.json()).jobId, ['failed']);
      const stored = app.jobStore.get(failed.jobId);
      expect(stored.attempts[0]).toMatchObject(index === 0
        ? { status: 'completed', outcome: 'http_error', errorCode: 'PROVIDER_HTTP_ERROR' }
        : { status: 'completed', outcome: 'result_invalid', errorCode: 'PROVIDER_RESULT_INVALID' });
      expect(stored.temp.composition).toBeNull();
      expect(stored.temp.candidates).toEqual([]);
      expect(stored.temp.finals).toEqual({});
      expect(readdirSync(join(app.sandbox, 'private', 'partials'))).toEqual([]);
      const beforeLate = structuredClone(stored);
      expect(app.jobStore.transition(
        stored.jobId, stored.attempts[0].providerAttemptId, `late-${index}`,
        'completed', 'result_invalid', 'PROVIDER_RESULT_INVALID',
      ).result).toBe(false);
      expect(app.jobStore.get(stored.jobId)).toEqual(beforeLate);
    }
  });

  it('keeps every old, retry, parent and final job on authoritative lineage and wizard aggregates', async () => {
    const app = await start({ provider: createRoomImageProviderBoundary() });
    const response = await createMain(app.base, 1, '92929292-9292-4292-8292-929292929292');
    const failed = await waitFor(app.base, (await response.json()).jobId, ['failed']);
    const retried = app.jobStore.retry('fixture-user', failed.jobId, {
      clientRequestId: '93939393-9393-4393-8393-939393939393',
      noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    }, 'a'.repeat(64));
    expect(retried.type).toBe('created');
    const fake = createDeterministicRoomImageFakeProvider();
    const retryRunner = createRoomImageJobRunner({ store: app.jobStore, provider: fake });
    retryRunner.enqueue(retried.record.jobId);
    await retryRunner.waitForIdle();
    const parent = app.jobStore.get(retried.record.jobId);
    expect(parent.status).toBe('succeeded');
    const selected = parent.temp.candidates[0];
    const finalCreated = app.jobStore.createFinal('fixture-user', {
      kind: 'variant_set', clientRequestId: '94949494-9494-4494-8494-949494949494',
      parentJobId: parent.jobId, candidateId: selected.candidateId,
      focus: { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } },
      noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    }, parent, 'b'.repeat(64));
    expect(finalCreated.type).toBe('created');
    const finalRunner = createRoomImageJobRunner({ store: app.jobStore, provider: fake });
    finalRunner.enqueue(finalCreated.record.jobId);
    await finalRunner.waitForIdle();

    const records = [failed.jobId, parent.jobId, finalCreated.record.jobId].map((jobId) => app.jobStore.get(jobId));
    expect(records.map((record) => record.status)).toEqual(['superseded', 'succeeded', 'awaiting_confirmation']);
    expect(records.map((record) => record.providerCalls.wizard)).toEqual([
      records[2].providerCalls.wizard, records[2].providerCalls.wizard, records[2].providerCalls.wizard,
    ]);
    expect(records[0].providerCalls.lineage).toEqual(records[1].providerCalls.lineage);
    expect(records[0].providerCalls.lineage).toMatchObject({ plannedCount: 4, startedCount: 2, completedCount: 2, outcomeUnknownCount: 0 });
    expect(records[2].providerCalls.lineage).toMatchObject({ plannedCount: 2, startedCount: 2, completedCount: 2, outcomeUnknownCount: 0 });
    expect(records[2].providerCalls.wizard).toMatchObject({ plannedCount: 6, startedCount: 4, completedCount: 4, outcomeUnknownCount: 0 });
    expect(records.map((record) => record.providerCalls.attempt)).toEqual([
      expect.objectContaining({ plannedCount: 2, startedCount: 0, completedCount: 0 }),
      expect.objectContaining({ plannedCount: 2, startedCount: 2, completedCount: 2 }),
      expect.objectContaining({ plannedCount: 2, startedCount: 2, completedCount: 2 }),
    ]);

    for (const jobId of records.map((record) => record.jobId)) {
      const responseJob = await fetch(`${app.base}/api/room-image-jobs/${jobId}`, { headers: headers() });
      expect(responseJob.status).toBe(200);
      expect((await responseJob.json()).providerCalls.wizard).toEqual(records[2].providerCalls.wizard);
    }
    const restarted = createRoomImageJobStore({ metadataRoot: join(app.sandbox, 'jobs'), tempRoot: join(app.sandbox, 'private') });
    expect(records.map((record) => restarted.get(record.jobId).providerCalls.wizard)).toEqual([
      records[2].providerCalls.wizard, records[2].providerCalls.wizard, records[2].providerCalls.wizard,
    ]);
  });

  it('recovers a persisted started attempt exactly once and expires retained temps at TTL', () => {
    let clock = Date.parse('2026-08-03T10:00:00.000Z');
    const sandbox = root();
    const metadataRoot = join(sandbox, 'jobs');
    const tempRoot = join(sandbox, 'private');
    const store = createRoomImageJobStore({ metadataRoot, tempRoot, now: () => clock });
    const request = {
      kind: 'main_candidates', clientRequestId: '44444444-4444-4444-8444-444444444444',
      uploadId: 'u'.repeat(43), crop: { x: 0.1, y: 0.1, width: 0.795, height: 0.75 },
      canonicalCropPixels: { x: 64, y: 48, width: 530, height: 375 },
      focus: { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } },
      stylePreset: 'hauser-room-v1', adjustments: { declutter: 'light', tone: 'neutral', preserveFeatures: ['windows'] },
      candidateCount: 1, noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    };
    const created = store.createMain('fixture-user', request, fixture('orientation-1.jpg'), 'c'.repeat(64)).record;
    const providerAttemptId = created.attempts[0].providerAttemptId;
    store.transition(created.jobId, providerAttemptId, 'manual-start', 'started');
    store.transition(created.jobId, providerAttemptId, 'manual-start', 'started');
    expect(store.get(created.jobId).providerCalls.attempt.startedCount).toBe(1);

    const restarted = createRoomImageJobStore({ metadataRoot, tempRoot, now: () => clock });
    const recovered = restarted.get(created.jobId);
    expect(recovered.status).toBe('failed');
    expect(recovered.providerCalls.attempt).toMatchObject({ startedCount: 1, completedCount: 0, outcomeUnknownCount: 1 });
    const restartedAgain = createRoomImageJobStore({ metadataRoot, tempRoot, now: () => clock });
    expect(restartedAgain.get(created.jobId).providerCalls.attempt.outcomeUnknownCount).toBe(1);

    clock += 24 * 60 * 60 * 1000;
    restartedAgain.cleanup();
    expect(restartedAgain.get(created.jobId).status).toBe('expired');
    expect(restartedAgain.get(created.jobId).retryable).toBe(false);
  });

  it('normalizes validating_set restart to a schema-valid retry and deletes partial finals idempotently', async () => {
    const fixtureState = await persistedFinalAtValidatingSet();
    const before = fixtureState.final;
    const retained = [before.temp.source, before.temp.selectedProvider, before.temp.selectedPreview];
    const partialFinals = Object.values(before.temp.finals) as string[];
    const counters = structuredClone(before.providerCalls);

    const restarted = createRoomImageJobStore({
      metadataRoot: fixtureState.metadataRoot, tempRoot: fixtureState.tempRoot,
    });
    const recovered = restarted.get(before.jobId);
    expect(recovered).toMatchObject({
      status: 'failed', phase: 'complete', cancellable: false, retryable: true, discardable: true,
      retry: { kind: 'variant_set', requiredProviderCalls: 2, noticeVersion: 'room-image-v1' },
      error: { code: 'SERVER_RESTARTED_RETRY_REQUIRED' },
      temp: {
        source: before.temp.source, composition: null, candidates: [],
        selectedProvider: before.temp.selectedProvider, selectedPreview: before.temp.selectedPreview,
        finals: {},
      },
    });
    expect(recovered.providerCalls).toEqual(counters);
    expect(retained.every((reference: string) => restarted.tempExists(reference))).toBe(true);
    expect(partialFinals.every((reference) => !restarted.tempExists(reference))).toBe(true);
    expect(readdirSync(join(fixtureState.tempRoot, 'finals'))).toEqual([]);

    const restartedAgain = createRoomImageJobStore({
      metadataRoot: fixtureState.metadataRoot, tempRoot: fixtureState.tempRoot,
    });
    expect(restartedAgain.get(before.jobId)).toEqual(recovered);
    expect(restartedAgain.get(before.jobId).providerCalls).toEqual(counters);
    expect(retained.every((reference: string) => restartedAgain.tempExists(reference))).toBe(true);
    expect(readdirSync(join(fixtureState.tempRoot, 'finals'))).toEqual([]);
  });

  it('resumes crash-during-cancel cleanup without double-counting or permanent referenced/orphaned temps', () => {
    const sandbox = root('hauser-room-image-b3-restart-cancelling-');
    const metadataRoot = join(sandbox, 'jobs');
    const tempRoot = join(sandbox, 'private');
    const store = createRoomImageJobStore({ metadataRoot, tempRoot });
    const created = store.createMain(
      'fixture-user', directMainRequest('24242424-2424-4424-8424-242424242424'),
      fixture('orientation-1.jpg'), '4'.repeat(64),
    ).record;
    const [compositionAttempt, styleAttempt] = created.attempts;
    store.transition(created.jobId, compositionAttempt.providerAttemptId, 'cancel-fixture-composition-start', 'started');
    store.commitProviderTransition(created.jobId, compositionAttempt.providerAttemptId, 'cancel-fixture-composition-valid', {
      target: 'completed', outcome: 'result_valid', errorCode: null,
      result: { type: 'composition', bytes: fixture('orientation-1.jpg') },
    });
    store.transition(created.jobId, styleAttempt.providerAttemptId, 'cancel-fixture-style-start', 'started');
    store.setJobState(created.jobId, { status: 'cancelling' });
    const before = store.get(created.jobId);
    const sourcePath = join(tempRoot, before.temp.source);
    const compositionPath = join(tempRoot, before.temp.composition);
    let injected = false;

    expect(() => createRoomImageJobStore({
      metadataRoot, tempRoot,
      removeFile(path: string) {
        if (!injected && path === compositionPath) {
          injected = true;
          throw new Error('injected crash during cancel cleanup');
        }
        unlinkSync(path);
      },
    })).toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));
    expect(injected).toBe(true);
    const crashMetadata = JSON.parse(readFileSync(join(metadataRoot, `${created.jobId}.json`), 'utf8'));
    expect(crashMetadata.status).toBe('cancelling');
    expect(crashMetadata.providerCalls.attempt).toMatchObject({
      plannedCount: 2, startedCount: 2, completedCount: 1, outcomeUnknownCount: 1,
    });
    expect(existsSync(sourcePath)).toBe(false);
    expect(existsSync(compositionPath)).toBe(true);

    const recoveredStore = createRoomImageJobStore({ metadataRoot, tempRoot });
    const recovered = recoveredStore.get(created.jobId);
    expect(recovered).toMatchObject({
      status: 'cancelled', phase: 'complete', cancellable: false,
      retryable: false, discardable: true, retry: null,
      error: { code: 'PROVIDER_OUTCOME_UNKNOWN' },
      temp: {
        source: null, composition: null, candidates: [],
        selectedProvider: null, selectedPreview: null, finals: {},
      },
    });
    expect(recovered.providerCalls.attempt).toMatchObject({
      plannedCount: 2, startedCount: 2, completedCount: 1, outcomeUnknownCount: 1,
    });
    for (const kind of ['sources', 'compositions', 'candidates', 'finals', 'partials']) {
      expect(readdirSync(join(tempRoot, kind)), kind).toEqual([]);
    }

    const restartedAgain = createRoomImageJobStore({ metadataRoot, tempRoot });
    expect(restartedAgain.get(created.jobId)).toEqual(recovered);
    expect(restartedAgain.get(created.jobId).providerCalls).toEqual(recovered.providerCalls);
    for (const kind of ['sources', 'compositions', 'candidates', 'finals', 'partials']) {
      expect(readdirSync(join(tempRoot, kind)), kind).toEqual([]);
    }
  });
});

describe('B-08E10 B3 spec follow-up evidence', () => {
  it('arms one monotone edit deadline before provider handoff and includes paused decode', async () => {
    const timers = manualTimers();
    const decodeGate = deferred();
    let decodeStarted = false;
    let providerSawArmedTimer = false;
    const provider = {
      available: true,
      async probe() { return { definitiveResponse: true, status: 200 }; },
      async edit() {
        providerSawArmedTimer = timers.entries.some((entry) => entry.active);
        return { definitiveResponse: true, status: 200, image: fixture('provider-portrait.png') };
      },
    };
    const app = directRunnerFixture({
      provider,
      runnerOptions: {
        editDeadlineMs: 300_000,
        monotonicNow: () => timers.clock.value,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        async prepareProviderResult(context: any) {
          decodeStarted = true;
          await decodeGate.promise;
          return context.defaultPrepare();
        },
      },
    });
    try {
      await waitUntil(() => decodeStarted, 'paused provider decode');
      expect(providerSawArmedTimer).toBe(true);
      expect(timers.entries).toHaveLength(1);
      expect(timers.entries[0].delay).toBe(300_000);
      timers.fire();
      await waitUntil(() => app.store.get(app.record.jobId).status === 'failed', 'deadline failure');
      expect(app.runner.capacityUsed).toBe(0);
      expect(app.store.get(app.record.jobId).providerCalls.attempt).toMatchObject({
        startedCount: 1, completedCount: 1, outcomeUnknownCount: 0,
      });
    } finally {
      decodeGate.resolve();
    }
    await app.runner.waitForIdle();
    const settled = app.store.get(app.record.jobId);
    expect(settled.temp.composition).toBeNull();
    expect(settled.temp.candidates).toEqual([]);
    expect(settled.providerCalls.attempt).toMatchObject({ completedCount: 1, outcomeUnknownCount: 0 });
  });

  it('accepts a complete provider decode that finishes inside the one edit deadline', async () => {
    const timers = manualTimers();
    const decodeGate = deferred();
    let prepareCount = 0;
    let firstDecodeStarted = false;
    const app = directRunnerFixture({
      provider: {
        available: true,
        async probe() { return { definitiveResponse: true, status: 200 }; },
        async edit() {
          return { definitiveResponse: true, status: 200, image: fixture('provider-portrait.png') };
        },
      },
      clientRequestId: '22222222-2222-4222-8222-222222222223',
      runnerOptions: {
        monotonicNow: () => timers.clock.value,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        async prepareProviderResult(context: any) {
          prepareCount += 1;
          if (prepareCount === 1) {
            firstDecodeStarted = true;
            await decodeGate.promise;
          }
          return context.defaultPrepare();
        },
      },
    });
    await waitUntil(() => firstDecodeStarted, 'in-deadline decode');
    expect(timers.entries).toHaveLength(1);
    expect(timers.entries[0].active).toBe(true);
    decodeGate.resolve();
    await app.runner.waitForIdle();
    const succeeded = app.store.get(app.record.jobId);
    expect(succeeded.status).toBe('succeeded');
    expect(succeeded.providerCalls.attempt).toMatchObject({
      startedCount: 2, completedCount: 2, outcomeUnknownCount: 0,
    });
    expect(timers.entries).toHaveLength(2);
    expect(timers.entries.every((entry) => !entry.active)).toBe(true);
  });

  it('tracks probe late settlement in waitForIdle after the 10-second deadline', async () => {
    const timers = manualTimers();
    const probeGate = deferred<any>();
    const sandbox = root('hauser-room-image-b3-probe-');
    const store = createRoomImageJobStore({
      metadataRoot: join(sandbox, 'jobs'), tempRoot: join(sandbox, 'private'),
    });
    const runner = createRoomImageJobRunner({
      store,
      provider: {
        available: true,
        probe: () => probeGate.promise,
        async edit() { throw new Error('not used'); },
      },
      probeDeadlineMs: 10_000,
      monotonicNow: () => timers.clock.value,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    runners.push(runner);
    const probe = runner.probe();
    await waitUntil(() => timers.entries.length === 1, 'probe timer');
    expect(timers.entries[0].delay).toBe(10_000);
    timers.fire();
    await expect(probe).rejects.toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN' });
    let idle = false;
    const waiting = runner.waitForIdle().then(() => { idle = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(idle).toBe(false);
    probeGate.resolve({ definitiveResponse: true, status: 200 });
    await waiting;
    expect(idle).toBe(true);
  });

  it('decodes and drops a late edit result without a second transition or temp write', async () => {
    const timers = manualTimers();
    const providerGate = deferred<any>();
    const decodeGate = deferred();
    let decodeStarted = false;
    const app = directRunnerFixture({
      provider: {
        available: true,
        async probe() { return { definitiveResponse: true, status: 200 }; },
        edit: () => providerGate.promise,
      },
      clientRequestId: '14141414-1414-4414-8414-141414141414',
      runnerOptions: {
        monotonicNow: () => timers.clock.value,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        async prepareProviderResult(context: any) {
          decodeStarted = true;
          await decodeGate.promise;
          return context.defaultPrepare();
        },
      },
    });
    await waitUntil(() => timers.entries.length === 1, 'edit timer');
    timers.fire();
    await waitUntil(() => app.store.get(app.record.jobId).status === 'failed', 'unknown edit outcome');
    const afterDeadline = structuredClone(app.store.get(app.record.jobId));
    expect(app.runner.capacityUsed).toBe(0);
    providerGate.resolve({ definitiveResponse: true, status: 200, image: fixture('provider-portrait.png') });
    await waitUntil(() => decodeStarted, 'late provider decode');
    let idle = false;
    const waiting = app.runner.waitForIdle().then(() => { idle = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(idle).toBe(false);
    decodeGate.resolve();
    await waiting;
    expect(app.store.get(app.record.jobId)).toEqual(afterDeadline);
    expect(readdirSync(join(app.sandbox, 'private', 'partials'))).toEqual([]);
    expect(readdirSync(join(app.sandbox, 'private', 'compositions'))).toEqual([]);
    expect(readdirSync(join(app.sandbox, 'private', 'candidates'))).toEqual([]);
  });

  it('serializes cancel against paused decode, aborts the controller and cleans the definitive result', async () => {
    const decodeGate = deferred();
    let decodeStarted = false;
    let providerSignal: AbortSignal | undefined;
    const app = directRunnerFixture({
      provider: {
        available: true,
        async probe() { return { definitiveResponse: true, status: 200 }; },
        async edit({ signal }: { signal: AbortSignal }) {
          providerSignal = signal;
          return { definitiveResponse: true, status: 200, image: fixture('provider-portrait.png') };
        },
      },
      clientRequestId: '15151515-1515-4515-8515-151515151515',
      runnerOptions: {
        async prepareProviderResult(context: any) {
          decodeStarted = true;
          await decodeGate.promise;
          return context.defaultPrepare();
        },
      },
    });
    try {
      await waitUntil(() => decodeStarted, 'cancel decode pause');
      expect(app.runner.cancel(app.record.jobId)).toBe('cancelling');
      expect(providerSignal?.aborted).toBe(true);
    } finally {
      decodeGate.resolve();
    }
    await app.runner.waitForIdle();
    const cancelled = app.store.get(app.record.jobId);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.providerCalls.attempt).toMatchObject({
      startedCount: 1, completedCount: 1, outcomeUnknownCount: 0,
    });
    expect(cancelled.temp).toEqual({
      source: null, composition: null, candidates: [], selectedProvider: null, selectedPreview: null, finals: {},
    });
    expect(readdirSync(join(app.sandbox, 'private', 'partials'))).toEqual([]);
    expect(readdirSync(join(app.sandbox, 'private', 'compositions'))).toEqual([]);
  });

  it('persists visible validating_set and fails closed when the joint final set is invalid', async () => {
    const validationGate = deferred();
    let validationStarted = false;
    const app = await start({
      runnerOptions: {
        async validatePreview(context: any) {
          if (context.purpose === 'final-set') {
            validationStarted = true;
            await validationGate.promise;
            if (context.variant === 'dark') throw new Error('injected invalid final set');
          }
          return context.defaultValidate();
        },
      },
    });
    const mainResponse = await createMain(app.base, 1, '16161616-1616-4616-8616-161616161616');
    const main = await waitFor(app.base, (await mainResponse.json()).jobId, ['succeeded']);
    const finalResponse = await fetch(`${app.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        kind: 'variant_set', clientRequestId: '17171717-1717-4717-8717-171717171717',
        parentJobId: main.jobId, candidateId: main.candidates[0].candidateId,
        focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
        noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
      }),
    });
    const final = await finalResponse.json();
    try {
      await waitUntil(() => validationStarted, 'joint final validation', VALIDATION_WAIT_ATTEMPTS);
      const visible = await (await fetch(`${app.base}/api/room-image-jobs/${final.jobId}`, { headers: headers() })).json();
      expect(visible).toMatchObject({ status: 'running', phase: 'validating_set', asset: null });
      expect(visible.temporaryVariants).toBeUndefined();
    } finally {
      validationGate.resolve();
    }
    const failed = await waitFor(app.base, final.jobId, ['failed']);
    expect(failed).toMatchObject({
      status: 'failed', phase: 'complete', asset: null,
      error: { code: 'PROVIDER_RESULT_INVALID' },
    });
    expect(app.jobStore.get(final.jobId).temp.finals).toEqual({});
  }, IMAGE_BUDGET_MS);

  it('fully validates source/candidate previews and loses them after cancel', async () => {
    const app = await start();
    const response = await createMain(app.base, 1, '18181818-1818-4818-8818-181818181818');
    const accepted = await response.json();
    const job = await waitFor(app.base, accepted.jobId, ['succeeded']);
    const sourceUrl = `/api/room-image-jobs/${job.jobId}/source-preview`;
    const candidateUrl = job.candidates[0].previewUrl;
    const source = await fetch(`${app.base}${sourceUrl}`, { headers: headers() });
    expect(source.status).toBe(200);
    expect(source.headers.get('content-type')).toBe('image/jpeg');
    expect(await sharp(new Uint8Array(await source.clone().arrayBuffer())).metadata()).toMatchObject({
      format: 'jpeg', width: 3392, height: 2400, space: 'srgb', hasAlpha: false,
    });
    const sourceHead = await fetch(`${app.base}${sourceUrl}`, { method: 'HEAD', headers: headers() });
    expect(sourceHead.status).toBe(200);
    expect(sourceHead.headers.get('content-length')).toBe(source.headers.get('content-length'));
    expect(await sourceHead.text()).toBe('');
    const candidateHead = await fetch(`${app.base}${candidateUrl}`, { method: 'HEAD', headers: headers() });
    expect(candidateHead.status).toBe(200);
    expect(await candidateHead.text()).toBe('');

    const stored = app.jobStore.get(job.jobId);
    const cleanSource = app.jobStore.readTemp(stored.temp.source);
    const metadataSource = await sharp(cleanSource).withMetadata({
      exif: { IFD0: { Artist: 'neutral-fixture' } },
    }).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
    writeFileSync(join(app.sandbox, 'private', stored.temp.source), metadataSource);
    const forbiddenMetadata = await fetch(`${app.base}${sourceUrl}`, { headers: headers() });
    expect(forbiddenMetadata.status).toBe(410);
    expect((await forbiddenMetadata.json()).code).toBe('SOURCE_PREVIEW_EXPIRED');
    writeFileSync(join(app.sandbox, 'private', stored.temp.source), cleanSource);
    writeFileSync(
      join(app.sandbox, 'private', stored.temp.candidates[0].preview),
      cleanSource,
    );
    const wrongFormat = await fetch(`${app.base}${candidateUrl}`, { headers: headers() });
    expect(wrongFormat.status).toBe(410);
    expect((await wrongFormat.json()).code).toBe('ROOM_IMAGE_PREVIEW_EXPIRED');

    const cancelled = await fetch(`${app.base}/api/room-image-jobs/${job.jobId}/cancel`, {
      method: 'POST', headers: headers(),
    });
    expect(cancelled.status).toBe(200);
    expect((await fetch(`${app.base}${sourceUrl}`, { headers: headers() })).status).toBe(410);
    expect((await fetch(`${app.base}${candidateUrl}`, { headers: headers() })).status).toBe(404);
  }, IMAGE_BUDGET_MS);

  it('rejects HEVC-in-HEIF as non-AVIF for candidate and final GET/HEAD while JPEG source stays valid', async () => {
    const emulateHevcMetadata = (bytes: Uint8Array, expectedFormat: string) => validateRoomImagePreviewBytes(
      bytes,
      expectedFormat,
      {
        async metadataReader(image: any) {
          const metadata = await image.metadata();
          return expectedFormat === 'heif' ? { ...metadata, compression: 'hevc' } : metadata;
        },
      },
    );
    const app = await start({ roomImagePreviewValidator: emulateHevcMetadata });
    const mainResponse = await createMain(app.base, 1, '25252525-2525-4525-8525-252525252525');
    const main = await waitFor(app.base, (await mainResponse.json()).jobId, ['succeeded']);
    const sourceUrl = `/api/room-image-jobs/${main.jobId}/source-preview`;
    expect((await fetch(`${app.base}${sourceUrl}`, { headers: headers() })).status).toBe(200);
    const expectHevcRejected = async (previewUrl: string) => {
      const get = await fetch(`${app.base}${previewUrl}`, { headers: headers() });
      expect(get.status, previewUrl).toBe(410);
      expect(get.headers.get('cache-control')).toBe('no-store');
      expect((await get.json()).code).toBe('ROOM_IMAGE_PREVIEW_EXPIRED');
      const head = await fetch(`${app.base}${previewUrl}`, { method: 'HEAD', headers: headers() });
      expect(head.status, previewUrl).toBe(410);
      expect(head.headers.get('cache-control')).toBe('no-store');
      expect(await head.text()).toBe('');
    };
    await expectHevcRejected(main.candidates[0].previewUrl);

    const finalResponse = await fetch(`${app.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        kind: 'variant_set', clientRequestId: '26262626-2626-4626-8626-262626262626',
        parentJobId: main.jobId, candidateId: main.candidates[0].candidateId,
        focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
        noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
      }),
    });
    const final = await waitFor(app.base, (await finalResponse.json()).jobId, ['awaiting_confirmation']);
    for (const previewUrl of Object.values(final.temporaryVariants) as string[]) {
      await expectHevcRejected(previewUrl);
    }
  }, IMAGE_BUDGET_MS);

  it('returns CROP_POLICY_MISMATCH without handoff and expires previews after discard and TTL', async () => {
    const app = await start();
    const prepared = await uploadAndMainPayload(app.base, '19191919-1919-4919-8919-191919191919');
    prepared.payload.canonicalCropPixels.width += 1;
    const mismatch = await postMainPayload(app.base, prepared.payload);
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()).code).toBe('CROP_POLICY_MISMATCH');
    expect(app.uploadStore.hasOwn('fixture-user', prepared.upload.uploadId)).toBe(true);
    expect(app.provider.calls).toHaveLength(0);

    const closed = await start({ provider: createRoomImageProviderBoundary() });
    const failedResponse = await createMain(closed.base, 1, '20202020-2020-4020-8020-202020202020');
    const failed = await waitFor(closed.base, (await failedResponse.json()).jobId, ['failed']);
    const failedSource = `/api/room-image-jobs/${failed.jobId}/source-preview`;
    expect((await fetch(`${closed.base}${failedSource}`, { headers: headers() })).status).toBe(200);
    const discarded = await fetch(`${closed.base}/api/room-image-jobs/${failed.jobId}/discard`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: '{}',
    });
    expect(discarded.status).toBe(204);
    expect((await fetch(`${closed.base}${failedSource}`, { headers: headers() })).status).toBe(410);

    let clock = Date.parse('2026-08-08T12:00:00.000Z');
    const ttl = await start({ now: () => clock });
    const ttlResponse = await createMain(ttl.base, 1, '21212121-2121-4121-8121-212121212121');
    const ttlJob = await waitFor(ttl.base, (await ttlResponse.json()).jobId, ['succeeded']);
    const ttlCandidate = ttlJob.candidates[0].previewUrl;
    clock += 24 * 60 * 60 * 1000;
    ttl.jobStore.cleanup();
    expect((await fetch(`${ttl.base}${ttlCandidate}`, { headers: headers() })).status).toBe(404);
    expect((await fetch(`${ttl.base}/api/room-image-jobs/${ttlJob.jobId}/source-preview`, { headers: headers() })).status).toBe(410);
  }, IMAGE_BUDGET_MS);

  it('inherits the absolute main-lineage deadline into final ownership and cleans every transferred temp there', async () => {
    let clock = Date.parse('2026-08-08T14:00:00.000Z');
    const app = await start({ now: () => clock });
    const mainResponse = await createMain(app.base, 1, '27272727-2727-4727-8727-272727272727');
    const main = await waitFor(app.base, (await mainResponse.json()).jobId, ['succeeded']);
    const parent = app.jobStore.get(main.jobId);
    const lineageDeadline = parent.expiresAt;
    const selected = structuredClone(parent.temp.candidates[0]);

    clock = lineageDeadline - 1_000;
    const finalResponse = await fetch(`${app.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        kind: 'variant_set', clientRequestId: '28282828-2828-4828-8828-282828282828',
        parentJobId: main.jobId, candidateId: selected.candidateId,
        focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
        noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
      }),
    });
    expect(finalResponse.status).toBe(202);
    const final = await waitFor(app.base, (await finalResponse.json()).jobId, ['awaiting_confirmation']);
    const storedFinal = app.jobStore.get(final.jobId);
    expect(storedFinal.createdAt).toBe(clock);
    expect(storedFinal.expiresAt).toBe(lineageDeadline);
    const transferredRefs = [
      storedFinal.temp.source, storedFinal.temp.selectedProvider, storedFinal.temp.selectedPreview,
      ...Object.values(storedFinal.temp.finals),
    ] as string[];
    expect(transferredRefs.every((reference) => app.jobStore.tempExists(reference))).toBe(true);

    clock = lineageDeadline;
    app.jobStore.cleanup();
    expect(app.jobStore.get(final.jobId)).toMatchObject({ status: 'expired', retryable: false });
    expect(transferredRefs.every((reference) => !app.jobStore.tempExists(reference))).toBe(true);
    for (const kind of ['sources', 'compositions', 'candidates', 'finals', 'partials']) {
      expect(readdirSync(join(app.sandbox, 'private', kind)), kind).toEqual([]);
    }
    const sourceUrl = `/api/room-image-jobs/${final.jobId}/source-preview`;
    expect((await fetch(`${app.base}${sourceUrl}`, { headers: headers() })).status).toBe(410);
    for (const previewUrl of Object.values(final.temporaryVariants) as string[]) {
      expect((await fetch(`${app.base}${previewUrl}`, { headers: headers() })).status).toBe(410);
    }

    const metadataCount = readdirSync(join(app.sandbox, 'jobs'))
      .filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name)).length;
    const callsBeforeExpiredFinal = app.provider.calls.length;
    const expiredFinal = await fetch(`${app.base}/api/room-image-jobs`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        kind: 'variant_set', clientRequestId: '34343434-3434-4343-8343-343434343435',
        parentJobId: main.jobId, candidateId: selected.candidateId,
        focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
        noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
      }),
    });
    expect(expiredFinal.status).toBe(410);
    expect((await expiredFinal.json()).code).toBe('SOURCE_PREVIEW_EXPIRED');
    expect(readdirSync(join(app.sandbox, 'jobs'))
      .filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name))).toHaveLength(metadataCount);
    expect(app.provider.calls).toHaveLength(callsBeforeExpiredFinal);
  }, IMAGE_BUDGET_MS);

  it('inherits a failed jobs absolute deadline into retry and refuses an expired retry source without a successor', async () => {
    let clock = Date.parse('2026-08-08T15:00:00.000Z');
    let failTransport = true;
    const fake = createDeterministicRoomImageFakeProvider();
    const provider = {
      available: true,
      calls: fake.calls,
      probe: fake.probe,
      edit(args: any) {
        if (failTransport) throw new Error('injected initial transport failure');
        return fake.edit(args);
      },
    };
    const app = await start({ now: () => clock, provider });
    const firstResponse = await createMain(app.base, 1, '29292929-2929-4929-8929-292929292929');
    const first = await waitFor(app.base, (await firstResponse.json()).jobId, ['failed']);
    const secondResponse = await createMain(app.base, 1, '30303030-3030-4030-8030-303030303030');
    const second = await waitFor(app.base, (await secondResponse.json()).jobId, ['failed']);
    const firstStored = app.jobStore.get(first.jobId);
    const lineageDeadline = firstStored.expiresAt;
    expect(app.jobStore.get(second.jobId).expiresAt).toBe(lineageDeadline);

    failTransport = false;
    clock = lineageDeadline - 1_000;
    const retryResponse = await fetch(`${app.base}/api/room-image-jobs/${first.jobId}/retry`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        clientRequestId: '31313131-3131-4131-8131-313131313131',
        noticeVersion: 'room-image-v1', costConfirmed: true,
        confirmedProviderCalls: first.retry.requiredProviderCalls,
      }),
    });
    expect(retryResponse.status).toBe(202);
    const successor = await waitFor(app.base, (await retryResponse.json()).jobId, ['succeeded']);
    const successorStored = app.jobStore.get(successor.jobId);
    expect(successorStored.createdAt).toBe(clock);
    expect(successorStored.expiresAt).toBe(lineageDeadline);
    expect((await fetch(`${app.base}/api/room-image-jobs/${successor.jobId}/source-preview`, { headers: headers() })).status).toBe(200);

    clock = lineageDeadline;
    const metadataCount = readdirSync(join(app.sandbox, 'jobs'))
      .filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name)).length;
    const callsBeforeExpiredRetry = provider.calls.length;
    const expiredRetry = await fetch(`${app.base}/api/room-image-jobs/${second.jobId}/retry`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        clientRequestId: '32323232-3232-4232-8232-323232323232',
        noticeVersion: 'room-image-v1', costConfirmed: true,
        confirmedProviderCalls: second.retry.requiredProviderCalls,
      }),
    });
    expect(expiredRetry.status).toBe(410);
    expect((await expiredRetry.json()).code).toBe('RETRY_SOURCE_EXPIRED');
    expect(readdirSync(join(app.sandbox, 'jobs'))
      .filter((name: string) => /^[A-Za-z0-9_-]{43}\.json$/.test(name))).toHaveLength(metadataCount);
    expect(provider.calls).toHaveLength(callsBeforeExpiredRetry);
    expect(app.jobStore.get(second.jobId)).toMatchObject({
      status: 'expired', supersededByJobId: null, retryable: false,
    });
    expect((await fetch(`${app.base}/api/room-image-jobs/${successor.jobId}/source-preview`, { headers: headers() })).status).toBe(410);
    for (const kind of ['sources', 'compositions', 'candidates', 'finals', 'partials']) {
      expect(readdirSync(join(app.sandbox, 'private', kind)), kind).toEqual([]);
    }
  }, IMAGE_BUDGET_MS);

  it('closes source-preview GET and HEAD while a started cancel remains visibly cancelling', async () => {
    const decodeGate = deferred();
    let decodeStarted = false;
    const app = await start({
      provider: {
        available: true,
        async probe() { return { definitiveResponse: true, status: 200 }; },
        async edit() {
          return { definitiveResponse: true, status: 200, image: fixture('provider-portrait.png') };
        },
      },
      runnerOptions: {
        async prepareProviderResult(context: any) {
          decodeStarted = true;
          await decodeGate.promise;
          return context.defaultPrepare();
        },
      },
      serverRunner: ({ jobStore, runner }: { jobStore: any; runner: any }) => ({
        reserve: runner.reserve,
        enqueue: runner.enqueue,
        cancel(jobId: string) {
          const record = jobStore.get(jobId);
          if (record?.status !== 'running') return runner.cancel(jobId);
          jobStore.setJobState(jobId, { status: 'cancelling' });
          return 'cancelling';
        },
      }),
    });
    const mainResponse = await createMain(app.base, 1, '33333333-3333-4333-8333-333333333334');
    const accepted = await mainResponse.json();
    const sourceUrl = `/api/room-image-jobs/${accepted.jobId}/source-preview`;
    try {
      await waitUntil(() => decodeStarted, 'started transport decode before cancel');
      expect((await fetch(`${app.base}${sourceUrl}`, { headers: headers() })).status).toBe(200);
      const cancel = await fetch(`${app.base}/api/room-image-jobs/${accepted.jobId}/cancel`, {
        method: 'POST', headers: headers(),
      });
      expect(cancel.status).toBe(200);
      expect(await cancel.json()).toMatchObject({ status: 'cancelling' });
      const visible = await (await fetch(`${app.base}/api/room-image-jobs/${accepted.jobId}`, { headers: headers() })).json();
      expect(visible.status).toBe('cancelling');

      const get = await fetch(`${app.base}${sourceUrl}`, { headers: headers() });
      expect(get.status).toBe(410);
      expect(get.headers.get('cache-control')).toBe('no-store');
      expect((await get.json()).code).toBe('SOURCE_PREVIEW_EXPIRED');
      const head = await fetch(`${app.base}${sourceUrl}`, { method: 'HEAD', headers: headers() });
      expect(head.status).toBe(410);
      expect(head.headers.get('cache-control')).toBe('no-store');
      expect(await head.text()).toBe('');
    } finally {
      decodeGate.resolve();
    }
    await app.runner.waitForIdle();
    expect(app.jobStore.get(accepted.jobId)).toMatchObject({ status: 'cancelled' });
    for (const kind of ['sources', 'compositions', 'candidates', 'finals', 'partials']) {
      expect(readdirSync(join(app.sandbox, 'private', kind)), kind).toEqual([]);
    }
  }, IMAGE_BUDGET_MS);
});
