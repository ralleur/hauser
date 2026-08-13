import { describe, expect, it } from 'vitest';
import type { RoomImageJob } from '../../state/room-image-client.ts';
import {
  projectRoomImageCrop,
  roomImagePhaseLabel,
  snapRoomImageCrop,
  viewForRoomImageJob,
} from './room-image-wizard-ui.ts';

const JOB_ID = 'J'.repeat(43);
const UUID = '123e4567-e89b-42d3-a456-426614174000';
const ATTEMPT_ID = 'A'.repeat(43);
const LINEAGE_ID = 'L'.repeat(43);

function counters() {
  return { plannedCount: 3, startedCount: 1, completedCount: 1, outcomeUnknownCount: 0 };
}

function job(overrides: Partial<RoomImageJob> = {}): RoomImageJob {
  return {
    jobId: JOB_ID,
    kind: 'main_candidates',
    clientRequestId: UUID,
    attemptId: ATTEMPT_ID,
    parentAttemptId: null,
    lineageId: LINEAGE_ID,
    status: 'running',
    phase: 'generating_composition',
    createdAt: '2026-08-13T10:00:00.000Z',
    updatedAt: '2026-08-13T10:00:01.000Z',
    expiresAt: '2026-08-14T10:00:00.000Z',
    cancellable: true,
    retryable: false,
    discardable: false,
    retry: null,
    supersededByJobId: null,
    providerCalls: { attempt: { confirmedCount: 3, ...counters() }, lineage: counters(), wizard: counters() },
    candidates: [],
    asset: null,
    error: null,
    ...overrides,
  };
}

describe('room image wizard UI projection', () => {
  it('projects landscape and portrait sources into an exact 106:75 canonical crop', () => {
    for (const [width, height] of [[4032, 3024], [3024, 4032], [2048, 1449]]) {
      const projection = projectRoomImageCrop(width, height, { zoom: 1.8, centerX: 0.92, centerY: 0.08 });
      const pixels = projection.canonicalCropPixels;
      expect(pixels.width * 75).toBe(pixels.height * 106);
      expect(pixels.x).toBeGreaterThanOrEqual(0);
      expect(pixels.y).toBeGreaterThanOrEqual(0);
      expect(pixels.x + pixels.width).toBeLessThanOrEqual(width);
      expect(pixels.y + pixels.height).toBeLessThanOrEqual(height);
      expect(snapRoomImageCrop(width, height, projection.crop)).toEqual(pixels);
    }
  });

  it('maps only server job state to progress, candidate, set-review, done or terminal views', () => {
    expect(viewForRoomImageJob(job())).toBe('job-progress');
    expect(roomImagePhaseLabel(job())).toBe('Komposition wird optimiert');
    expect(viewForRoomImageJob(job({ status: 'succeeded', phase: 'complete', candidates: [] }))).toBe('candidates');
    expect(viewForRoomImageJob(job({
      kind: 'variant_set', status: 'awaiting_confirmation', phase: 'awaiting_confirmation',
      temporaryVariants: { light: '/light', dark: '/dark', darkOff: '/dark-off' },
      focus: { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } },
    }))).toBe('set-review');
    expect(viewForRoomImageJob(job({ kind: 'variant_set', status: 'succeeded', phase: 'complete' }))).toBe('done');
    expect(viewForRoomImageJob(job({ status: 'failed', phase: 'complete', error: { code: 'FAILED', message: 'Fehler' } }))).toBe('terminal');
  });
});
