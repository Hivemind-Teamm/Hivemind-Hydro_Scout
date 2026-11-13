import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchHydrantsById } from '../lib/hydrant-search.ts';

const hydrants = ['HYD-001', 'HYD-009', 'HYD-010', 'HYD-011', 'HYD-019', 'HYD-100', 'BFP-010', 'BFP-020'].map(id => ({ id }));
const ids = (query, limit) => searchHydrantsById(hydrants, query, limit).map(m => m.hydrant.id);

test('the typed ID in any spelling finds that hydrant first', () => {
  for (const query of ['HYD-010', 'hyd010', 'hyd 10', 'Hyd-10', 'h10', 'hydrant 10']) {
    const [top] = searchHydrantsById(hydrants, query);
    assert.equal(top.hydrant.id, 'HYD-010', query);
    assert.equal(top.exact, true, query);
  }
});

test('a typed prefix picks that set when both have the number', () => {
  for (const query of ['bfp-010', 'BFP010', 'bfp 10', 'b10']) {
    assert.deepEqual(searchHydrantsById(hydrants, query).map(m => [m.hydrant.id, m.exact]), [['BFP-010', true], ['HYD-010', false]], query);
  }
});

test('a bare number lists field hydrants, then BFP, then partial matches', () => {
  assert.deepEqual(ids('010'), ['HYD-010', 'BFP-010']);
  assert.deepEqual(ids('10'), ['HYD-010', 'BFP-010', 'HYD-100']);
  const exact = searchHydrantsById(hydrants, '10').filter(m => m.exact).map(m => m.hydrant.id);
  assert.deepEqual(exact, ['HYD-010', 'BFP-010']);
});

test('a prefix with no such hydrant still lists the same number under another prefix', () => {
  assert.deepEqual(searchHydrantsById(hydrants, 'BFP-001').map(m => [m.hydrant.id, m.exact]), [['HYD-001', false]]);
  assert.deepEqual(ids('XYZ-9'), ['HYD-009']);
});

test('partial IDs list the hydrants they could complete to', () => {
  assert.deepEqual(ids('HYD-01'), ['HYD-001', 'HYD-010', 'HYD-011', 'HYD-019']);
  assert.deepEqual(ids('bfp'), ['BFP-010', 'BFP-020']);
  assert.equal(ids('HYD', 3).length, 3);
  assert.equal(searchHydrantsById(hydrants, 'HYD-01').find(m => m.hydrant.id === 'HYD-019').exact, false);
});

test('place names and empty queries do not match hydrants', () => {
  for (const query of ['', ' ', 'h', 'Kalayaan', 'Kalayaan 10', 'Quezon Ave', 'HYD-999']) {
    assert.deepEqual(ids(query), [], query);
  }
});

test('IDs without a number match on their full text', () => {
  const odd = [{ id: 'aB3xY' }, { id: 'HYD-010' }];
  assert.deepEqual(searchHydrantsById(odd, 'ab3').map(m => m.hydrant.id), ['aB3xY']);
  assert.deepEqual(searchHydrantsById(odd, 'ab3xy').map(m => m.exact), [true]);
});
