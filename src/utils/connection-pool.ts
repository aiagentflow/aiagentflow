/**
 * Connection pool for reusing HTTP connections across requests.
 *
 * Reduces connection overhead by maintaining persistent connections
 * to LLM providers. Supports connection limits and automatic cleanup.
 *
 * Dependency direction: connection-pool.ts → nothing (leaf module)
 * Used by: provider implementations (anthropic, ollama, etc.)
 */

import { logger } from './logger.js';

/** Connection pool configuration options. */
export interface ConnectionPoolOptions {
  /** Maximum number of concurrent connections. */
  maxConnections?: number;
  /** Connection idle timeout in milliseconds. */
  idleTimeout?: number;
  /** Maximum lifetime of a connection in milliseconds. */
  maxLifetime?: number;
}

/** A pooled connection with metadata. */
interface PooledConnection {
  /** The underlying fetch AbortController for this connection. */
  controller: AbortController;
  /** Timestamp when the connection was created. */
  createdAt: number;
  /** Timestamp of last activity. */
  lastUsed: number;
  /** Whether the connection is currently in use. */
  inUse: boolean;
}

/** Default configuration values. */
const DEFAULTS = {
  maxConnections: 10,
  idleTimeout: 60000,
  maxLifetime: 300000,
} as const;

/**
 * Connection pool for reusing HTTP connections.
 *
 * Maintains a pool of connections with configurable limits and
 * automatic cleanup of idle/old connections.
 */
export class ConnectionPool {
  private readonly options: Required<ConnectionPoolOptions>;
  private readonly connections: Map<string, PooledConnection>;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: ConnectionPoolOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.connections = new Map();

    logger.debug(
      `Connection pool initialized: maxConnections=${this.options.maxConnections}, ` +
        `idleTimeout=${this.options.idleTimeout}ms, maxLifetime=${this.options.maxLifetime}ms`,
    );

    this.startCleanupInterval();
  }

  /**
   * Acquire a connection for a request.
   *
   * @param key - Unique identifier for the connection endpoint
   * @returns AbortController for the connection
   */
  async acquire(key: string): Promise<AbortController> {
    const existing = this.connections.get(key);

    if (existing && !existing.inUse) {
      if (this.isConnectionValid(existing)) {
        existing.inUse = true;
        existing.lastUsed = Date.now();
        logger.debug(`Reusing existing connection: ${key}`);
        return existing.controller;
      } else {
        this.connections.delete(key);
      }
    }

    if (this.connections.size >= this.options.maxConnections) {
      await this.evictOldestIdle();
    }

    const controller = new AbortController();
    const now = Date.now();

    const connection: PooledConnection = {
      controller,
      createdAt: now,
      lastUsed: now,
      inUse: true,
    };

    this.connections.set(key, connection);
    logger.debug(`Created new connection: ${key} (total: ${this.connections.size})`);

    return controller;
  }

  /**
   * Release a connection back to the pool.
   *
   * @param key - Unique identifier for the connection
   */
  release(key: string): void {
    const connection = this.connections.get(key);
    if (connection) {
      connection.inUse = false;
      connection.lastUsed = Date.now();
      logger.debug(`Released connection: ${key}`);
    }
  }

  /**
   * Close all connections and cleanup resources.
   */
  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const [key, connection] of this.connections.entries()) {
      connection.controller.abort();
    }

    this.connections.clear();
    logger.debug('Connection pool closed');
  }

  /**
   * Get current pool statistics.
   */
  getStats(): { total: number; active: number; idle: number } {
    let active = 0;
    let idle = 0;

    for (const conn of this.connections.values()) {
      if (conn.inUse) {
        active++;
      } else {
        idle++;
      }
    }

    return { total: this.connections.size, active, idle };
  }

  // ── Private helpers ──

  private isConnectionValid(connection: PooledConnection): boolean {
    const now = Date.now();
    const age = now - connection.createdAt;
    const idleTime = now - connection.lastUsed;

    return age < this.options.maxLifetime && idleTime < this.options.idleTimeout;
  }

  private async evictOldestIdle(): Promise<void> {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, conn] of this.connections.entries()) {
      if (!conn.inUse && conn.lastUsed < oldestTime) {
        oldestTime = conn.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const conn = this.connections.get(oldestKey);
      if (conn) {
        conn.controller.abort();
        this.connections.delete(oldestKey);
        logger.debug(`Evicted idle connection: ${oldestKey}`);
      }
    }
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(
      () => {
        const now = Date.now();
        const keysToRemove: string[] = [];

        for (const [key, conn] of this.connections.entries()) {
          if (!conn.inUse && !this.isConnectionValid(conn)) {
            keysToRemove.push(key);
          }
        }

        for (const key of keysToRemove) {
          const conn = this.connections.get(key);
          if (conn) {
            conn.controller.abort();
            this.connections.delete(key);
            logger.debug(`Cleaned up expired connection: ${key}`);
          }
        }
      },
      Math.min(this.options.idleTimeout / 2, 30000),
    );
  }
}

/**
 * Global connection pool instance.
 */
let globalPool: ConnectionPool | null = null;

/**
 * Get or create the global connection pool.
 */
export function getConnectionPool(options?: ConnectionPoolOptions): ConnectionPool {
  if (!globalPool) {
    globalPool = new ConnectionPool(options);
  }
  return globalPool;
}

/**
 * Close the global connection pool.
 */
export function closeConnectionPool(): void {
  if (globalPool) {
    globalPool.close();
    globalPool = null;
  }
}
