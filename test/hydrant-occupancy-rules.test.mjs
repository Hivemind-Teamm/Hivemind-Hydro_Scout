import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

test('Hydrant occupancy rules enforce read-only client access', async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-hydrant-occupancy-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    const path = 'hydrantOccupancy/HYD-001';

    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc(path).set({
        occupied: true,
        responseId: 'example-response',
      });
    });

    const responder = env.authenticatedContext('responder-1').firestore();
    const admin = env.authenticatedContext('admin').firestore();
    const guest = env.unauthenticatedContext().firestore();

    async function expectDenied(operation, description) {
      await assert.rejects(operation, error => {
        assert.match(
          String(error.code ?? error.message),
          /permission.denied/i,
          description
        );

        assert.doesNotMatch(
          String(error.message),
          /maximum of 1000 expressions|evaluation error/i,
          description
        );

        return true;
      });

      console.log('PASS:', description);
    }

    const readable = await responder.doc(path).get();
    assert.equal(readable.exists, true);
    assert.equal(readable.data().occupied, true);
    console.log('PASS: Signed-in responder can read occupancy');

    const list = await responder.collection('hydrantOccupancy').get();
    assert.equal(list.size, 1);
    console.log('PASS: Signed-in responder can list occupancy');

    await expectDenied(
      guest.doc(path).get(),
      'Unauthenticated read denied'
    );

    await expectDenied(
      guest.collection('hydrantOccupancy').get(),
      'Unauthenticated list denied'
    );

    await expectDenied(
      responder.doc('hydrantOccupancy/HYD-002').set({
        occupied: true,
      }),
      'Responder cannot create a claim directly'
    );

    await expectDenied(
      responder.doc(path).update({
        occupied: false,
      }),
      'Responder cannot update a claim directly'
    );

    await expectDenied(
      responder.doc(path).delete(),
      'Responder cannot delete a claim directly'
    );

    await expectDenied(
      admin.doc(path).delete(),
      'Admin cannot bypass server-only claim deletion'
    );

    console.log('ALL HYDRANT OCCUPANCY RULE TESTS PASSED');
  } finally {
    await env.cleanup();
  }
});
