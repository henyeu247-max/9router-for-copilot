/**
 * Periodic reachability probe for every enabled profile.
 *
 * Pure (no `vscode` import): timers and probes are injected so the state
 * machine is unit-testable. The status bar / panel read `getState()`; request
 * outcomes reported through `reportRequest` flip the state instantly instead
 * of waiting for the next tick. The probe idea (cheap HEAD/GET /v1/models plus
 * a status dot) is credited to diegosouzapw/OmniCopilot - see NOTICE.
 */

/**
 * online   = gateway answered and the request was accepted (2xx/3xx/404)
 * auth     = gateway is up but rejected our credentials (401/403)
 * degraded = gateway is up but erroring (5xx / 429)
 * offline  = no answer (network error / timeout)
 */
import { NO_RESPONSE_MESSAGE, SILENT_STREAM_MESSAGE } from '../api/streamAbort';

export type HealthStatus = 'online' | 'auth' | 'degraded' | 'offline' | 'checking';

/** Classify an HTTP status from the probe. `undefined` = no answer at all. */
export function classifyHttpStatus(status: number | undefined): HealthStatus {
  if (status === undefined) { return 'offline'; }
  if (status === 401 || status === 403) { return 'auth'; }
  if (status === 429 || status >= 500) { return 'degraded'; }
  return 'online';
}

export interface HealthTarget {
  readonly id: string;
  readonly name: string;
  /** Resolves the HTTP status (or undefined = no answer); a throw counts as offline. */
  ping(): Promise<number | undefined>;
}

export interface HealthDeps {
  getTargets: () => readonly HealthTarget[];
  onChange: () => void;
  getIntervalSeconds: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export const MIN_HEALTH_INTERVAL_SECONDS = 5;

export class HealthMonitor {
  private readonly states = new Map<string, HealthStatus>();
  private handle: unknown;
  private disposed = false;

  constructor(private readonly deps: HealthDeps) {}

  getState(profileId: string): HealthStatus {
    return this.states.get(profileId) ?? 'checking';
  }

  /**
   * Overall = the best state among profiles (any working provider makes the
   * extension usable): online > degraded > auth > offline. `checking` only
   * while nothing has answered yet.
   */
  getOverall(): HealthStatus {
    const values = [...this.states.values()];
    if (values.length === 0) { return 'checking'; }
    for (const s of ['online', 'degraded', 'auth', 'offline'] as const) {
      if (values.includes(s)) { return s; }
    }
    return 'checking';
  }

  start(): void {
    this.schedule();
    void this.checkNow();
  }

  restart(): void {
    this.schedule();
    void this.checkNow();
  }

  /** A real chat request finished: trust it over the last probe. */
  reportRequest(profileId: string, ok: boolean): void {
    this.set(profileId, ok ? 'online' : 'offline');
  }

  /**
   * A chat request failed. Classify by what the failure says instead of calling
   * every error "offline": a 400 means the gateway answered (online), 401/403 is
   * auth, 429/5xx is degraded, and only "no HTTP answer at all" is offline.
   */
  reportRequestError(profileId: string, errorMessage: string): void {
    const m = /(?:failed|returned|HTTP)[: ]+(\d{3})\b/i.exec(errorMessage);
    if (!m && (errorMessage.includes(NO_RESPONSE_MESSAGE) || errorMessage.includes(SILENT_STREAM_MESSAGE))) {
      this.set(profileId, 'degraded'); // it answers, just slowly: not offline
      return;
    }
    this.set(profileId, classifyHttpStatus(m ? Number(m[1]) : undefined));
  }

  /** Probe every target now; resolves once all have answered. */
  async checkNow(): Promise<HealthStatus> {
    const targets = this.deps.getTargets();
    // Forget profiles that no longer exist.
    const ids = new Set(targets.map((t) => t.id));
    for (const id of [...this.states.keys()]) {
      if (!ids.has(id)) { this.states.delete(id); }
    }
    await Promise.all(
      targets.map(async (t) => {
        let status: number | undefined;
        try {
          status = await t.ping();
        } catch {
          status = undefined;
        }
        if (!this.disposed) { this.set(t.id, classifyHttpStatus(status)); }
      })
    );
    return this.getOverall();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  private schedule(): void {
    this.clear();
    if (this.disposed) { return; }
    const seconds = Math.max(this.deps.getIntervalSeconds(), MIN_HEALTH_INTERVAL_SECONDS);
    const set = this.deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    this.handle = set(() => void this.checkNow(), seconds * 1000);
  }

  private clear(): void {
    if (this.handle === undefined) { return; }
    const clear = this.deps.clearInterval ?? ((h: unknown) => clearInterval(h as NodeJS.Timeout));
    clear(this.handle);
    this.handle = undefined;
  }

  private set(id: string, status: HealthStatus): void {
    if (this.states.get(id) === status) { return; }
    this.states.set(id, status);
    this.deps.onChange();
  }
}
