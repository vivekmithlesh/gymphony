// Tiny trailing-edge debounce used to coalesce realtime "refetch" bursts.
//
// At scale a single owner's dashboard receives many postgres_changes events in a
// short window (e.g. a payment batch, or a flurry of check-ins each writing
// activity_log). Calling an expensive refetch once per event causes a query
// storm. Wrapping the refetch in `debounce(fn, 400)` collapses a burst into ONE
// trailing call. `.cancel()` lets effects clear pending timers on unmount.
//
// No external dependency — intentionally minimal.

export interface DebouncedFn<A extends unknown[]> {
  (...args: A): void;
  /** Cancel any pending trailing invocation. Call this in effect cleanup. */
  cancel: () => void;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs = 400
): DebouncedFn<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = ((...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  }) as DebouncedFn<A>;

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}
