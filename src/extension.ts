import * as vscode from 'vscode';
import { GatewayProvider } from './provider/gatewayProvider';
import { GatewayInlineCompletionProvider } from './completions/inlineCompletionProvider';
import { StatusBarManager } from './status/statusBarManager';
import { registerCommands } from './commands';
import { registerUiCommands } from './commands/ui';
import { HealthMonitor } from './status/healthMonitor';
import { NineRouterPanelProvider } from './panel';

const STATUS_BAR_PROBE_DELAY_MS = 1500;

/**
 * Extension activation. Async so we can pull the API key + custom headers
 * out of SecretStorage (and migrate legacy plain-text settings, issue #28)
 * before registering the provider — otherwise the first model fetch races
 * the secret load and is sent unauthenticated.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const provider = new GatewayProvider(context);
  await provider.loadSecrets();

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('9router-github-copilot', provider),

    // Experimental standalone inline (ghost-text) completions backed by the
    // inference server's /v1/completions endpoint. Registered unconditionally
    // for all files; it no-ops unless the user opts in via
    // `enableInlineCompletion`, so toggling the setting takes effect without a
    // reload (issue #44).
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      new GatewayInlineCompletionProvider(provider)
    )
  );

  // Status bar entry: live request state (host when idle, model name while
  // streaming, model + token count afterwards). The rich hover tooltip is
  // rebuilt from the provider snapshot. Its visibility follows `statusBar`.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.name = '9Router';
  statusBar.command = '9router-for-github-copilot.quickActions';
  context.subscriptions.push(statusBar);

  const statusManager = new StatusBarManager(statusBar, () => provider.getStatusSnapshot());
  context.subscriptions.push(
    statusManager,
    provider.onDidChangeRequestState((event) => statusManager.onRequest(event)),
    provider.onDidChangeStatusSnapshot(() => statusManager.refreshTooltip())
  );

  const applyStatusBarVisibility = (): void => {
    const enabled = vscode.workspace
      .getConfiguration('9router-for-github-copilot')
      .get<boolean>('statusBar', true);
    if (enabled) {
      statusBar.show();
    } else {
      statusBar.hide();
    }
  };
  applyStatusBarVisibility();

  /**
   * Probe the gateway silently (no error toast) and render the result in the
   * status bar. Uses the provider's cached fetch so it doesn't double-hit the
   * server when VS Code is already asking for models.
   */
  const refreshStatusBar = async (): Promise<void> => {
    const cts = new vscode.CancellationTokenSource();
    try {
      const models = await provider.provideLanguageModelChatInformation({ silent: true }, cts.token);
      if (models.length > 0) {
        statusManager.setIdle(models.map((m) => m.id));
      } else {
        statusManager.setNoModels();
      }
    } catch (error) {
      statusManager.setError(error instanceof Error ? error.message : String(error));
    } finally {
      cts.dispose();
    }
  };

  // Periodic reachability probe: catches "gateway went away" without waiting
  // for the user to open the model picker. Reacts instantly to request outcomes.
  const health = new HealthMonitor({
    getTargets: () => provider.getHealthTargets(),
    onChange: () => {
      statusManager.refreshTooltip();
      void panelProvider.refreshStatus();
    },
    getIntervalSeconds: () =>
      vscode.workspace
        .getConfiguration('9router-for-github-copilot')
        .get<number>('healthCheckIntervalSeconds', 30),
  });
  context.subscriptions.push(health);
  provider.attachHealthMonitor(health);

  const panelProvider = new NineRouterPanelProvider(provider, health, async () => {
    await refreshStatusBar();
    health.restart();
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NineRouterPanelProvider.viewId, panelProvider)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('9router-for-github-copilot')) {
        return;
      }
      applyStatusBarVisibility();
      if (
        e.affectsConfiguration('9router-for-github-copilot.healthCheckIntervalSeconds') ||
        e.affectsConfiguration('9router-for-github-copilot.serverUrl')
      ) {
        health.restart();
      }
      void panelProvider.refreshStatus();
    })
  );

  // Initial silent probe shortly after activation, once VS Code has settled.
  const initialProbeTimer = setTimeout(() => {
    void refreshStatusBar();
    health.start();
  }, STATUS_BAR_PROBE_DELAY_MS);
  context.subscriptions.push({ dispose: () => clearTimeout(initialProbeTimer) });

  registerCommands(context, provider, statusManager, refreshStatusBar);
  registerUiCommands(context, provider, panelProvider, health, refreshStatusBar);
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  // no-op
}
