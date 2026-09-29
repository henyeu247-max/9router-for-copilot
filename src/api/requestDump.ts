/**
 * Request dump: build a redacted, self-describing JSON document for one chat
 * request, and decide where/whether to write it. Pure logic (no `vscode`, no
 * fs) - `writeDump` takes an injected `writeFile`, so it is unit-testable.
 *
 * debugMode: off      -> nothing is written
 *            metadata -> sizes / roles / tool names only, no message content
 *            verbose  -> full request body (secrets ALWAYS redacted)
 */
import { redactSensitiveValue } from './privacy';

export type DebugMode = 'off' | 'metadata' | 'verbose';

export const MAX_DUMP_FILES = 50;

export function normalizeDebugMode(value: unknown): DebugMode {
  return value === 'metadata' || value === 'verbose' ? value : 'off';
}

interface MsgLike { role?: unknown; content?: unknown; tool_calls?: unknown }

function contentLength(content: unknown): number {
  if (typeof content === 'string') { return content.length; }
  if (Array.isArray(content)) {
    return content.reduce((n: number, p) => n + (typeof (p as { text?: unknown })?.text === 'string' ? (p as { text: string }).text.length : 0), 0);
  }
  return 0;
}

/** Content-free summary of a request (safe to attach to a bug report). */
export function summarizeRequest(request: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(request.messages) ? (request.messages as MsgLike[]) : [];
  const tools = Array.isArray(request.tools) ? (request.tools as Array<{ function?: { name?: unknown } }>) : [];
  const { messages: _m, tools: _t, ...rest } = request;
  void _m; void _t;
  return {
    params: redactSensitiveValue(rest),
    messageCount: messages.length,
    messages: messages.map((m) => ({
      role: m.role,
      chars: contentLength(m.content),
      toolCalls: Array.isArray(m.tool_calls) ? m.tool_calls.length : 0,
      hasImage: Array.isArray(m.content) && (m.content as Array<{ type?: unknown }>).some((p) => p?.type === 'image_url'),
    })),
    toolCount: tools.length,
    toolNames: tools.map((t) => String(t.function?.name ?? '')),
  };
}

export interface DumpInput {
  mode: DebugMode;
  profileName: string;
  modelId: string;
  request: Record<string, unknown>;
  extra?: Record<string, unknown>;
  now?: Date;
}

/** Build the document to write, or undefined when debugging is off. */
export function buildDump(input: DumpInput): Record<string, unknown> | undefined {
  if (input.mode === 'off') { return undefined; }
  const doc: Record<string, unknown> = {
    when: (input.now ?? new Date()).toISOString(),
    mode: input.mode,
    profile: input.profileName,
    model: input.modelId,
    summary: summarizeRequest(input.request),
    ...(input.extra ? { extra: redactSensitiveValue(input.extra) } : {}),
  };
  if (input.mode === 'verbose') { doc.request = redactSensitiveValue(input.request); }
  return doc;
}

/** Safe, sortable file name: 2026-09-30T05-57-12-345Z_<model>.json */
export function dumpFileName(now: Date, modelId: string): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const safeModel = modelId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60) || 'model';
  return `${stamp}_${safeModel}.json`;
}

/** Names to delete so at most `keep` dump files remain (oldest first). */
export function pickDumpsToPrune(names: readonly string[], keep = MAX_DUMP_FILES): string[] {
  const dumps = names.filter((n) => n.endsWith('.json')).sort();
  return dumps.length > keep ? dumps.slice(0, dumps.length - keep) : [];
}

export interface DumpFs {
  mkdir(dir: string): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
  readdir(dir: string): Promise<string[]>;
  unlink(path: string): Promise<void>;
}

/** Write one dump; never throws (debugging must not break chat). Returns the path or undefined. */
export async function writeDump(fs: DumpFs, dir: string, input: DumpInput): Promise<string | undefined> {
  try {
    const doc = buildDump(input);
    if (!doc) { return undefined; }
    await fs.mkdir(dir);
    const path = `${dir}/${dumpFileName(input.now ?? new Date(), input.modelId)}`;
    await fs.writeFile(path, JSON.stringify(doc, null, 2));
    for (const old of pickDumpsToPrune(await fs.readdir(dir))) {
      await fs.unlink(`${dir}/${old}`).catch(() => undefined);
    }
    return path;
  } catch {
    return undefined;
  }
}
