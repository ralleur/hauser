import type {
  RoomImageCanonicalCropPixels,
  RoomImageCrop,
  RoomImageFocus,
  RoomImageJob,
} from '../../state/room-image-client.ts';

const CROP_RATIO_WIDTH = 106;
const CROP_RATIO_HEIGHT = 75;
const TARGET_RATIO = CROP_RATIO_WIDTH / CROP_RATIO_HEIGHT;

export type RoomImageWizardView =
  | 'upload'
  | 'job-progress'
  | 'candidates'
  | 'set-review'
  | 'done'
  | 'terminal';

export interface CropControls {
  zoom: number;
  centerX: number;
  centerY: number;
}

export interface CropProjection {
  crop: RoomImageCrop;
  canonicalCropPixels: RoomImageCanonicalCropPixels;
  backgroundSize: string;
  backgroundPosition: string;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function projectRoomImageCrop(
  imageWidth: number,
  imageHeight: number,
  controls: CropControls,
): CropProjection {
  if (!Number.isInteger(imageWidth) || !Number.isInteger(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error('Ungültige Bildabmessungen.');
  }

  const zoom = clamp(controls.zoom, 1, 3);
  const sourceRatio = imageWidth / imageHeight;
  const baseWidth = sourceRatio >= TARGET_RATIO ? TARGET_RATIO / sourceRatio : 1;
  const baseHeight = sourceRatio >= TARGET_RATIO ? 1 : sourceRatio / TARGET_RATIO;
  const width = baseWidth / zoom;
  const height = baseHeight / zoom;
  const centerX = clamp(controls.centerX, width / 2, 1 - width / 2);
  const centerY = clamp(controls.centerY, height / 2, 1 - height / 2);
  const crop: RoomImageCrop = {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };

  const canonical = snapRoomImageCrop(imageWidth, imageHeight, crop);
  const backgroundPositionX = width === 1 ? 50 : (crop.x / (1 - width)) * 100;
  const backgroundPositionY = height === 1 ? 50 : (crop.y / (1 - height)) * 100;
  return {
    crop,
    canonicalCropPixels: canonical,
    backgroundSize: `${100 / width}% ${100 / height}%`,
    backgroundPosition: `${backgroundPositionX}% ${backgroundPositionY}%`,
  };
}

export function snapRoomImageCrop(
  imageWidth: number,
  imageHeight: number,
  crop: RoomImageCrop,
): RoomImageCanonicalCropPixels {
  const requestedWidth = crop.width * imageWidth;
  const requestedHeight = crop.height * imageHeight;
  const maxK = Math.min(
    Math.floor(imageWidth / CROP_RATIO_WIDTH),
    Math.floor(imageHeight / CROP_RATIO_HEIGHT),
  );
  if (maxK < 1) throw new Error('Das Bild ist zu klein.');

  let selectedK = 1;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (let k = 1; k <= maxK; k += 1) {
    const distance = Math.abs(CROP_RATIO_WIDTH * k - requestedWidth)
      + Math.abs(CROP_RATIO_HEIGHT * k - requestedHeight);
    if (distance < selectedDistance || (distance === selectedDistance && k > selectedK)) {
      selectedK = k;
      selectedDistance = distance;
    }
  }

  const width = CROP_RATIO_WIDTH * selectedK;
  const height = CROP_RATIO_HEIGHT * selectedK;
  const centerX = (crop.x + crop.width / 2) * imageWidth;
  const centerY = (crop.y + crop.height / 2) * imageHeight;
  return {
    x: clamp(Math.floor(centerX - width / 2 + 0.5), 0, imageWidth - width),
    y: clamp(Math.floor(centerY - height / 2 + 0.5), 0, imageHeight - height),
    width,
    height,
  };
}

export function pointFromPointer(event: PointerEvent): { x: number; y: number } {
  const element = event.currentTarget;
  if (!(element instanceof HTMLElement)) return { x: 0.5, y: 0.5 };
  const rect = element.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

export function initialRoomImageFocus(): RoomImageFocus {
  return { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } };
}

export function viewForRoomImageJob(job: RoomImageJob): RoomImageWizardView {
  if (job.kind === 'main_candidates' && job.status === 'succeeded') return 'candidates';
  if (job.kind === 'variant_set' && job.status === 'awaiting_confirmation') return 'set-review';
  if (job.kind === 'variant_set' && job.status === 'succeeded') return 'done';
  if (['queued', 'running', 'cancelling'].includes(job.status)) return 'job-progress';
  return 'terminal';
}

export function roomImagePhaseLabel(job: RoomImageJob): string {
  const labels: Record<RoomImageJob['phase'], string> = {
    queued: 'Auftrag wartet',
    generating_composition: 'Komposition wird optimiert',
    generating_style_1: 'Erste Stilvariante wird erstellt',
    generating_style_2: 'Zweite Stilvariante wird erstellt',
    generating_dark: 'Nachtvariante mit Licht wird erstellt',
    generating_dark_off: 'Nachtvariante ohne Licht wird erstellt',
    validating_set: 'Bildset wird geprüft',
    awaiting_confirmation: 'Bildset wartet auf deine Prüfung',
    publishing_set: 'Bildset wird übernommen',
    complete: 'Fertig',
  };
  return labels[job.phase];
}
