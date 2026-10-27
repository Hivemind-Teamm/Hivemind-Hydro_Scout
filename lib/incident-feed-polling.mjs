import { validateIncidentFeed } from './incident-feed-validation.mjs';

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_VERIFICATION_MAX_AGE_MS = 15_000;

/**
 * Read-only, fail-closed polling controller.
 *
 * Dependencies are injectable for deterministic tests.
 * No GPS or Firestore operations occur here.
 */
export function createIncidentFeedPollingController({
  fetchFeed,
  onChange,
  intervalMs = DEFAULT_INTERVAL_MS,
  idleIntervalMs = intervalMs,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  verificationMaxAgeMs = DEFAULT_VERIFICATION_MAX_AGE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (
    typeof fetchFeed !== 'function' ||
    typeof onChange !== 'function' ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0 ||
    !Number.isFinite(idleIntervalMs) ||
    idleIntervalMs <= 0 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(verificationMaxAgeMs) ||
    verificationMaxAgeMs <= 0
  ) {
    throw new Error('invalid-polling-dependencies');
  }

  let running = false;
  let generation = 0;
  let pollTimer = null;
  let activeRequest = null;
  let activeTimeout = null;
  let verificationExpiryTimer = null;
  let nextPollDelayMs = idleIntervalMs;

  function clearVerificationExpiry() {
    if (verificationExpiryTimer !== null) {
      clearTimer(verificationExpiryTimer);
      verificationExpiryTimer = null;
    }
  }

  function renewVerificationExpiry(token) {
    clearVerificationExpiry();

    verificationExpiryTimer = setTimer(() => {
      verificationExpiryTimer = null;
      notify(emptyState('incident-feed-expired'), token);
    }, verificationMaxAgeMs);
  }

  const emptyState = error => ({
    incidents: [],
    verified: false,
    error,
  });

  function notify(state, token) {
    if (running && token === generation) {
      onChange(state);
    }
  }

  async function poll(token) {
    if (!running || token !== generation) return;

    const request = new AbortController();
    activeRequest = request;

    let rejectOnTimeout;
    const timeoutFailure = new Promise((_, reject) => {
      rejectOnTimeout = reject;
    });

    const timeout = setTimer(
      () => {
        request.abort();
        rejectOnTimeout(new Error('incident-feed-timeout'));
      },
      timeoutMs,
    );
    activeTimeout = timeout;

    try {
      // Race the entire fetch-and-validation operation, including JSON
      // parsing, so an ignored AbortSignal cannot stall polling.
      const incidents = await Promise.race([
        (async () => {
          const response = await fetchFeed(request.signal);

          if (!response.ok) {
            throw new Error('incident-feed-unavailable');
          }

          const body = await response.json();
          return validateIncidentFeed(body);
        })(),
        timeoutFailure,
      ]);

      if (running && token === generation) {
        nextPollDelayMs = incidents.length > 0 ? intervalMs : idleIntervalMs;
        renewVerificationExpiry(token);
        notify({
          incidents,
          verified: true,
          error: null,
        }, token);
      }
    } catch {
      nextPollDelayMs = idleIntervalMs;
      clearVerificationExpiry();
      notify(
        emptyState('incident-feed-unavailable'),
        token,
      );
    } finally {
      clearTimer(timeout);

      if (activeRequest === request) {
        activeRequest = null;
        activeTimeout = null;
      }

      if (running && token === generation) {
        pollTimer = setTimer(
          () => {
            pollTimer = null;
            void poll(token);
          },
          nextPollDelayMs,
        );
      }
    }
  }

  return {
    start() {
      if (running) return;

      running = true;
      const token = ++generation;

      notify(emptyState(null), token);
      void poll(token);
    },

    stop() {
      running = false;
      ++generation;

      if (pollTimer !== null) {
        clearTimer(pollTimer);
        pollTimer = null;
      }

      activeRequest?.abort();
      activeRequest = null;
      clearVerificationExpiry();

      if (activeTimeout !== null) {
        clearTimer(activeTimeout);
        activeTimeout = null;
      }
    },

    get running() {
      return running;
    },
  };
}
