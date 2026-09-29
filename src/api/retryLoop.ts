import { pickDegradeStep, type DegradeStep } from './degrade';

/**
 * The retry policy around one chat turn, extracted from the handler so it can be
 * tested without VS Code. `attempt` runs the whole request; `describe` reports
 * what the last request contained so we never propose stripping something absent.
 *
 * Guarantees: bounded (<= 1 overflow retry + 1 retry per DegradeStep), never retries
 * after output was streamed or after cancellation, and rethrows the ORIGINAL error
 * when no recovery applies.
 */
export interface RetryDeps {
  attempt: () => Promise<void>;
  /** True once anything reached the chat view (retrying would duplicate output). */
  partsReported: () => boolean;
  isCancelled: () => boolean;
  /** Learns the real context from an overflow error; true when a retry is worthwhile. */
  learnFromOverflow: (error: unknown) => boolean;
  /** What the LAST attempted request contained. */
  lastRequest: () => { hasReasoning: boolean; hasTools: boolean };
  /** Steps already stripped (shared with `attempt`, which applies them). */
  degraded: Set<DegradeStep>;
  log: (msg: string) => void;
}

export async function runWithRecovery(deps: RetryDeps): Promise<void> {
  let overflowRetried = false;
  for (;;) {
    try {
      await deps.attempt();
      return;
    } catch (error) {
      if (deps.partsReported() || deps.isCancelled()) { throw error; }
      if (!overflowRetried && deps.learnFromOverflow(error)) {
        overflowRetried = true;
        deps.log('Retrying chat request with corrected context size...');
        continue;
      }
      const last = deps.lastRequest();
      const step = pickDegradeStep(error, {
        hasReasoning: last.hasReasoning,
        hasTools: last.hasTools,
        done: deps.degraded,
      });
      if (!step) { throw error; }
      deps.degraded.add(step);
      deps.log(`Backend rejected the request (HTTP 400); retrying without ${step === 'tools' ? 'tools' : 'reasoning_effort'}...`);
    }
  }
}
