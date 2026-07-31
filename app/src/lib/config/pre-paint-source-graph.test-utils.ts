// @ts-expect-error Native Node test utility without @types/node.
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error Native Node test utility without @types/node.
import { dirname, extname, resolve } from 'node:path';
import { parse as parseSvelte } from 'svelte/compiler';
import ts from 'typescript';

export interface PrePaintSourceGraphOptions {
  sourceOverrides?: ReadonlyMap<string, string>;
}

type RuntimeImport = Readonly<{
  specifier: string;
  importedName: string;
  modulePath?: string;
}>;

type ParsedModule = Readonly<{
  sourceFile: ts.SourceFile;
  staticSpecifiers: readonly string[];
  staticBindings: ReadonlyMap<string, RuntimeImport>;
}>;

const SOURCE_EXTENSIONS = new Set(['.ts', '.svelte', '.json']);

function normalized(path: string): string {
  return resolve(path);
}

function sourceFor(path: string, overrides: ReadonlyMap<string, string>): string {
  return overrides.get(normalized(path)) ?? readFileSync(path, 'utf8');
}

function scriptSource(path: string, source: string): string {
  if (!path.endsWith('.svelte')) return source;
  const parsed = parseSvelte(source, { filename: path, modern: true });
  const instance = parsed.instance;
  if (!instance) return '';
  const content = instance.content as typeof instance.content & { start: number; end: number };
  return source.slice(content.start, content.end);
}

function importClauseHasRuntimeValue(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings?.elements.some((element) => !element.isTypeOnly) ?? false;
}

function exportDeclarationHasRuntimeValue(declaration: ts.ExportDeclaration): boolean {
  if (declaration.isTypeOnly) return false;
  if (!declaration.exportClause || ts.isNamespaceExport(declaration.exportClause)) return true;
  return declaration.exportClause.elements.some((element) => !element.isTypeOnly);
}

function parseModule(path: string, overrides: ReadonlyMap<string, string>): ParsedModule {
  const source = scriptSource(path, sourceFor(path, overrides));
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) throw new Error(`Cannot parse pre-paint source module: ${path}`);

  const staticSpecifiers: string[] = [];
  const staticBindings = new Map<string, RuntimeImport>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      if (!importClauseHasRuntimeValue(statement.importClause)) continue;
      staticSpecifiers.push(specifier);
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) staticBindings.set(clause.name.text, { specifier, importedName: 'default' });
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        staticBindings.set(clause.namedBindings.name.text, { specifier, importedName: '*' });
      } else if (clause.namedBindings) {
        for (const element of clause.namedBindings.elements) {
          if (element.isTypeOnly) continue;
          staticBindings.set(element.name.text, {
            specifier,
            importedName: (element.propertyName ?? element.name).text,
          });
        }
      }
    } else if (
      ts.isExportDeclaration(statement)
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
      && exportDeclarationHasRuntimeValue(statement)
    ) {
      staticSpecifiers.push(statement.moduleSpecifier.text);
    }
  }
  return { sourceFile, staticSpecifiers: [...new Set(staticSpecifiers)], staticBindings };
}

