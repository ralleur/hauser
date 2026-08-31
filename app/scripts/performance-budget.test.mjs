import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { analyzeBuild, exitCodeForReport, extractModuleReferences } from './performance-budget.mjs';
import { REQUIRED_PRE_MOUNT_MODULE_SUFFIXES } from '../vite.config.ts';

const generousBudgets = {
  initialJsGzipBytes: 1024 * 1024,
  initialCssGzipBytes: 1024 * 1024,
};

const PRE_MOUNT_METADATA_PATH = 'hmi-performance-budget.json';
const DEFAULT_PRE_MOUNT_SOURCE = 'src/default-pre-mount.ts';
const DEFAULT_PRE_MOUNT_MARKER = `hmi-premount:required:${DEFAULT_PRE_MOUNT_SOURCE}`;

/* B-27 B2 (ADR-028): Der First Paint kommt aus dem validierten Active-Cache und
   mountet direkt die produktive App. Gemessen wird deshalb genau diese Kette;
   die Minimal-Shell ist Fehlerpfad und darf nicht mehr im Pre-Mount-Graphen
   liegen. Frueher galt hier die umgekehrte Forderung. */
test('measures the productive first-paint chain and excludes the minimal shell', () => {
  for (const suffix of [
    '/src/App.svelte',
    '/src/lib/config/household-config-runtime.ts',
    '/src/lib/state/ui-mode.svelte.ts',
    '/src/lib/state/nav.svelte.ts',
    '/src/lib/state/app.svelte.ts',
  ]) {
    assert.equal(
      REQUIRED_PRE_MOUNT_MODULE_SUFFIXES.filter((candidate) => candidate === suffix).length,
      1,
      `${suffix} must be represented exactly once in build metadata`,
    );
  }
  for (const suffix of [
    '/src/lib/shells/minimal-shell-loader.ts',
    '/src/lib/shells/MinimalAppShell.svelte',
  ]) {
    assert.equal(
      REQUIRED_PRE_MOUNT_MODULE_SUFFIXES.includes(suffix),
      false,
      `${suffix} must stay out of the pre-mount graph after the cache-first mount`,
    );
  }
});

function preMountEntry({
  sourceModule = DEFAULT_PRE_MOUNT_SOURCE,
  marker = `hmi-premount:required:${sourceModule}`,
  facade = 'assets/pre-mount-entry.js',
  markerChunk = facade,
} = {}) {
  return { sourceModule, marker, facade, markerChunk };
}

function preMountMetadata(entries = [preMountEntry()], cssByChunk = {}) {
  return { schemaVersion: 2, requiredPreMountEntries: entries, cssByChunk };
}

function serializePreMountMetadata(metadata, files) {
  if (typeof metadata === 'string') return metadata;
  const chunkCss = Object.keys(files)
    .filter((relativePath) => relativePath.endsWith('.js'))
    .sort()
    .map((chunk) => ({ chunk, files: metadata.cssByChunk[chunk] ?? [] }));
  return JSON.stringify({
    schemaVersion: metadata.schemaVersion,
    requiredPreMountEntries: metadata.requiredPreMountEntries,
    chunkCss,
  });
}

async function fixture({
  html = '<script type="module" src="/assets/main-a1.js"></script><link rel="stylesheet" href="/assets/main-b2.css">',
  files = {},
  shellMarkers = 'valid',
  preMount = 'valid',
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'hmi-performance-budget-'));
  await mkdir(path.join(root, 'assets'), { recursive: true });
  if (html !== null) await writeFile(path.join(root, 'index.html'), html);
  const markerSources = {
    valid: {
      phone: 'export const marker="hmi-shell:phone";',
      panel: 'export const marker="hmi-shell:panel";',
    },
    phone: {
      phone: 'export const marker="hmi-shell:phone";',
      panel: 'export const marker="panel-without-marker";',
    },
    panel: {
      phone: 'export const marker="phone-without-marker";',
      panel: 'export const marker="hmi-shell:panel";',
    },
    none: null,
  };
  const markerSource = markerSources[shellMarkers];
  if (markerSource === undefined) throw new TypeError(`Unknown shell marker fixture mode: ${shellMarkers}`);
  const defaults = {
    'assets/main-a1.js': 'console.log("main");',
    'assets/main-b2.css': 'body{color:black}',
  };
  const fixtureFiles = { ...defaults, ...files };
  let metadata = null;
  if (preMount === 'valid') {
    fixtureFiles['assets/main-a1.js'] = `${fixtureFiles['assets/main-a1.js']}\nimport("./pre-mount-entry.js");`;
    fixtureFiles['assets/pre-mount-entry.js'] = `export const marker=${JSON.stringify(DEFAULT_PRE_MOUNT_MARKER)};`;
    metadata = preMountMetadata();
  } else if (preMount !== 'none') {
    throw new TypeError(`Unknown pre-mount fixture mode: ${preMount}`);
  }
  if (markerSource) {
    fixtureFiles['assets/main-a1.js'] = `${fixtureFiles['assets/main-a1.js']}\nimport("./phone-shell.js"); import("./panel-shell.js");`;
    fixtureFiles['assets/phone-shell.js'] = markerSource.phone;
    fixtureFiles['assets/panel-shell.js'] = markerSource.panel;
  }
  if (metadata) {
    fixtureFiles[PRE_MOUNT_METADATA_PATH] = serializePreMountMetadata(metadata, fixtureFiles);
  } else if (fixtureFiles[PRE_MOUNT_METADATA_PATH] && typeof fixtureFiles[PRE_MOUNT_METADATA_PATH] !== 'string') {
    fixtureFiles[PRE_MOUNT_METADATA_PATH] = serializePreMountMetadata(
      fixtureFiles[PRE_MOUNT_METADATA_PATH],
      fixtureFiles,
    );
  }
  for (const [relativePath, contents] of Object.entries(fixtureFiles)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  return root;
}

