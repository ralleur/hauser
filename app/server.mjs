import { existsSync, renameSync } from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createHaSupervisorClient,
  parseHaConnectionMode,
  readHaDiscoverySnapshot,
  redactSupervisorToken,
} from './server/ha-supervisor.mjs';
import { createHaWebSocketGateway } from './server/ha-gateway.mjs';
import { createAmbientMapService } from './server/ambient-map-service.mjs';
import { createAmbientMapGeocoder } from './server/ambient-map-geocode.mjs';
import {
  ABLAGE_KEYCHAIN_SERVICE,
  ABLAGE_PIN_ACCOUNT,
  ABLAGE_TOKEN_ACCOUNT,
  ACESTEP_HOST,
  ACESTEP_PORT,
  AI_CUSTOMIZING_ENABLED,
  ALLOWED_ORIGINS,
  AMBIENT_HOST,
  AMBIENT_MAP_SERVER_ASSET_DIRECTORY,
  AMBIENT_MAP_SERVER_CONFIG_PATH,
  AMBIENT_PORT,
  CONFIG_PATH,
  DIST,
  FAMILY_DATA_PATH,
  HA_CONNECTION_MODE,
  HERMES_HOST,
  HERMES_PORT,
  HOST,
  HOTEL_ADMIN_SESSION_MS,
  HOUSEHOLD_CONFIG_MODE_HEADER,
  HOUSEHOLD_CONFIG_PATH,
  LAUNDRY_BLUEPRINT_FILE,
  MOMENTS_STATE_PATH,
  NOTIFICATION_BLUEPRINT_DIR,
  NOTIFICATION_RULES_PATH,
  PAPERLESS_HOST,
  PAPERLESS_PORT,
  PORT,
  REQUIRED_WRITABLE_DIRS,
  PAIRING_DEVICES_PATH,
  REMOTE_URL,
  ROOM_IMAGE_ASSET_ROOT,
  ROOM_IMAGE_CREDENTIAL_PATH,
  ROOM_IMAGE_TEMP_ROOT,
  ROOM_IMAGE_UPLOAD_ROOT,
  ROOM_IMAGE_CODEX_VISION_MODEL,
  ROOM_IMAGE_VISION_MODEL,
  deriveRoomImagePhoneVariants,
} from './server/runtime-env.mjs';
import {
  ambientRequestAllowed,
  configRequestAllowed,
  familyDataRequestAllowed,
  householdConfigRequestAllowed,
  jsonResponse,
  proxy,
  proxyRequestAllowed,
  proxyTargetPath,
  readHermesKey,
  readKeychainSecret,
  requestOriginAllowed,
  serveStatic,
  withReadCache,
} from './server/shared.mjs';
import { matchApiRoute } from './server/api-contract.mjs';
import { runSelfCheck } from './server/self-check.mjs';
import { scheduleNightly } from './server/precompute.mjs';
import { createRuntimeConfig } from './server/runtime-config.mjs';
import { precomputeEnergyWeek } from './server/energy-week.mjs';
import { assetsWithoutRegions, detectRegionsForAsset } from './server/room-image-region-service.mjs';
import { createRoomImageFinisher } from './server/room-image-finishing.mjs';
import { assetsWithoutOvercast, deriveOvercastVariant } from './server/room-image-overcast-service.mjs';
import {
  backfillRoomImagePhoneVariants,
  createOpenAiRoomImageProvider,
  createRoomImageAssetStore,
  createRoomImageAuthConfig,
  roomImageCodexTextHeaders,
  createRoomImageCredentialStore,
  createRoomImageJobRunner,
  createRoomImageJobStore,
  createRoomImageProviderBoundary,
  createRoomImageProviderRouter,
  createRoomImageUploadStore,
  serveRoomImages,
  validateRoomImagePreviewBytes,
} from './server/room-images.mjs';
import {
  assessHmiReadiness,
  createCentralConfigStore,
  createConfigMutationCoordinator,
  createHouseholdConfigReader,
  migrateHouseholdConfigFile,
  normalizeHouseholdConfigMode,
  readBuildInfo,
  readRoomImageHouseholdSnapshot,
  recoverSetupConfigTransactions,
  serveBuildInfo,
  serveHmiHealth,
  serveHouseholdConfig,
  serveHouseholdConfigMode,
  serveHouseholdEnergy,
  serveHouseholdModuleToggle,
  setupRecoveryFailure,
  setupRecoveryRequiredError,
} from './server/config-core.mjs';
import { createFamilyDataStore, serveFamilyData } from './server/family-data.mjs';
import { notionShoppingRoute, serveNotionShopping } from './server/shopping-notion.mjs';
import { createMomentsService, MOMENT_HOLIDAYS_CONFIG_KEY, serveMoments } from './server/moments.mjs';
import { createWeatherService, serveWeather } from './server/weather.mjs';
import { authenticateRequest, createDeviceStore, PAIRING_ROUTE_PREFIX, remoteGateAllows, remoteGateReject, servePairing } from './server/pairing.mjs';
import { APP_ROUTE_PREFIX, createFileIndex, serveAppBundle } from './server/app-bundle.mjs';
import {
  haCameraProxyRoute,
  haRestUrl,
  householdModuleMatch,
  purgeHaCredentialsFromSharedConfig,
  resolveServerHaAccess,
  serveConfig,
  serveHaCaldavFlow,
  serveHaTodoListFlow,
  serveHaCameraProxy,
  serveHaConnection,
  serveSetupActivation,
  serveSetupDiscovery,
  setupReadRequestAllowed,
  setupRequestAllowed,
  verifySetupHomeAssistant,
  verifySetupJellyfin,
  verifySetupSupervisorHomeAssistant,
  withSupervisorClient,
} from './server/setup.mjs';
import {
  createHotelActivationPreflight,
  createHotelCalendarClient,
  createHotelCheckoutService,
  createHotelCommandClient,
  createHotelCommandService,
  createHotelEventClient,
  createHotelGuestStateService,
  createHotelModeAdminAccess,
  createHotelModeAdminGate,
  createHotelModeSettingsService,
  createHotelModeStayService,
  createHotelModeStore,
  createHotelStatesClient,
  hotelModeRequestAllowed,
  resolveHotelModeDataPath,
  serveHotelModeSession,
} from './server/hotel-mode.mjs';
import { createLaundryCoordinator, createLaundryHomeAssistantClient, serveLaundry } from './server/laundry.mjs';
import {
  createNotificationError,
  createNotificationRulesStore,
  serveNotifications,
  syncNotificationAutomations,
} from './server/notification-rules.mjs';
import { createSongLibrary, serveSongs, songRequestAllowed, songTargetPath } from './server/songs.mjs';
import { ablageRequestAllowed, createAblageAccess, paperlessUpstream, serveAblage } from './server/ablage.mjs';
import {
  ambientMapAdminRoute,
  ambientMapHomeAssistantConfigured,
  ambientMapNotReady,
  ambientMapPublicRoute,
  proxyAmbient,
  readAmbientMapHomeAssistantLocation,
  serveAmbientMap,
} from './server/ambient-routes.mjs';

/* Öffentliche Serverfläche: die Module unter server/ bleiben über server.mjs
   erreichbar, damit Tests und Werkzeuge ihren Importpfad behalten. */
