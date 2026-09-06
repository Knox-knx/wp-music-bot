import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSelfTarget, resolveTarget } from '../src/commands/admin/helpers.js';

test('resolveTarget returns the first mention as a string', async () => {
  const ctx = { mentions: ['910000000001@c.us', '910000000002@c.us'] };
  assert.equal(await resolveTarget(ctx), '910000000001@c.us');
});

test('resolveTarget returns null when no mention exists', async () => {
  assert.equal(await resolveTarget({ mentions: [] }), null);
  assert.equal(await resolveTarget({}), null);
});

test('isSelfTarget compares normalized numbers, not raw jids', () => {
  const ctx = { client: { info: { wid: { _serialized: '919999999999@c.us' } } } };
  assert.equal(isSelfTarget(ctx, '919999999999@c.us'), true);
  assert.equal(isSelfTarget(ctx, '919999999999'), true);
  assert.equal(isSelfTarget(ctx, '910000000001@c.us'), false);
});

test('isSelfTarget is false when the bot session is unknown', () => {
  assert.equal(isSelfTarget({ client: {} }, '919999999999@c.us'), false);
});