async function structuredPreMountFixture({
  mainImports = ['./pre-mount-entry.js'],
  files = {},
  metadata = preMountMetadata(),
} = {}) {
  const fixtureFiles = {
    'assets/main-a1.js': [
      ...mainImports.map((specifier) => `import(${JSON.stringify(specifier)});`),
      'import("./phone-shell.js");',
      'import("./panel-shell.js");',
    ].join('\n'),
    'assets/phone-shell.js': 'export const marker="hmi-shell:phone";',
    'assets/panel-shell.js': 'export const marker="hmi-shell:panel";',
    'assets/pre-mount-entry.js': `export const marker=${JSON.stringify(DEFAULT_PRE_MOUNT_MARKER)};`,
    ...files,
  };
  if (metadata !== null) {
    fixtureFiles[PRE_MOUNT_METADATA_PATH] = serializePreMountMetadata(metadata, fixtureFiles);
  }
  return fixture({
    shellMarkers: 'none',
    preMount: 'none',
    files: fixtureFiles,
  });
}

test('reports a passing build with measured raw and gzip bytes', async () => {
  const distDir = await fixture();
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.status, 'PASS');
  assert.equal(report.initial.javascript.budget.passed, true);
  assert.equal(report.initial.css.budget.passed, true);
  assert.deepEqual(report.initial.javascript.files.map((file) => file.path), ['assets/main-a1.js']);
  assert.deepEqual(report.initial.css.files.map((file) => file.path), ['assets/main-b2.css']);
  assert.ok(report.initial.javascript.total.rawBytes > 0);
  assert.ok(report.initial.javascript.total.gzipBytes > 0);
  assert.equal(report.shells.phone.entry, 'assets/phone-shell.js');
  assert.equal(report.shells.panel.entry, 'assets/panel-shell.js');
  assert.notEqual(report.shells.phone.entry, report.shells.panel.entry);
  assert.equal(exitCodeForReport(report, { enforceBudget: true }), 0);
  assert.deepEqual(report.errors, []);
});

test('fails only the initial-JS budget when its gzip sum reaches the limit', async () => {
  const distDir = await fixture();
  const measured = await analyzeBuild({ distDir, budgets: generousBudgets });
  const jsGzip = measured.initial.javascript.total.gzipBytes;
  const report = await analyzeBuild({
    distDir,
    budgets: { ...generousBudgets, initialJsGzipBytes: jsGzip },
  });

  assert.equal(report.status, 'FAIL');
  assert.equal(report.initial.javascript.budget.passed, false, 'the contract is strictly less than the limit');
  assert.equal(report.initial.css.budget.passed, true);
});

test('fails only the initial-CSS budget when its gzip sum reaches the limit', async () => {
  const distDir = await fixture();
  const measured = await analyzeBuild({ distDir, budgets: generousBudgets });
  const cssGzip = measured.initial.css.total.gzipBytes;
  const report = await analyzeBuild({
    distDir,
    budgets: { ...generousBudgets, initialCssGzipBytes: cssGzip },
  });

  assert.equal(report.status, 'FAIL');
  assert.equal(report.initial.javascript.budget.passed, true);
  assert.equal(report.initial.css.budget.passed, false, 'the contract is strictly less than the limit');
});

