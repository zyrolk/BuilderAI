export interface BoundedOutputCapture {
  readonly text: string;
  readonly byteCount: number;
  readonly limited: boolean;
}

export class BoundedStreamCapture {
  private readonly chunks: string[] = [];
  private byteCount = 0;
  private limited = false;

  constructor(private readonly maximumBytes: number) {}

  append(chunk: Buffer | string): void {
    if (this.limited) return;
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const chunkBytes = Buffer.byteLength(text, 'utf8');
    const remaining = this.maximumBytes - this.byteCount;
    if (remaining <= 0) {
      this.limited = true;
      return;
    }
    if (chunkBytes <= remaining) {
      this.chunks.push(text);
      this.byteCount += chunkBytes;
      return;
    }
    const truncated = truncateToByteBudget(text, remaining);
    this.chunks.push(truncated);
    this.byteCount += Buffer.byteLength(truncated, 'utf8');
    this.limited = true;
  }

  snapshot(): BoundedOutputCapture {
    return {
      text: this.chunks.join(''),
      byteCount: this.byteCount,
      limited: this.limited,
    };
  }
}

function truncateToByteBudget(text: string, maximumBytes: number): string {
  if (maximumBytes <= 0) return '';
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, middle);
    if (Buffer.byteLength(candidate, 'utf8') <= maximumBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return text.slice(0, low);
}