export { HA_CONNECTION_MODE };
export { staticCacheControl, staticPathFor } from './server/shared.mjs';
export {
  ambientRequestAllowed,
  configRequestAllowed,
  familyDataRequestAllowed,
  householdConfigRequestAllowed,
  proxyRequestAllowed,
  proxyTargetPath,
  requestOriginAllowed,
};
export {
  allowedRoomImageOrigin,
  createChatGptRoomImageProvider,
  createDeterministicRoomImageFakeProvider,
  normalizeRoomImageIdentity,
  parseRoomImageCidr,
  parseRoomImageContentLength,
  readBoundedRoomImageBody,
  roomImagePeerAllowed,
} from './server/room-images.mjs';
export {
  backfillRoomImagePhoneVariants,
  createOpenAiRoomImageProvider,
  createRoomImageAssetStore,
  createRoomImageAuthConfig,
  createRoomImageCredentialStore,
  createRoomImageJobRunner,
  createRoomImageJobStore,
  createRoomImageProviderBoundary,
  createRoomImageProviderRouter,
  createRoomImageUploadStore,
  validateRoomImagePreviewBytes,
};
export {
  assessHmiReadiness,
  createCentralConfigStore,
  createConfigMutationCoordinator,
  createHouseholdConfigReader,
  migrateHouseholdConfigFile,
  normalizeHouseholdConfigMode,
  readBuildInfo,
  readRoomImageHouseholdSnapshot,
  recoverSetupConfigTransactions,
  serveBuildInfo,
  serveHmiHealth,
  serveHouseholdConfig,
  serveHouseholdConfigMode,
};
export { createFamilyDataStore };
export {
  purgeHaCredentialsFromSharedConfig,
  verifySetupHomeAssistant,
  verifySetupJellyfin,
  verifySetupSupervisorHomeAssistant,
};
export {
  hotelAdminCookie,
  hotelAdminOnlyRoute,
  normalizeHotelCalendarEvents,
  normalizeHotelModeDocument,
  readHotelModePolicy,
} from './server/hotel-mode.mjs';
export {
  createHotelActivationPreflight,
  createHotelCalendarClient,
  createHotelCheckoutService,
  createHotelCommandClient,
  createHotelCommandService,
  createHotelEventClient,
  createHotelGuestStateService,
  createHotelModeAdminAccess,
  createHotelModeAdminGate,
  createHotelModeSettingsService,
  createHotelModeStayService,
  createHotelModeStore,
  createHotelStatesClient,
  hotelModeRequestAllowed,
  resolveHotelModeDataPath,
  serveHotelModeSession,
};
export { createLaundryHomeAssistantClient };
export { notificationAutomationSpecs, parseNotificationColors, parseNotificationRules } from './server/notification-rules.mjs';
export { createNotificationRulesStore, syncNotificationAutomations };
export { buildAceSongRequest, buildSongPlanMessages, parseSongPlan } from './server/songs.mjs';
export { createSongLibrary, songRequestAllowed, songTargetPath };
export { paperlessTargetPath } from './server/ablage.mjs';
export { ablageRequestAllowed, createAblageAccess, paperlessUpstream };
export { ambientMapAdminRoute, ambientMapPublicRoute };
export { createHaSupervisorClient, createHaWebSocketGateway, parseHaConnectionMode, readHaDiscoverySnapshot, redactSupervisorToken };

