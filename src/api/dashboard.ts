/**
 * Dashboard embedding probe. The header logic (`isFramingAllowed`) lives in
 * ../embed.ts (from diegosouzapw/OmniCopilot, MIT - see NOTICE); this adds the
 * network probe. Fails closed: an unreachable server is not embeddable.
 */
import { isFramingAllowed } from '../embed';

/** HEAD the URL and evaluate framing headers. Never throws. */
export async function canFrame(url: string, timeoutMs = 4000): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return isFramingAllowed(res.headers);
  } catch {
    return false;
  }
}
