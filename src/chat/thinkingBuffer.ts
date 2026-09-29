/**
 * Buffers streamed thinking deltas and emits them as ONE thinking part with a
 * stable id per turn. Emitting every token as its own part makes Copilot Chat
 * render a separate "Analyzed… / Finished with N steps" fragment per delta.
 *
 * Pure (no `vscode` import) so it is unit-testable under `node --test`.
 */
export interface ThinkingSink {
  /** Emit the accumulated thinking text as a single part carrying `id`. */
  emitThinking(text: string, id: string): void;
  /** Close the thinking block (`vscode_reasoning_done`). */
  emitDone(id: string): void;
}

export class ThinkingBuffer {
  private text = '';
  private closed = false;

  constructor(
    private readonly sink: ThinkingSink,
    private readonly id: string
  ) {}

  /** Accumulate a delta. Deltas arriving after the block closed are ignored
   *  (some models interleave reasoning and content in tiny alternating pieces). */
  push(delta: string): void {
    if (this.closed || !delta) { return; }
    this.text += delta;
  }

  /** Flush buffered text once and close the block. Safe to call repeatedly. */
  done(): void {
    if (this.closed) { return; }
    this.closed = true;
    if (this.text) {
      this.sink.emitThinking(this.text, this.id);
      this.text = '';
    }
    this.sink.emitDone(this.id);
  }

  /** Close only if thinking actually started — used as a sentinel at stream end. */
  finish(): void {
    if (!this.closed && this.text) { this.done(); }
  }
}
