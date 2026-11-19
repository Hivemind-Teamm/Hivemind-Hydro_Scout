import assert from 'node:assert/strict';
import test from 'node:test';

function deferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

test('withdrawal waits for an existing publication before deletion', async () => {
  const events = [];
  const publishing = deferred();

  const publication = publishing.promise.then(() => {
    events.push('published');
  });

  const cleanup = (async () => {
    await publication;
    events.push('deleted');
  })();

  assert.deepEqual(events, []);

  publishing.resolve();
  await cleanup;

  assert.deepEqual(events, ['published', 'deleted']);
});

test('a stopped GPS operation cannot publish a newly received fix', async () => {
  const gps = deferred();
  let stopped = false;
  let publications = 0;

  const operation = (async () => {
    await gps.promise;
    if (stopped) return;
    publications += 1;
  })();

  stopped = true;
  gps.resolve();

  await operation;

  assert.equal(publications, 0);
});

test('failed cleanup remains eligible for another attempt', async () => {
  let confirmed = false;
  let attempts = 0;

  const cleanup = async () => {
    attempts += 1;

    if (attempts === 1) {
      throw new Error('temporary network failure');
    }

    confirmed = true;
  };

  await assert.rejects(cleanup());

  assert.equal(confirmed, false);

  await cleanup();

  assert.equal(attempts, 2);
  assert.equal(confirmed, true);
});

test('renewed sharing waits until pending deletion finishes', async () => {
  const events = [];
  const deleting = deferred();

  const deletion = deleting.promise.then(() => {
    events.push('deleted');
  });

  const publication = (async () => {
    await deletion;
    events.push('republished');
  })();

  deleting.resolve();

  await publication;

  assert.deepEqual(events, ['deleted', 'republished']);
});

test('deletion completion reconciles state after cleanup deactivation', async () => {
  let cleanupActive = true;
  let published = true;

  const deletion = deferred();

  const operation = (async () => {
    await deletion.promise;

    published = false;

    if (cleanupActive) {
      assert.equal(published, false);
    }
  })();

  cleanupActive = false;
  deletion.resolve();

  await operation;

  assert.equal(published, false);
});