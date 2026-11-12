import crypto from 'node:crypto';

/**
 * Constant-time string comparison by hashing both inputs with SHA-256 first
 * so token length differences never leak timing information.
 */
export function safeTokenEquals(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

interface FailureBucket {
  count: number;
  windowStartMs: number;
  blockedUntilMs: number;
}

export class LoginRateLimiter {
  private readonly buckets = new Map<string, FailureBucket>();

  constructor(
    private readonly maxFailuresPerUser = 5,
    private readonly maxFailuresPerIp = 12,
    private readonly windowMs = 15 * 60_000,
    private readonly blockMs = 15 * 60_000
  ) {}

  private pruneExpired(nowMs: number): void {
    if (this.buckets.size < 500) return;
    for (const [key, b] of this.buckets.entries()) {
      if (b.blockedUntilMs < nowMs && nowMs - b.windowStartMs > this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }

  public checkBlocked(ip: string, username: string, nowMs = Date.now()): number {
    this.pruneExpired(nowMs);
    const keys = [`ip:${ip}`, `user:${ip}:${username.toLowerCase()}`];
    let maxWaitMs = 0;
    for (const k of keys) {
      const b = this.buckets.get(k);
      if (b && b.blockedUntilMs > nowMs) {
        maxWaitMs = Math.max(maxWaitMs, b.blockedUntilMs - nowMs);
      }
    }
    return maxWaitMs;
  }

  public recordFailure(ip: string, username: string, nowMs = Date.now()): void {
    this.bumpBucket(`ip:${ip}`, this.maxFailuresPerIp, nowMs);
    this.bumpBucket(`user:${ip}:${username.toLowerCase()}`, this.maxFailuresPerUser, nowMs);
  }

  public recordSuccess(ip: string, username: string): void {
    this.buckets.delete(`user:${ip}:${username.toLowerCase()}`);
  }

  private bumpBucket(key: string, limit: number, nowMs: number): void {
    const existing = this.buckets.get(key);
    if (!existing || nowMs - existing.windowStartMs > this.windowMs) {
      this.buckets.set(key, {
        count: 1,
        windowStartMs: nowMs,
        blockedUntilMs: 0
      });
      return;
    }

    existing.count += 1;
    if (existing.count >= limit) {
      existing.blockedUntilMs = nowMs + this.blockMs;
    }
  }
}

export class ActionCooldown {
  private readonly lastTriggerByUser = new Map<string, number>();

  constructor(private readonly cooldownMs = 1500) {}

  public tryAcquire(userId: string, nowMs = Date.now()): boolean {
    if (this.lastTriggerByUser.size > 500) {
      for (const [k, ts] of this.lastTriggerByUser.entries()) {
        if (nowMs - ts > this.cooldownMs * 10) {
          this.lastTriggerByUser.delete(k);
        }
      }
    }
    const prev = this.lastTriggerByUser.get(userId) ?? 0;
    if (nowMs - prev < this.cooldownMs) {
      return false;
    }
    this.lastTriggerByUser.set(userId, nowMs);
    return true;
  }
}
