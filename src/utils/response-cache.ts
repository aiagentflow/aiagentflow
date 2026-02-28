/**
 * Response cache for LLM responses.
 *
 * Caches LLM responses to reduce redundant API calls for identical inputs.
 * Uses an LRU (Least Recently Used) eviction strategy with TTL support.
 *
 * Dependency direction: response-cache.ts → nothing (leaf module)
 * Used by: provider implementations
 */

import { createHash } from 'node:crypto';
import { logger } from './logger.js';

/** Cache entry with metadata. */
interface CacheEntry<T> {
  /** The cached value. */
  value: T;
  /** Timestamp when the entry was created. */
  createdAt: number;
  /** Timestamp of last access. */
  lastAccessed: number;
  /** Number of times this entry has been accessed. */
  accessCount: number;
}

/** Cache configuration options. */
export interface ResponseCacheOptions {
  /** Maximum number of entries to cache. */
  maxSize?: number;
  /** Time-to-live for cache entries in milliseconds. */
  ttl?: number;
  /** Whether to log cache hits/misses. */
  logMetrics?: boolean;
}

/** Cache statistics. */
export interface CacheStats {
  /** Total number of entries in cache. */
  size: number;
  /** Number of cache hits. */
  hits: number;
  /** Number of cache misses. */
  misses: number;
  /** Hit rate (0-1). */
  hitRate: number;
  /** Number of evicted entries. */
  evictions: number;
}

/** Default configuration values. */
const DEFAULTS = {
  maxSize: 100,
  ttl: 3600000,
  logMetrics: true,
} as const;

/**
 * Response cache for LLM responses.
 *
 * Implements an LRU cache with TTL support to avoid stale responses.
 */
export class ResponseCache<T> {
  private readonly options: Required<ResponseCacheOptions>;
  private readonly cache: Map<string, CacheEntry<T>>;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: ResponseCacheOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.cache = new Map();

    logger.debug(
      `Response cache initialized: maxSize=${this.options.maxSize}, ` + `ttl=${this.options.ttl}ms`,
    );
  }

  /**
   * Get a cached response.
   *
   * @param key - Cache key
   * @returns Cached value or undefined if not found/expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      if (this.options.logMetrics) {
        logger.debug(`Cache miss: ${this.hashKey(key)}`);
      }
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.misses++;
      if (this.options.logMetrics) {
        logger.debug(`Cache expired: ${this.hashKey(key)}`);
      }
      return undefined;
    }

    entry.lastAccessed = Date.now();
    entry.accessCount++;
    this.hits++;

    if (this.options.logMetrics) {
      logger.debug(`Cache hit: ${this.hashKey(key)} (accessed ${entry.accessCount} times)`);
    }

    return entry.value;
  }

  /**
   * Set a value in the cache.
   *
   * @param key - Cache key
   * @param value - Value to cache
   */
  set(key: string, value: T): void {
    if (this.cache.size >= this.options.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const now = Date.now();
    const existing = this.cache.get(key);

    const entry: CacheEntry<T> = existing
      ? { ...existing, value, lastAccessed: now }
      : { value, createdAt: now, lastAccessed: now, accessCount: 0 };

    this.cache.set(key, entry);
    logger.debug(`Cache set: ${this.hashKey(key)}`);
  }

  /**
   * Check if a key exists in the cache and is not expired.
   *
   * @param key - Cache key
   * @returns True if key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    return entry !== undefined && !this.isExpired(entry);
  }

  /**
   * Delete a specific entry from the cache.
   *
   * @param key - Cache key to delete
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    logger.debug('Cache cleared');
  }

  /**
   * Get cache statistics.
   *
   * @returns Cache statistics object
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
    };
  }

  /**
   * Remove expired entries from the cache.
   *
   * @returns Number of entries removed
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} expired cache entries`);
    }

    return removed;
  }

  // ── Private helpers ──

  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.createdAt > this.options.ttl;
  }

  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      this.evictions++;
      logger.debug(`Evicted LRU entry: ${this.hashKey(lruKey)}`);
    }
  }

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
  }
}

/**
 * Generate a cache key from request parameters.
 *
 * @param messages - Chat messages
 * @param options - Chat options
 * @returns Cache key string
 */
export function generateCacheKey(
  messages: Array<{ role: string; content: string }>,
  options?: { model?: string; temperature?: number; maxTokens?: number },
): string {
  const keyParts = [
    messages.map((m) => `${m.role}:${m.content}`).join('|'),
    options?.model ?? '',
    String(options?.temperature ?? ''),
    String(options?.maxTokens ?? ''),
  ];

  return createHash('sha256').update(keyParts.join('::')).digest('hex');
}

/**
 * Global response cache instance.
 */
let globalCache: ResponseCache<unknown> | null = null;

/**
 * Get or create the global response cache.
 */
export function getResponseCache<T = unknown>(options?: ResponseCacheOptions): ResponseCache<T> {
  if (!globalCache) {
    globalCache = new ResponseCache<T>(options);
  }
  return globalCache as ResponseCache<T>;
}

/**
 * Close the global response cache.
 */
export function closeResponseCache(): void {
  if (globalCache) {
    globalCache.clear();
    globalCache = null;
  }
}