function resolveSourceModule(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  const base = resolve(dirname(importer), cleanSpecifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.svelte`,
    `${base}.json`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.svelte'),
    resolve(base, 'index.json'),
  ];
  const resolved = candidates.find(existsSync);
  if (!resolved) throw new Error(`Cannot resolve local pre-paint import ${specifier} from ${importer}`);

  // CSS is inventoried by the production-build budget. Paraglide JavaScript is
  // generated compiler output rather than an authored application source family.
  if (resolved.includes('/src/paraglide/') || !SOURCE_EXTENSIONS.has(extname(resolved))) return null;
  return normalized(resolved);
}

function literalDynamicSpecifier(call: ts.CallExpression): string | null | undefined {
  if (call.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined;
  if (call.arguments.length !== 1) return null;
  const argument = call.arguments[0];
  return ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
    ? argument.text
    : null;
}

function isFunctionBoundary(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isClassExpression(node);
}

function immediateCalls(node: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (candidate: ts.Node): void => {
    if (candidate !== node && isFunctionBoundary(candidate)) return;
    if (ts.isCallExpression(candidate)) calls.push(candidate);
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return calls;
}

function dynamicImportsExecutedNow(
  node: ts.Node,
  importer: string,
  addSeed: (path: string) => void,
): void {
  for (const call of immediateCalls(node)) {
    const specifier = literalDynamicSpecifier(call);
    if (specifier === undefined) continue;
    if (specifier === null) throw new Error(`Non-literal dynamic import in pre-paint execution: ${importer}`);
    const target = resolveSourceModule(importer, specifier);
    if (target) addSeed(target);
  }
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAwaitExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function dynamicImportBinding(
  declaration: ts.VariableDeclaration,
  importer: string,
): Map<string, RuntimeImport> {
  const bindings = new Map<string, RuntimeImport>();
  if (!declaration.initializer) return bindings;
  const expression = unwrapExpression(declaration.initializer);
  if (!ts.isCallExpression(expression)) return bindings;
  const specifier = literalDynamicSpecifier(expression);
  if (specifier === undefined) return bindings;
  if (specifier === null) throw new Error(`Non-literal dynamic import in pre-paint execution: ${importer}`);
  const modulePath = resolveSourceModule(importer, specifier);
  if (!modulePath) return bindings;

  if (ts.isIdentifier(declaration.name)) {
    bindings.set(declaration.name.text, { specifier, importedName: '*', modulePath });
  } else if (ts.isObjectBindingPattern(declaration.name)) {
    for (const element of declaration.name.elements) {
      if (!ts.isIdentifier(element.name)) throw new Error(`Unsupported pre-paint import binding in ${importer}`);
      const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : element.name.text;
      bindings.set(element.name.text, { specifier, importedName, modulePath });
    }
  }
  return bindings;
}

function calledBinding(call: ts.CallExpression): string | null {
  const expression = unwrapExpression(call.expression);
  return ts.isIdentifier(expression) ? expression.text : null;
}

function exportedFunction(module: ParsedModule, exportName: string): ts.FunctionLikeDeclaration | null {
  for (const statement of module.sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === exportName
      && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) return statement;
    if (ts.isVariableStatement(statement)
      && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name)
          && declaration.name.text === exportName
          && declaration.initializer
          && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
        ) return declaration.initializer;
      }
    }
  }
  return null;
}

function functionBodyStatements(functionNode: ts.FunctionLikeDeclaration): readonly ts.Statement[] {
  if (!functionNode.body) throw new Error('Pre-paint function has no body.');
  if (ts.isBlock(functionNode.body)) return functionNode.body.statements;
  return [ts.factory.createReturnStatement(functionNode.body)];
}

function executeUntilLocalMount(
  functionNode: ts.FunctionLikeDeclaration,
  importer: string,
  parsed: (path: string) => ParsedModule,
  addSeed: (path: string) => void,
  activeCalls: Set<string>,
): boolean {
  const module = parsed(importer);
  const bindings = new Map(module.staticBindings);
  for (const [name, binding] of bindings) {
    const modulePath = resolveSourceModule(importer, binding.specifier) ?? undefined;
    bindings.set(name, { ...binding, modulePath });
  }

  for (const statement of functionBodyStatements(functionNode)) {
    dynamicImportsExecutedNow(statement, importer, addSeed);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const [name, binding] of dynamicImportBinding(declaration, importer)) bindings.set(name, binding);
      }
    }

    for (const call of immediateCalls(statement)) {
      const localName = calledBinding(call);
      if (!localName) continue;
      const binding = bindings.get(localName);
      if (!binding) continue;
      if (binding.specifier === 'svelte' && binding.importedName === 'mount') return true;
      if (!binding.modulePath || binding.importedName === '*' || binding.importedName === 'default') continue;

      const callKey = `${binding.modulePath}#${binding.importedName}`;
      if (activeCalls.has(callKey)) throw new Error(`Recursive pre-paint call before local mount: ${callKey}`);
      const targetFunction = exportedFunction(parsed(binding.modulePath), binding.importedName);
      if (!targetFunction) throw new Error(`Cannot resolve pre-paint function ${callKey}`);
      activeCalls.add(callKey);
      const mounted = executeUntilLocalMount(
        targetFunction,
        binding.modulePath,
        parsed,
        addSeed,
        activeCalls,
      );
      activeCalls.delete(callKey);
      if (mounted) return true;
    }
  }
  return false;
}

