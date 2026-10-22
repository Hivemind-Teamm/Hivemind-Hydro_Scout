import test from "node:test";
import assert from "node:assert/strict";
import { validateIncidentFeed } from "../lib/incident-feed-validation.mjs";

const validIncident = {
  id: "fire-001",
  lat: 14.65,
  lng: 121.06,
};

test("Accepts a valid assigned incident", () => {
  assert.deepEqual(
    validateIncidentFeed({ incidents: [validIncident] }),
    [validIncident]
  );
});

test("Accepts an empty incident feed", () => {
  assert.deepEqual(
    validateIncidentFeed({ incidents: [] }),
    []
  );
});

test("Accepts multiple distinct valid incidents", () => {
  const second = {
    id: "fire-002",
    lat: -14.5,
    lng: -121.0,
  };

  assert.deepEqual(
    validateIncidentFeed({ incidents: [validIncident, second] }),
    [validIncident, second]
  );
});

test("Rejects missing or malformed response bodies", () => {
  const invalidBodies = [
    null,
    undefined,
    "invalid",
    [],
    {},
    { incidents: null },
    { incidents: "fire-001" },
    { incidents: {} },
  ];

  for (const body of invalidBodies) {
    assert.throws(
      () => validateIncidentFeed(body),
      /invalid-incident-feed/
    );
  }
});

test("Rejects invalid incident IDs and duplicates", () => {
  const invalidIds = [
    "",
    "../fire",
    "fire/001",
    "fire 001",
    123,
    null,
  ];

  for (const id of invalidIds) {
    assert.throws(
      () => validateIncidentFeed({
        incidents: [{ ...validIncident, id }],
      }),
      /invalid-incident-feed/
    );
  }

  assert.throws(
    () => validateIncidentFeed({
      incidents: [validIncident, { ...validIncident }],
    }),
    /invalid-incident-feed/
  );
});

test("Rejects missing, nonnumeric, and nonfinite coordinates", () => {
  const invalidCoordinates = [
    { lat: undefined },
    { lng: undefined },
    { lat: "14.65" },
    { lng: "121.06" },
    { lat: NaN },
    { lng: Infinity },
    { lat: -Infinity },
    { lng: null },
    { lat: 90.01 },
    { lat: -90.01 },
    { lng: 180.01 },
    { lng: -180.01 },
  ];

  for (const changes of invalidCoordinates) {
    assert.throws(
      () => validateIncidentFeed({
        incidents: [{ ...validIncident, ...changes }],
      }),
      /invalid-incident-feed/
    );
  }
});

test("Rejects malformed incident entries", () => {
  for (const incident of [null, undefined, "fire", 123, []]) {
    assert.throws(
      () => validateIncidentFeed({ incidents: [incident] }),
      /invalid-incident-feed/
    );
  }
});

test("Rejects feeds exceeding 100 incidents", () => {
  const incidents = Array.from({ length: 101 }, (_, index) => ({
    id: `fire-${index}`,
    lat: 14.65,
    lng: 121.06,
  }));

  assert.throws(
    () => validateIncidentFeed({ incidents }),
    /invalid-incident-feed/
  );

  assert.equal(
    validateIncidentFeed({ incidents: incidents.slice(0, 100) }).length,
    100
  );
});

test("Rejects an entirely valid-looking feed containing one bad incident", () => {
  assert.throws(
    () => validateIncidentFeed({
      incidents: [
        validIncident,
        { id: "fire-bad", lat: 999, lng: 121.06 },
      ],
    }),
    /invalid-incident-feed/
  );
});