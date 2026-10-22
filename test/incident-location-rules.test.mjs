import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { GeoPoint, serverTimestamp } from 'firebase/firestore';

const PROJECT = 'demo-hydro-scout-api';

if (
  process.env.GCLOUD_PROJECT !== PROJECT ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
  process.env.NODE_ENV === 'production'
) {
  throw new Error('Exact local demo emulator configuration required.');
}

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: {
    host: '127.0.0.1',
    port: 8080,
    rules: readFileSync('firestore.rules', 'utf8'),
  },
});

after(async () => {
  await env.cleanup();
});

async function seed() {
  await env.clearFirestore();

  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    await db.doc('users/sub-1').set({
      role: 'sub_admin',
      accountType: 'station',
      stationId: 'station-1',
    });

    await db.doc('users/authorized-1').set({
      role: 'authorized',
      accountType: 'station',
      stationId: 'station-1',
    });

    await db.doc('incidents/fire-1').set({
      status: 'active',
      location: new GeoPoint(14.65, 121.06),
      // Proposed trusted server-managed dispatch assignment.
      assignedStationIds: ['station-1'],
    });
  });
}

function locationPayload(uid) {
  return {
    stationId: 'station-1',
    updatedBy: uid,
    incidentId: 'fire-1',
    location: new GeoPoint(14.6501, 121.0601),
    accuracy: 8,
    updatedAt: serverTimestamp(),
  };
}

test('ALLOW: Sub Admin creates own location near active incident', async () => {
  await seed();

  const db = env.authenticatedContext('sub-1').firestore();

  await assertSucceeds(
    db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1'))
  );
});

test('DENY: Authorized user cannot create Sub Admin location', async () => {
  await seed();

  const db = env.authenticatedContext('authorized-1').firestore();

  await assertFails(
    db.doc('unitLocations/authorized-1_550e8400-e29b-41d4-a716-446655440000').set(
      locationPayload('authorized-1')
    )
  );
});

test('DENY: Sub Admin cannot write another UID document', async () => {
  await seed();

  const db = env.authenticatedContext('sub-1').firestore();

  await assertFails(
    db.doc('unitLocations/someone-else_550e8400-e29b-41d4-a716-446655440000').set(
      locationPayload('sub-1')
    )
  );
});

test('ALLOW: Sub Admin updates own location for the same active incident', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  const ref = db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000');
  await assertSucceeds(ref.set(locationPayload('sub-1')));
  await assertSucceeds(ref.update({
    location: new GeoPoint(14.6502, 121.0602),
    updatedAt: serverTimestamp(),
  }));
});

test('DENY: Sub Admin cannot write an unassigned station', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set({
    ...locationPayload('sub-1'),
    stationId: 'station-2',
  }));
});

test('DENY: Sub Admin cannot write for a nonexistent incident', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set({
    ...locationPayload('sub-1'),
    incidentId: 'missing',
  }));
});

test('DENY: Sub Admin cannot write for a resolved incident', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('incidents/fire-1').update({
      status: 'resolved',
    });
  });
  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(
    locationPayload('sub-1')
  ));
});

test('DENY: Sub Admin cannot switch to a nonexistent incident', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  const ref = db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000');
  await assertSucceeds(ref.set(locationPayload('sub-1')));
  await assertFails(ref.update({
    incidentId: 'fire-2',
    updatedAt: serverTimestamp(),
  }));
});

test('ALLOW: Sub Admin location safely within 500 meters', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  await assertSucceeds(
    db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set({
      ...locationPayload('sub-1'),
      location: new GeoPoint(14.6540, 121.06),
    })
  );
});

test('DENY: Sub Admin location approximately 600 meters from incident', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(
    db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set({
      ...locationPayload('sub-1'),
      location: new GeoPoint(14.6554, 121.06),
    })
  );
});

test('DENY: Sub Admin cannot move existing location outside 500 meters', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  const ref = db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000');

  await assertSucceeds(ref.set(locationPayload('sub-1')));

  await assertFails(ref.update({
    location: new GeoPoint(14.6554, 121.06),
    updatedAt: serverTimestamp(),
  }));
});

test('DENY: Sub Admin cannot supply an old updatedAt timestamp', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set({
    ...locationPayload('sub-1'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  }));
});

test('DENY: Sub Admin cannot omit updatedAt', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  const data = locationPayload('sub-1');
  delete data.updatedAt;
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(data));
});

test('DENY: Sub Admin cannot add an unauthorized field', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set({
    ...locationPayload('sub-1'),
    adminOverride: true,
  }));
});

