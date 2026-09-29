import * as vscode from 'vscode';
import type { GatewayProvider } from '../provider/gatewayProvider';
import type { HealthMonitor } from '../status/healthMonitor';
import type { NineRouterPanelProvider } from '../panel';
import { normalizeBaseUrl } from '../api/client';
import { canFrame } from '../api/dashboard';

const NS = '9router-for-github-copilot';

/** Server root (no /v1) of the default profile, or the explicit `dashboardUrl` setting. */
export function resolveDashboardUrl(explicit: string, serverUrl: string): string {
  const e = explicit.trim();
  return e || normalizeBaseUrl(serverUrl);
}

/**
 * Commands that belong to the UI layer: quick-actions menu (status bar click),
 * dashboard opener, settings, dump folder, key clearing. The quick-actions +
 * dashboard-in-editor behaviour follows diegosouzapw/OmniCopilot (MIT).
 */
export function registerUiCommands(
  context: vscode.ExtensionContext,
  provider: GatewayProvider,
  panel: NineRouterPanelProvider,
  health: HealthMonitor,
  refreshStatusBar: () => Promise<void>
): void {
  const cfg = () => vscode.workspace.getConfiguration(NS);
  const reg = (name: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(`${NS}.${name}`, fn));

  reg('openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', NS));

  reg('quickActions', async () => {
    const overall = health.getOverall();
    const state =
      overall === 'online' ? '$(circle-filled) '
      : overall === 'offline' ? '$(circle-slash) '
      : overall === 'auth' || overall === 'degraded' ? '$(warning) '
      : '$(sync) ';
    const items: Array<vscode.QuickPickItem & { command?: string }> = [
      { label: `${state}${vscode.l10n.t('Open 9Router panel')}`, command: `${NS}.showPanel` },
      { label: `$(refresh) ${vscode.l10n.t('Refresh models')}`, command: `${NS}.refreshModels` },
      { label: `$(plug) ${vscode.l10n.t('Test server connection')}`, command: `${NS}.testConnection` },
      { label: `$(browser) ${vscode.l10n.t('Open 9Router dashboard')}`, command: `${NS}.openDashboard` },
      { label: `$(add) ${vscode.l10n.t('Add provider profile')}`, command: `${NS}.addProvider` },
      { label: `$(output) ${vscode.l10n.t('Show output log')}`, command: `${NS}.showOutput` },
      { label: `$(folder-opened) ${vscode.l10n.t('Open request dumps folder')}`, command: `${NS}.openRequestDumps` },
      { label: `$(gear) ${vscode.l10n.t('Extension settings')}`, command: `${NS}.openSettings` },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: '9Router', placeHolder: vscode.l10n.t('Choose an action') });
    if (pick?.command) { await vscode.commands.executeCommand(pick.command); }
  });

  reg('showPanel', () => panel.focus());

  reg('openDashboard', async () => {
    const url = resolveDashboardUrl(cfg().get<string>('dashboardUrl', ''), provider.getProfileStore().getDefaultProfile().serverUrl);
    if (cfg().get<string>('dashboardOpen', 'external') === 'editor') {
      if (await canFrame(url)) {
        try {
          await vscode.commands.executeCommand('simpleBrowser.show', url);
          return;
        } catch {
          // fall through to the external browser
        }
      } else {
        void vscode.window.showInformationMessage(
          vscode.l10n.t('The dashboard does not allow embedding in an editor tab; opening it in your browser instead.')
        );
      }
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  });

  reg('openRequestDumps', async () => {
    const dir = provider.getDumpDir();
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
  });

  reg('clearApiKey', async () => {
    const store = provider.getProfileStore();
    const def = store.getDefaultProfile();
    await store.setApiKey(def.id, '');
    provider.syncRuntimes();
    provider.invalidateModelCache();
    provider.refreshModels();
    await health.checkNow();
    await refreshStatusBar();
    void vscode.window.showInformationMessage(vscode.l10n.t('9Router: API key cleared.'));
  });
}
