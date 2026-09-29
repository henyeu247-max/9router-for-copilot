// Smoke test for the PRODUCTION bundle (dist/extension.js). Run: npm run smoke
// Loads the bundle against a recording fake of `vscode`, calls activate() and checks:
//  - activate() does not throw
//  - the LM provider vendor, the webview view and the inline provider are registered
//  - every command declared in package.json is actually registered (and vice versa for ours)
// It proves wiring only; it cannot prove UI rendering or a live chat.
const Module = require('module');
const os = require('os');
const path = require('path');
const pkg = require('../package.json');

const registered = { commands: new Set(), providers: [], views: [], inline: 0, statusItems: 0 };
const disposable = { dispose() {} };
const emitter = () => ({ event: () => disposable, fire() {}, dispose() {} });

class MarkdownString {
  constructor(v) { this.value = v || ''; }
  appendMarkdown(t) { this.value += t; return this; }
  appendText(t) { this.value += t; return this; }
}
class Uri {
  static file(p) { return { fsPath: p }; }
  static parse(s) { return { s }; }
}
const config = { get: (k, d) => d, update: async () => {}, inspect: () => undefined };

const vscode = {
  MarkdownString, Uri,
  EventEmitter: function () { return emitter(); },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeIcon: function (id) { this.id = id; },
  ThemeColor: function (id) { this.id = id; },
  ConfigurationTarget: { Global: 1 },
  CancellationTokenSource: function () {
    this.token = { isCancellationRequested: false, onCancellationRequested: () => disposable };
    this.dispose = () => {};
    this.cancel = () => {};
  },
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
  LanguageModelTextPart: class {}, LanguageModelToolCallPart: class {}, LanguageModelToolResultPart: class {},
  LanguageModelDataPart: class {}, LanguageModelThinkingPart: class {},
  l10n: { t: (s, ...a) => String(s).replace(/\{(\d+)\}/g, (_, i) => a[i]) },
  workspace: {
    getConfiguration: () => config,
    onDidChangeConfiguration: () => disposable,
    fs: { createDirectory: async () => {} },
  },
  window: {
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    createStatusBarItem: () => { registered.statusItems++; return { show() {}, hide() {}, dispose() {} }; },
    registerWebviewViewProvider: (id) => { registered.views.push(id); return disposable; },
    showInformationMessage: async () => undefined, showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined, showQuickPick: async () => undefined,
    setStatusBarMessage: () => disposable,
  },
  commands: {
    registerCommand: (id) => { registered.commands.add(id); return disposable; },
    executeCommand: async () => undefined,
  },
  lm: { registerLanguageModelChatProvider: (vendor) => { registered.providers.push(vendor); return disposable; } },
  languages: { registerInlineCompletionItemProvider: () => { registered.inline++; return disposable; } },
  env: { openExternal: async () => true },
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'vscode' ? vscode : originalLoad.call(this, request, ...rest);
};

const secrets = new Map();
const context = {
  subscriptions: [],
  globalStorageUri: { fsPath: path.join(os.tmpdir(), '9router-smoke') },
  extension: { packageJSON: pkg },
  secrets: {
    get: async (k) => secrets.get(k),
    store: async (k, v) => { secrets.set(k, v); },
    delete: async (k) => { secrets.delete(k); },
    onDidChange: () => disposable,
  },
  globalState: { get: (k, d) => d, update: async () => {}, keys: () => [] },
  workspaceState: { get: (k, d) => d, update: async () => {}, keys: () => [] },
};

(async () => {
  const ext = require('../dist/extension.js');
  await ext.activate(context);

  const declared = pkg.contributes.commands.map((c) => c.command);
  const ours = [...registered.commands].filter((c) => c.startsWith('9router-for-github-copilot.'));
  const problems = [];

  const missing = declared.filter((c) => !registered.commands.has(c));
  if (missing.length) { problems.push('declared but NOT registered: ' + missing.join(', ')); }
  const undeclared = ours.filter((c) => !declared.includes(c));
  if (undeclared.length) { problems.push('registered but NOT declared in package.json: ' + undeclared.join(', ')); }

  const vendor = pkg.contributes.languageModelChatProviders[0].vendor;
  if (!registered.providers.includes(vendor)) { problems.push('LM provider vendor not registered: ' + vendor); }
  const viewId = pkg.contributes.views['nine-router'][0].id;
  if (!registered.views.includes(viewId)) { problems.push('webview view not registered: ' + viewId); }
  if (registered.inline !== 1) { problems.push('expected 1 inline completion provider, got ' + registered.inline); }

  ext.deactivate();
  console.log(JSON.stringify({
    commandsRegistered: registered.commands.size, declared: declared.length,
    providers: registered.providers, views: registered.views,
    statusItems: registered.statusItems, subscriptions: context.subscriptions.length, problems,
  }, null, 2));
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('ACTIVATE THREW:', (e && e.stack) || e); process.exit(2); });
