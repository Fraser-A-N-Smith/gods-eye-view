/**
 * @file Spread synchronous per-item work across multiple event-loop turns so
 * a long list doesn't block the main thread (input, paint, the render-loop's
 * own frame callbacks) in one unbroken pass.
 * @module data/chunkedWork
 */

/**
 * Yield control back to the event loop. Prefers `requestAnimationFrame` so
 * paused work resumes in step with the browser's own paint cadence; falls
 * back to a macrotask (`setTimeout`) in non-browser environments (tests,
 * workers) where `requestAnimationFrame` doesn't exist.
 *
 * @returns {Promise<void>}
 */
export function yieldToMain() {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run `processItem` over `items` synchronously in batches of `chunkSize`,
 * awaiting `yield_()` between batches so the caller's own async callers can
 * interleave (paint a frame, handle input, run a superseding request).
 *
 * @param {Array<*>} items
 * @param {(item:*, index:number) => void} processItem - Synchronous per-item work.
 * @param {Object} [options]
 * @param {number} [options.chunkSize=25] - Items processed per turn before yielding.
 * @param {() => boolean} [options.shouldAbort] - Checked after each yield; return
 *   true to stop processing early (e.g. a newer request superseded this one).
 * @param {() => Promise<void>} [options.yield_] - Override for `yieldToMain`, for tests.
 * @returns {Promise<number>} Count of items actually processed.
 */
export async function processInChunks(items, processItem, options = {}) {
  const { chunkSize = 25, shouldAbort = () => false, yield_ = yieldToMain } = options;

  for (let i = 0; i < items.length; i++) {
    processItem(items[i], i);
    const processedCount = i + 1;
    if (processedCount % chunkSize === 0 && processedCount < items.length) {
      await yield_();
      if (shouldAbort()) return processedCount;
    }
  }
  return items.length;
}
