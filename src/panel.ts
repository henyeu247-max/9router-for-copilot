import * as vscode from 'vscode';
import type { GatewayProvider } from './provider/gatewayProvider';
import type { HealthMonitor } from './status/healthMonitor';
import { DEFAULT_PROFILE_ID } from './profiles/profileTypes';
import { normalizeBaseUrl } from './api/client';

export interface PanelStatus {
  type: 'status';
  online: boolean;
  checking: boolean;
  /** online | auth | degraded | offline | checking */
  overall: string;
  url: string;
  modelCount: number;
  hasKey: boolean;
  profileName: string;
  profiles: Array<{ id: string; name: string; url: string; state: string; models: number }>;
  detail?: string;
}

/**
 * Sidebar webview (Activity Bar): connection state, server URL + API key for the
 * default profile, per-profile health, and quick actions. Layout and the
 * "status + Save & Test + links" concept follow diegosouzapw/OmniCopilot (MIT).
 * All server-provided text is rendered with textContent only (never innerHTML).
 */
export class NineRouterPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'nine-router.panel';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly provider: GatewayProvider,
    private readonly health: HealthMonitor,
    private readonly onSettingsSaved: () => Promise<void>
  ) {}

  async focus(): Promise<void> {
    await vscode.commands.executeCommand(`${NineRouterPanelProvider.viewId}.focus`);
  }

  async refreshStatus(): Promise<void> {
    if (!this.view) { return; }
    void this.view.webview.postMessage(this.buildStatus());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();

    view.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      try {
        await this.handleMessage(msg);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`9Router: ${text}`);
      }
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) { void this.refreshStatus(); }
    });
    void this.refreshStatus();
  }

  private async handleMessage(msg: Record<string, unknown>): Promise<void> {
    const store = this.provider.getProfileStore();
    switch (msg.type) {
      case 'ready':
        await this.refreshStatus();
        break;
      case 'test':
        await this.health.checkNow();
        await this.onSettingsSaved();
        await this.refreshStatus();
        break;
      case 'save': {
        const url = String(msg.url ?? '').trim();
        const key = String(msg.apiKey ?? '').trim();
        const profile = store.getProfile(DEFAULT_PROFILE_ID) ?? store.getDefaultProfile();
        await store.saveProfile({
          id: profile.id,
          name: profile.name,
          serverUrl: url || profile.serverUrl,
          // Empty field = keep the stored key; the explicit Clear button removes it.
          ...(key ? { apiKey: key } : {}),
        });
        this.provider.syncRuntimes();
        this.provider.invalidateModelCache();
        this.provider.refreshModels();
        await this.health.checkNow();
        await this.onSettingsSaved();
        await this.refreshStatus();
        break;
      }
      case 'clearKey': {
        const profile = store.getDefaultProfile();
        await store.setApiKey(profile.id, '');
        this.provider.syncRuntimes();
        this.provider.invalidateModelCache();
        this.provider.refreshModels();
        await this.onSettingsSaved();
        await this.refreshStatus();
        break;
      }
      case 'action': {
        const command = String(msg.command ?? '');
        // Only our own commands may be triggered from the webview.
        if (command.startsWith('9router-for-github-copilot.')) {
          await vscode.commands.executeCommand(command);
        }
        break;
      }
    }
  }

  private buildStatus(): PanelStatus {
    const snapshot = this.provider.getStatusSnapshot();
    const store = this.provider.getProfileStore();
    const def = store.getDefaultProfile();
    const overall = this.health.getOverall();
    const profiles = (snapshot.profiles ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      url: p.serverUrl,
      state: this.health.getState(p.id),
      models: p.modelCount,
    }));
    return {
      type: 'status',
      online: overall === 'online' || overall === 'degraded',
      checking: overall === 'checking',
      overall,
      url: normalizeBaseUrl(def.serverUrl),
      modelCount: snapshot.models.length,
      hasKey: Boolean(def.apiKey),
      profileName: def.name,
      profiles,
      detail: snapshot.connection.state === 'error' ? snapshot.connection.errorMessage : undefined,
    };
  }

  private html(): string {
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    const t = vscode.l10n.t;
    const S = {
      checking: t('Checking…'),
      testing: t('Testing…'),
      serverUrl: t('Server URL'),
      apiKey: t('API key'),
      keyPlaceholder: t('paste your API key (optional)'),
      saveTest: t('Save & Test'),
      clearKey: t('Clear key'),
      clearKeyTitle: t('Remove the stored API key'),
      keyStored: t('A key is stored. Leave the field empty to keep it.'),
      keyNone: t('No key stored — only needed if your gateway requires one.'),
      onlineWithCount: t('Online — {0} models available'),
      online: t('Online'),
      offline: t('Offline — gateway unreachable'),
      authError: t('Reachable, but the API key was rejected (401/403)'),
      degraded: t('Reachable, but the gateway is returning errors (5xx/429)'),
      profiles: t('Providers'),
      linkRefresh: t('Refresh models in the picker'),
      linkDashboard: t('Open 9Router dashboard'),
      linkAdd: t('Add provider profile'),
      linkLogs: t('Show output log'),
      linkDumps: t('Open request dumps folder'),
      linkSettings: t('Extension settings'),
    };
    const links: Array<[string, string, string]> = [
      ['refreshModels', '↻', S.linkRefresh],
      ['openDashboard', '▤', S.linkDashboard],
      ['addProvider', '＋', S.linkAdd],
      ['showOutput', '☰', S.linkLogs],
      ['openRequestDumps', '⬚', S.linkDumps],
      ['openSettings', '⚙', S.linkSettings],
    ];
    const linkHtml = links
      .map(([cmd, icon, label]) => `<span class="link" data-cmd="9router-for-github-copilot.${cmd}">${icon} ${label}</span>`)
      .join('\n    ');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 10px 14px; }
  h3 { margin: 4px 0 10px; font-size: 13px; display: flex; align-items: center; gap: 7px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--vscode-charts-red); display: inline-block; flex: none; }
  .dot.on { background: var(--vscode-charts-green); }
  .dot.wait { background: var(--vscode-charts-yellow); }
  .dot.warn { background: var(--vscode-charts-orange); }
  .muted { color: var(--vscode-descriptionForeground); font-size: 11.5px; margin: 2px 0 12px; word-break: break-all; }
  label { display: block; font-size: 11px; margin: 10px 0 3px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: .04em; }
  input { width: 100%; box-sizing: border-box; padding: 5px 7px; border-radius: 3px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); outline: none; }
  input:focus { border-color: var(--vscode-focusBorder); }
  .row { display: flex; gap: 6px; margin-top: 12px; }
  button { flex: 1; padding: 5px 8px; border: none; border-radius: 3px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .links { margin-top: 16px; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25)); padding-top: 8px; }
  .link { display: block; padding: 5px 2px; cursor: pointer; font-size: 12.5px; color: var(--vscode-textLink-foreground); }
  .link:hover { text-decoration: underline; }
  .badge { font-weight: 600; }
  .warn { color: var(--vscode-charts-orange); font-size: 11.5px; margin-top: 8px; word-break: break-word; }
  .keyhint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 3px; }
  .prof { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; }
  .prof .n { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>
  <h3><span id="dot" class="dot wait"></span><span id="statusText">${S.checking}</span></h3>
  <div class="muted" id="urlText"></div>

  <label for="url">${S.serverUrl}</label>
  <input id="url" type="text" placeholder="http://localhost:20128/v1" />

  <label for="key">${S.apiKey}</label>
  <input id="key" type="password" placeholder="${S.keyPlaceholder}" />
  <div class="keyhint" id="keyHint"></div>

  <div class="row">
    <button id="save">${S.saveTest.replace('&', '&amp;')}</button>
    <button id="clearKey" class="secondary" title="${S.clearKeyTitle}">${S.clearKey}</button>
  </div>
  <div class="warn" id="detail" style="display:none"></div>

  <div id="profWrap" style="display:none">
    <label>${S.profiles}</label>
    <div id="profList"></div>
  </div>

  <div class="links">
    ${linkHtml}
  </div>

  <script nonce="${nonce}">
    const S = ${JSON.stringify(S)};
    const vscodeApi = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);

    $('save').addEventListener('click', () => {
      vscodeApi.postMessage({ type: 'save', url: $('url').value, apiKey: $('key').value });
      $('key').value = '';
      $('statusText').textContent = S.testing;
    });
    $('clearKey').addEventListener('click', () => vscodeApi.postMessage({ type: 'clearKey' }));
    document.querySelectorAll('.link').forEach((el) =>
      el.addEventListener('click', () => vscodeApi.postMessage({ type: 'action', command: el.dataset.cmd }))
    );

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type !== 'status') return;
      const dotClass = (state) => state === 'online' ? ' on' : state === 'checking' ? ' wait' : (state === 'auth' || state === 'degraded') ? ' warn' : '';
      $('dot').className = 'dot' + dotClass(msg.overall);
      if (!$('url').value) $('url').value = msg.url;
      $('urlText').textContent = msg.url;
      $('keyHint').textContent = msg.hasKey ? S.keyStored : S.keyNone;
      const st = $('statusText');
      st.textContent = '';
      if (msg.checking) {
        st.textContent = S.checking;
      } else if (msg.overall === 'auth') {
        st.textContent = S.authError;
      } else if (msg.overall === 'degraded') {
        st.textContent = S.degraded;
      } else if (msg.online) {
        const [prefix, suffix] = S.onlineWithCount.split('{0}');
        st.append(prefix ?? '');
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = String(msg.modelCount);
        st.append(badge, suffix ?? '');
      } else {
        st.textContent = S.offline;
      }
      const d = $('detail');
      if (msg.detail) { d.textContent = msg.detail; d.style.display = 'block'; }
      else { d.style.display = 'none'; }

      const list = $('profList');
      list.textContent = '';
      const many = Array.isArray(msg.profiles) && msg.profiles.length > 1;
      $('profWrap').style.display = many ? 'block' : 'none';
      if (many) {
        for (const p of msg.profiles) {
          const row = document.createElement('div');
          row.className = 'prof';
          const dot = document.createElement('span');
          dot.className = 'dot' + dotClass(p.state);
          const name = document.createElement('span');
          name.className = 'n';
          name.textContent = p.name;
          name.title = p.url;
          const cnt = document.createElement('span');
          cnt.className = 'muted';
          cnt.style.margin = '0';
          cnt.textContent = String(p.models);
          row.append(dot, name, cnt);
          list.append(row);
        }
      }
    });

    vscodeApi.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