function bootstrapCallInProductivePath(sourceFile: ts.SourceFile): ts.CallExpression {
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== sourceFile && isFunctionBoundary(node)) return;
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'bootstrapHouseholdConfigFirstPaint'
    ) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (matches.length !== 1) throw new Error('Expected exactly one productive first-paint bootstrap call.');
  return matches[0];
}

function containingBlockStatement(call: ts.CallExpression): { block: ts.Block; statement: ts.Statement } {
  let statement: ts.Node = call;
  while (statement.parent && !ts.isStatement(statement)) statement = statement.parent;
  if (!ts.isStatement(statement) || !statement.parent || !ts.isBlock(statement.parent)) {
    throw new Error('First-paint bootstrap call must be a direct block statement.');
  }
  return { block: statement.parent, statement };
}

function variableFunction(block: ts.Block, name: string): ts.FunctionLikeDeclaration {
  for (const statement of block.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === name
        && declaration.initializer
        && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
      ) return declaration.initializer;
    }
  }
  throw new Error(`Cannot resolve first-paint callback ${name}.`);
}

function startLocalShellCallback(call: ts.CallExpression, block: ts.Block): ts.FunctionLikeDeclaration {
  const argument = call.arguments[0];
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    throw new Error('First-paint bootstrap dependencies must be an object literal.');
  }
  for (const property of argument.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'startLocalShell') {
      return variableFunction(block, property.name.text);
    }
    if (ts.isPropertyAssignment(property)
      && property.name.getText() === 'startLocalShell'
      && (ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer))) {
      return property.initializer;
    }
  }
  throw new Error('First-paint bootstrap must provide startLocalShell.');
}

/**
 * Collect authored modules executed on the productive path through the complete
 * local-shell mount. Post-mount callbacks and authorized App imports are not
 * traversed. CSS is measured from build metadata, and generated Paraglide output
 * remains a compiler-output boundary.
 */
export function collectProductivePrePaintSourceGraph(
  mainPath: string,
  { sourceOverrides = new Map() }: PrePaintSourceGraphOptions = {},
): Set<string> {
  const normalizedOverrides = new Map(
    [...sourceOverrides].map(([path, source]) => [normalized(path), source] as const),
  );
  const cache = new Map<string, ParsedModule>();
  const parsed = (path: string): ParsedModule => {
    const key = normalized(path);
    let value = cache.get(key);
    if (!value) {
      value = parseModule(key, normalizedOverrides);
      cache.set(key, value);
    }
    return value;
  };

  const main = normalized(mainPath);
  const mainModule = parsed(main);
  const bootstrapCall = bootstrapCallInProductivePath(mainModule.sourceFile);
  const { block, statement: bootstrapStatement } = containingBlockStatement(bootstrapCall);
  const seeds = new Set<string>();
  const addSeed = (path: string): void => { seeds.add(path); };

  for (const statement of block.statements) {
    if (statement === bootstrapStatement) break;
    dynamicImportsExecutedNow(statement, main, addSeed);
  }

  const localShell = startLocalShellCallback(bootstrapCall, block);
  if (!executeUntilLocalMount(localShell, main, parsed, addSeed, new Set())) {
    throw new Error('The productive first-paint path did not reach the local Svelte mount.');
  }

  const graph = new Set<string>();
  const queue = [main, ...seeds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (graph.has(current)) continue;
    graph.add(current);
    if (current.endsWith('.json')) continue;
    for (const specifier of parsed(current).staticSpecifiers) {
      const target = resolveSourceModule(current, specifier);
      if (target) queue.push(target);
    }
  }
  return graph;
}
