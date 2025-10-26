// lib/retry.js

/**
 * Exponential backoff retry wrapper with jitter
 * Prevents rate limit failures and duplicate charges
 */

/**
 * Custom error class for retryable errors
 */
export class RetryableError extends Error {
  constructor(message, status, isRetryable = true) {
    super(message);
    this.name = 'RetryableError';
    this.status = status;
    this.isRetryable = isRetryable;
  }
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelayMs - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelayMs - Maximum delay in ms (default: 10000)
 * @param {number} options.jitterFactor - Jitter factor 0-1 (default: 0.2)
 * @param {number[]} options.retryableStatuses - HTTP status codes to retry (default: [429, 500, 502, 503, 504])
 * @returns {Promise<T>} Result of the function
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    jitterFactor = 0.2,
    retryableStatuses = [429, 500, 502, 503, 504]
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Check if error is retryable
      const status = err.status || err.response?.status;
      const isRetryable =
        (status && retryableStatuses.includes(status)) ||
        (err instanceof RetryableError && err.isRetryable);

      if (!isRetryable) {
        throw err;
      }

      // Calculate backoff with exponential growth + jitter
      const baseDelay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = baseDelay * jitterFactor * (Math.random() * 2 - 1);
      const delay = Math.max(0, baseDelay + jitter);

      console.warn(
        `[Retry] Attempt ${attempt + 1}/${maxRetries} failed (status: ${status}). ` +
        `Retrying in ${Math.round(delay)}ms...`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}