/**
 * Why a streaming chat request ended early, in words a person can act on. Pure (no `vscode`), so the
 * health monitor and the tests can use it too.
 */

/** What ended a streaming request early. */
export type StreamAbortCause = 'cancelled' | 'no-response' | 'silent';

/** Message stems the health monitor recognises: a slow answer is "degraded", not "offline". */
export const NO_RESPONSE_MESSAGE = 'No response from the gateway';
export const SILENT_STREAM_MESSAGE = 'The stream went silent';

/**
 * A plain "This operation was aborted" says nothing: a user pressing stop, a wait for the first
 * byte and a model that thinks silently for a while all look identical. Name the cause.
 */
export function describeStreamAbort(cause: StreamAbortCause, timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  switch (cause) {
    case 'cancelled':
      return 'Request cancelled (stopped from VS Code).';
    case 'no-response':
      return `${NO_RESPONSE_MESSAGE} within ${seconds}s (waiting for the first byte). Very large contexts and high thinking effort can take longer: raise the requestTimeout setting.`;
    case 'silent':
      return `${SILENT_STREAM_MESSAGE}: no data for ${seconds}s. A model thinking for a long time can do this: raise the requestTimeout setting.`;
  }
}