test('DENY: Sub Admin cannot remove required stationId', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  const data = locationPayload('sub-1');
  delete data.stationId;
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(data));
});

test('DENY: Sub Admin cannot forge updatedBy', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set({
    ...locationPayload('sub-1'),
    updatedBy: 'another-user',
  }));
});

test('DENY: Sub Admin cannot add unauthorized fields during update', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  const ref = db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000');
  await assertSucceeds(ref.set(locationPayload('sub-1')));
  await assertFails(ref.update({
    adminOverride: true,
    updatedAt: serverTimestamp(),
  }));
});

test('DENY: Admin cannot create a unit location', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('users/admin-1').set({
      role: 'admin',
    });
  });

  const db = env.authenticatedContext('admin-1').firestore();
  await assertFails(
    db.doc('unitLocations/admin-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('admin-1'))
  );
});

test('DENY: Station Head cannot create a unit location', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('users/head-1').set({
      role: 'head',
      accountType: 'station',
      stationId: 'station-1',
    });
  });

  const db = env.authenticatedContext('head-1').firestore();
  await assertFails(
    db.doc('unitLocations/head-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('head-1'))
  );
});

test('DENY: Admin cannot update an existing unit location', async () => {
  await seed();

  const ownerDb = env.authenticatedContext('sub-1').firestore();
  await assertSucceeds(
    ownerDb.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1'))
  );

  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('users/admin-1').set({ role: 'admin' });
  });

  const adminDb = env.authenticatedContext('admin-1').firestore();
  await assertFails(
    adminDb.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').update({
      location: new GeoPoint(14.6502, 121.0602),
      updatedAt: serverTimestamp(),
    })
  );
});

test('DENY: Station Head cannot update an existing unit location', async () => {
  await seed();

  const ownerDb = env.authenticatedContext('sub-1').firestore();
  await assertSucceeds(
    ownerDb.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1'))
  );

  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('users/head-1').set({
      role: 'head',
      accountType: 'station',
      stationId: 'station-1',
    });
  });

  const headDb = env.authenticatedContext('head-1').firestore();
  await assertFails(
    headDb.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').update({
      location: new GeoPoint(14.6502, 121.0602),
      updatedAt: serverTimestamp(),
    })
  );
});

test('ALLOW: Sub Admin station account can read unit location', async () => {
  await seed();
  const owner = env.authenticatedContext('sub-1').firestore();
  await assertSucceeds(owner.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1')));
  await assertSucceeds(owner.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').get());
  await assertSucceeds(owner.collection('unitLocations').get());
});

test('DENY: Station Head cannot read unit locations', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/head-1').set({
      role: 'head', accountType: 'station', stationId: 'station-1',
    });
  });
  const db = env.authenticatedContext('head-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').get());
  await assertFails(db.collection('unitLocations').get());
});

test('ALLOW: Admin can read unit locations', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/admin-1').set({ role: 'admin' });
  });
  const db = env.authenticatedContext('admin-1').firestore();
  await assertSucceeds(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').get());
  await assertSucceeds(db.collection('unitLocations').get());
});

test('DENY: General account cannot read unit locations', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/general-1').set({ role: 'general' });
  });
  const db = env.authenticatedContext('general-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').get());
  await assertFails(db.collection('unitLocations').get());
});

test('DENY: Signed-out user cannot read unit locations', async () => {
  await seed();
  const db = env.unauthenticatedContext().firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').get());
  await assertFails(db.collection('unitLocations').get());
});

test('DENY: Account without station assignment or Admin role cannot read locations', async () => {
  await seed();
  const db = env.authenticatedContext('unknown-user').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').get());
  await assertFails(db.collection('unitLocations').get());
});

test('ALLOW: Document owner can delete own unit location', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  const ref = db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000');
  await assertSucceeds(ref.set(locationPayload('sub-1')));
  await assertSucceeds(ref.delete());
});

test('ALLOW: Admin can delete another user unit location', async () => {
  await seed();
  const owner = env.authenticatedContext('sub-1').firestore();
  await assertSucceeds(
    owner.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1'))
  );
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/admin-1').set({ role: 'admin' });
  });
  const admin = env.authenticatedContext('admin-1').firestore();
  await assertSucceeds(admin.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').delete());
});

test('DENY: Another Sub Admin cannot delete someone else location', async () => {
  await seed();
  const owner = env.authenticatedContext('sub-1').firestore();
  await assertSucceeds(
    owner.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1'))
  );
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/sub-2').set({
      role: 'sub_admin',
      accountType: 'station',
      stationId: 'station-1',
    });
  });
  const other = env.authenticatedContext('sub-2').firestore();
  await assertFails(other.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').delete());
});

