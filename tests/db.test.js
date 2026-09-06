import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDbService } from '../src/services/dbService.js';
import { createSilentLogger } from '../src/utils/logger.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-db-test-'));
let db;

before(() => {
  db = createDbService({ dbPath: path.join(dir, 'test.sqlite'), logger: createSilentLogger() });
});

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mute and unmute a user', () => {
  assert.equal(db.muteUser('g1', 'u1', 'admin1'), true);
  assert.ok(db.isMuted('g1', 'u1'));
  assert.ok(db.unmuteUser('g1', 'u1'));
  assert.ok(!db.isMuted('g1', 'u1'));
});

test('duplicate mute is idempotent', () => {
  db.muteUser('g1', 'u2', 'admin1');
  assert.equal(db.muteUser('g1', 'u2', 'admin1'), false);
  assert.equal(db.countMuted(), 1);
});

test('mute is scoped to group + user', () => {
  db.muteUser('g1', 'u3', 'admin1');
  assert.ok(db.isMuted('g1', 'u3'));
  assert.ok(!db.isMuted('g2', 'u3'));
});

test('ban and unban a user', () => {
  db.banUser('g1', 'u4', 'admin1', 'spam');
  assert.ok(db.isBanned('g1', 'u4'));
  assert.ok(db.isBannedAnywhere('u4').includes('g1'));
  assert.ok(db.unbanUser('g1', 'u4'));
  assert.ok(!db.isBanned('g1', 'u4'));
});

test('duplicate ban is idempotent', () => {
  db.banUser('g1', 'u5', 'admin1');
  assert.equal(db.banUser('g1', 'u5', 'admin1'), false);
  assert.equal(db.countBanned(), 1);
});

test('ban persists across service restarts (new connection)', () => {
  const db2 = createDbService({
    dbPath: path.join(dir, 'test.sqlite'),
    logger: createSilentLogger(),
  });
  assert.ok(db2.isBanned('g1', 'u5'));
  db2.close();
});

test('advertisement config persists', () => {
  db.saveAdvertisement({ message: 'hello', timesPerDay: 3, createdBy: 'owner' });
  const ad = db.getAdvertisement();
  assert.equal(ad.message, 'hello');
  assert.equal(Number(ad.times_per_day), 3);
  db.setAdInterval(4);
  assert.equal(db.getAdInterval(), 4);
  db.setAdEnabled(false);
  assert.equal(db.getAdsEnabled(), false);
});

test('settings counter increments atomically', () => {
  db.incrementSetting('songs_processed');
  db.incrementSetting('songs_processed');
  assert.equal(db.getSettingInt('songs_processed'), 2);
});

test('warnings are counted per group and user', () => {
  db.logModeration({ action: 'warn', groupId: 'g1', userId: 'u9', actorId: 'admin1' });
  db.logModeration({ action: 'warn', groupId: 'g1', userId: 'u9', actorId: 'admin1' });
  assert.equal(db.countWarnings('g1', 'u9'), 2);
  assert.equal(db.countWarnings('g2', 'u9'), 0);
});
test('stats() returns coherent counters without throwing', () => {
  db.upsertUser('u1@c.us');
  db.upsertGroup('g1@g.us', 'Test');
  db.logCommand({ command: 'song', args: 'x', chatId: 'g1@g.us', senderId: 'u1@c.us', status: 'ok' });
  db.muteUser('g1@g.us', 'u1@c.us', 'admin');
  const before = db.stats();
  const stats = db.stats();
  assert.ok(stats.users >= before.users, 'users monotonic');
  assert.ok(stats.groupsActive >= before.groupsActive);
  assert.ok(stats.groupsKnown >= before.groupsKnown);
  assert.ok(stats.commands >= before.commands);
  assert.ok(stats.muted >= before.muted);
  for (const key of ['songsProcessed','lyricsRequests','antispamActions','mutedDeletions','banned','moderationEvents']) {
    assert.equal(typeof stats[key], 'number', key + ' is a number');
  }
});
