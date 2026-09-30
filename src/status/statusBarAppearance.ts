/**
 * Pure mapping from gateway health to how the status bar item looks.
 *
 * Same idea as OmniCopilot's status dot (credited in NOTICE): green = working,
 * warning/yellow = reachable but not fully OK, red = unreachable. VS Code only
 * lets an item take `statusBarItem.warningBackground` / `errorBackground` as
 * background, so those two carry yellow and red; green is a foreground colour.
 */
import type { HealthStatus } from './healthMonitor';

export interface StatusBarAppearance {
  /** Codicon id without `$( )`. */
  readonly icon: string;
  /** ThemeColor id for the text/icon colour, if any. */
  readonly color?: string;
  /** ThemeColor id for the item background, if any. */
  readonly background?: string;
  /** English label; localised by the caller. */
  readonly label: 'Online' | 'Checking…' | 'Rejected — check your API key' | 'Degraded — server is erroring or rate limiting' | 'Offline — gateway unreachable';
}

export function statusBarAppearance(health: HealthStatus, busy: boolean): StatusBarAppearance {
  // A request in flight always shows the spinner, whatever the last probe said.
  if (busy) { return { icon: 'sync~spin', label: 'Online' }; }
  switch (health) {
    case 'online':
      return { icon: 'circle-filled', color: 'testing.iconPassed', label: 'Online' };
    case 'auth':
      return { icon: 'key', background: 'statusBarItem.warningBackground', label: 'Rejected — check your API key' };
    case 'degraded':
      return { icon: 'warning', background: 'statusBarItem.warningBackground', label: 'Degraded — server is erroring or rate limiting' };
    case 'offline':
      return { icon: 'circle-slash', background: 'statusBarItem.errorBackground', label: 'Offline — gateway unreachable' };
    default:
      return { icon: 'sync~spin', label: 'Checking…' };
  }
}
