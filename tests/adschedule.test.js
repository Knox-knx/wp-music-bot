import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdService, validateInterval, slotSendAt, createSchedule } from '../src/services/adService.js';
import { createDbService } from '../src/services/dbService.js';
import { parseConfig } from '../src/config.js';
import { createSilentLogger } from '../src/utils/logger.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeEnv(adsPerDay = 2) {
  const config = parseConfig({
    NODE_ENV: 'test',
    OWNER_NUMBERS: '919111111111',
    DEFAULT_ADS_PER_DAY: String(adsPerDay),
  });
  const db = createDbService({
    dbPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-ad-')), 'db.sqlite'),
    logger: createSilentLogger(),
  });
  return { config, db, svc: createAdService({ config, logger: createSilentLogger(), db }) };
}

test('valid intervals 2..5 are accepted', () => {
  for (const n of [2, 3, 4, 5]) {
    assert.equal(validateInterval(n), n);
  }
});

test('intervals 1 and 6 are rejected', () => {
  assert.throws(() => validateInterval(1));
  assert.throws(() => validateInterval(6));
  assert.throws(() => validateInterval(2.5));
  assert.throws(() => validateInterval('x'));
});

test('schedule slot times fall inside their windows', () => {
  const dateStr = '2026-01-01';
  for (const count of [2, 3, 4, 5]) {
    const dayStart = new Date(`${dateStr}T00:00:00`).getTime();
    for (let slot = 0; slot < count; slot += 1) {
      const at = slotSendAt(dateStr, slot, count);
      const windowSize = 86_400_000 / count;
      const lo = dayStart + slot * windowSize;
      const hi = lo + windowSize - 60_000;
      assert.ok(at >= lo && at <= hi, `slot ${slot} count ${count} out of window`);
    }
  }
});

test('schedule generation is deterministic for the same date', () => {
  const a = createSchedule('2026-01-01', 3);
  const b = createSchedule('2026-01-01', 3);
  assert.deepEqual(
    a.map((s) => s.sendAt),
    b.map((s) => s.sendAt)
  );
});

test('schedule differs across dates', () => {
  const a = createSchedule('2026-01-01', 3).map((s) => s.sendAt);
  const b = createSchedule('2026-01-02', 3).map((s) => s.sendAt);
  assert.notDeepEqual(a, b);
});

test('ensureDailySchedule creates exactly N slots and no duplicates', () => {
  const { db, svc } = makeEnv(4);
  const slots = svc.ensureDailySchedule('2026-01-01');
  assert.equal(slots.length, 4);
  const again = svc.ensureDailySchedule('2026-01-01');
  assert.equal(again.length, 4);
  const unique = new Set(slots.map((s) => `${s.play_date}:${s.slot}`));
  assert.equal(unique.size, 4);
  db.close();
});

test('schedule generation is idempotent across restarts', () => {
  const { config, db } = makeEnv(3);
  const svc1 = createAdService({ config, logger: createSilentLogger(), db });
  const first = svc1.ensureDailySchedule('2026-05-10').map((s) => s.sendAt);
  const svc2 = createAdService({ config, logger: createSilentLogger(), db });
  const second = svc2.ensureDailySchedule('2026-05-10').map((s) => s.sendAt);
  assert.deepEqual(first, second);
  db.close();
});

test('claiming the same slot twice is prevented', async () => {
  const { db, svc } = makeEnv(2);
  const slots = svc.ensureDailySchedule('2026-01-01');
  const slot = slots[0];
  assert.equal(svc.claimSlot(slot), true);
  assert.equal(svc.claimSlot(slot), false);
  db.close();
});

test('saveAd stores message and respects max length', () => {
  const { db, svc } = makeEnv();
  const kept = svc.saveAd({ message: 'x'.repeat(2000), createdBy: 'owner' });
  assert.equal(kept.length, 1000);
  assert.equal(db.getAdvertisement().message.length, 1000);
  db.close();
});

test('empty advertisement message is rejected', () => {
  const { db, svc } = makeEnv();
  assert.throws(() => svc.saveAd({ message: '   ', createdBy: 'owner' }));
  db.close();
});

test('setInterval persists and getAdConfig reflects it', () => {
  const { db, svc } = makeEnv();
  svc.setInterval(5);
  assert.equal(db.getAdInterval(), 5);
  svc.setInterval(2);
  assert.equal(db.getAdInterval(), 2);
  const cfg = svc.getAdConfig();
  assert.equal(cfg.enabled, true);
  db.close();
});