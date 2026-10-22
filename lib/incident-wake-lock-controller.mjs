/**
 * Manages a screen wake lock for an active, visible incident session.
 * Browser dependencies are injected so lifecycle behavior can be tested.
 */
export function createIncidentWakeLockController({
  request,
  isVisible,
  onChange = () => {},
}) {
  let active = false;
  let stopped = false;
  let held = null;
  let pending = false;
  let generation = 0;

  const publish = () => {
    if (!stopped) onChange(held !== null);
  };

  const release = () => {
    const previous = held;
    held = null;
    publish();

    if (previous) {
      void previous.release().catch(() => {});
    }
  };

  const acquire = async () => {
    if (stopped || !active || !isVisible() || held || pending) return;

    const attempt = generation;
    pending = true;

    try {
      const lock = await request();

      if (stopped || !active || !isVisible() || attempt !== generation) {
        await lock.release();
        return;
      }

      held = lock;
      publish();

      lock.addEventListener('release', () => {
        if (held !== lock) return;
        held = null;
        publish();

        // Unexpected release: attempt reacquisition while still eligible.
        if (active && isVisible() && !stopped) {
          queueMicrotask(() => { void acquire(); });
        }
      });
    } catch {
      publish();
    } finally {
      pending = false;

      // A visibility change during a pending request may require retry.
      if (!stopped && active && isVisible() && !held && attempt !== generation) {
        void acquire();
      }
    }
  };

  return {
    start() {
      if (stopped) return;
      active = true;
      generation++;
      void acquire();
    },

    visibilityChanged() {
      if (stopped) return;
      generation++;

      if (!isVisible()) {
        release();
      } else if (active) {
        void acquire();
      }
    },

    stop() {
      active = false;
      stopped = true;
      generation++;
      release();
    },
  };
}
