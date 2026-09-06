import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemporaryMute } from '../src/utils/tempMute.js';
import { createDbService } from '../src/services/dbService.js';
import { createSilentLogger } from '../src/utils/logger.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeEnv() {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-tmpmute-')), 'db.sqlite');
  const db = createDbService({ dbPath, logger: createSilentLogger() });
  const svc = createTemporaryMute({ db, logger: createSilentLogger(), defaultSeconds: 1 });
  return { db, svc };
}

test('temporary mute mutes immediately', () => {
  const { db, svc } = makeEnv();
  svc.muteTemporarily('g1', 'u1', 1, 'test');
  assert.equal(db.isMuted('g1', 'u1'), true);
  svc.stop();
  db.close();
});

test('temporary mute auto-unmutes after the duration', async () => {
  const { db, svc } = makeEnv();
  svc.muteTemporarily('g1', 'u1', 1, 'test');
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(db.isMuted('g1', 'u1'), false);
  db.close();
});

test('temporary mute is still active before the duration elapses', async () => {
  const { db, svc } = makeEnv();
  svc.muteTemporarily('g1', 'u3', 1, 'test');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(db.isMuted('g1', 'u3'), true);
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(db.isMuted('g1', 'u3'), false);
  db.close();
});

test('repeated temporary mute refreshes the timer and stays muted', async () => {
  const { db, svc } = makeEnv();
  svc.muteTemporarily('g1', 'u2', 1, 'test');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(db.isMuted('g1', 'u2'), true);
  svc.muteTemporarily('g1', 'u2', 1, 'test');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(db.isMuted('g1', 'u2'), true, 'timer was refreshed, mute persists');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(db.isMuted('g1', 'u2'), false, 'mute expires after the refreshed duration');
  db.close();
});

test('temp mute only affects the group/user pair', () => {
  const { db, svc } = makeEnv();
  svc.muteTemporarily('g1', 'u1', 1, 'test');
  assert.equal(db.isMuted('g2', 'u1'), false);
  assert.equal(db.isMuted('g1', 'u9'), false);
  svc.stop();
  db.close();
});