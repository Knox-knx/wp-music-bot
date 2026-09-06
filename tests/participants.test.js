import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNotification } from '../src/listeners/participantListener.js';

test('new-style GroupNotification with recipients and chatId', () => {
  const notification = {
    chatId: '123@g.us',
    author: '910000000001@c.us',
    recipientIds: ['910000000002@c.us', '910000000003@c.us'],
    id: { remote: '123@g.us', participant: '910000000002@c.us', _serialized: 'x' },
  };
  assert.deepEqual(normalizeNotification(notification), {
    chatId: '123@g.us',
    participants: ['910000000002@c.us', '910000000003@c.us'],
    author: '910000000001@c.us',
  });
});

test('single-participant notification without recipientIds', () => {
  const notification = {
    chatId: '123@g.us',
    id: { remote: '123@g.us', participant: '910000000004@c.us' },
  };
  assert.deepEqual(normalizeNotification(notification).participants, [
    '910000000004@c.us',
  ]);
});

test('duplicate participants are deduplicated', () => {
  const notification = {
    chatId: '123@g.us',
    recipientIds: ['a@c.us', 'a@c.us', 'b@c.us'],
    id: { participant: 'a@c.us' },
  };
  assert.deepEqual(normalizeNotification(notification).participants, ['a@c.us', 'b@c.us']);
});

test('empty / missing notifications are handled safely', () => {
  assert.deepEqual(normalizeNotification(null), { chatId: null, participants: [], author: null });
  assert.deepEqual(normalizeNotification({}), { chatId: null, participants: [], author: null });
});