test('DENY: Station Head cannot delete unit location', async () => {
  await seed();
  const owner = env.authenticatedContext('sub-1').firestore();
  await assertSucceeds(
    owner.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1'))
  );
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/head-1').set({
      role: 'head',
      accountType: 'station',
      stationId: 'station-1',
    });
  });
  const head = env.authenticatedContext('head-1').firestore();
  await assertFails(head.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').delete());
});

test('DENY: General user cannot delete unit location', async () => {
  await seed();
  const owner = env.authenticatedContext('sub-1').firestore();
  await assertSucceeds(
    owner.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1'))
  );
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/general-1').set({ role: 'general' });
  });
  const general = env.authenticatedContext('general-1').firestore();
  await assertFails(general.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').delete());
});

test('DENY: Signed-out user cannot delete unit location', async () => {
  await seed();
  const owner = env.authenticatedContext('sub-1').firestore();
  await assertSucceeds(
    owner.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1'))
  );
  const anonymous = env.unauthenticatedContext().firestore();
  await assertFails(anonymous.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').delete());
});


test('ALLOW: Sub Admin location approximately 499 meters from incident', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  const latitude = 14.65 + (499 / 6371000) * (180 / Math.PI);

  await assertSucceeds(
    db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set({
      ...locationPayload('sub-1'),
      location: new GeoPoint(latitude, 121.06),
    })
  );
});

test('DENY: Sub Admin location approximately 501 meters from incident', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  const latitude = 14.65 + (501 / 6371000) * (180 / Math.PI);

  await assertFails(
    db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set({
      ...locationPayload('sub-1'),
      location: new GeoPoint(latitude, 121.06),
    })
  );
});

test('DENY: Incident without a status field cannot authorize a location', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('incidents/fire-1').set({
      location: new GeoPoint(14.65, 121.06),
    });
  });
  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1')));
});

test('DENY: Incident with invalid location type cannot authorize a location', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('incidents/fire-1').set({
      status: 'active',
      location: '14.65,121.06',
    });
  });
  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1')));
});

test('DENY: Malformed incident ID cannot authorize a location', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_invalid.id').set({
    ...locationPayload('sub-1'),
    incidentId: 'invalid.id',
  }));
});

test('DENY: Sub Admin without accountType cannot write a location', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/sub-1').update({
      accountType: 'individual',
    });
  });
  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1')));
});

test('DENY: Admin cannot create an incident directly', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/admin-1').set({ role: 'admin' });
  });

  const db = env.authenticatedContext('admin-1').firestore();

  await assertFails(db.doc('incidents/fire-2').set({
    status: 'active',
    location: new GeoPoint(14.65, 121.06),
  }));
});

test('DENY: Admin cannot modify an existing incident directly', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/admin-1').set({ role: 'admin' });
  });

  const db = env.authenticatedContext('admin-1').firestore();

  await assertFails(db.doc('incidents/fire-1').update({
    status: 'resolved',
  }));
});

test('DENY: Sub Admin cannot create an incident directly', async () => {
  await seed();

  const db = env.authenticatedContext('sub-1').firestore();

  await assertFails(db.doc('incidents/fire-2').set({
    status: 'active',
    location: new GeoPoint(14.65, 121.06),
  }));
});

test('DENY: Sub Admin cannot modify an existing incident directly', async () => {
  await seed();

  const db = env.authenticatedContext('sub-1').firestore();

  await assertFails(db.doc('incidents/fire-1').update({
    status: 'resolved',
  }));
});

test('DENY: Sub Admin missing accountType cannot create a location', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/sub-1').update({
      accountType: 'station',
    });
    await ctx.firestore().doc('users/sub-1').update({
      accountType: null,
    });
  });

  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1')));
});

test('DENY: Sub Admin missing stationId cannot create a location', async () => {
  await seed();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc('users/sub-1').update({
      stationId: null,
    });
  });

  const db = env.authenticatedContext('sub-1').firestore();
  await assertFails(db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set(locationPayload('sub-1')));
});

test('DENY: Sub Admin cannot change stationId during an update', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  const ref = db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000');

  await assertSucceeds(ref.set(locationPayload('sub-1')));
  await assertFails(ref.update({
    stationId: 'station-2',
    updatedAt: serverTimestamp(),
  }));
});

test('DENY: Sub Admin cannot change updatedBy during an update', async () => {
  await seed();
  const db = env.authenticatedContext('sub-1').firestore();
  const ref = db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000');

  await assertSucceeds(ref.set(locationPayload('sub-1')));
  await assertFails(ref.update({
    updatedBy: 'another-user',
    updatedAt: serverTimestamp(),
  }));
});

