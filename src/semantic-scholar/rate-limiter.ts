export class RateLimiter {
  private queue: Array<() => void> = [];
  private lastFired = 0;
  private readonly intervalMs: number;
  private draining = false;

  constructor(requestsPerSecond: number) {
    this.intervalMs = 1000 / requestsPerSecond;
  }

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  private drain(): void {
    if (this.draining || this.queue.length === 0) return;
    this.draining = true;
    const now = Date.now();
    const wait = Math.max(0, this.intervalMs - (now - this.lastFired));
    setTimeout(() => {
      const next = this.queue.shift();
      if (next) {
        this.lastFired = Date.now();
        next();
      }
      this.draining = false;
      this.drain();
    }, wait);
  }
}
