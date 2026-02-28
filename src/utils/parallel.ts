/**
 * Parallel execution utilities for concurrent operations.
 *
 * Provides utilities for running operations concurrently with
 * proper error handling and resource management.
 *
 * Dependency direction: parallel.ts → nothing (leaf module)
 * Used by: workflow runner, agents
 */

import { logger } from './logger.js';

/** Result of a parallel operation. */
export interface ParallelResult<T> {
  /** The operation result value. */
  value: T;
  /** Index of the operation in the input array. */
  index: number;
  /** Whether the operation succeeded. */
  success: boolean;
  /** Error if the operation failed. */
  error?: Error;
}

/** Options for parallel execution. */
export interface ParallelOptions {
  /** Maximum number of concurrent operations (default: unlimited). */
  concurrency?: number;
  /** Whether to continue on error (default: false). */
  continueOnError?: boolean;
  /** Delay between starting operations in milliseconds (default: 0). */
  delay?: number;
}

/**
 * Execute an array of operations concurrently.
 *
 * @param operations - Array of async functions to execute
 * @param options - Parallel execution options
 * @returns Array of results with the same order as input
 */
export async function parallel<T>(
  operations: Array<() => Promise<T>>,
  options: ParallelOptions = {},
): Promise<ParallelResult<T>[]> {
  const { concurrency = Infinity, continueOnError = false, delay = 0 } = options;
  const results: ParallelResult<T>[] = new Array(operations.length);
  const executing: Set<Promise<void>> = new Set();

  let currentIndex = 0;

  const executeOperation = async (index: number): Promise<void> => {
    if (delay > 0 && index > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const operation = operations[index];
      if (!operation) {
        throw new Error(`Operation at index ${index} is undefined`);
      }
      const value = await operation();
      results[index] = { value, index, success: true };
    } catch (error) {
      results[index] = {
        value: null as unknown as T,
        index,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };

      if (!continueOnError) {
        throw error;
      }
    }
  };

  const next = (): void => {
    if (currentIndex >= operations.length) {
      return;
    }

    const index = currentIndex++;
    const promise = executeOperation(index).finally(() => {
      executing.delete(promise);
      if (executing.size < concurrency && currentIndex < operations.length) {
        next();
      }
    });

    executing.add(promise);

    if (executing.size < concurrency && currentIndex < operations.length) {
      next();
    }
  };

  while (executing.size < concurrency && currentIndex < operations.length) {
    next();
  }

  await Promise.all(executing);

  return results;
}

/**
 * Execute operations in batches.
 *
 * @param operations - Array of async functions to execute
 * @param batchSize - Number of operations per batch
 * @returns Array of results with the same order as input
 */
export async function parallelBatch<T>(
  operations: Array<() => Promise<T>>,
  batchSize: number,
): Promise<ParallelResult<T>[]> {
  const results: ParallelResult<T>[] = [];

  for (let i = 0; i < operations.length; i += batchSize) {
    const batch = operations.slice(i, i + batchSize);
    const batchResults = await parallel(batch, { concurrency: batchSize });
    results.push(...batchResults);
  }

  return results;
}

/**
 * Race multiple operations and return the first successful result.
 *
 * @param operations - Array of async functions to execute
 * @returns First successful result or throws if all fail
 */
export async function raceSuccess<T>(operations: Array<() => Promise<T>>): Promise<T> {
  const errors: Error[] = [];

  for (const operation of operations) {
    try {
      return await operation();
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  throw new Error(`All operations failed: ${errors.map((e) => e.message).join(', ')}`);
}

/**
 * Execute operations with a timeout.
 *
 * @param operation - Async function to execute
 * @param timeoutMs - Timeout in milliseconds
 * @returns Operation result or throws timeout error
 */
export async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

/**
 * Execute operations with retry logic.
 *
 * @param operation - Async function to execute
 * @param options - Retry options
 * @returns Operation result
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delay?: number;
    backoff?: boolean;
    onRetry?: (attempt: number, error: Error) => void;
  } = {},
): Promise<T> {
  const { maxAttempts = 3, delay = 1000, backoff = true, onRetry } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`Operation failed (attempt ${attempt}/${maxAttempts}): ${lastError.message}`);

      if (attempt < maxAttempts) {
        const retryDelay = backoff ? delay * attempt : delay;
        if (onRetry) {
          onRetry(attempt, lastError);
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  throw lastError || new Error('Operation failed after maximum attempts');
}

/**
 * Parallel map with concurrency control.
 *
 * @param items - Array of items to process
 * @param mapper - Async function to map each item
 * @param options - Parallel execution options
 * @returns Array of mapped results
 */
export async function parallelMap<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: ParallelOptions = {},
): Promise<R[]> {
  const operations = items.map((item, index) => () => mapper(item, index));
  const results = await parallel(operations, options);

  if (options.continueOnError !== true) {
    const failed = results.find((r) => !r.success);
    if (failed) {
      throw failed.error;
    }
  }

  return results.map((r) => r.value);
}

/**
 * Parallel filter with concurrency control.
 *
 * @param items - Array of items to filter
 * @param predicate - Async predicate function
 * @param options - Parallel execution options
 * @returns Array of items that pass the predicate
 */
export async function parallelFilter<T>(
  items: T[],
  predicate: (item: T) => Promise<boolean>,
  options: ParallelOptions = {},
): Promise<T[]> {
  const results = await parallelMap(
    items,
    async (item) => ({ item, passes: await predicate(item) }),
    options,
  );

  return results.filter((r) => r.passes).map((r) => r.item);
}