test('ALLOW: Sub Admin creates a UUID device location', async () => {
  await seed();

  const db = env.authenticatedContext('sub-1').firestore();
  const deviceUUID = '550e8400-e29b-41d4-a716-446655440000';

  await assertSucceeds(
    db.doc(`unitLocations/sub-1_${deviceUUID}`).set(
      locationPayload('sub-1')
    )
  );
});

test('ALLOW: GPS accuracy exactly 50 meters', async () => {
  await seed();

  const db = env.authenticatedContext('sub-1').firestore();

  await assertSucceeds(
    db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set({
      ...locationPayload('sub-1'),
      accuracy: 50,
    })
  );
});

test('DENY: GPS accuracy above 50 meters', async () => {
  await seed();

  const db = env.authenticatedContext('sub-1').firestore();

  await assertFails(
    db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000').set({
      ...locationPayload('sub-1'),
      accuracy: 50.01,
    })
  );
});

test('ALLOW: Device switches to another active nearby incident', async () => {
  await seed();

  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('incidents/fire-2').set({
      status: 'active',
      location: new GeoPoint(14.65, 121.06),
      assignedStationIds: ['station-1'],
    });
  });

  const db = env.authenticatedContext('sub-1').firestore();
  const ref = db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000');

  await assertSucceeds(ref.set(locationPayload('sub-1')));

  await assertSucceeds(ref.update({
    incidentId: 'fire-2',
    updatedAt: serverTimestamp(),
  }));
});

test('DENY: Device cannot switch to a resolved incident', async () => {
  await seed();

  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('incidents/fire-2').set({
      status: 'resolved',
      location: new GeoPoint(14.65, 121.06),
    });
  });

  const db = env.authenticatedContext('sub-1').firestore();
  const ref = db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000');

  await assertSucceeds(ref.set(locationPayload('sub-1')));

  await assertFails(ref.update({
    incidentId: 'fire-2',
    updatedAt: serverTimestamp(),
  }));
});


test('ASSIGNMENT: explicitly assigned station can publish', async () => {
  await seed();

  const db = env.authenticatedContext('sub-1').firestore();

  await assertSucceeds(
    db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000')
      .set(locationPayload('sub-1'))
  );
});

test('ASSIGNMENT: unassigned station cannot publish', async () => {
  await seed();

  // Only trusted fixture setup changes the incident assignment.
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('incidents/fire-1').update({
      assignedStationIds: ['station-2'],
    });
  });

  const db = env.authenticatedContext('sub-1').firestore();

  await assertFails(
    db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000')
      .set(locationPayload('sub-1'))
  );
});

test('ASSIGNMENT: revoking station assignment blocks updates', async () => {
  await seed();

  const db = env.authenticatedContext('sub-1').firestore();
  const ref = db.doc(
    'unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000'
  );

  await assertSucceeds(ref.set(locationPayload('sub-1')));

  // Simulate a trusted dispatcher revoking this station's assignment.
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('incidents/fire-1').update({
      assignedStationIds: [],
    });
  });

  await assertFails(
    ref.update({
      location: new GeoPoint(14.6502, 121.0602),
      updatedAt: serverTimestamp(),
    })
  );

  // Revocation must not prevent the owner from deleting their document.
  await assertSucceeds(ref.delete());
});

test('ASSIGNMENT: malformed or missing assignments fail closed', async t => {
  const cases = [
    {
      name: 'missing assignment field',
      removeField: true,
    },
    {
      name: 'empty assignment list',
      assignedStationIds: [],
    },
    {
      name: 'assignment stored as a string',
      assignedStationIds: 'station-1',
    },
    {
      name: 'assignment stored as an object',
      assignedStationIds: { station: 'station-1' },
    },
    {
      name: 'different station ID capitalization',
      assignedStationIds: ['STATION-1'],
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      await seed();

      await env.withSecurityRulesDisabled(async context => {
        const incidentRef = context.firestore().doc('incidents/fire-1');

        if (scenario.removeField) {
          await incidentRef.set({
            status: 'active',
            location: new GeoPoint(14.65, 121.06),
          });
        } else {
          await incidentRef.update({
            assignedStationIds: scenario.assignedStationIds,
          });
        }
      });

      const db = env.authenticatedContext('sub-1').firestore();

      await assertFails(
        db.doc('unitLocations/sub-1_550e8400-e29b-41d4-a716-446655440000')
          .set(locationPayload('sub-1'))
      );
    });
  }
});
