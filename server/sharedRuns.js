/** In memory, so waiting costs nothing: no database connection, no Kite call. */

/**
 * Callers asking for the same `key` while a run is going share that run: its
 * progress events and its result. The run is cancelled only when every caller
 * has cancelled, and a new caller after that starts a fresh run.
 */
export function createSharedRuns() {
  const running = new Map();

  const start = (key, work) => {
    const controller = new AbortController();
    const run = { listeners: new Set(), callers: 0, controller };
    const emit = (event, data) => run.listeners.forEach((listener) => listener(event, data));
    run.promise = Promise.resolve()
      .then(() => work({ emit, signal: controller.signal }))
      .finally(() => {
        if (running.get(key) === run) running.delete(key);
      });
    run.promise.catch(() => {}); // each caller handles the failure; none may be left
    running.set(key, run);
    return run;
  };

  return {
    /**
     * Join the run for `key`, starting one with `work({ emit, signal })` if none is going.
     * `onEvent` receives the run's progress; `signal` leaves the run (rejecting with its reason).
     * Returns whether this caller started the run, and the run's result.
     */
    join(key, work, { onEvent, signal } = {}) {
      signal?.throwIfAborted();
      const existing = running.get(key);
      const run = existing || start(key, work);
      run.callers += 1;
      if (onEvent) run.listeners.add(onEvent);

      const leave = () => {
        run.callers -= 1;
        if (onEvent) run.listeners.delete(onEvent);
      };

      const result = new Promise((resolve, reject) => {
        const onAbort = () => {
          leave();
          if (run.callers === 0) {
            if (running.get(key) === run) running.delete(key);
            run.controller.abort(signal.reason);
          }
          reject(signal.reason);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        run.promise.then(
          (value) => { signal?.removeEventListener('abort', onAbort); leave(); resolve(value); },
          (err) => { signal?.removeEventListener('abort', onAbort); leave(); reject(err); },
        );
      });
      return { started: !existing, result };
    },

    /** Whether a run for `key` is going. */
    isRunning(key) {
      return running.has(key);
    },
  };
}

export function createKeyedQueue() {
  const tails = new Map();
  return {
    /** Run `work()` once every earlier run for `key` has settled. */
    run(key, work) {
      const previous = tails.get(key) || Promise.resolve();
      const result = previous.then(() => work());
      const tail = result.catch(() => {});
      tails.set(key, tail);
      tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}
