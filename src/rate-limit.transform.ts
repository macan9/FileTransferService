import { Transform, type TransformCallback } from 'stream';

export class RateLimitTransform extends Transform {
  private nextAvailableTime = Date.now();

  constructor(private readonly bytesPerSecond: number) {
    super();
  }

  _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ) {
    if (this.bytesPerSecond <= 0) {
      this.push(chunk);
      callback();
      return;
    }

    const now = Date.now();
    const scheduledAt = Math.max(this.nextAvailableTime, now);
    const durationMs = Math.ceil((chunk.length / this.bytesPerSecond) * 1000);
    const delayMs = Math.max(scheduledAt - now, 0);

    this.nextAvailableTime = scheduledAt + durationMs;

    setTimeout(() => {
      this.push(chunk, encoding);
      callback();
    }, delayMs);
  }
}
