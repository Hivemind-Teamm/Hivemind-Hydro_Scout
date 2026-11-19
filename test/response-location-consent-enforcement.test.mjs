import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

const projectId = 'demo-response-consent-enforcement';
const stationId = 'DILIMAN-01';
const responseId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const firePinId = 'abcdefghijklmnopqrst';
const memberUid = 'member-1';
const noticeVersion = '2026-10-23-v5';

const markerPath =
  `stations/${stationId}/unitLocations/${responseId}`;

const consentPath =
  `users/${memberUid}/locationConsents/${stationId}`;

const governancePath = 'appSettings/locationPrivacy';

function markerData() {
  return {
    responseId,
    stationId,
    stationName: 'Diliman Fire Station',
    public: true,
    lat: 14.65,
    lng: 121.06,
    accuracy: 8,
    updatedAt: serverTimestamp(),
  };
}

function consentData(decision, governanceUpdatedAt) {
  return {
    uid: memberUid,
    stationId,
    decision,
    noticeVersion,
    governanceUpdatedAt,
    updatedAt: serverTimestamp(),
  };
}

test('server-backed location consent enforces the full lifecycle', async () => {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    await env.clearFirestore();

    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();

      await setDoc(doc(db, 'users', memberUid), {
        uid: memberUid,
        role: 'general',
        accountType: 'person',
        stationId,
        stationMembershipStatus: 'approved',
        displayName: 'Responder One',
        activeResponseId: responseId,
      });

      await setDoc(doc(db, 'users', 'member-2'), {
        uid: 'member-2',
        role: 'general',
        accountType: 'person',
        stationId,
        stationMembershipStatus: 'approved',
        displayName: 'Responder Two',
      });

      await setDoc(doc(db, 'stations', stationId), {
        name: 'Diliman Fire Station',
        active: true,
      });

      await setDoc(doc(db, 'firePins', firePinId), {
        lat: 14.65,
        lng: 121.06,
        stationId,
        status: 'active',
      });

      await setDoc(doc(db, 'stationResponses', responseId), {
        responseId,
        uid: memberUid,
        displayName: 'Responder One',
        stationId,
        stationName: 'Diliman Fire Station',
        status: 'active',
        firePinId,
        incidentLat: 14.65,
        incidentLng: 121.06,
      });

      await setDoc(doc(db, governancePath), {
        controller: 'HydroScout Project Organization',
        contact: 'privacy@example.com',
        updatedAt: serverTimestamp(),
        updatedBy: 'admin-user',
      });
    });

    const memberDb =
      env.authenticatedContext(memberUid).firestore();

    const otherDb =
      env.authenticatedContext('member-2').firestore();

    let published;

    await env.withSecurityRulesDisabled(async context => {
      const snapshot = await getDoc(
        doc(context.firestore(), governancePath),
      );

      assert.ok(
        snapshot.exists(),
        'Governance fixture document must exist',
      );

      published = snapshot.data().updatedAt;
    });

    assert.ok(
      published instanceof Timestamp,
      'Expected a server-published governance timestamp',
    );

    // Missing consent must never authorize publication.
    await assertFails(
      setDoc(doc(memberDb, markerPath), markerData()),
    );

    // Another user must not create consent for this responder.
    await assertFails(
      setDoc(
        doc(otherDb, consentPath),
        consentData('granted', published),
      ),
    );

    // Governance publication is temporarily optional. A personal responder
    // can record consent even after the governance document is unavailable.
    await env.withSecurityRulesDisabled(async context => {
      await deleteDoc(doc(context.firestore(), governancePath));
    });

    await assertSucceeds(
      setDoc(
        doc(memberDb, consentPath),
        consentData(
          'granted',
          Timestamp.fromMillis(1000),
        ),
      ),
    );

    // Valid authenticated consent permits publication.
    await assertSucceeds(
      setDoc(
        doc(memberDb, consentPath),
        consentData('granted', published),
      ),
    );

    await assertSucceeds(
      setDoc(doc(memberDb, markerPath), markerData()),
    );

    console.log('VALID CONSENT: publication permitted');

    // Declining consent must stop subsequent publication.
    await assertSucceeds(
      setDoc(
        doc(memberDb, consentPath),
        consentData('declined', published),
      ),
    );

    await assertFails(
      setDoc(doc(memberDb, markerPath), markerData()),
    );

    // Cleanup must remain possible after consent withdrawal.
    await assertSucceeds(
      deleteDoc(doc(memberDb, markerPath)),
    );

    console.log('DECLINED CONSENT: publication denied, deletion permitted');

    // A changed governance document does not invalidate consent while the
    // temporary governance prerequisite is disabled.
    await assertSucceeds(
      setDoc(
        doc(memberDb, consentPath),
        consentData('granted', published),
      ),
    );

    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), governancePath), {
        controller: 'HydroScout Project Organization',
        contact: 'updated-privacy@example.com',
        updatedAt: Timestamp.fromMillis(
          published.toMillis() + 60000,
        ),
        updatedBy: 'admin-user',
      });
    });

    await assertSucceeds(
      setDoc(doc(memberDb, markerPath), markerData()),
    );

    console.log('GOVERNANCE OPTIONAL: publication remains permitted');

    const storedConsent = await assertSucceeds(
      getDoc(doc(memberDb, consentPath)),
    );

    assert.equal(storedConsent.data().uid, memberUid);

    await assertFails(
      getDoc(doc(otherDb, consentPath)),
    );

    console.log('CONSENT OWNERSHIP: protected');
  } finally {
    await env.cleanup();
  }
});
