/**
 * Vision proxy: text-only models can't take `image_url` parts. Instead of
 * silently dropping images, describe them with a vision-capable model and
 * inline the description as text.
 *
 * Prompt text adapted from Vizards/deepseek-v4-for-copilot (MIT) - see NOTICE.
 * Pure (no `vscode` import) so it is unit-testable under `node --test`.
 */
export const IMAGE_DESCRIPTION_PROMPT =
  'Describe all image attachments in this message.\n\n' +
  'If there is one image, describe it directly.\n' +
  'If there are multiple images:\n' +
  '1. Describe each image separately, preserving their order.\n' +
  '2. Then provide a combined description explaining the overall context and relationships across the images.\n\n' +
  'Return one concise factual description suitable for inserting into a text-only chat prompt. ' +
  'Include visible text, objects, UI elements, people, and relevant context. Do not invent details.';

/** Kept in English and out of i18n so the prompt shape is stable across UI languages. */
export const IMAGE_DESCRIPTION_UNAVAILABLE = '[Image Description unavailable]';
export const IMAGE_DESCRIPTION_PREFIX = '[The user attached an image. Here is its description: ';
export const IMAGE_DESCRIPTION_SUFFIX = ']';

type Part = { type?: unknown; text?: unknown; image_url?: { url?: unknown } };
type Msg = Record<string, unknown>;

export type ImageDescriber = (imageUrls: string[]) => Promise<string>;

function isImagePart(p: unknown): p is Part {
  return !!p && typeof p === 'object' && (p as Part).type === 'image_url';
}

/** True when any message carries an `image_url` content part. */
export function messagesHaveImages(messages: readonly Msg[]): boolean {
  return messages.some((m) => Array.isArray(m.content) && (m.content as unknown[]).some(isImagePart));
}

/**
 * Replace image parts in every message with a text description. Images within
 * one message are described together in a single call. Never throws: a failed
 * description becomes IMAGE_DESCRIPTION_UNAVAILABLE so the turn still proceeds.
 * Returns new message objects (input is not mutated) and the number of images handled.
 */
export async function describeImagesInMessages(
  messages: readonly Msg[],
  describe: ImageDescriber,
  log: (m: string) => void = () => undefined
): Promise<{ messages: Msg[]; imageCount: number }> {
  let imageCount = 0;
  const out: Msg[] = [];
  for (const m of messages) {
    const content = m.content;
    if (!Array.isArray(content) || !content.some(isImagePart)) {
      out.push(m);
      continue;
    }
    const urls = (content as Part[])
      .filter(isImagePart)
      .map((p) => String(p.image_url?.url ?? ''))
      .filter(Boolean);
    imageCount += urls.length;

    let note: string;
    try {
      const desc = (await describe(urls)).trim();
      note = desc ? `${IMAGE_DESCRIPTION_PREFIX}${desc}${IMAGE_DESCRIPTION_SUFFIX}` : IMAGE_DESCRIPTION_UNAVAILABLE;
    } catch (error) {
      log(`Vision proxy failed: ${error instanceof Error ? error.message : String(error)}`);
      note = IMAGE_DESCRIPTION_UNAVAILABLE;
    }

    const parts: Array<{ type: 'text'; text: string }> = [];
    let noteInserted = false;
    for (const p of content as unknown[]) {
      if (isImagePart(p)) {
        if (!noteInserted) {
          parts.push({ type: 'text', text: note });
          noteInserted = true;
        }
        continue;
      }
      const tp = p as Part | null;
      if (tp && tp.type === 'text' && typeof tp.text === 'string') {
        parts.push({ type: 'text', text: tp.text });
      }
    }
    out.push({ ...m, content: parts });
  }
  return { messages: out, imageCount };
}

/** Request body for the describing call (non-streaming, image_url parts). */
export function buildDescribeRequest(modelId: string, imageUrls: readonly string[]): Record<string, unknown> {
  return {
    model: modelId,
    stream: false,
    max_tokens: 1024,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: IMAGE_DESCRIPTION_PROMPT },
          ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ],
  };
}

/** Extract assistant text from a non-streaming chat completion response. */
export function extractCompletionText(payload: unknown): string {
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content === 'string') { return content; }
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .join('');
  }
  return '';
}

const CHEAP_HINT = /(mini|flash|haiku|lite|small|nano)/i;

/**
 * Choose a vision-capable model to describe images. Explicit choice wins (if
 * it still exists); otherwise prefer a vision model with a "cheap/fast" name.
 */
export function pickVisionModelId(
  models: ReadonlyArray<{ id: string; vision?: boolean }>,
  preferred?: string
): string | undefined {
  const wanted = preferred?.trim();
  if (wanted && models.some((m) => m.id === wanted)) { return wanted; }
  const vision = models.filter((m) => m.vision === true);
  return (vision.find((m) => CHEAP_HINT.test(m.id)) ?? vision[0])?.id;
}