export function createHmiServer(
  key = readHermesKey(),
  {
    upstreamHost = HERMES_HOST,
    upstreamPort = HERMES_PORT,
    aiCustomizingEnabled = AI_CUSTOMIZING_ENABLED,
    ambientHost = AMBIENT_HOST,
    ambientPort = AMBIENT_PORT,
    paperlessHost = PAPERLESS_HOST,
    paperlessPort = PAPERLESS_PORT,
    aceStepHost = ACESTEP_HOST,
    aceStepPort = ACESTEP_PORT,
    songLibrary = null,
    paperlessPin = readKeychainSecret(ABLAGE_PIN_ACCOUNT, ABLAGE_KEYCHAIN_SERVICE),
    paperlessToken = readKeychainSecret(ABLAGE_TOKEN_ACCOUNT, ABLAGE_KEYCHAIN_SERVICE),
    allowedOrigins = ALLOWED_ORIGINS,
    configPath = CONFIG_PATH,
    householdConfigPath = HOUSEHOLD_CONFIG_PATH,
    householdConfigMode = process.env.HMI_HOUSEHOLD_CONFIG_MODE,
    householdConfigMigrationResult = null,
    setupConfigRecoveryResult = null,
    staticRoot = DIST,
    requiredWritableDirs = REQUIRED_WRITABLE_DIRS,
    familyDataPath = FAMILY_DATA_PATH,
    familyData = null,
    setupConnectionVerifier = verifySetupHomeAssistant,
    setupJellyfinVerifier = verifySetupJellyfin,
    haConnectionMode = HA_CONNECTION_MODE,
    haSupervisorClientFactory = createHaSupervisorClient,
    haGatewayFactory = createHaWebSocketGateway,
    setupMutationStep = () => undefined,
    laundryClientFactory = createLaundryHomeAssistantClient,
    laundryReplaceConfig = renameSync,
    laundryNow = () => Date.now(),
    laundrySleep = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 250)),
    laundryBlueprintFile = LAUNDRY_BLUEPRINT_FILE,
    notificationRulesPath = NOTIFICATION_RULES_PATH,
    notificationRulesStore = null,
    notificationSync = null,
    notificationBlueprintDir = NOTIFICATION_BLUEPRINT_DIR,
    momentsStatePath = MOMENTS_STATE_PATH,
    pairingDevicesPath = PAIRING_DEVICES_PATH,
    deviceStore = null,
    remoteUrl = REMOTE_URL,
    momentsService = null,
    weatherService = null,
    configMutationCoordinator = null,
    roomImageAuthConfig = createRoomImageAuthConfig(),
    roomImageUploadRoot = ROOM_IMAGE_UPLOAD_ROOT,
    roomImageNow = () => Date.now(),
    roomImageUploadStore = null,
    roomImageUploadStoreFactory = createRoomImageUploadStore,
    roomImageTestCapability = null,
    roomImageJobRoot = householdConfigPath ? join(dirname(householdConfigPath), 'room-images', 'jobs') : null,
    roomImageTempRoot = ROOM_IMAGE_TEMP_ROOT,
    roomImageJobStore = null,
    roomImageJobStoreFactory = createRoomImageJobStore,
    roomImageProvider = null,
    roomImageProviderFactory = createOpenAiRoomImageProvider,
    roomImageProviderCredential = undefined,
    roomImageFetchImpl = undefined,
    roomImageCredentialStore = null,
    roomImageCredentialStoreFactory = createRoomImageCredentialStore,
    roomImageCredentialPath = ROOM_IMAGE_CREDENTIAL_PATH,
    roomImageJobRunner = null,
    roomImageJobRunnerFactory = createRoomImageJobRunner,
    roomImagePreviewValidator = validateRoomImagePreviewBytes,
    /* B-27 D2: Seam wie beim Preview-Validator — die Ableitung ist echte
       Bildarbeit und in Fixtures ohne dekodierbares AVIF nicht ausfuehrbar. */
    roomImagePhoneDeriver = deriveRoomImagePhoneVariants,
    roomImageAssetRoot = ROOM_IMAGE_ASSET_ROOT,
    roomImageVisionModel = ROOM_IMAGE_VISION_MODEL,
    roomImageCodexVisionModel = ROOM_IMAGE_CODEX_VISION_MODEL,
    roomImageAssetCatalogPath = undefined,
    roomImageAssetStore = null,
    roomImageAssetStoreFactory = createRoomImageAssetStore,
    roomImagePublishStep = () => undefined,
    buildInfo = readBuildInfo(),
    /* Paket 11 (ADR-030): Grenzwerte und Modellname als Objekt statt als
       Modulimport — die Servermodule bekommen sie hereingereicht. */
    runtimeConfig = createRuntimeConfig(),
    hotelModeDataPath = null,
    hotelModeStore = null,
    hotelModeNow = () => Date.now(),
    hotelModeSessionMs = HOTEL_ADMIN_SESSION_MS,
    hotelModeStayService = null,
    hotelCalendarClientFactory = createHotelCalendarClient,
    hotelGuestStateService = null,
    hotelStatesClientFactory = createHotelStatesClient,
    hotelCommandService = null,
    hotelCommandClientFactory = createHotelCommandClient,
    hotelSettingsService = null,
    hotelActivationPreflightService = null,
    hotelCheckoutService = null,
    hotelEventClientFactory = createHotelEventClient,
    /* AMBIENT-MAP S3: vollständig injizierbare Kartenfähigkeit — Service,
       Pfade und der HA-`fetch` des direkten Modus sind Testgrenzen. */
    ambientMapService = null,
    ambientMapGeocode = null,
    ambientMapConfigPath = AMBIENT_MAP_SERVER_CONFIG_PATH,
    ambientMapAssetDirectory = AMBIENT_MAP_SERVER_ASSET_DIRECTORY,
    ambientMapHaFetchImpl = undefined,
    ambientMapJobRunner = null,
  } = {},
) {
  const normalizedHouseholdConfigMode = normalizeHouseholdConfigMode(householdConfigMode);
  const configMutations = configMutationCoordinator ?? createConfigMutationCoordinator();
  const setupRecoveryResult = setupConfigRecoveryResult ?? configMutations.runSync(
    () => recoverSetupConfigTransactions({ configPath, householdConfigPath }),
  );
  let setupRecoveryFailureLatched = !setupRecoveryResult.ok;
  const latchSetupRecoveryFailure = () => { setupRecoveryFailureLatched = true; };
  const assertSetupRecoveryHealthy = () => {
    if (setupRecoveryFailureLatched) throw setupRecoveryRequiredError();
  };
  const migrationResult = !setupRecoveryResult.ok ? setupRecoveryResult : (householdConfigMigrationResult ?? (
    normalizedHouseholdConfigMode === 'active'
      ? configMutations.runSync(() => migrateHouseholdConfigFile(householdConfigPath))
      : { ok: true, status: 'shadow' }
  ));
  const configStore = createCentralConfigStore(configPath, { assertSetupRecoveryHealthy });
  if (haConnectionMode === 'supervisor' && setupRecoveryResult.ok) {
    /* Ab dem ersten Start im App-Modus existiert kein gespeicherter HA-Zugang
       mehr — weder in `/data` noch in einer Antwort an den Browser. */
    try { configMutations.runSync(() => purgeHaCredentialsFromSharedConfig(configStore)); }
    catch (error) { console.warn('[hauser] HA-Credentials konnten nicht entfernt werden:', error?.code ?? error); }
  }
  const householdConfigReader = createHouseholdConfigReader(householdConfigPath);
  const familyStore = familyData || createFamilyDataStore(familyDataPath);
  const ablageAccess = createAblageAccess(
    paperlessPin,
    () => configStore.read()['hmi:paperless-token'] || paperlessToken,
  );
  const hotelStore = hotelModeStore || createHotelModeStore(hotelModeDataPath || resolveHotelModeDataPath(configPath));
  const hotelAdminAccess = createHotelModeAdminAccess(hotelStore, { now: hotelModeNow, sessionMs: hotelModeSessionMs });
  const hotelAdminGate = createHotelModeAdminGate(householdConfigPath, { access: hotelAdminAccess });
  const hotelStays = hotelModeStayService || createHotelModeStayService({
    store: hotelStore,
    configStore,
    connectionMode: haConnectionMode,
    householdConfigPath,
    now: hotelModeNow,
    calendarClientFactory: hotelCalendarClientFactory,
  });
  const hotelGuestStates = hotelGuestStateService || createHotelGuestStateService({
    stays: hotelStays,
    configStore,
    connectionMode: haConnectionMode,
    householdConfigPath,
    now: hotelModeNow,
    statesClientFactory: hotelStatesClientFactory,
  });
  const hotelCommands = hotelCommandService || createHotelCommandService({
    stays: hotelStays,
    guests: hotelGuestStates,
    configStore,
    connectionMode: haConnectionMode,
    householdConfigPath,
    commandClientFactory: hotelCommandClientFactory,
  });
  const hotelActivationPreflight = hotelActivationPreflightService || createHotelActivationPreflight({
    configStore,
    connectionMode: haConnectionMode,
    access: hotelAdminAccess,
    statesClientFactory: hotelStatesClientFactory,
    calendarClientFactory: hotelCalendarClientFactory,
    now: hotelModeNow,
  });
  const hotelSettings = hotelSettingsService || createHotelModeSettingsService({
    householdConfigPath,
    configMutations,
    publishStep: roomImagePublishStep,
    latchSetupRecoveryFailure,
    assertSetupRecoveryHealthy,
    preflight: hotelActivationPreflight,
  });
  const hotelCheckouts = hotelCheckoutService || createHotelCheckoutService({
    stays: hotelStays,
    store: hotelStore,
    guests: hotelGuestStates,
    configStore,
    connectionMode: haConnectionMode,
    householdConfigPath,
    now: hotelModeNow,
    eventClientFactory: hotelEventClientFactory,
    commandClientFactory: hotelCommandClientFactory,
  });
  const library = songLibrary || createSongLibrary();
  const roomImageUploads = setupRecoveryResult.ok ? (roomImageUploadStore || roomImageUploadStoreFactory({
    root: roomImageUploadRoot, now: roomImageNow, assertSetupRecoveryHealthy,
  })) : null;
  const roomImageJobs = setupRecoveryResult.ok ? (roomImageJobStore || (roomImageJobRoot && roomImageAuthConfig?.configured
    ? roomImageJobStoreFactory({
      metadataRoot: roomImageJobRoot, tempRoot: roomImageTempRoot, now: roomImageNow,
      transactionStep: roomImagePublishStep, assertSetupRecoveryHealthy,
    })
    : null)) : null;
  const resolvedRoomImageCredentialStore = roomImageCredentialStore || roomImageCredentialStoreFactory({
    path: roomImageCredentialPath,
    environmentApiKey: roomImageProviderCredential !== undefined
      ? roomImageProviderCredential
      : process.env.NODE_ENV === 'test' ? '' : process.env.HMI_OPENAI_API_KEY,
    fetchImpl: roomImageFetchImpl,
    now: roomImageNow,
  });
  let resolvedRoomImageProvider = roomImageProvider;
  if (!roomImageJobRunner && roomImageJobs && !resolvedRoomImageProvider) {
    resolvedRoomImageProvider = roomImageProviderFactory === createOpenAiRoomImageProvider
      ? createRoomImageProviderRouter({ credentialStore: resolvedRoomImageCredentialStore, fetchImpl: roomImageFetchImpl })
      : roomImageProviderFactory({
        credential: resolvedRoomImageCredentialStore.current()?.apiKey,
        credentialStore: resolvedRoomImageCredentialStore,
        fetchImpl: roomImageFetchImpl,
      });
  }
  const roomImageRunner = setupRecoveryResult.ok ? (roomImageJobRunner || (roomImageJobs
    ? roomImageJobRunnerFactory({
      store: roomImageJobs, provider: resolvedRoomImageProvider || createRoomImageProviderBoundary(), assertSetupRecoveryHealthy,
    })
    : null)) : null;
  const roomImageProbeState = {
    credentialConfigured: resolvedRoomImageCredentialStore.status().configured,
    imageCapability: 'disabled',
    probe: { modelVisible: false, checkedAt: null },
  };
  const resolvedRoomImageAssetCatalogPath = roomImageAssetCatalogPath === undefined
    ? (householdConfigPath ? join(dirname(householdConfigPath), 'room-images', 'assets.json') : null)
    : roomImageAssetCatalogPath;
  let roomImageAssets = null;
  if (setupRecoveryResult.ok) {
    roomImageAssets = roomImageAssetStore || (resolvedRoomImageAssetCatalogPath
        && (roomImageJobs || roomImageAssetCatalogPath !== undefined || existsSync(resolvedRoomImageAssetCatalogPath)
          || roomImageAssetRoot !== '/assets' || existsSync(roomImageAssetRoot))
      ? roomImageAssetStoreFactory({
        catalogPath: resolvedRoomImageAssetCatalogPath, assetRoot: roomImageAssetRoot,
        now: roomImageNow, transactionStep: roomImagePublishStep, assertSetupRecoveryHealthy,
      })
      : null);
  } else if (resolvedRoomImageAssetCatalogPath && existsSync(resolvedRoomImageAssetCatalogPath)) {
    try {
      roomImageAssets = roomImageAssetStoreFactory({
        catalogPath: resolvedRoomImageAssetCatalogPath, assetRoot: roomImageAssetRoot,
        now: roomImageNow, transactionStep: roomImagePublishStep, readOnly: true,
        assertSetupRecoveryHealthy: () => undefined,
      });
    } catch { roomImageAssets = null; }
  }
  if (setupRecoveryResult.ok && roomImageJobs && roomImageAssets) {
    configMutations.runSync(() => {
      for (const record of roomImageJobs.records().filter((candidate) => candidate.phase === 'publishing_set')) {
        const recovery = roomImageAssets.recoveryState(record.reservedAssetId);
        if (recovery.type === 'complete') roomImageJobs.finishPublish(record.jobId, recovery.asset);
        else roomImageJobs.failPublish(record.jobId, recovery.type === 'required' ? 'PUBLISH_RECOVERY_REQUIRED' : 'PUBLISH_FAILED');
      }
      const retainedReservations = new Set(roomImageJobs.records()
        .map((record) => record.reservedAssetId).filter(Boolean));
      roomImageAssets.cleanupOrphans(retainedReservations);
    });
  }
  /* Fenstererkennung (Paket 13): ein Sehmodell sagt einmal pro Bildset, wo die
     Fenster sind. Der Zugang ist derselbe wie für die Bildgenerierung; das
     Modell steht in der Umgebung, damit ein Konto mit neuerem Angebot nicht auf
     einen Neubau warten muss. */
  /* Beide Anmeldearten können sehen (Paket 13):
     — API-Schlüssel: `chat/completions` bei OpenAI.
     — ChatGPT-Anmeldung: die Responses-API des Codex-Backends, mit denselben
       Kopfzeilen wie die Bildgenerierung. Dieselbe Anmeldung, ein anderer
       Endpunkt; Hermes macht es für `openai-codex` genauso. */
  const detectRegionsForRoomImage = async (assetId) => {
    const credential = resolvedRoomImageCredentialStore?.current?.();
    if (!credential) return { ok: false, code: 'PROVIDER_CREDENTIAL_MISSING' };
    if (credential.mode === 'chatgpt') {
      const token = await resolvedRoomImageCredentialStore.chatGptAccessToken().catch(() => null);
      if (!token) return { ok: false, code: 'PROVIDER_CREDENTIAL_INVALID' };
      return detectRegionsForAsset(assetId, {
        assetStore: roomImageAssets,
        credential: token,
        mode: 'chatgpt',
        model: roomImageCodexVisionModel,
        headers: roomImageCodexTextHeaders(token),
        fetchImpl: roomImageFetchImpl,
        now: roomImageNow,
      });
    }
    return detectRegionsForAsset(assetId, {
      assetStore: roomImageAssets,
      credential: credential.apiKey ?? '',
      model: roomImageVisionModel,
      fetchImpl: roomImageFetchImpl,
      now: roomImageNow,
    });
  };

  /* Trübe Bildvariante (Paket 13): ein weiterer Anbieteraufruf aus dem fertigen
     Tagbild. Läuft über denselben Provider wie die Generierung — also auch mit
     der ChatGPT-Anmeldung, anders als die Fenstererkennung. */
  const deriveOvercastForRoomImage = async (assetId) => deriveOvercastVariant(assetId, {
    assetStore: roomImageAssets,
    provider: resolvedRoomImageProvider,
  });

  /* Feinschliff frisch veröffentlichter Bildsets (Paket 13): Flächenerkennung
     und trübe Variante laufen direkt nach dem Wizard, damit ein neues Set
     vollständig ist, ohne auf den nächtlichen Nachzug zu warten. Die beiden
     Aufrufe stehen in einer Kette — mehrere Räume hintereinander erzeugen so
     keine Parallelaufrufe beim Anbieter. */
  const roomImageFinisher = createRoomImageFinisher({
    assetStore: roomImageAssets,
    detectRegions: detectRegionsForRoomImage,
    deriveOvercast: deriveOvercastForRoomImage,
    now: roomImageNow,
  });

  /* Selbstprüfung beim Start (Paket 11): einmal den Katalog gegen den
     Assetroot halten. Ein fehlendes Bildset ist eine Warnung im Health-Payload
     — der Dienst startet trotzdem. */
  const startupSelfCheck = runSelfCheck({
    roomImages: {
      catalogPath: resolvedRoomImageAssetCatalogPath,
      assetRoot: roomImageAssetRoot,
    },
  });
  if (!startupSelfCheck.ok) {
    console.warn(
      '[hauser] Selbstprüfung: %d Datei(en) fehlen im Assetroot, z. B. %s',
      startupSelfCheck.roomImages.missing.length,
      startupSelfCheck.roomImages.missing[0],
    );
  }

  /* Nächtliche Vorberechnung (Paket 11): Stadtplan, Phone-Ableitungen und die
     Energiestatistik der Vorwoche entstehen um 03:30, nicht beim ersten Blick
     aufs Panel. Jede Aufgabe darf fehlschlagen, ohne die anderen mitzureißen;
     das Ergebnis steht im Health-Payload. */
  let lastPrecompute = null;
  const precomputeTasks = [
    {
      name: 'ambient-map',
      run: async () => {
        if (!ambientMap) return { status: 'skipped', reason: 'not-configured' };
        try { ambientMap.regenerate(); } catch { return { status: 'skipped', reason: 'no-location' }; }
        return { status: 'scheduled' };
      },
    },
    {
      name: 'phone-variants',
      run: async () => {
        if (!resolvedRoomImageAssetCatalogPath) return { status: 'skipped', reason: 'no-catalog' };
        const result = await backfillRoomImagePhoneVariants({
          catalogPath: resolvedRoomImageAssetCatalogPath,
          assetRoot: roomImageAssetRoot,
          derive: roomImagePhoneDeriver,
        });
        return { status: result.status ?? 'done', migrated: result.migrated.length, failed: result.failed.length };
      },
    },
    {
      /* Paket 13: eine trübe Variante pro Nacht. Sie kostet eine Generierung,
         also bewusst noch sparsamer als die Fenstererkennung. */
      name: 'room-image-overcast',
      run: async () => {
        const [assetId] = assetsWithoutOvercast(roomImageAssets);
        if (!assetId) return { status: 'skipped', reason: 'nothing-pending' };
        const result = await deriveOvercastForRoomImage(assetId);
        return result.ok ? { status: result.status, assetId } : { status: 'failed', reason: result.code };
      },
    },
    {
      /* Paket 13: Bildsets ohne Flächenangaben nachziehen — höchstens drei pro
         Nacht, damit ein großer Bestand nicht in einem Rutsch Geld kostet. */
      name: 'room-image-regions',
      run: async () => {
        const pending = assetsWithoutRegions(roomImageAssets).slice(0, 3);
        if (pending.length === 0) return { status: 'skipped', reason: 'nothing-pending' };
        let detected = 0;
        for (const assetId of pending) {
          const result = await detectRegionsForRoomImage(assetId);
          if (result.ok) detected += 1;
          else if (result.code === 'PROVIDER_CREDENTIAL_MISSING') {
            return { status: 'skipped', reason: 'no-credential' };
          }
        }
        return { status: 'done', detected, pending: pending.length };
      },
    },
    {
      name: 'energy-week',
      run: async () => precomputeEnergyWeek({
        access: resolveServerHaAccess(configStore, haConnectionMode),
        document: householdConfigPath ? readRoomImageHouseholdSnapshot(householdConfigPath).document : null,
        targetPath: householdConfigPath
          ? join(dirname(householdConfigPath), 'precomputed', 'energy-week.json')
          : null,
        haRestUrl,
      }),
    },
  ];
  const stopNightly = scheduleNightly(precomputeTasks, {
    onResult: (result) => { lastPrecompute = result; },
  });

  const roomImagePublishFlights = new Map();
  const laundry = createLaundryCoordinator({
    configStore,
    connectionMode: haConnectionMode,
    householdConfigPath,
    clientFactory: laundryClientFactory,
    replaceConfig: laundryReplaceConfig,
    now: laundryNow,
    sleep: laundrySleep,
    blueprintFile: laundryBlueprintFile,
    configMutations,
    assertSetupRecoveryHealthy,
  });
  const notificationsService = {
    store: notificationRulesStore ?? createNotificationRulesStore(notificationRulesPath),
    async sync(rules) {
      if (notificationSync) return notificationSync(rules);
      const credentials = resolveServerHaAccess(configStore, haConnectionMode);
      if (!credentials) {
        throw createNotificationError('NOTIFICATIONS_HOME_ASSISTANT_NOT_CONFIGURED', 503, 'Home Assistant ist serverseitig nicht konfiguriert.');
      }
      const client = laundryClientFactory(credentials);
      try {
        return await syncNotificationAutomations(client, rules, notificationBlueprintDir);
      } finally {
        client.close();
      }
    },
  };
  /* Kalendermomente: Erkennung gehört dem Server, nicht dem Browser. Er liest
     Termine und Wetterlage selbst und merkt sich nur die Schneesaison. */
  const moments = momentsService ?? createMomentsService({
    clientFactory: laundryClientFactory,
    resolveCredentials: () => resolveServerHaAccess(configStore, haConnectionMode),
    readHolidaySetting: () => configStore.read()[MOMENT_HOLIDAYS_CONFIG_KEY] ?? null,
    statePath: momentsStatePath,
  });
  /* Außenwetter (Issue #15): der Ort kommt aus Home Assistant, Open-Meteo
     fragt der Server — die Oberfläche kennt keine Koordinaten mehr. */
  const weather = weatherService ?? createWeatherService({
    clientFactory: laundryClientFactory,
    resolveCredentials: () => resolveServerHaAccess(configStore, haConnectionMode),
  });
  /* Companion-App (Plan 21): gekoppelte Geräte und die Dateilisten, mit
     denen die App Bundle und Raumbilder spiegelt. */
  const devices = deviceStore ?? createDeviceStore(pairingDevicesPath);
  const appFileIndex = createFileIndex();
  /* B-08E11: Der Live-Kanal des App-Modus. Im direkten Modus existiert er
     nicht — dort spricht der Browser weiterhin selbst mit Home Assistant. */
  const haGateway = haGatewayFactory({
    connectionMode: haConnectionMode,
    originAllowed: (req) => requestOriginAllowed(req, allowedOrigins),
  });
  /* AMBIENT-MAP S3: Standort und Asset gehören dem Server. Fehlen die
     Laufzeitverzeichnisse (`/data`, `/assets`), bleibt die Fähigkeit
     unverfügbar, statt an unerwarteten Orten zu schreiben; eine gerissene
     Setup-Recovery hält sie wie Raumbilder und Wäsche fail-closed. */
  const ambientMapDirectoriesReady = existsSync(dirname(ambientMapConfigPath))
    && existsSync(dirname(ambientMapAssetDirectory));
  const ambientMapGeocoder = ambientMapGeocode ?? createAmbientMapGeocoder();
  const ambientMap = !setupRecoveryResult.ok ? null : (ambientMapService ?? (ambientMapDirectoriesReady
    ? createAmbientMapService({
      configPath: ambientMapConfigPath,
      assetDirectory: ambientMapAssetDirectory,
      ...(ambientMapJobRunner ? { jobRunner: ambientMapJobRunner } : {}),
      /* Auflage aus dem S2-Review: der Resolver wird ausschließlich wirksam,
         wenn wirklich ein HA-Zugang konfiguriert ist — sonst antwortet die
         Standortroute mit `503` statt einen aussichtslosen Job zu starten. */
      homeAssistantConfigured: () => ambientMapHomeAssistantConfigured({
        configStore,
        connectionMode: haConnectionMode,
        supervisorClientFactory: haSupervisorClientFactory,
      }),
      resolveHomeAssistantLocation: () => readAmbientMapHomeAssistantLocation({
        configStore,
        connectionMode: haConnectionMode,
        supervisorClientFactory: haSupervisorClientFactory,
        runtimeConfig,
        ...(ambientMapHaFetchImpl ? { fetchImpl: ambientMapHaFetchImpl } : {}),
      }),
      /* Ortssuche über Nominatim, serverseitig: so haengt sie nicht an der IP
         des Endgeraets und der geforderte Kontakt-Header sitzt zuverlaessig.
         Genau eine Instanz, damit der Mindestabstand zwischen zwei Anfragen
         prozessweit gilt. */
      geocode: ambientMapGeocoder,
    })
    : null));
  /* Der Store initialisiert asynchron; ein nicht beschreibbarer Pfad darf
     weder eine Unhandled Rejection erzeugen noch den Serverstart verhindern. */
  ambientMap?.ready?.catch?.((error) => {
    console.warn('[hauser] Ambient-Map-Speicher nicht verfügbar:', error?.code ?? 'AMBIENT_MAP_STORE_UNAVAILABLE');
  });
  const httpServer = http.createServer((req, res) => {
    /* Gerätetoken vor allem anderen: er ersetzt die Origin-Grenze und ist
       über den Tunnel Pflicht. */
    authenticateRequest(req, devices);
    if (!remoteGateAllows(req)) {
      remoteGateReject(res);
      return;
    }
    /* Paket 11: Jede Leseroute des Vertrags bekommt ETag und Cache-Control,
       ohne dass die einzelne Route etwas davon weiß. Streams und alles, was
       ausdrücklich `no-store` sagt, bleiben unberührt (server/shared.mjs). */
    if (req.method === 'GET' || req.method === 'HEAD') {
      const pathname = new URL(req.url || '/', 'http://hmi.local').pathname;
      /* Nur die im Vertrag als `cacheable` markierten Leserouten: alles
         andere — insbesondere Health, Betriebsart und die Fähigkeitsauskunft —
         bleibt ausdrücklich ungespeichert. */
      if (matchApiRoute(req.method, pathname)?.cacheable) withReadCache(req, res);
    }
    const effectiveMigrationResult = setupRecoveryFailureLatched
      ? setupRecoveryFailure()
      : migrationResult;
    const readinessOptions = {
      staticRoot,
      householdConfigPath,
      householdConfigMode: normalizedHouseholdConfigMode,
      requiredWritableDirs,
      migrationResult: effectiveMigrationResult,
      selfCheck: startupSelfCheck,
      precompute: lastPrecompute,
    };
    const readiness = assessHmiReadiness(readinessOptions);
    const setupIsRequired = readiness.payload.status === 'setup_required';
    const targetPath = aiCustomizingEnabled ? proxyTargetPath(req.url || '/') : null;
    const laundryRoutes = new Set([
      '/api/laundry/existing/validate',
      '/api/laundry/existing/apply',
      '/api/laundry/blueprint/preview',
      '/api/laundry/blueprint/apply',
      '/api/laundry/disable/preview',
      '/api/laundry/disable/apply',
    ]);
    const laundryRoute = laundryRoutes.has(req.url || '') ? req.url : null;

    const songTarget = songTargetPath(req.url || '/');
    const familyDataRoute = (req.url || '').startsWith('/api/reminders');
    if ((req.url || '') === '/api/health') {
      serveHmiHealth(req, res, readinessOptions);
    } else if ((req.url || '') === '/api/build-info') {
      serveBuildInfo(req, res, buildInfo);
    } else if ((req.url || '') === '/api/ha/connection'
        && setupReadRequestAllowed(req, allowedOrigins)) {
      /* Sanitisierte Laufzeitauskunft: sagt Oberfläche und Runtime, ob dieser
         Server Home Assistant selbst vermittelt. Enthält keine Credentials und
         wird deshalb wie Health und Build-Info früh beantwortet. */
      serveHaConnection(res, {
        connectionMode: haConnectionMode,
        supervisorAvailable: haConnectionMode !== 'supervisor'
          || haSupervisorClientFactory().available,
      });
    } else if (haCameraProxyRoute(req.url || '/')
        && setupReadRequestAllowed(req, allowedOrigins)) {
      /* Kamera-Bild und -Strom kommen im App-Modus von diesem Ursprung; das
         Wandpanel sieht sie wie den Ambient-Screen ohne Admin-Anmeldung. */
      void serveHaCameraProxy(req, res, {
        connectionMode: haConnectionMode,
        supervisorClientFactory: haSupervisorClientFactory,
      });
    } else if (ambientMapPublicRoute(req.url || '/')) {
      /* Plan §6.1/§6.3: Status und Asset des Ambient-Screens liest auch ein
         Hotelgast — deshalb vor dem Admin-Gate, aber ausschließlich in der
         sanitisierten S2-Projektion ohne Koordinaten und Ortslabel. */
      serveAmbientMap(req, res, {
        service: ambientMap,
        allowedOrigins,
        notReady: ambientMapNotReady(effectiveMigrationResult, readiness, setupIsRequired),
      });
    } else if (hotelAdminGate.blocked(req)) {
      // Vor jeder anderen Auswertung: bei eingerichtetem Hotel Mode verlangen
      // sensitive Routen eine Adminsitzung, unabhängig davon, was die
      // Oberfläche gerade anzeigt.
      jsonResponse(res, 401, { code: 'HOTEL_ADMIN_REQUIRED', message: 'Adminsitzung erforderlich.' });
    } else if (!effectiveMigrationResult.ok && ((req.url || '').startsWith('/api/')
        || (req.url || '').startsWith('/hermes')
        || (req.url || '').startsWith('/ambient-llm')
        || (req.url || '').startsWith('/shopping-llm'))) {
      jsonResponse(res, 503, {
        ok: false,
        status: 'not_ready',
        code: readiness.payload.code,
        message: readiness.payload.message,
      }, { [HOUSEHOLD_CONFIG_MODE_HEADER]: normalizedHouseholdConfigMode });
    } else if (householdModuleMatch(req) && req.method === 'PUT'
        && requestOriginAllowed(req, allowedOrigins)
        && normalizedHouseholdConfigMode === 'active') {
      void serveHouseholdModuleToggle(req, res, householdModuleMatch(req), {
        householdConfigPath,
        configMutations,
        publishStep: roomImagePublishStep,
        latchSetupRecoveryFailure,
        assertSetupRecoveryHealthy,
      });
    } else if ((req.url || '').split('?')[0] === '/api/household-energy' && req.method === 'PUT'
        && requestOriginAllowed(req, allowedOrigins)
        && normalizedHouseholdConfigMode === 'active') {
      void serveHouseholdEnergy(req, res, {
        householdConfigPath,
        configMutations,
        publishStep: roomImagePublishStep,
        latchSetupRecoveryFailure,
        assertSetupRecoveryHealthy,
      });
    } else if ((req.url || '').split('?')[0] === '/api/household-energy') {
      jsonResponse(res, 403, { ok: false, code: 'ENERGY_ROUTE_FORBIDDEN', message: 'Energie-Auswahl nicht freigegeben.' });
    } else if ((req.url || '').startsWith('/api/household-modules/')) {
      jsonResponse(res, 403, { ok: false, code: 'MODULE_ROUTE_FORBIDDEN', message: 'Modulschalter nicht freigegeben.' });
    } else if (serveRoomImages(req, res, {
      authConfig: roomImageAuthConfig,
      allowedOrigins,
      uploadStore: roomImageUploads,
      jobStore: roomImageJobs,
      jobRunner: roomImageRunner,
      previewValidator: roomImagePreviewValidator,
      phoneDeriver: roomImagePhoneDeriver,
      testCapability: roomImageTestCapability,
      probeState: roomImageProbeState,
      credentialStore: resolvedRoomImageCredentialStore,
      now: roomImageNow,
      assetStore: roomImageAssets,
      householdConfigPath,
      configMutations,
      publishFlights: roomImagePublishFlights,
      publishStep: roomImagePublishStep,
      latchSetupRecoveryFailure,
      assertSetupRecoveryHealthy,
      detectRegions: detectRegionsForRoomImage,
      deriveOvercast: deriveOvercastForRoomImage,
      finishAsset: roomImageFinisher.finish,
    })) {
      // Room-image capability and private auth are independent of setup/readiness routes.
    } else if (!aiCustomizingEnabled && (req.url || '').startsWith('/hermes')) {
      jsonResponse(res, 404, { error: 'Route nicht gefunden' });
    } else if ((req.url || '') === '/api/ha/caldav-flow'
        && setupRequestAllowed(req, allowedOrigins)) {
      void serveHaCaldavFlow(req, res, {
        connectionMode: haConnectionMode,
        supervisorClientFactory: haSupervisorClientFactory,
      });
    } else if ((req.url || '') === '/api/setup/discovery'
        && setupReadRequestAllowed(req, allowedOrigins)) {
      void serveSetupDiscovery(res, {
        connectionMode: haConnectionMode,
        supervisorClientFactory: haSupervisorClientFactory,
      });
    } else if (setupIsRequired && (req.url || '') === '/api/setup/activate'
        && setupRequestAllowed(req, allowedOrigins)) {
      serveSetupActivation(req, res, {
        configStore,
        householdConfigPath,
        setupConnectionVerifier,
        setupJellyfinVerifier,
        configMutations,
        setupMutationStep,
        latchSetupRecoveryFailure,
        assertSetupRecoveryHealthy,
        connectionMode: haConnectionMode,
        supervisorConnectionVerifier: () => withSupervisorClient(
          haSupervisorClientFactory, verifySetupSupervisorHomeAssistant,
        ),
      });
    } else if (!setupIsRequired && readiness.ok
        && normalizedHouseholdConfigMode === 'active'
        && (req.url || '') === '/api/setup/activate'
        && setupRequestAllowed(req, allowedOrigins)) {
      serveSetupActivation(req, res, {
        configStore,
        householdConfigPath,
        setupConnectionVerifier,
        setupJellyfinVerifier,
        configMutations,
        setupMutationStep,
        latchSetupRecoveryFailure,
        assertSetupRecoveryHealthy,
        reconfigure: true,
        connectionMode: haConnectionMode,
        supervisorConnectionVerifier: () => withSupervisorClient(
          haSupervisorClientFactory, verifySetupSupervisorHomeAssistant,
        ),
      });
    } else if ((req.url || '') === '/api/setup/activate') {
      jsonResponse(res, 403, {
        ok: false,
        code: 'SETUP_REQUEST_FORBIDDEN',
        message: 'Die Setup-Anfrage ist nicht freigegeben.',
      });
    } else if (setupIsRequired && ((req.url || '').startsWith('/api/')
        || (req.url || '').startsWith('/hermes')
        || (req.url || '').startsWith('/ambient-llm')
        || (req.url || '').startsWith('/shopping-llm'))) {
      jsonResponse(res, 503, {
        ok: false,
        code: 'SETUP_REQUIRED',
        message: 'Die Ersteinrichtung muss zuerst abgeschlossen werden.',
      });
    } else if (ambientMapAdminRoute(req.url || '/')) {
      /* Hinter Hotel-Admin-Gate, Migrations- und Setup-Schranke: hier bleibt
         nur noch die bestehende Origin-Grenze für die Mutationen. */
      serveAmbientMap(req, res, {
        service: ambientMap,
        allowedOrigins,
        notReady: ambientMapNotReady(effectiveMigrationResult, readiness, setupIsRequired),
      });
    } else if ((req.url || '').startsWith(PAIRING_ROUTE_PREFIX)) {
      servePairing(req, res, { store: devices, allowedOrigins, remoteUrl });
    } else if ((req.url || '').startsWith(`${APP_ROUTE_PREFIX}/`)) {
      serveAppBundle(req, res, { staticRoot, roomImageAssetRoot, buildInfo, allowedOrigins, index: appFileIndex });
    } else if ((req.url || '') === '/api/weather') {
      if (!requestOriginAllowed(req, allowedOrigins)) {
        jsonResponse(res, 403, {
          ok: false,
          code: 'WEATHER_ORIGIN_FORBIDDEN',
          message: 'Die Wetter-Anfrage stammt nicht von einer freigegebenen Origin.',
        });
      } else {
        void serveWeather(req, res, weather);
      }
    } else if ((req.url || '').startsWith('/api/moments')) {
      if (!requestOriginAllowed(req, allowedOrigins)) {
        jsonResponse(res, 403, {
          ok: false,
          code: 'MOMENTS_ORIGIN_FORBIDDEN',
          message: 'Die Momente-Anfrage stammt nicht von einer freigegebenen Origin.',
        });
      } else {
        serveMoments(req, res, moments);
      }
    } else if ((req.url || '').startsWith('/api/notifications')) {
      if (!requestOriginAllowed(req, allowedOrigins)) {
        jsonResponse(res, 403, {
          ok: false,
          code: 'NOTIFICATIONS_ORIGIN_FORBIDDEN',
          message: 'Die Benachrichtigungs-Anfrage stammt nicht von einer freigegebenen Origin.',
        });
      } else {
        serveNotifications(req, res, notificationsService);
      }
    } else if ((req.url || '').startsWith('/api/laundry')) {
      const origin = String(req.headers.origin || '');
      if (!readiness.ok || normalizedHouseholdConfigMode !== 'active') {
        jsonResponse(res, 503, {
          ok: false,
          code: 'LAUNDRY_NOT_READY',
          message: 'Die Wäsche-Konfiguration ist nur bei aktiver, bereiter Haushaltskonfiguration verfügbar.',
        });
      } else if (origin && !allowedOrigins.has(origin)) {
        jsonResponse(res, 403, {
          ok: false,
          code: 'LAUNDRY_ORIGIN_FORBIDDEN',
          message: 'Die Wäsche-Anfrage stammt nicht von einer freigegebenen Origin.',
        });
      } else if (!laundryRoute) {
        jsonResponse(res, 404, { ok: false, code: 'LAUNDRY_ROUTE_NOT_FOUND', message: 'Die Wäsche-Route wurde nicht gefunden.' });
      } else {
        serveLaundry(req, res, laundry, laundryRoute, origin);
      }
    } else if (notionShoppingRoute(req.url || '/') && familyDataRequestAllowed(req, allowedOrigins)) {
      serveNotionShopping(req, res, { configStore });
    } else if (notionShoppingRoute(req.url || '/')) {
      jsonResponse(res, 403, { error: 'Notion-Route nicht freigegeben' });
    } else if ((req.url || '') === '/api/shopping/ha-list'
        && familyDataRequestAllowed(req, allowedOrigins)) {
      void serveHaTodoListFlow(req, res, {
        connectionMode: haConnectionMode,
        supervisorClientFactory: haSupervisorClientFactory,
      });
    } else if (familyDataRoute && familyDataRequestAllowed(req, allowedOrigins)) {
      serveFamilyData(req, res, familyStore);
    } else if (familyDataRoute) {
      jsonResponse(res, 403, { error: 'Familiendaten-Route nicht freigegeben' });
    } else if ((req.url || '').startsWith('/api/shopping')) {
      jsonResponse(res, 410, { error: 'Die Einkaufsliste läuft über Home-Assistant-Listen oder Notion' });
    } else if (songTarget && songRequestAllowed(req, songTarget, allowedOrigins)) {
      serveSongs(req, res, songTarget, aceStepHost, aceStepPort, ambientHost, ambientPort, library);
    } else if ((req.url || '').startsWith('/api/songs')) {
      jsonResponse(res, 403, { error: 'Song-Route nicht freigegeben' });
    } else if ((req.url || '').startsWith('/api/hotel-mode/') && hotelModeRequestAllowed(req, allowedOrigins)) {
      serveHotelModeSession(
        req, res, hotelAdminAccess, hotelStays, hotelGuestStates, hotelCommands, hotelSettings, hotelCheckouts,
      );
    } else if ((req.url || '').startsWith('/api/hotel-mode')) {
      jsonResponse(res, 403, { code: 'HOTEL_ROUTE_FORBIDDEN', message: 'Hotel-Mode-Route nicht freigegeben.' });
    } else if ((req.url || '').startsWith('/api/ablage/') && ablageRequestAllowed(req, allowedOrigins)) {
      const upstream = paperlessUpstream(
        configStore.read()['hmi:paperless-url'], paperlessHost, paperlessPort,
      );
      serveAblage(req, res, ablageAccess, upstream.host, upstream.port);
    } else if ((req.url || '').startsWith('/api/ablage')) {
      jsonResponse(res, 403, { error: 'Ablage-Route nicht freigegeben' });
    } else if ((req.url || '') === '/api/household-config-mode'
        && householdConfigRequestAllowed(req, allowedOrigins)) {
      serveHouseholdConfigMode(req, res, normalizedHouseholdConfigMode);
    } else if ((req.url || '') === '/api/household-config-mode') {
      jsonResponse(
        res,
        403,
        { code: 'HOUSEHOLD_CONFIG_MODE_FORBIDDEN', message: 'Haushaltsmodusroute nicht freigegeben.' },
        { [HOUSEHOLD_CONFIG_MODE_HEADER]: normalizedHouseholdConfigMode },
      );
    } else if ((req.url || '') === '/api/household-config'
        && householdConfigRequestAllowed(req, allowedOrigins)) {
      serveHouseholdConfig(req, res, householdConfigReader, normalizedHouseholdConfigMode);
    } else if ((req.url || '') === '/api/household-config') {
      if (requestOriginAllowed(req, allowedOrigins)) {
        serveHouseholdConfig(req, res, householdConfigReader, normalizedHouseholdConfigMode);
      } else {
        jsonResponse(
          res,
          403,
          { code: 'HOUSEHOLD_CONFIG_FORBIDDEN', message: 'Haushaltskonfigurationsroute nicht freigegeben.' },
          { [HOUSEHOLD_CONFIG_MODE_HEADER]: normalizedHouseholdConfigMode },
        );
      }
    } else if ((req.url || '') === '/api/config' && configRequestAllowed(req, allowedOrigins)) {
      serveConfig(req, res, configStore, configMutations, assertSetupRecoveryHealthy);
    } else if ((req.url || '').startsWith('/api/config')) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Konfigurationsroute nicht freigegeben"}');
    } else if ((req.url || '') === '/shopping-llm/v1/chat/completions'
        && ambientRequestAllowed(req, allowedOrigins)) {
      proxyAmbient(req, res, ambientHost, ambientPort, 'shopping', runtimeConfig);
    } else if ((req.url || '').startsWith('/shopping-llm')) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Shopping-Route nicht freigegeben"}');
    } else if ((req.url || '') === '/ambient-llm/v1/chat/completions'
        && ambientRequestAllowed(req, allowedOrigins)) {
      proxyAmbient(req, res, ambientHost, ambientPort, 'ambient', runtimeConfig);
    } else if ((req.url || '').startsWith('/ambient-llm')) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Ambient-Route nicht freigegeben"}');
    } else if (targetPath !== null && proxyRequestAllowed(req, allowedOrigins)) {
      if (!key) {
        jsonResponse(res, 503, { error: 'Hermes-Integration ist nicht konfiguriert' });
      } else {
        proxy(req, res, key, targetPath, upstreamHost, upstreamPort);
      }
    } else if ((req.url || '').startsWith('/hermes')) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Hermes-Route nicht freigegeben"}');
    } else {
      serveStatic(req, res, staticRoot);
    }
  });
  httpServer.on('upgrade', (req, socket, head) => {
    /* Genau ein Pfad wird zum WebSocket erhoben; alles andere wird verworfen,
       damit hier keine allgemeine Bridge entsteht. */
    if (!haGateway.handlesUpgrade(req)) {
      socket.destroy();
      return;
    }
    /* Der WebSocket der App trägt den Gerätetoken als Query-Parameter. */
    authenticateRequest(req, devices);
    if (!remoteGateAllows(req)) {
      socket.destroy();
      return;
    }
    haGateway.handleUpgrade(req, socket, head);
  });
  httpServer.on('close', () => {
    haGateway.close();
    /* Kartenjob und sein kurzlebiger Worker enden mit dem Server. */
    void Promise.resolve(ambientMap?.close?.()).catch(() => {});
    stopNightly();
  });
  return httpServer;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  /* Ein Absturz soll im Supervisor-Log stehen, nicht nur im Exit-Code. Node
     beendet den Prozess bei beiden Ereignissen von sich aus; die Handler
     ergänzen den Stack und behalten dieses Verhalten bei (Exit 1), damit der
     Supervisor wie bisher neu startet. */
  const logFatal = (kind, error) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`[hauser] ${kind}: ${detail}`);
    process.exit(1);
  };
  process.on('uncaughtException', (error) => logFatal('uncaughtException', error));
  process.on('unhandledRejection', (reason) => logFatal('unhandledRejection', reason));

  let server;
  try {
    const householdConfigMode = normalizeHouseholdConfigMode(process.env.HMI_HOUSEHOLD_CONFIG_MODE);
    const setupRecoveryResult = recoverSetupConfigTransactions({
      configPath: CONFIG_PATH,
      householdConfigPath: HOUSEHOLD_CONFIG_PATH,
    });
    const migrationResult = !setupRecoveryResult.ok ? setupRecoveryResult : (householdConfigMode === 'active'
      ? migrateHouseholdConfigFile(HOUSEHOLD_CONFIG_PATH)
      : { ok: true, status: 'shadow' });
    const readiness = assessHmiReadiness({ householdConfigMode, migrationResult });
    if (!readiness.ok && readiness.payload.code !== 'SETUP_CONFIG_RECOVERY_REQUIRED') {
      const issue = readiness.payload.issue;
      const issueText = issue ? ` ${issue.path}: ${issue.message}` : '';
      throw new Error(`[${readiness.payload.code}] ${readiness.payload.message}${issueText}`);
    }
    /* B-27 D3: vor dem Assetstore. Er verifiziert beim Konstruieren jedes
       aktive Asset gegen ROOM_IMAGE_VARIANT_FILES und wuerfe ohne die
       Migration sofort — der Dienst kaeme gar nicht hoch. */
    if (setupRecoveryResult.ok && HOUSEHOLD_CONFIG_PATH) {
      const result = await backfillRoomImagePhoneVariants({
        catalogPath: join(dirname(HOUSEHOLD_CONFIG_PATH), 'room-images', 'assets.json'),
      });
      if (result.migrated.length > 0) {
        console.log(`[hauser] Phone-Ableitungen ergaenzt fuer ${result.migrated.length} Raumbild-Asset(s).`);
      }
      if (result.failed.length > 0) {
        console.warn(`[hauser] Phone-Backfill unvollstaendig: ${result.failed.join(', ')}`);
      }
    }
    server = createHmiServer(undefined, {
      householdConfigMode,
      householdConfigMigrationResult: migrationResult,
      setupConfigRecoveryResult: setupRecoveryResult,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'HMI-Server konnte nicht starten.');
    process.exit(1);
  }
  server.listen(PORT, HOST, () => console.log(`Smart Home HMI hört auf ${HOST}:${PORT}`));
}