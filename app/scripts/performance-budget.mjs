#!/usr/bin/env node

import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { ImportType, init, parse } from 'es-module-lexer';

/* ADR-022/ADR-027: Der kombinierte Phone-Startup hat ein eigenes, höheres Limit
   als die Initialroute; seit ADR-029 sind es 92 KiB. Die Initialroute steht
   weiter auf den dokumentierten 80 KiB — sie hat dort reichlich Luft, und ein
   Gate, das großzügiger ist als sein Dokument, ist kein Gate. */
export const DEFAULT_BUDGETS = Object.freeze({
  initialJsGzipBytes: 80 * 1024,
  initialCssGzipBytes: 20 * 1024,
  combinedPhoneStartupJsGzipBytes: 92 * 1024,
});

function emptyReport(budgets) {
  return {
    schemaVersion: 1,
    buildRoot: 'dist',
    status: 'ERROR',
    initial: {
      javascript: {
        files: [],
        total: { rawBytes: 0, gzipBytes: 0 },
        budget: budgetResult(budgets.initialJsGzipBytes, 0),
      },
      css: {
        files: [],
        total: { rawBytes: 0, gzipBytes: 0 },
        budget: budgetResult(budgets.initialCssGzipBytes, 0),
      },
    },
    shells: {
      phone: null,
      panel: null,
      combinedPhoneStartup: null,
    },
    dynamicChunks: [],
    errors: [],
  };
}

function budgetResult(limitBytes, actualBytes) {
  return {
    limitBytes,
    limitKiB: limitBytes / 1024,
    actualBytes,
    passed: actualBytes < limitBytes,
  };
}

function validateBudgets(budgets) {
  for (const key of ['initialJsGzipBytes', 'initialCssGzipBytes']) {
    if (!Number.isInteger(budgets[key]) || budgets[key] <= 0) {
      throw new TypeError(`${key} must be a positive integer`);
    }
  }
  // Optional: fällt auf das Initialroutenlimit zurück, wenn nicht gesetzt.
  const combined = budgets.combinedPhoneStartupJsGzipBytes;
  if (combined !== undefined && (!Number.isInteger(combined) || combined <= 0)) {
    throw new TypeError('combinedPhoneStartupJsGzipBytes must be a positive integer');
  }
}

function combinedStartupJsLimit(budgets) {
  return budgets.combinedPhoneStartupJsGzipBytes ?? budgets.initialJsGzipBytes;
}

function readAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function indexReferences(html) {
  const javascript = [];
  const css = [];
  const activeHtml = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '');

  for (const match of activeHtml.matchAll(/<script\b([^>]*)>/gi)) {
    const attributes = match[1];
    const type = readAttribute(attributes, 'type');
    const src = readAttribute(attributes, 'src');
    if (type?.toLowerCase() === 'module' && src) javascript.push(src);
  }

  for (const match of activeHtml.matchAll(/<link\b([^>]*)>/gi)) {
    const attributes = match[1];
    const rel = readAttribute(attributes, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    const href = readAttribute(attributes, 'href');
    if (!href) continue;
    if (rel.includes('modulepreload')) javascript.push(href);
    if (rel.includes('stylesheet')) css.push(href);
  }

  return { javascript, css };
}

const STATIC_IMPORT_TYPES = new Set([
  ImportType.Static,
  ImportType.StaticSourcePhase,
  ImportType.StaticDeferPhase,
]);
const DYNAMIC_IMPORT_TYPES = new Set([
  ImportType.Dynamic,
  ImportType.DynamicSourcePhase,
  ImportType.DynamicDeferPhase,
]);

/** Extract genuine ESM edges with es-module-lexer; non-literal dynamics stay explicit. */
export async function extractModuleReferences(source) {
  await init;
  const [imports] = parse(source);
  const staticImports = [];
  const dynamicImports = [];
  const nonLiteralDynamicImports = [];

  for (const entry of imports) {
    if (STATIC_IMPORT_TYPES.has(entry.t)) {
      staticImports.push(entry.n);
    } else if (DYNAMIC_IMPORT_TYPES.has(entry.t)) {
      if (typeof entry.n === 'string') dynamicImports.push(entry.n);
      else nonLiteralDynamicImports.push({ start: entry.ss });
    }
  }

  return {
    staticImports: [...new Set(staticImports)],
    dynamicImports: [...new Set(dynamicImports)],
    nonLiteralDynamicImports,
  };
}

