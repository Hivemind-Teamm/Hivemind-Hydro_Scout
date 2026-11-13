import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  SEARCH_BBOX,
  SearchSession,
  dedupePlaces,
  newSessionToken,
  placeView,
  retrieveMapboxPlace,
  searchOsmPlaces,
  suggestMapboxPlaces,
} from '../lib/place-search.ts';
import { barangayBounds, searchBarangays } from '../lib/barangay-boundaries.ts';

const boundaries = JSON.parse(readFileSync('lib/qc-barangays.json', 'utf8'));

// Records each request and answers with `body`.
function fakeFetch(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return { ok, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

const suggestion = (name, feature_type, extra = {}) => ({
  name, feature_type, mapbox_id: `id-${name}-${feature_type}`, place_formatted: 'Quezon City, 1100, Philippines', ...extra,
});

test('Mapbox suggest is limited to the Philippines, Metro Manila, and ranked around the map center', async () => {
  const { fetchImpl, calls } = fakeFetch({ suggestions: [] });
  await suggestMapboxPlaces('  Quezon Mem ', { token: 'tok', sessionToken: 'sess', near: { lat: 14.65, lng: 121.07 }, fetchImpl });
  const { url } = calls[0];
  assert.equal(url.pathname, '/search/searchbox/v1/suggest');
  assert.equal(url.searchParams.get('q'), 'Quezon Mem');
  assert.equal(url.searchParams.get('session_token'), 'sess');
  assert.equal(url.searchParams.get('country'), 'ph');
  assert.equal(url.searchParams.get('proximity'), '121.07,14.65');
  assert.equal(url.searchParams.get('bbox'), SEARCH_BBOX.join(','));
});

test('Mapbox suggestions drop brand rows, repeats of an area name, and look-alike duplicates', async () => {
  const { fetchImpl } = fakeFetch({
    suggestions: [
      { name: 'Jollibee', feature_type: 'brand', mapbox_id: 'brand-1', place_formatted: 'Brand' },
      suggestion('Quezon City', 'place', { place_formatted: 'Philippines' }),
      suggestion('Quezon city', 'poi'),
      suggestion('SM North EDSA', 'poi'),
      suggestion('SM North EDSA', 'poi'),
      suggestion('Jollibee', 'poi', { address: 'Commonwealth Avenue' }),
      suggestion('Jollibee', 'poi', { address: 'Kalayaan Avenue' }),
    ],
  });
  const rows = await suggestMapboxPlaces('x', { token: 't', sessionToken: 's', fetchImpl });
  assert.deepEqual(rows.map(r => [r.name, r.subtitle]), [
    ['Quezon City', ''],
    ['SM North EDSA', 'Quezon City, 1100'],
    ['Jollibee', 'Commonwealth Avenue, Quezon City, 1100'],
    ['Jollibee', 'Kalayaan Avenue, Quezon City, 1100'],
  ]);
  assert.ok(rows.every(r => !r.location), 'Mapbox rows get their location on retrieve');
});

test('rows already shown as barangays are skipped', () => {
  const rows = [suggestion('Pinyahan', 'locality'), suggestion('Pinyahan', 'poi'), suggestion('Pinyahan Elementary School', 'poi')]
    .map(s => ({ id: s.mapbox_id, name: s.name, kind: s.feature_type, subtitle: '' }));
  assert.deepEqual(dedupePlaces(rows, ['Pinyahan']).map(r => r.name), ['Pinyahan Elementary School']);
  assert.deepEqual(dedupePlaces([{ id: '1', name: 'UP Campus', kind: 'locality', subtitle: '' }], ['U.P. Campus']), []);
});

test('Mapbox retrieve returns the point and any extent, under the same session', async () => {
  const { fetchImpl, calls } = fakeFetch({
    features: [{ geometry: { coordinates: [121.05, 14.63] }, properties: { bbox: [121.04, 14.62, 121.06, 14.64] } }],
  });
  const place = await retrieveMapboxPlace('dXJu:abc', { token: 'tok', sessionToken: 'sess', fetchImpl });
  assert.deepEqual(place, { lat: 14.63, lng: 121.05, bbox: [121.04, 14.62, 121.06, 14.64] });
  assert.equal(calls[0].url.pathname, '/search/searchbox/v1/retrieve/dXJu%3Aabc');
  assert.equal(calls[0].url.searchParams.get('session_token'), 'sess');

  const empty = fakeFetch({ features: [] });
  assert.equal(await retrieveMapboxPlace('x', { token: 't', sessionToken: 's', fetchImpl: empty.fetchImpl }), null);
});

test('provider errors are thrown so the search bar can say search is unavailable', async () => {
  const { fetchImpl } = fakeFetch({}, { ok: false, status: 401 });
  await assert.rejects(suggestMapboxPlaces('x', { token: 't', sessionToken: 's', fetchImpl }), /401/);
  await assert.rejects(retrieveMapboxPlace('x', { token: 't', sessionToken: 's', fetchImpl }), /401/);
});

test('OpenStreetMap search stays inside Metro Manila, maps extents, and caches repeat queries', async () => {
  const { fetchImpl, calls } = fakeFetch([{
    osm_type: 'way', osm_id: 1, lat: '14.6549', lon: '121.0645', name: 'University of the Philippines Diliman',
    display_name: 'University of the Philippines Diliman, Central Avenue, U.P. Campus, Diliman, Philippines',
    addresstype: 'amenity', boundingbox: ['14.645', '14.665', '121.055', '121.075'],
  }]);
  const rows = await searchOsmPlaces('UP Diliman test', { fetchImpl });
  assert.deepEqual(rows, [{
    id: 'osm:way/1',
    name: 'University of the Philippines Diliman',
    subtitle: 'Central Avenue, U.P. Campus, Diliman',
    kind: 'amenity',
    location: { lat: 14.6549, lng: 121.0645, bbox: [121.055, 14.645, 121.075, 14.665] },
  }]);
  const { searchParams } = calls[0].url;
  assert.equal(searchParams.get('bounded'), '1');
  assert.equal(searchParams.get('viewbox'), '120.9,14.85,121.25,14.35');
  await searchOsmPlaces('  up diliman TEST ', { fetchImpl });
  assert.equal(calls.length, 1, 'second identical search is served from the cache');
});

test('areas and large sites are framed; spots fly to a zoom for their kind and get a pin', () => {
  const campus = [121.055, 14.645, 121.075, 14.665];
  assert.deepEqual(placeView('locality', { lat: 0, lng: 0, bbox: campus }), { fit: campus, zoom: 15, pin: false });
  assert.deepEqual(placeView('amenity', { lat: 0, lng: 0, bbox: campus }), { fit: campus, zoom: 17, pin: true });
  const building = [121.0601, 14.6501, 121.0605, 14.6504];
  assert.deepEqual(placeView('poi', { lat: 0, lng: 0, bbox: building }), { fit: null, zoom: 17, pin: true });
  assert.deepEqual(placeView('street', { lat: 0, lng: 0, bbox: null }), { fit: null, zoom: 16, pin: true });
  assert.equal(placeView('barangay', { lat: 0, lng: 0, bbox: campus }).pin, false);
});

test('a search session is reused while typing and ends with the retrieve', () => {
  let now = 0;
  const session = new SearchSession(() => now);
  const first = session.forSuggest();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  now += 1000;
  assert.equal(session.forSuggest(), first);
  assert.equal(session.forRetrieve(), first);
  const second = session.forSuggest();
  assert.notEqual(second, first);

  now += 151_000;
  assert.notEqual(session.forSuggest(), second, 'idle sessions are not reused');

  const busy = new SearchSession(() => 0);
  const token = busy.forSuggest();
  for (let i = 1; i < 45; i++) assert.equal(busy.forSuggest(), token);
  assert.notEqual(busy.forSuggest(), token, 'rotates before Mapbox ends the session at 50 suggests');
  assert.notEqual(newSessionToken(), newSessionToken());
});

test('barangay search ignores case, accents, dots and a "Brgy" prefix', () => {
  const names = (query) => searchBarangays(boundaries, query).map(f => f.properties.name);
  assert.deepEqual(names('pinyahan'), ['Pinyahan']);
  assert.deepEqual(names('Brgy. Pinyahan'), ['Pinyahan']);
  assert.deepEqual(names('santo nino'), ['Santo Niño']);
  assert.deepEqual(names('UP'), ['U.P. Campus', 'U.P. Village']);
  assert.deepEqual(names('up village'), ['U.P. Village']);
  assert.deepEqual(names('village'), ['Sikatuna Village', "Teachers' Village East", "Teachers' Village West"]);
  assert.equal(names('san').length, 3);
  assert.deepEqual(names('p'), []);
  assert.deepEqual(names('HYD-010'), []);
});

test('barangay bounds wrap the whole barangay', () => {
  const [feature] = searchBarangays(boundaries, 'Pinyahan');
  const [west, south, east, north] = barangayBounds(feature);
  assert.ok(west < east && south < north);
  assert.ok(west > 121 && east < 121.1 && south > 14.6 && north < 14.7);
});
