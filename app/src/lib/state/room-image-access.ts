export type RoomImageAccessMode = 'api_key' | 'chatgpt';

export interface RoomImageAccessStatus {
  configured: boolean;
  mode: RoomImageAccessMode | null;
  source: 'environment' | 'stored' | null;
}

export interface RoomImageChatGptLogin {
  loginId: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
  intervalSeconds: number;
}

export class RoomImageAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomImageAccessError';
  }
}

async function json(input: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(input, { ...init, credentials: 'same-origin' });
  } catch {
    throw new RoomImageAccessError('Der KI-Zugang ist gerade nicht erreichbar.');
  }
  let payload: any = null;
  try { payload = await response.json(); } catch { /* normalized below */ }
  if (!response.ok) throw new RoomImageAccessError(
    typeof payload?.message === 'string' ? payload.message : 'Der KI-Zugang konnte nicht geändert werden.',
  );
  return payload;
}

function status(value: any): RoomImageAccessStatus {
  if (!value || typeof value !== 'object' || typeof value.configured !== 'boolean'
      || ![null, 'api_key', 'chatgpt'].includes(value.mode)
      || ![null, 'environment', 'stored'].includes(value.source)) {
    throw new RoomImageAccessError('Der Server hat einen ungültigen Zugangsstatus geliefert.');
  }
  return { configured: value.configured, mode: value.mode, source: value.source };
}

export async function getRoomImageAccess(): Promise<RoomImageAccessStatus> {
  return status(await json('/api/room-images/access', { method: 'GET' }));
}

export async function saveRoomImageApiKey(apiKey: string): Promise<RoomImageAccessStatus> {
  return status(await json('/api/room-images/access/api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }),
  }));
}

export async function clearRoomImageAccess(): Promise<RoomImageAccessStatus> {
  return status(await json('/api/room-images/access', { method: 'DELETE' }));
}

export async function startRoomImageChatGptLogin(): Promise<RoomImageChatGptLogin> {
  const value: any = await json('/api/room-images/access/chatgpt/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!value || typeof value.loginId !== 'string' || typeof value.userCode !== 'string'
      || typeof value.verificationUrl !== 'string' || typeof value.expiresAt !== 'string'
      || !Number.isFinite(value.intervalSeconds)) {
    throw new RoomImageAccessError('OpenAI hat keinen gültigen Anmeldecode geliefert.');
  }
  return value;
}

export async function pollRoomImageChatGptLogin(loginId: string): Promise<'pending' | 'connected'> {
  const value: any = await json('/api/room-images/access/chatgpt/poll', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId }),
  });
  if (!value || !['pending', 'connected'].includes(value.status)) {
    throw new RoomImageAccessError('Der ChatGPT-Anmeldestatus ist ungültig.');
  }
  return value.status;
}