test('walks static imports recursively and inventories dynamic closures separately', async () => {
  const distDir = await fixture({
    files: {
      'assets/main-a1.js': [
        "const quotePattern = /'/;",
        'import "./shared-c3.js";',
        'import { value } from "./feature-d4.js";',
        'export { nested } from "./nested-e5.js";',
        'const load = () => import(`./lazy-f6.js`);',
        'console.log(value, load);',
      ].join('\n'),
      'assets/shared-c3.js': 'import "./nested-e5.js";',
      'assets/feature-d4.js': 'export const value = 1;',
      'assets/nested-e5.js': 'export const nested = 2;',
      'assets/lazy-f6.js': 'import "./lazy-child-g7.js";',
      'assets/lazy-child-g7.js': 'export const child = true;',
    },
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.deepEqual(report.initial.javascript.files.map((file) => file.path), [
    'assets/feature-d4.js',
    'assets/main-a1.js',
    'assets/nested-e5.js',
    'assets/shared-c3.js',
  ]);
  assert.deepEqual(report.dynamicChunks.map((file) => file.path), [
    'assets/lazy-child-g7.js',
    'assets/lazy-f6.js',
    'assets/panel-shell.js',
    'assets/phone-shell.js',
    'assets/pre-mount-entry.js',
  ]);
  assert.equal(report.initial.javascript.files.some((file) => file.path.includes('lazy')), false);
});

test('uses only literal-followed ESM from-clauses when bindings are named from', async () => {
  const source = [
    'import { x as from } from "./dep.js";',
    "import { from as alias } /* from './comment-ghost.js' */ from /* clause */ './dep2.js';",
    "import from from './dep5.js';",
    "const from = 'local'; export { from };",
    "export { from as alias } from './dep3.js';",
    'export { x as from }\n/* multiline clause */ from\n"./dep4.js";',
    'const property = { from: "./property-ghost.js" };',
    'const string = "from \'./string-ghost.js\'";',
  ].join('\n');

  assert.deepEqual((await extractModuleReferences(source)).staticImports, [
    './dep.js',
    './dep2.js',
    './dep5.js',
    './dep3.js',
    './dep4.js',
  ]);
});

test('extracts only lexical dynamic import calls from hostile minified source', async () => {
  const source = [
    'const string = "import(\\\"./string-ghost.js\\\")";',
    'const template = `text ${"import(\\\"./template-ghost.js\\\")"}`;',
    'const pattern = /import\\(["\']\\.\\/regex-ghost\\.js["\']\\)/;',
    '/* import("./comment-ghost.js") */',
    'const obj={import(value){return value}};obj.import("./property-ghost.js");',
    'const load=()=>import("./real-lazy.js");',
  ].join('');

  assert.deepEqual((await extractModuleReferences(source)).dynamicImports, ['./real-lazy.js']);
});

test('does not invent imports from regex literals after control flow or a block', async () => {
  const source = [
    'if (flag) /import(".\\/ghost-if.js")/.test(value);',
    'if (flag) {} /import(".\\/ghost-block.js")/.test(value);',
  ].join('\n');

  assert.deepEqual(await extractModuleReferences(source), {
    staticImports: [],
    dynamicImports: [],
    nonLiteralDynamicImports: [],
  });
});

test('finds a real dynamic import inside a template interpolation', async () => {
  const references = await extractModuleReferences(
    'export const value = `${import("./lazy.js")}`;',
  );

  assert.deepEqual(references.dynamicImports, ['./lazy.js']);
  assert.deepEqual(references.nonLiteralDynamicImports, []);
});

test('fails closed when a dynamic import specifier is not a literal', async () => {
  const distDir = await fixture({
    files: { 'assets/main-a1.js': 'const name = "lazy"; import(`./${name}.js`);' },
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'ERROR');
  assert.deepEqual(report.errors.map((error) => error.code), ['DYNAMIC_IMPORT_NOT_LITERAL']);
  assert.equal(report.errors[0].path, 'assets/main-a1.js');
});

test('ignores scripts, modulepreloads and stylesheets inside HTML comments', async () => {
  const distDir = await fixture({
    html: [
      '<!-- <script type="module" src="/assets/script-ghost.js"></script> -->',
      '<!-- <link rel="modulepreload" href="/assets/preload-ghost.js"> -->',
      '<!-- <link rel="stylesheet" href="/assets/style-ghost.css"> -->',
      '<script type="module" src="/assets/main-a1.js"></script>',
      '<link rel="stylesheet" href="/assets/main-b2.css">',
    ].join(''),
  });

  const report = await analyzeBuild({ distDir, budgets: generousBudgets });
  assert.equal(report.status, 'PASS');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.initial.javascript.files.map((file) => file.path), ['assets/main-a1.js']);
  assert.deepEqual(report.initial.css.files.map((file) => file.path), ['assets/main-b2.css']);
});

test('rejects a referenced asset whose symlink escapes the real dist root', async () => {
  const distDir = await fixture();
  const outsideDir = await mkdtemp(path.join(tmpdir(), 'hmi-performance-outside-'));
  const outsideFile = path.join(outsideDir, 'outside.js');
  await writeFile(outsideFile, 'console.log("outside");');
  await symlink(outsideFile, path.join(distDir, 'assets', 'escaped.js'));
  await writeFile(
    path.join(distDir, 'index.html'),
    '<script type="module" src="/assets/escaped.js"></script>',
  );

  const report = await analyzeBuild({ distDir, budgets: generousBudgets });
  assert.equal(report.status, 'ERROR');
  assert.deepEqual(report.errors.map((error) => error.code), ['ASSET_OUTSIDE_DIST', 'SHELL_MARKER_INVALID']);
  assert.equal(JSON.stringify(report).includes(outsideDir), false);
});

test('rejects unsafe dynamic imports instead of silently dropping them', async (t) => {
  for (const [name, specifier] of [
    ['traversal', '../../escape.js'],
    ['percent-encoded traversal', '%2e%2e/%2e%2e/encoded.js'],
  ]) {
    await t.test(name, async () => {
      const distDir = await fixture({
        files: { 'assets/main-a1.js': `import(${JSON.stringify(specifier)});` },
      });
      const report = await analyzeBuild({ distDir, budgets: generousBudgets });
      assert.equal(report.status, 'ERROR');
      assert.deepEqual(report.errors.map((error) => error.code), ['ASSET_REFERENCE_INVALID']);
      assert.equal(report.errors[0].path, 'assets/main-a1.js');
    });
  }
});

test('accepts local dynamic imports with query and fragment suffixes', async () => {
  const distDir = await fixture({
    files: {
      'assets/main-a1.js': 'import("./lazy.js?worker#chunk");',
      'assets/lazy.js': 'export const lazy = true;',
    },
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'PASS');
  assert.deepEqual(report.dynamicChunks.map((file) => file.path), [
    'assets/lazy.js', 'assets/panel-shell.js', 'assets/phone-shell.js', 'assets/pre-mount-entry.js',
  ]);
});

test('returns controlled errors when the dist root or index realpath is unsafe', async (t) => {
  await t.test('broken dist root symlink', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'hmi-performance-root-'));
    const distDir = path.join(parent, 'dist');
    await symlink(path.join(parent, 'missing'), distDir);
    const report = await analyzeBuild({ distDir, budgets: generousBudgets });
    assert.equal(report.status, 'ERROR');
    assert.deepEqual(report.errors.map((error) => error.code), ['DIST_ROOT_INVALID']);
    assert.equal(JSON.stringify(report).includes(parent), false);
  });

  await t.test('index symlink escape', async () => {
    const distDir = await fixture();
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'hmi-performance-index-'));
    const outsideIndex = path.join(outsideDir, 'index.html');
    await writeFile(outsideIndex, '<script type="module" src="/assets/main-a1.js"></script>');
    await rm(path.join(distDir, 'index.html'));
    await symlink(outsideIndex, path.join(distDir, 'index.html'));
    const report = await analyzeBuild({ distDir, budgets: generousBudgets });
    assert.equal(report.status, 'ERROR');
    assert.deepEqual(report.errors.map((error) => error.code), ['INDEX_HTML_OUTSIDE_DIST']);
    assert.equal(JSON.stringify(report).includes(outsideDir), false);
  });
});

