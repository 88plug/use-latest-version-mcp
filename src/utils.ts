/**
 * Utility functions for the MCP server
 */

// Request timeout wrapper
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  }
}

// In-memory cache with TTL
export class Cache<T> {
  private cache = new Map<string, { data: T; expiry: number }>();
  private defaultTtl: number;

  constructor(defaultTtlMs: number = 5 * 60 * 1000) { // 5 minutes default
    this.defaultTtl = defaultTtlMs;
  }

  set(key: string, data: T, ttl?: number): void {
    const expiry = Date.now() + (ttl ?? this.defaultTtl);
    this.cache.set(key, { data, expiry });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  clear(): void {
    this.cache.clear();
  }

  // Clean up expired entries
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  get size(): number {
    return this.cache.size;
  }
}

// Circuit breaker for API resilience
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private readonly failureThreshold: number;
  private readonly recoveryTimeout: number;
  private readonly halfOpenMaxCalls: number;
  private halfOpenCalls = 0;

  constructor(
    failureThreshold: number = 5,
    recoveryTimeout: number = 60000, // 1 minute
    halfOpenMaxCalls: number = 3
  ) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.halfOpenMaxCalls = halfOpenMaxCalls;
  }

  /**
   * Run `fn` under the breaker. `isFailure` lets the caller classify which
   * errors count against the breaker: an error for which it returns false (e.g.
   * a 404 "not found" — the upstream answered, so it is healthy) is treated as a
   * success and does not trip the breaker. Defaults to "every error is a failure".
   */
  async execute<T>(fn: () => Promise<T>, isFailure?: (error: unknown) => boolean): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'half-open';
        this.halfOpenCalls = 0;
      } else {
        throw new Error('Circuit breaker is OPEN - requests are blocked');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      if (isFailure && !isFailure(error)) {
        // Not an infrastructure failure (the upstream responded) — don't penalize.
        this.onSuccess();
      } else {
        this.onFailure();
      }
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'half-open') {
      this.halfOpenCalls++;
      if (this.halfOpenCalls >= this.halfOpenMaxCalls) {
        this.state = 'closed';
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
    }
  }

  getState(): string {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
    this.halfOpenCalls = 0;
  }
}

// Global cache instance
export const packageCache = new Cache<any>(5 * 60 * 1000); // 5 minutes

// Global circuit breaker per registry
export const circuitBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(registry: string): CircuitBreaker {
  if (!circuitBreakers.has(registry)) {
    circuitBreakers.set(registry, new CircuitBreaker());
  }
  return circuitBreakers.get(registry)!;
}

// Generate cache key
export function getCacheKey(registry: string, packageName: string, method: string = 'version'): string {
  return `${registry}:${packageName}:${method}`;
}

// Retry with exponential backoff
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on 404 or client errors
      if (error instanceof Error && error.message.includes('not found')) {
        throw error;
      }

      // Don't retry on last attempt
      if (i === maxRetries - 1) {
        throw error;
      }

      // Exponential backoff
      const delay = baseDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
