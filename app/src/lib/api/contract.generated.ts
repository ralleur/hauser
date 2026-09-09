/* GENERIERT aus server/api-contract.mjs — nicht von Hand ändern.
   Neu erzeugen mit: node scripts/generate-api-contract.mjs */

import type { AppFileListResponse, AppStatesResponse, BuildInfoResponse, HaConnectionResponse, HealthResponse, HouseholdConfigModeResponse, MomentsResponse, NotificationRulesResponse, PairingClaimResponse, PairingDevicesResponse, PairingStartResponse, RemindersResponse, RemoteStatusResponse, SharedConfigResponse, ShoppingResponse } from './types.ts';

export const API_CONTRACT_VERSION = 1;

export type ApiMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ApiAccess = 'public' | 'origin' | 'admin' | 'session' | 'guest';

export const API_ROUTES = {
  health: { methods: ['GET'], path: '/api/health', area: 'core', access: 'public' },
  buildInfo: { methods: ['GET'], path: '/api/build-info', area: 'core', access: 'public' },
  haConnection: { methods: ['GET'], path: '/api/ha/connection', area: 'core', access: 'origin' },
  haGateway: { methods: ['GET'], path: '/api/websocket', area: 'core', access: 'origin' },
  haCameraProxy: { methods: ['GET'], path: '/api/camera_proxy/:entityId', area: 'core', access: 'origin' },
  haCameraProxyStream: { methods: ['GET'], path: '/api/camera_proxy_stream/:entityId', area: 'core', access: 'origin' },
  haCaldavFlow: { methods: ['POST'], path: '/api/ha/caldav-flow', area: 'core', access: 'origin' },
  config: { methods: ['GET', 'PUT'], path: '/api/config', area: 'config', access: 'origin' },
  householdConfigMode: { methods: ['GET'], path: '/api/household-config-mode', area: 'config', access: 'origin' },
  householdConfig: { methods: ['GET', 'HEAD'], path: '/api/household-config', area: 'config', access: 'origin' },
  householdModuleToggle: { methods: ['PUT'], path: '/api/household-modules/:moduleId', area: 'config', access: 'origin' },
  householdEnergy: { methods: ['PUT'], path: '/api/household-energy', area: 'config', access: 'origin' },
  householdEnergyMarks: { methods: ['PUT'], path: '/api/household-energy-marks', area: 'config', access: 'origin' },
  setupDiscovery: { methods: ['GET'], path: '/api/setup/discovery', area: 'setup', access: 'origin' },
  setupActivate: { methods: ['POST'], path: '/api/setup/activate', area: 'setup', access: 'origin' },
  notificationRules: { methods: ['GET', 'PUT'], path: '/api/notifications/rules', area: 'notifications', access: 'origin' },
  laundryExistingValidate: { methods: ['POST'], path: '/api/laundry/existing/validate', area: 'laundry', access: 'origin' },
  laundryExistingApply: { methods: ['POST'], path: '/api/laundry/existing/apply', area: 'laundry', access: 'origin' },
  laundryBlueprintPreview: { methods: ['POST'], path: '/api/laundry/blueprint/preview', area: 'laundry', access: 'origin' },
  laundryBlueprintApply: { methods: ['POST'], path: '/api/laundry/blueprint/apply', area: 'laundry', access: 'origin' },
  laundryDisablePreview: { methods: ['POST'], path: '/api/laundry/disable/preview', area: 'laundry', access: 'origin' },
  laundryDisableApply: { methods: ['POST'], path: '/api/laundry/disable/apply', area: 'laundry', access: 'origin' },
  reminders: { methods: ['GET', 'POST'], path: '/api/reminders', area: 'family', access: 'origin' },
  reminderComplete: { methods: ['POST'], path: '/api/reminders/:id/complete', area: 'family', access: 'origin' },
  reminderUpdate: { methods: ['PATCH'], path: '/api/reminders/:id', area: 'family', access: 'origin' },
  shopping: { methods: ['GET'], path: '/api/shopping', area: 'family', access: 'origin' },
  shoppingItems: { methods: ['POST'], path: '/api/shopping/items', area: 'family', access: 'origin' },
  shoppingItemUpdate: { methods: ['PATCH'], path: '/api/shopping/items/:id', area: 'family', access: 'origin' },
  shoppingStores: { methods: ['POST'], path: '/api/shopping/stores', area: 'family', access: 'origin' },
  shoppingStoreDelete: { methods: ['DELETE'], path: '/api/shopping/stores/:storeId', area: 'family', access: 'origin' },
  shoppingHaList: { methods: ['POST'], path: '/api/shopping/ha-list', area: 'family', access: 'origin' },
  shoppingNotion: { methods: ['GET'], path: '/api/shopping/notion', area: 'family', access: 'origin' },
  shoppingNotionItems: { methods: ['POST'], path: '/api/shopping/notion/items', area: 'family', access: 'origin' },
  shoppingNotionItemUpdate: { methods: ['PATCH'], path: '/api/shopping/notion/items/:id', area: 'family', access: 'origin' },
  weather: { methods: ['GET'], path: '/api/weather', area: 'family', access: 'origin' },
  moments: { methods: ['GET'], path: '/api/moments', area: 'family', access: 'origin' },
  roomImageCapability: { methods: ['GET', 'HEAD'], path: '/api/room-images/capability', area: 'room-images', access: 'origin' },
  roomImageCapabilityDetails: { methods: ['GET', 'HEAD'], path: '/api/room-images/capability/details', area: 'room-images', access: 'admin' },
  roomImageProbe: { methods: ['POST'], path: '/api/room-images/probe', area: 'room-images', access: 'admin' },
  roomImageAccess: { methods: ['GET', 'DELETE'], path: '/api/room-images/access', area: 'room-images', access: 'admin' },
  roomImageAccessApiKey: { methods: ['POST'], path: '/api/room-images/access/api-key', area: 'room-images', access: 'admin' },
  roomImageAccessChatGptStart: { methods: ['POST'], path: '/api/room-images/access/chatgpt/start', area: 'room-images', access: 'admin' },
  roomImageAccessChatGptPoll: { methods: ['POST'], path: '/api/room-images/access/chatgpt/poll', area: 'room-images', access: 'admin' },
  roomImageUploads: { methods: ['POST'], path: '/api/room-image-uploads', area: 'room-images', access: 'admin' },
  roomImageUploadDelete: { methods: ['DELETE'], path: '/api/room-image-uploads/:uploadId', area: 'room-images', access: 'admin' },
  roomImageJobs: { methods: ['POST'], path: '/api/room-image-jobs', area: 'room-images', access: 'admin' },
  roomImageJob: { methods: ['GET'], path: '/api/room-image-jobs/:jobId', area: 'room-images', access: 'admin' },
  roomImageJobPublish: { methods: ['POST'], path: '/api/room-image-jobs/:jobId/publish', area: 'room-images', access: 'admin' },
  roomImageJobRetry: { methods: ['POST'], path: '/api/room-image-jobs/:jobId/retry', area: 'room-images', access: 'admin' },
  roomImageJobDiscard: { methods: ['POST'], path: '/api/room-image-jobs/:jobId/discard', area: 'room-images', access: 'admin' },
  roomImageJobCancel: { methods: ['POST'], path: '/api/room-image-jobs/:jobId/cancel', area: 'room-images', access: 'admin' },
  roomImageJobSourcePreview: { methods: ['GET', 'HEAD'], path: '/api/room-image-jobs/:jobId/source-preview', area: 'room-images', access: 'admin' },
  roomImageJobCandidatePreview: { methods: ['GET', 'HEAD'], path: '/api/room-image-jobs/:jobId/previews/:candidateId', area: 'room-images', access: 'admin' },
  roomImageJobFinalPreview: { methods: ['GET', 'HEAD'], path: '/api/room-image-jobs/:jobId/final-previews/:variant', area: 'room-images', access: 'admin' },
  roomImageAssets: { methods: ['GET'], path: '/api/room-image-assets', area: 'room-images', access: 'origin' },
  roomImageOvercast: { methods: ['POST'], path: '/api/room-image-assets/:assetId/overcast', area: 'room-images', access: 'admin' },
  roomImageRegions: { methods: ['POST'], path: '/api/room-image-assets/:assetId/regions', area: 'room-images', access: 'admin' },
  roomImageAssetDelete: { methods: ['DELETE'], path: '/api/room-image-assets/:assetId', area: 'room-images', access: 'admin' },
  roomImageAssignment: { methods: ['PUT'], path: '/api/room-image-assignments/:roomId', area: 'room-images', access: 'admin' },
  roomBackground: { methods: ['POST', 'DELETE'], path: '/api/room-backgrounds/:roomId', area: 'room-images', access: 'admin' },
  roomImageAssignmentLegacy: { methods: ['PUT'], path: '/api/rooms/:roomId/room-image-assignment', area: 'room-images', access: 'admin' },
  ambientMap: { methods: ['GET', 'HEAD'], path: '/api/ambient-map', area: 'ambient', access: 'public' },
  ambientMapAdmin: { methods: ['GET', 'HEAD'], path: '/api/admin/ambient-map', area: 'ambient', access: 'admin' },
  ambientMapLocation: { methods: ['PUT', 'DELETE'], path: '/api/admin/ambient-map/location', area: 'ambient', access: 'admin' },
  ambientMapSearch: { methods: ['GET'], path: '/api/admin/ambient-map/search', area: 'ambient', access: 'admin' },
  ambientMapRegenerate: { methods: ['POST'], path: '/api/admin/ambient-map/regenerate', area: 'ambient', access: 'admin' },
  hotelSession: { methods: ['GET'], path: '/api/hotel-mode/session', area: 'hotel', access: 'guest' },
  hotelStatus: { methods: ['GET'], path: '/api/hotel-mode/status', area: 'hotel', access: 'guest' },
  hotelEntities: { methods: ['GET'], path: '/api/hotel-mode/entities', area: 'hotel', access: 'guest' },
  hotelCommand: { methods: ['POST'], path: '/api/hotel-mode/command', area: 'hotel', access: 'guest' },
  hotelCheckout: { methods: ['POST'], path: '/api/hotel-mode/checkout', area: 'hotel', access: 'guest' },
  hotelActivation: { methods: ['GET'], path: '/api/hotel-mode/activation', area: 'hotel', access: 'admin' },
  hotelSettings: { methods: ['GET', 'PUT'], path: '/api/hotel-mode/settings', area: 'hotel', access: 'admin' },
  hotelStay: { methods: ['GET'], path: '/api/hotel-mode/stay', area: 'hotel', access: 'admin' },
  hotelOverride: { methods: ['POST'], path: '/api/hotel-mode/override', area: 'hotel', access: 'admin' },
  hotelPin: { methods: ['POST'], path: '/api/hotel-mode/pin', area: 'hotel', access: 'admin' },
  hotelUnlock: { methods: ['POST'], path: '/api/hotel-mode/unlock', area: 'hotel', access: 'guest' },
  hotelLock: { methods: ['POST'], path: '/api/hotel-mode/lock', area: 'hotel', access: 'guest' },
  pairingStart: { methods: ['POST'], path: '/api/pairing/start', area: 'app', access: 'origin' },
  pairingClaim: { methods: ['POST'], path: '/api/pairing/claim', area: 'app', access: 'public' },
  pairingDevices: { methods: ['GET'], path: '/api/pairing/devices', area: 'app', access: 'origin' },
  pairingDeviceRevoke: { methods: ['DELETE', 'PATCH'], path: '/api/pairing/devices/:deviceId', area: 'app', access: 'origin' },
  appPersons: { methods: ['GET'], path: '/api/app/persons', area: 'app', access: 'origin' },
  appBundle: { methods: ['GET', 'HEAD'], path: '/api/app/bundle', area: 'app', access: 'origin' },
  remoteStatus: { methods: ['GET'], path: '/api/remote', area: 'app', access: 'origin' },
  remoteReset: { methods: ['POST'], path: '/api/remote/reset', area: 'app', access: 'origin' },
  appCommand: { methods: ['POST'], path: '/api/app/command', area: 'app', access: 'origin' },
  appStates: { methods: ['GET'], path: '/api/app/states', area: 'app', access: 'origin' },
  appManifest: { methods: ['GET', 'HEAD'], path: '/api/app/manifest', area: 'app', access: 'origin' },
  appHero: { methods: ['GET', 'HEAD'], path: '/api/app/hero/:roomId/:variant', area: 'app', access: 'origin' },
  hotelTouch: { methods: ['POST'], path: '/api/hotel-mode/touch', area: 'hotel', access: 'guest' },
  ablageStatus: { methods: ['GET'], path: '/api/ablage/status', area: 'ablage', access: 'origin' },
  ablageUnlock: { methods: ['POST'], path: '/api/ablage/unlock', area: 'ablage', access: 'origin' },
  ablageLock: { methods: ['POST'], path: '/api/ablage/lock', area: 'ablage', access: 'origin' },
  ablageDocuments: { methods: ['GET'], path: '/api/ablage/documents', area: 'ablage', access: 'session' },
  ablageDocumentImport: { methods: ['POST'], path: '/api/ablage/documents/import', area: 'ablage', access: 'session' },
  ablageTasks: { methods: ['GET'], path: '/api/ablage/tasks', area: 'ablage', access: 'session' },
  ablageDocumentFile: { methods: ['GET'], path: '/api/ablage/documents/:documentId/:kind', area: 'ablage', access: 'session' },
  songsHealth: { methods: ['GET'], path: '/api/songs/health', area: 'songs', access: 'origin' },
  songsGenerate: { methods: ['POST'], path: '/api/songs/generate', area: 'songs', access: 'origin' },
  songsStatus: { methods: ['POST'], path: '/api/songs/status', area: 'songs', access: 'origin' },
  songsAudio: { methods: ['GET'], path: '/api/songs/audio', area: 'songs', access: 'origin' },
  songsLibrary: { methods: ['GET', 'POST'], path: '/api/songs/library', area: 'songs', access: 'origin' },
  songsLibraryItem: { methods: ['PATCH', 'DELETE'], path: '/api/songs/library/:songId', area: 'songs', access: 'origin' },
  songsLibraryAudio: { methods: ['GET', 'HEAD'], path: '/api/songs/library/:songId/audio', area: 'songs', access: 'origin' },
} as const;

export type ApiRouteId = keyof typeof API_ROUTES;
export type ApiRoutePath<Id extends ApiRouteId> = (typeof API_ROUTES)[Id]['path'];

/** Antworttypen der Leserouten; Routen ohne Eintrag liefern `unknown`. */
export interface ApiResponses {
  health: HealthResponse;
  buildInfo: BuildInfoResponse;
  haConnection: HaConnectionResponse;
  config: SharedConfigResponse;
  householdConfigMode: HouseholdConfigModeResponse;
  notificationRules: NotificationRulesResponse;
  reminders: RemindersResponse;
  shopping: ShoppingResponse;
  shoppingNotion: ShoppingResponse;
  moments: MomentsResponse;
  pairingStart: PairingStartResponse;
  pairingClaim: PairingClaimResponse;
  pairingDevices: PairingDevicesResponse;
  appBundle: AppFileListResponse;
  remoteStatus: RemoteStatusResponse;
  appStates: AppStatesResponse;
  appManifest: AppFileListResponse;
}

export type ApiResponse<Id extends ApiRouteId> = Id extends keyof ApiResponses ? ApiResponses[Id] : unknown;