test('returns controlled errors for missing and invalid index.html', async (t) => {
  await t.test('missing', async () => {
    const distDir = await fixture({ html: null });
    const report = await analyzeBuild({ distDir, budgets: generousBudgets });
    assert.equal(report.status, 'ERROR');
    assert.deepEqual(report.errors.map((error) => error.code), ['INDEX_HTML_MISSING']);
  });

  await t.test('invalid', async () => {
    const distDir = await fixture({ html: '<!doctype html><p>no module entry</p>' });
    const report = await analyzeBuild({ distDir, budgets: generousBudgets });
    assert.equal(report.status, 'ERROR');
    assert.deepEqual(report.errors.map((error) => error.code), ['INDEX_HTML_INVALID']);
  });
});

test('reports missing referenced assets as controlled build errors', async () => {
  const distDir = await fixture({
    html: '<script type="module" src="/assets/does-not-exist.js"></script>',
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'ERROR');
  assert.deepEqual(report.errors.map((error) => error.code), ['ASSET_MISSING', 'SHELL_MARKER_INVALID']);
  assert.equal(report.errors[0].path, 'assets/does-not-exist.js');
});

test('measures stable shell static closures and deduplicated phone startup', async () => {
  const distDir = await fixture({
    shellMarkers: 'none',
    files: {
      'assets/main-a1.js': 'import("./phone-p1.js"); import("./panel-p2.js");',
      'assets/phone-p1.js': 'import "./shared-s1.js"; import("./phone-lazy.js"); export const marker="hmi-shell:phone";',
      'assets/panel-p2.js': 'import "./shared-s1.js"; import "./panel-screen.js"; export const marker="hmi-shell:panel";',
      'assets/shared-s1.js': 'export const shared=true;',
      'assets/phone-lazy.js': 'export const lazy=true;',
      'assets/panel-screen.js': 'export const panel=true;',
    },
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'PASS');
  assert.equal(report.shells.phone.entry, 'assets/phone-p1.js');
  assert.deepEqual(report.shells.phone.files.map((file) => file.path), [
    'assets/phone-p1.js', 'assets/shared-s1.js',
  ]);
  assert.deepEqual(report.shells.panel.files.map((file) => file.path), [
    'assets/panel-p2.js', 'assets/panel-screen.js', 'assets/shared-s1.js',
  ]);
  assert.deepEqual(report.shells.combinedPhoneStartup.files.map((file) => file.path), [
    'assets/main-a1.js', 'assets/phone-p1.js', 'assets/pre-mount-entry.js', 'assets/shared-s1.js',
  ]);
  assert.equal(report.shells.phone.files.some((file) => file.path.includes('lazy')), false);
});

test('charges the transitive required pre-mount App closure once before the phone shell mounts', async () => {
  let state = 0x6d2b79f5;
  const highEntropy = Buffer.alloc(120_000);
  for (let index = 0; index < highEntropy.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    highEntropy[index] = state & 0xff;
  }
  const appSource = 'src/App.svelte';
  const appMarker = `hmi-premount:required:${appSource}`;
  const distDir = await fixture({
    shellMarkers: 'none',
    preMount: 'none',
    files: {
      'assets/main-a1.js': [
        'const app = await import("./App-app1.js");',
        'const phone = await import("./phone-p1.js");',
        'import("./panel-p2.js");',
        'mount(app.default, phone.default);',
      ].join('\n'),
      'assets/App-app1.js': `import "./pre-mount-shared.js"; import "./pre-mount-extra.js"; export const marker=${JSON.stringify(appMarker)};`,
      'assets/pre-mount-extra.js': `export const payload=${JSON.stringify(highEntropy.toString('base64'))};`,
      'assets/pre-mount-shared.js': 'export const shared=true;',
      'assets/phone-p1.js': 'import "./pre-mount-shared.js"; export const marker="hmi-shell:phone";',
      'assets/panel-p2.js': 'export const marker="hmi-shell:panel";',
      [PRE_MOUNT_METADATA_PATH]: preMountMetadata([
        preMountEntry({ sourceModule: appSource, facade: 'assets/App-app1.js' }),
      ]),
    },
  });
  const report = await analyzeBuild({
    distDir,
    budgets: { ...generousBudgets, initialJsGzipBytes: 80 * 1024 },
  });

  assert.equal(report.status, 'FAIL');
  assert.deepEqual(report.shells.combinedPhoneStartup.files.map((file) => file.path), [
    'assets/App-app1.js',
    'assets/main-a1.js',
    'assets/phone-p1.js',
    'assets/pre-mount-extra.js',
    'assets/pre-mount-shared.js',
  ]);
  assert.equal(
    report.shells.combinedPhoneStartup.files.filter((file) => file.path === 'assets/pre-mount-shared.js').length,
    1,
  );
  assert.equal(report.shells.combinedPhoneStartup.budget.passed, false);
  assert.equal(exitCodeForReport(report, { enforceBudget: true }), 1);
});

test('fails closed for missing, duplicate, and decoy pre-mount markers', async (t) => {
  const cases = [
    ['missing marker', {
      files: { 'assets/pre-mount-entry.js': 'export const value=true;' },
    }],
    ['duplicate marker in one chunk', {
      files: {
        'assets/pre-mount-entry.js': [
          `export const marker=${JSON.stringify(DEFAULT_PRE_MOUNT_MARKER)};`,
          `export const duplicate=${JSON.stringify(DEFAULT_PRE_MOUNT_MARKER)};`,
        ].join('\n'),
      },
    }],
    ['duplicate marker in different chunks', {
      mainImports: ['./pre-mount-entry.js', './marker-decoy.js'],
      files: {
        'assets/marker-decoy.js': `export const duplicate=${JSON.stringify(DEFAULT_PRE_MOUNT_MARKER)};`,
      },
    }],
    ['undeclared decoy marker string', {
      mainImports: ['./pre-mount-entry.js', './marker-decoy.js'],
      files: {
        'assets/marker-decoy.js': 'export const decoy="hmi-premount:required:src/decoy.ts";',
      },
    }],
  ];

  for (const [name, options] of cases) {
    await t.test(name, async () => {
      const distDir = await structuredPreMountFixture(options);
      const report = await analyzeBuild({ distDir, budgets: generousBudgets });

      assert.equal(report.status, 'ERROR');
      assert.deepEqual(report.errors.map((error) => error.code), ['PRE_MOUNT_MARKER_INVALID']);
      assert.equal(report.shells.combinedPhoneStartup, null);
      assert.equal(exitCodeForReport(report, { enforceBudget: true }), 2);
    });
  }
});

test('rejects a marker that is not statically reachable from its required dynamic facade', async () => {
  const sourceModule = 'src/unreachable.ts';
  const marker = `hmi-premount:required:${sourceModule}`;
  const distDir = await structuredPreMountFixture({
    mainImports: ['./required-facade.js', './unreachable-marker.js'],
    files: {
      'assets/required-facade.js': 'export const facade=true;',
      'assets/unreachable-marker.js': `export const marker=${JSON.stringify(marker)};`,
    },
    metadata: preMountMetadata([
      preMountEntry({
        sourceModule,
        facade: 'assets/required-facade.js',
        markerChunk: 'assets/unreachable-marker.js',
      }),
    ]),
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'ERROR');
  assert.deepEqual(report.errors.map((error) => error.code), ['PRE_MOUNT_ENTRY_INVALID']);
  assert.equal(report.shells.combinedPhoneStartup, null);
  assert.equal(exitCodeForReport(report, { enforceBudget: true }), 2);
});

test('charges a required dynamic facade before the shared chunk containing its marker', async () => {
  const sourceModule = 'src/App.svelte';
  const marker = `hmi-premount:required:${sourceModule}`;
  const distDir = await structuredPreMountFixture({
    mainImports: ['./App-facade.js'],
    files: {
      'assets/App-facade.js': 'import "./pre-mount-shared.js"; export { app } from "./pre-mount-shared.js";',
      'assets/pre-mount-shared.js': `export const app=true; export const marker=${JSON.stringify(marker)};`,
    },
    metadata: preMountMetadata([
      preMountEntry({
        sourceModule,
        facade: 'assets/App-facade.js',
        markerChunk: 'assets/pre-mount-shared.js',
      }),
    ]),
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'PASS');
  assert.deepEqual(report.shells.combinedPhoneStartup.files.map((file) => file.path), [
    'assets/App-facade.js',
    'assets/main-a1.js',
    'assets/phone-shell.js',
    'assets/pre-mount-shared.js',
  ]);
  assert.equal(
    report.shells.combinedPhoneStartup.files.filter((file) => file.path === 'assets/pre-mount-shared.js').length,
    1,
  );
});

test('charges the nested minimal-shell facades, static closures, and CSS exactly once', async () => {
  const loaderSource = 'src/lib/shells/minimal-shell-loader.ts';
  const shellSource = 'src/lib/shells/MinimalAppShell.svelte';
  const loaderMarker = `hmi-premount:required:${loaderSource}`;
  const shellMarker = `hmi-premount:required:${shellSource}`;
  const metadata = preMountMetadata([
    preMountEntry({
      sourceModule: loaderSource,
      facade: 'assets/minimal-shell-loader.js',
      markerChunk: 'assets/minimal-shell-loader.js',
    }),
    preMountEntry({
      sourceModule: shellSource,
      facade: 'assets/MinimalAppShell.js',
      markerChunk: 'assets/MinimalAppShell.js',
    }),
  ], {
    'assets/minimal-shell-loader.js': ['assets/minimal-shared.css'],
    'assets/MinimalAppShell.js': ['assets/minimal-shell.css'],
    'assets/phone-shell.js': ['assets/minimal-shared.css', 'assets/phone-shell.css'],
  });
  const distDir = await structuredPreMountFixture({
    mainImports: ['./minimal-shell-loader.js'],
    files: {
      'assets/minimal-shell-loader.js': [
        'import "./loader-static.js";',
        'import("./MinimalAppShell.js");',
        `export const marker=${JSON.stringify(loaderMarker)};`,
      ].join('\n'),
      'assets/loader-static.js': 'export const loaderStatic=true;',
      'assets/MinimalAppShell.js': [
        'import "./minimal-shared.js";',
        `export const marker=${JSON.stringify(shellMarker)};`,
      ].join('\n'),
      'assets/minimal-shared.js': 'export const shared=true;',
      'assets/phone-shell.js': 'import "./minimal-shared.js"; export const marker="hmi-shell:phone";',
      'assets/minimal-shared.css': '.shared{display:block}',
      'assets/minimal-shell.css': '.minimal{display:grid}',
      'assets/phone-shell.css': '.phone{display:grid}',
    },
    metadata,
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'PASS');
  assert.deepEqual(report.shells.combinedPhoneStartup.files.map((file) => file.path), [
    'assets/loader-static.js',
    'assets/main-a1.js',
    'assets/minimal-shared.js',
    'assets/minimal-shell-loader.js',
    'assets/MinimalAppShell.js',
    'assets/phone-shell.js',
  ]);
  assert.deepEqual(report.shells.combinedPhoneStartup.css.files.map((file) => file.path), [
    'assets/main-b2.css',
    'assets/minimal-shared.css',
    'assets/minimal-shell.css',
    'assets/phone-shell.css',
  ]);
  assert.equal(
    report.shells.combinedPhoneStartup.css.files
      .filter((file) => file.path === 'assets/minimal-shared.css').length,
    1,
  );

  const cssLimit = report.shells.combinedPhoneStartup.css.total.gzipBytes;
  const cssFail = await analyzeBuild({
    distDir,
    budgets: { ...generousBudgets, initialCssGzipBytes: cssLimit },
  });
  assert.equal(cssFail.initial.css.budget.passed, true);
  assert.equal(cssFail.shells.combinedPhoneStartup.css.budget.passed, false);
  assert.equal(cssFail.status, 'FAIL');
});

test('fails closed when reachable chunk CSS metadata is missing', async () => {
  const metadata = JSON.stringify({
    schemaVersion: 2,
    requiredPreMountEntries: [preMountEntry()],
    chunkCss: [
      { chunk: 'assets/main-a1.js', files: [] },
      { chunk: 'assets/pre-mount-entry.js', files: [] },
      { chunk: 'assets/phone-shell.js', files: [] },
    ],
  });
  const distDir = await structuredPreMountFixture({ metadata });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'ERROR');
  assert.deepEqual(report.errors.map((error) => error.code), ['PRE_MOUNT_CSS_INVALID']);
  assert.equal(report.shells.combinedPhoneStartup, null);
  assert.equal(exitCodeForReport(report, { enforceBudget: true }), 2);
});

test('deduplicates initial, phone, shared, cyclic, and multi-entry pre-mount closures', async () => {
  const sourceA = 'src/pre-mount-a.ts';
  const sourceB = 'src/pre-mount-b.ts';
  const markerA = `hmi-premount:required:${sourceA}`;
  const markerB = `hmi-premount:required:${sourceB}`;
  const distDir = await structuredPreMountFixture({
    mainImports: ['./facade-a.js', './facade-b.js'],
    files: {
      'assets/main-a1.js': [
        'import "./initial-common.js";',
        'import("./facade-a.js");',
        'import("./facade-b.js");',
        'import("./phone-shell.js");',
        'import("./panel-shell.js");',
      ].join('\n'),
      'assets/facade-a.js': 'import "./static-cycle-a.js"; import "./marked-shared.js";',
      'assets/facade-b.js': 'import "./initial-common.js"; import "./marked-shared.js";',
      'assets/static-cycle-a.js': 'import "./static-cycle-b.js";',
      'assets/static-cycle-b.js': 'import "./static-cycle-a.js"; import "./marked-shared.js";',
      'assets/initial-common.js': 'export const initial=true;',
      'assets/marked-shared.js': `export const a=${JSON.stringify(markerA)}; export const b=${JSON.stringify(markerB)};`,
      'assets/phone-shell.js': 'import "./marked-shared.js"; export const marker="hmi-shell:phone";',
    },
    metadata: preMountMetadata([
      preMountEntry({ sourceModule: sourceA, facade: 'assets/facade-a.js', markerChunk: 'assets/marked-shared.js' }),
      preMountEntry({ sourceModule: sourceB, facade: 'assets/facade-b.js', markerChunk: 'assets/marked-shared.js' }),
    ]),
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'PASS');
  assert.deepEqual(report.shells.combinedPhoneStartup.files.map((file) => file.path), [
    'assets/facade-a.js',
    'assets/facade-b.js',
    'assets/initial-common.js',
    'assets/main-a1.js',
    'assets/marked-shared.js',
    'assets/phone-shell.js',
    'assets/static-cycle-a.js',
    'assets/static-cycle-b.js',
  ]);
  assert.equal(new Set(report.shells.combinedPhoneStartup.files.map((file) => file.path)).size, 8);
});

test('rejects missing or malformed structured pre-mount metadata', async (t) => {
  for (const [name, metadata] of [
    ['missing metadata', null],
    ['invalid JSON', '{"schemaVersion":1'],
    ['invalid schema', JSON.stringify({ schemaVersion: 1, requiredPreMountEntries: [{}] })],
  ]) {
    await t.test(name, async () => {
      const distDir = await structuredPreMountFixture({ metadata });
      const report = await analyzeBuild({ distDir, budgets: generousBudgets });

      assert.equal(report.status, 'ERROR');
      assert.deepEqual(report.errors.map((error) => error.code), ['PRE_MOUNT_METADATA_INVALID']);
      assert.equal(report.shells.combinedPhoneStartup, null);
      assert.equal(exitCodeForReport(report, { enforceBudget: true }), 2);
    });
  }
});

test('fails closed unless the build contains exactly one phone and one panel shell marker', async (t) => {
  for (const [name, fixtureOptions] of [
    ['no shell markers', { shellMarkers: 'none' }],
    ['only a phone marker', { shellMarkers: 'phone' }],
    ['only a panel marker', { shellMarkers: 'panel' }],
    ['duplicate phone markers', {
      shellMarkers: 'none',
      files: {
        'assets/main-a1.js': 'import("./phone-1.js"); import("./phone-2.js"); import("./panel.js");',
        'assets/phone-1.js': 'export const marker="hmi-shell:phone";',
        'assets/phone-2.js': 'export const marker="hmi-shell:phone";',
        'assets/panel.js': 'export const marker="hmi-shell:panel";',
      },
    }],
    ['duplicate panel markers', {
      shellMarkers: 'none',
      files: {
        'assets/main-a1.js': 'import("./phone.js"); import("./panel-1.js"); import("./panel-2.js");',
        'assets/phone.js': 'export const marker="hmi-shell:phone";',
        'assets/panel-1.js': 'export const marker="hmi-shell:panel";',
        'assets/panel-2.js': 'export const marker="hmi-shell:panel";',
      },
    }],
    ['duplicate phone marker occurrences in one entry', {
      shellMarkers: 'none',
      files: {
        'assets/main-a1.js': 'import("./phone.js"); import("./panel.js");',
        'assets/phone.js': 'export const marker="hmi-shell:phone"; export const duplicate="hmi-shell:phone";',
        'assets/panel.js': 'export const marker="hmi-shell:panel";',
      },
    }],
    ['duplicate panel marker occurrences in one entry', {
      shellMarkers: 'none',
      files: {
        'assets/main-a1.js': 'import("./phone.js"); import("./panel.js");',
        'assets/phone.js': 'export const marker="hmi-shell:phone";',
        'assets/panel.js': 'export const marker="hmi-shell:panel"; export const duplicate="hmi-shell:panel";',
      },
    }],
  ]) {
    await t.test(name, async () => {
      const distDir = await fixture(fixtureOptions);
      const report = await analyzeBuild({ distDir, budgets: generousBudgets });
      assert.equal(report.status, 'ERROR');
      assert.deepEqual(report.errors.map((error) => error.code), ['SHELL_MARKER_INVALID']);
      assert.equal(report.shells.phone, null);
      assert.equal(report.shells.panel, null);
      assert.equal(report.shells.combinedPhoneStartup, null);
      assert.equal(exitCodeForReport(report, { enforceBudget: true }), 2);
    });
  }
});

test('returns only a controlled parse error for malformed JavaScript', async () => {
  const distDir = await fixture({
    shellMarkers: 'none',
    files: { 'assets/main-a1.js': 'import {' },
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'ERROR');
  assert.deepEqual(report.errors, [{
    code: 'MODULE_PARSE_FAILED',
    message: 'A referenced JavaScript asset could not be lexed safely.',
    path: 'assets/main-a1.js',
  }]);
  assert.deepEqual(report.shells, { phone: null, panel: null, combinedPhoneStartup: null });
  assert.equal(exitCodeForReport(report, { enforceBudget: true }), 2);
  assert.equal(JSON.stringify(report).includes(distDir), false);
});

test('rejects bootstrap marker decoys instead of omitting the real oversized phone shell', async () => {
  let state = 0x6d2b79f5;
  const highEntropy = Buffer.alloc(120_000);
  for (let index = 0; index < highEntropy.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    highEntropy[index] = state & 0xff;
  }
  const oversizedPhone = `export const payload=${JSON.stringify(highEntropy.toString('base64'))};`;
  const distDir = await fixture({
    shellMarkers: 'none',
    files: {
      'assets/main-a1.js': [
        'const phoneDecoy="hmi-shell:phone";',
        'const panelDecoy="hmi-shell:panel";',
        'import("./phone-real.js");',
        'import("./panel-real.js");',
      ].join('\n'),
      'assets/phone-real.js': oversizedPhone,
      'assets/panel-real.js': 'export const panel=true;',
    },
  });
  const report = await analyzeBuild({
    distDir,
    budgets: { ...generousBudgets, initialJsGzipBytes: 80 * 1024 },
  });
  const realPhone = report.dynamicChunks.find((file) => file.path === 'assets/phone-real.js');

  assert.ok(realPhone.gzipBytes > 121_247, 'the real direct phone shell must reproduce the oversized review fixture');
  assert.equal(report.status, 'ERROR');
  assert.deepEqual(report.errors.map((error) => error.code), ['SHELL_MARKER_INVALID']);
  assert.equal(report.shells.phone, null);
  assert.equal(report.shells.panel, null);
  assert.equal(report.shells.combinedPhoneStartup, null);
  assert.equal(exitCodeForReport(report, { enforceBudget: true }), 2);
});

test('charges a semantically valid oversized direct phone shell to the startup budget', async () => {
  let state = 0x6d2b79f5;
  const highEntropy = Buffer.alloc(120_000);
  for (let index = 0; index < highEntropy.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    highEntropy[index] = state & 0xff;
  }
  const distDir = await fixture({
    shellMarkers: 'none',
    files: {
      'assets/main-a1.js': 'import("./phone-real.js"); import("./panel-real.js");',
      'assets/phone-real.js': `export const marker="hmi-shell:phone"; export const payload=${JSON.stringify(highEntropy.toString('base64'))};`,
      'assets/panel-real.js': 'export const marker="hmi-shell:panel";',
    },
  });
  const report = await analyzeBuild({
    distDir,
    budgets: { ...generousBudgets, initialJsGzipBytes: 80 * 1024 },
  });

  assert.equal(report.status, 'FAIL');
  assert.equal(report.shells.phone.entry, 'assets/phone-real.js');
  assert.equal(report.shells.combinedPhoneStartup.budget.passed, false);
  assert.equal(exitCodeForReport(report, { enforceBudget: true }), 1);
});

test('rejects co-located shell markers in one direct dynamic target', async () => {
  const distDir = await fixture({
    shellMarkers: 'none',
    files: {
      'assets/main-a1.js': 'import("./both-shells.js");',
      'assets/both-shells.js': 'export const phone="hmi-shell:phone"; export const panel="hmi-shell:panel";',
    },
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'ERROR');
  assert.deepEqual(report.errors.map((error) => error.code), ['SHELL_MARKER_INVALID']);
  assert.deepEqual(report.shells, { phone: null, panel: null, combinedPhoneStartup: null });
  assert.equal(exitCodeForReport(report, { enforceBudget: true }), 2);
});

test('rejects shell markers found only in an indirect dynamic descendant', async () => {
  const distDir = await fixture({
    shellMarkers: 'none',
    files: {
      'assets/main-a1.js': 'import("./loader.js"); import("./panel.js");',
      'assets/loader.js': 'import("./phone-descendant.js");',
      'assets/phone-descendant.js': 'export const marker="hmi-shell:phone";',
      'assets/panel.js': 'export const marker="hmi-shell:panel";',
    },
  });
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });

  assert.equal(report.status, 'ERROR');
  assert.deepEqual(report.errors.map((error) => error.code), ['SHELL_MARKER_INVALID']);
  assert.deepEqual(report.shells, { phone: null, panel: null, combinedPhoneStartup: null });
  assert.equal(exitCodeForReport(report, { enforceBudget: true }), 2);
});

test('source boundary keeps literal pre-mount App and shell imports out of the Svelte root', async () => {
  const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const main = await readFile(path.join(appRoot, 'src', 'main.ts'), 'utf8');
  const app = await readFile(path.join(appRoot, 'src', 'App.svelte'), 'utf8');
  const phone = await readFile(path.join(appRoot, 'src', 'lib', 'shells', 'PhoneAppShell.svelte'), 'utf8');
  assert.match(main, /import\('\.\/App\.svelte'\)/);
  assert.match(main, /import\('\.\/lib\/shells\/PhoneAppShell\.svelte'\)/);
  assert.match(main, /import\('\.\/lib\/shells\/PanelAppShell\.svelte'\)/);
  assert.doesNotMatch(app, /import\(['"].*AppShell/);
  assert.doesNotMatch(app, /^\s*import\s+\w+\s+from\s+['"].*AppShell/m);
  for (const forbidden of ['StatusBar', 'TabBar', 'StandbyFab', 'PlayerLayer', 'IconPicker', 'hero/']) {
    assert.equal(phone.includes(forbidden), false, `phone source contains forbidden path ${forbidden}`);
  }
});

test('never exposes an absolute local path in its JSON report', async () => {
  const distDir = await fixture();
  const report = await analyzeBuild({ distDir, budgets: generousBudgets });
  const json = JSON.stringify(report);

  assert.equal(json.includes(distDir), false);
  assert.equal(report.buildRoot, 'dist');
  for (const file of [
    ...report.initial.javascript.files,
    ...report.initial.css.files,
    ...report.dynamicChunks,
  ]) {
    assert.equal(path.isAbsolute(file.path), false);
  }
});