function localReference(specifier, importer = 'index.html') {
  const withoutSuffix = specifier.split(/[?#]/, 1)[0];
  if (!withoutSuffix || /^(?:[a-z]+:|\/\/)/i.test(withoutSuffix)) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    return null;
  }

  const joined = decoded.startsWith('/')
    ? decoded.slice(1)
    : path.posix.join(path.posix.dirname(importer), decoded);
  const normalized = path.posix.normalize(joined);
  if (!normalized || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

function fileMeasurement(relativePath, contents) {
  return {
    path: relativePath,
    rawBytes: contents.byteLength,
    gzipBytes: gzipSync(contents).byteLength,
  };
}

function totals(files) {
  return files.reduce(
    (sum, file) => ({
      rawBytes: sum.rawBytes + file.rawBytes,
      gzipBytes: sum.gzipBytes + file.gzipBytes,
    }),
    { rawBytes: 0, gzipBytes: 0 },
  );
}

function countOccurrences(source, marker) {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(marker, offset)) !== -1) {
    count += 1;
    offset += marker.length;
  }
  return count;
}

const PRE_MOUNT_METADATA_PATH = 'hmi-performance-budget.json';
const PRE_MOUNT_MARKER_PREFIX = 'hmi-premount:required';
const PRE_MOUNT_MARKER_PATTERN = /hmi-premount:required:src\/[A-Za-z0-9_./-]+/g;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(record, expectedKeys) {
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validMetadataChunkPath(value) {
  return typeof value === 'string'
    && !value.includes('\\')
    && value.endsWith('.js')
    && localReference(value) === value;
}

function validMetadataCssPath(value) {
  return typeof value === 'string'
    && !value.includes('\\')
    && value.endsWith('.css')
    && localReference(value) === value;
}

function parsePreMountMetadata(source) {
  let metadata;
  try {
    metadata = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isRecord(metadata)
    || !hasExactKeys(metadata, ['schemaVersion', 'requiredPreMountEntries', 'chunkCss'])
    || metadata.schemaVersion !== 2
    || !Array.isArray(metadata.requiredPreMountEntries)
    || metadata.requiredPreMountEntries.length === 0
    || !Array.isArray(metadata.chunkCss)
    || metadata.chunkCss.length === 0) {
    return null;
  }

  const sourceModules = new Set();
  const markers = new Set();
  const facades = new Set();
  for (const entry of metadata.requiredPreMountEntries) {
    if (!isRecord(entry)
      || !hasExactKeys(entry, ['sourceModule', 'marker', 'facade', 'markerChunk'])
      || typeof entry.sourceModule !== 'string'
      || !entry.sourceModule.startsWith('src/')
      || entry.sourceModule.includes('\\')
      || localReference(entry.sourceModule) !== entry.sourceModule
      || entry.marker !== `${PRE_MOUNT_MARKER_PREFIX}:${entry.sourceModule}`
      || !validMetadataChunkPath(entry.facade)
      || !validMetadataChunkPath(entry.markerChunk)
      || sourceModules.has(entry.sourceModule)
      || markers.has(entry.marker)
      || facades.has(entry.facade)) {
      return null;
    }
    sourceModules.add(entry.sourceModule);
    markers.add(entry.marker);
    facades.add(entry.facade);
  }

  const chunks = new Set();
  for (const entry of metadata.chunkCss) {
    if (!isRecord(entry)
      || !hasExactKeys(entry, ['chunk', 'files'])
      || !validMetadataChunkPath(entry.chunk)
      || !Array.isArray(entry.files)
      || entry.files.some((file) => !validMetadataCssPath(file))
      || new Set(entry.files).size !== entry.files.length
      || chunks.has(entry.chunk)) {
      return null;
    }
    chunks.add(entry.chunk);
  }
  return {
    requiredPreMountEntries: metadata.requiredPreMountEntries,
    chunkCss: metadata.chunkCss,
  };
}

function isInside(realRoot, candidate) {
  const relative = path.relative(realRoot, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

/** Analyze one Vite-style dist directory without exposing its local absolute path. */
export async function analyzeBuild({ distDir, budgets = DEFAULT_BUDGETS }) {
  validateBudgets(budgets);
  const report = emptyReport(budgets);
  const errors = [];
  const measured = new Map();
  const assetEdges = new Map();

  const addError = (code, message, relativePath) => {
    const error = { code, message };
    if (relativePath) error.path = relativePath;
    if (!errors.some((entry) => entry.code === code && entry.path === error.path)) errors.push(error);
  };

  let realDistDir;
  try {
    realDistDir = await realpath(distDir);
  } catch {
    addError('DIST_ROOT_INVALID', 'The dist root is missing or cannot be resolved safely.');
    report.errors = errors;
    return report;
  }

  const readAsset = async (relativePath, {
    missingCode = 'ASSET_MISSING',
    missingMessage = 'A referenced build asset is missing or unreadable.',
    outsideCode = 'ASSET_OUTSIDE_DIST',
    outsideMessage = 'A referenced build asset resolves outside the dist root.',
  } = {}) => {
    if (measured.has(relativePath)) return measured.get(relativePath).contents;
    let resolvedPath;
    try {
      resolvedPath = await realpath(path.join(realDistDir, ...relativePath.split('/')));
    } catch {
      addError(missingCode, missingMessage, relativePath);
      return null;
    }
    if (!isInside(realDistDir, resolvedPath)) {
      addError(outsideCode, outsideMessage, relativePath);
      return null;
    }
    try {
      const contents = await readFile(resolvedPath);
      measured.set(relativePath, { contents, measurement: fileMeasurement(relativePath, contents) });
      return contents;
    } catch {
      addError(missingCode, missingMessage, relativePath);
      return null;
    }
  };

  const extractAssetEdges = async (contents, relativePath) => {
    try {
      const edges = await extractModuleReferences(contents.toString('utf8'));
      assetEdges.set(relativePath, edges);
      if (edges.nonLiteralDynamicImports.length > 0) {
        addError(
          'DYNAMIC_IMPORT_NOT_LITERAL',
          'A dynamic import cannot be resolved from a string literal; the chunk inventory would be incomplete.',
          relativePath,
        );
      }
      return edges;
    } catch {
      assetEdges.set(relativePath, null);
      addError('MODULE_PARSE_FAILED', 'A referenced JavaScript asset could not be lexed safely.', relativePath);
      return null;
    }
  };

  let html;
  let indexPath;
  try {
    indexPath = await realpath(path.join(realDistDir, 'index.html'));
  } catch {
    addError('INDEX_HTML_MISSING', 'dist/index.html is missing or unreadable.');
    report.errors = errors;
    return report;
  }
  if (!isInside(realDistDir, indexPath)) {
    addError('INDEX_HTML_OUTSIDE_DIST', 'dist/index.html resolves outside the dist root.');
    report.errors = errors;
    return report;
  }
  try {
    html = await readFile(indexPath, 'utf8');
  } catch {
    addError('INDEX_HTML_MISSING', 'dist/index.html is missing or unreadable.');
    report.errors = errors;
    return report;
  }

  const references = indexReferences(html);
  if (references.javascript.length === 0) {
    addError('INDEX_HTML_INVALID', 'dist/index.html has no external module entry.');
    report.errors = errors;
    return report;
  }

  const initial = new Set();
  const initialQueue = [];
  const dynamicSeeds = [];
  const initialDynamicEdges = new Map();
  for (const specifier of references.javascript) {
    const relativePath = localReference(specifier);
    if (relativePath) initialQueue.push(relativePath);
    else addError('ASSET_REFERENCE_INVALID', 'index.html contains a non-local or unsafe module reference.');
  }

  while (initialQueue.length > 0) {
    const relativePath = initialQueue.shift();
    if (initial.has(relativePath)) continue;
    initial.add(relativePath);
    const contents = await readAsset(relativePath);
    if (!contents) continue;
    const edges = await extractAssetEdges(contents, relativePath);
    if (!edges) continue;
    for (const specifier of edges.staticImports) {
      const target = localReference(specifier, relativePath);
      if (target) initialQueue.push(target);
      else addError('ASSET_REFERENCE_INVALID', 'A static import is non-local or unsafe.', relativePath);
    }
    for (const specifier of edges.dynamicImports) {
      const target = localReference(specifier, relativePath);
      if (target) {
        dynamicSeeds.push(target);
        const targets = initialDynamicEdges.get(relativePath) ?? new Set();
        targets.add(target);
        initialDynamicEdges.set(relativePath, targets);
      }
      else addError('ASSET_REFERENCE_INVALID', 'A dynamic import is non-local or unsafe.', relativePath);
    }
  }

  const dynamic = new Set();
  const dynamicQueue = [...dynamicSeeds];
  while (dynamicQueue.length > 0) {
    const relativePath = dynamicQueue.shift();
    if (initial.has(relativePath) || dynamic.has(relativePath)) continue;
    dynamic.add(relativePath);
    const contents = await readAsset(relativePath);
    if (!contents) continue;
    const edges = await extractAssetEdges(contents, relativePath);
    if (!edges) continue;
    for (const specifier of [...edges.staticImports, ...edges.dynamicImports]) {
      const target = localReference(specifier, relativePath);
      if (target) dynamicQueue.push(target);
      else addError('ASSET_REFERENCE_INVALID', 'An import in a dynamic chunk is non-local or unsafe.', relativePath);
    }
  }

  const moduleGraph = new Map();
  const dynamicGraph = new Map();
  const shellMarkerHits = { phone: [], panel: [] };
  for (const relativePath of new Set([...initial, ...dynamic])) {
    const contents = measured.get(relativePath)?.contents;
    if (!contents || !relativePath.endsWith('.js')) continue;
    const edges = assetEdges.get(relativePath);
    if (!edges) continue;
    moduleGraph.set(relativePath, edges.staticImports
      .map((specifier) => localReference(specifier, relativePath))
      .filter(Boolean));
    dynamicGraph.set(relativePath, edges.dynamicImports
      .map((specifier) => localReference(specifier, relativePath))
      .filter(Boolean));
    const source = contents.toString('utf8');
    shellMarkerHits.phone.push(...Array(countOccurrences(source, 'hmi-shell:phone')).fill(relativePath));
    shellMarkerHits.panel.push(...Array(countOccurrences(source, 'hmi-shell:panel')).fill(relativePath));
  }

  const directDynamicTargets = new Set(
    [...initialDynamicEdges.values()].flatMap((targets) => [...targets]),
  );
  const shellEntries = { phone: [], panel: [] };
  for (const relativePath of directDynamicTargets) {
    if (initial.has(relativePath)) continue;
    const contents = measured.get(relativePath)?.contents;
    if (!contents || !relativePath.endsWith('.js')) continue;
    const source = contents.toString('utf8');
    const phoneMarkerCount = countOccurrences(source, 'hmi-shell:phone');
    const panelMarkerCount = countOccurrences(source, 'hmi-shell:panel');
    if (phoneMarkerCount === 1 && panelMarkerCount === 0) shellEntries.phone.push(relativePath);
    if (panelMarkerCount === 1 && phoneMarkerCount === 0) shellEntries.panel.push(relativePath);
  }

  const staticClosure = (entry) => {
    const closure = new Set();
    const queue = [entry];
    while (queue.length > 0) {
      const relativePath = queue.shift();
      if (closure.has(relativePath)) continue;
      closure.add(relativePath);
      for (const target of moduleGraph.get(relativePath) ?? []) queue.push(target);
    }
    return closure;
  };

  const graphReliable = errors.length === 0;
  let requiredPreMountEntries = [];
  let chunkCss = new Map();
  let preMountEntriesValid = false;
  const metadataContents = await readAsset(PRE_MOUNT_METADATA_PATH, {
    missingCode: 'PRE_MOUNT_METADATA_INVALID',
    missingMessage: 'The structured pre-mount metadata is missing or unreadable.',
    outsideCode: 'PRE_MOUNT_METADATA_INVALID',
    outsideMessage: 'The structured pre-mount metadata resolves outside the dist root.',
  });
  if (metadataContents) {
    const parsedMetadata = parsePreMountMetadata(metadataContents.toString('utf8'));
    if (!parsedMetadata) {
      addError(
        'PRE_MOUNT_METADATA_INVALID',
        'The structured pre-mount metadata has an unsupported or malformed schema.',
        PRE_MOUNT_METADATA_PATH,
      );
    } else {
      requiredPreMountEntries = parsedMetadata.requiredPreMountEntries;
      chunkCss = new Map(parsedMetadata.chunkCss.map((entry) => [entry.chunk, entry.files]));
    }
  }

  if (requiredPreMountEntries.length > 0 && graphReliable) {
    const markerSearchPaths = new Set([
      ...[...initial, ...dynamic].filter((relativePath) => relativePath.endsWith('.js')),
      ...requiredPreMountEntries.map((entry) => entry.markerChunk),
    ]);
    await Promise.all([...markerSearchPaths].map((relativePath) => readAsset(relativePath)));

    const markerHits = [];
    let markerTokenCount = 0;
    for (const relativePath of markerSearchPaths) {
      const contents = measured.get(relativePath)?.contents;
      if (!contents) continue;
      const source = contents.toString('utf8');
      markerTokenCount += countOccurrences(source, PRE_MOUNT_MARKER_PREFIX);
      for (const marker of source.match(PRE_MOUNT_MARKER_PATTERN) ?? []) {
        markerHits.push({ marker, path: relativePath });
      }
    }

    const declaredMarkers = new Set(requiredPreMountEntries.map((entry) => entry.marker));
    const markersValid = markerTokenCount === requiredPreMountEntries.length
      && markerHits.length === requiredPreMountEntries.length
      && markerHits.every((hit) => declaredMarkers.has(hit.marker))
      && requiredPreMountEntries.every((entry) => {
        const hits = markerHits.filter((hit) => hit.marker === entry.marker);
        return hits.length === 1 && hits[0].path === entry.markerChunk;
      });
    if (!markersValid) {
      addError(
        'PRE_MOUNT_MARKER_INVALID',
        'Every declared pre-mount source module must have exactly one matching marker in its declared build chunk, without duplicate or decoy markers.',
      );
    }

    const declaredFacades = new Set(requiredPreMountEntries.map((entry) => entry.facade));
    const reachableFacades = new Set(
      [...directDynamicTargets].filter((target) => declaredFacades.has(target)),
    );
    const facadeQueue = [...reachableFacades];
    while (facadeQueue.length > 0) {
      const facade = facadeQueue.shift();
      for (const sourceChunk of staticClosure(facade)) {
        for (const target of dynamicGraph.get(sourceChunk) ?? []) {
          if (!declaredFacades.has(target) || reachableFacades.has(target)) continue;
          reachableFacades.add(target);
          facadeQueue.push(target);
        }
      }
    }

    const entriesReachable = reachableFacades.size === requiredPreMountEntries.length
      && requiredPreMountEntries.every((entry) => (
        !initial.has(entry.facade)
        && dynamic.has(entry.facade)
        && reachableFacades.has(entry.facade)
        && moduleGraph.has(entry.facade)
        && moduleGraph.has(entry.markerChunk)
        && staticClosure(entry.facade).has(entry.markerChunk)
      ));
    if (!entriesReachable) {
      addError(
        'PRE_MOUNT_ENTRY_INVALID',
        'Every pre-mount marker chunk must be statically reachable from its declared facade, and every facade must be a declared root or nested literal-dynamic target in that pre-mount graph.',
      );
    }

    const graphChunks = new Set(
      [...initial, ...dynamic].filter((relativePath) => relativePath.endsWith('.js')),
    );
    const chunkCssValid = [...graphChunks].every((relativePath) => chunkCss.has(relativePath));
    if (!chunkCssValid) {
      addError(
        'PRE_MOUNT_CSS_INVALID',
        'The build metadata must describe the CSS files for every reachable JavaScript chunk exactly once.',
      );
    }
    preMountEntriesValid = markersValid && entriesReachable && chunkCssValid;
  }

  const cssPaths = [];
  for (const specifier of references.css) {
    const relativePath = localReference(specifier);
    if (relativePath) cssPaths.push(relativePath);
    else addError('ASSET_REFERENCE_INVALID', 'index.html contains a non-local or unsafe stylesheet reference.');
  }
  await Promise.all(cssPaths.map((relativePath) => readAsset(relativePath)));

  const measurementsFor = (paths) => [...new Set(paths)]
    .map((relativePath) => measured.get(relativePath)?.measurement)
    .filter(Boolean)
    .sort((left, right) => left.path.localeCompare(right.path));

  report.initial.javascript.files = measurementsFor(initial);
  report.initial.css.files = measurementsFor(cssPaths);
  report.dynamicChunks = measurementsFor(dynamic);

  const moduleParseFailed = errors.some((error) => error.code === 'MODULE_PARSE_FAILED');
  const shellEntriesValid = !moduleParseFailed
    && shellEntries.phone.length === 1
    && shellEntries.panel.length === 1
    && shellEntries.phone[0] !== shellEntries.panel[0]
    && shellMarkerHits.phone.length === 1
    && shellMarkerHits.phone[0] === shellEntries.phone[0]
    && shellMarkerHits.panel.length === 1
    && shellMarkerHits.panel[0] === shellEntries.panel[0];
  if (!moduleParseFailed && !shellEntriesValid) {
    addError(
      'SHELL_MARKER_INVALID',
      'The build must contain exactly one distinct phone and panel shell entry, each marked only in its own non-initial direct literal-dynamic target from the initial graph.',
    );
  }
  if (shellEntriesValid) {
    const describeShell = (entry) => {
      const files = measurementsFor(staticClosure(entry));
      return { entry, files, total: totals(files) };
    };
    report.shells.phone = describeShell(shellEntries.phone[0]);
    report.shells.panel = describeShell(shellEntries.panel[0]);
  }
  if (shellEntriesValid && preMountEntriesValid) {
    const combinedPaths = new Set([
      ...initial,
      ...requiredPreMountEntries.flatMap((entry) => [...staticClosure(entry.facade)]),
      ...staticClosure(shellEntries.phone[0]),
    ]);
    const combinedFiles = measurementsFor(combinedPaths);
    const combinedTotal = totals(combinedFiles);
    const combinedCssPaths = new Set(cssPaths);
    for (const relativePath of combinedPaths) {
      for (const cssPath of chunkCss.get(relativePath) ?? []) combinedCssPaths.add(cssPath);
    }
    await Promise.all([...combinedCssPaths].map((relativePath) => readAsset(relativePath, {
      missingCode: 'PRE_MOUNT_CSS_INVALID',
      missingMessage: 'A CSS file declared for the combined startup is missing or unreadable.',
      outsideCode: 'PRE_MOUNT_CSS_INVALID',
      outsideMessage: 'A CSS file declared for the combined startup resolves outside the dist root.',
    })));
    const combinedCssFiles = measurementsFor(combinedCssPaths);
    const combinedCssTotal = totals(combinedCssFiles);
    report.shells.combinedPhoneStartup = {
      files: combinedFiles,
      total: combinedTotal,
      budget: budgetResult(combinedStartupJsLimit(budgets), combinedTotal.gzipBytes),
      css: {
        files: combinedCssFiles,
        total: combinedCssTotal,
        budget: budgetResult(budgets.initialCssGzipBytes, combinedCssTotal.gzipBytes),
      },
    };
  }

  report.initial.javascript.total = totals(report.initial.javascript.files);
  report.initial.css.total = totals(report.initial.css.files);
  report.initial.javascript.budget = budgetResult(
    budgets.initialJsGzipBytes,
    report.initial.javascript.total.gzipBytes,
  );
  report.initial.css.budget = budgetResult(
    budgets.initialCssGzipBytes,
    report.initial.css.total.gzipBytes,
  );
  report.errors = errors;
  report.status = errors.length > 0
    ? 'ERROR'
    : report.initial.javascript.budget.passed
      && report.initial.css.budget.passed
      && (report.shells.combinedPhoneStartup?.budget.passed ?? true)
      && (report.shells.combinedPhoneStartup?.css.budget.passed ?? true)
      ? 'PASS'
      : 'FAIL';
  return report;
}

export function exitCodeForReport(report, { enforceBudget = false } = {}) {
  if (report.status === 'ERROR') return 2;
  if (enforceBudget && report.status === 'FAIL') return 1;
  return 0;
}

async function main() {
  const enforceBudget = process.argv.slice(2).includes('--budget');
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const report = await analyzeBuild({ distDir: path.resolve(scriptDir, '..', 'dist') });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = exitCodeForReport(report, { enforceBudget });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
