import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSilentLogger } from '../src/utils/logger.js';
import { createAdScheduler } from '../src/scheduler/adScheduler.js';

function makeScheduler({ groups, state, sendAdToGroup, isGroupAvailable }) {
  return createAdScheduler({
    config: { ads: { enabled: true } },
    logger: createSilentLogger(),
    adService: new AdServiceStub(groups, state),
    sendAdToGroup,
    isGroupAvailable,
  });
}

function makeState() {
  return {
    adEnabled: true,
    groupAdEnabled: { 'g1@g.us': true, 'g2@g.us': true },
  };
}

test('ad scheduler disables a group only after repeated consecutive failures', async () => {
  const groups = [{ id: 'g1@g.us' }, { id: 'g2@g.us' }];
  const state = makeState();
  let sends = 0;

  const scheduler = makeScheduler({
    groups,
    state,
    sendAdToGroup: async (groupId) => {
      if (groupId !== 'g2@g.us') throw new Error('mock send failure');
      sends += 1;
    },
    isGroupAvailable: async (groupId) => groupId === 'g2@g.us',
  });

  await scheduler.tick();
  assert.equal(state.groupAdEnabled['g1@g.us'], true, 'one failure must not disable');
  assert.equal(state.groupAdEnabled['g2@g.us'], true);

  await scheduler.tick();
  assert.equal(state.groupAdEnabled['g1@g.us'], true, 'two failures must not disable');

  await scheduler.tick();
  assert.equal(state.groupAdEnabled['g1@g.us'], false, 'three failures disable the group');
  assert.equal(state.groupAdEnabled['g2@g.us'], true, 'healthy group is untouched');
  assert.equal(sends, 3, 'healthy group keeps receiving ads');
  scheduler.stop();
});

test('ad scheduler resets the failure counter on a successful delivery', async () => {
  const groups = [{ id: 'g1@g.us' }];
  const state = makeState();
  let available = false;
  let sendFails = true;

  const scheduler = makeScheduler({
    groups,
    state,
    sendAdToGroup: async () => {
      if (sendFails) throw new Error('mock send failure');
    },
    isGroupAvailable: async () => available,
  });

  await scheduler.tick();
  await scheduler.tick();
  assert.equal(state.groupAdEnabled['g1@g.us'], true);

  available = true;
  sendFails = false;
  await scheduler.tick();
  assert.equal(state.groupAdEnabled['g1@g.us'], true);

  available = false;
  sendFails = true;
  await scheduler.tick();
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(
    state.groupAdEnabled['g1@g.us'],
    false,
    'failures counted again after a success resets them'
  );
  scheduler.stop();
});

test('ad scheduler skips delivery when ads are disabled', async () => {
  const groups = [{ id: 'g1@g.us' }];
  const state = { adEnabled: false, groupAdEnabled: { 'g1@g.us': true } };
  let sent = 0;

  const scheduler = makeScheduler({
    groups,
    state,
    sendAdToGroup: async () => {
      sent += 1;
    },
    isGroupAvailable: async () => true,
  });

  await scheduler.tick();
  assert.equal(sent, 0);
  scheduler.stop();
});

class AdServiceStub {
  constructor(groups, state) {
    this.groups = groups;
    this.state = state;
    this.marker = 0;
  }

  isEnabled() {
    return this.state.adEnabled;
  }

  ensureDailySchedule() {}

  getAdConfig() {
    return { message: 'ad message' };
  }

  getDueSlots() {
    return [{ id: ++this.marker }];
  }

  claimSlot() {
    return true;
  }

  getActiveGroups() {
    return this.groups;
  }

  completeSlot() {}

  get db() {
    return {
      setGroupAdEnabled: (g, v) => {
        this.state.groupAdEnabled[g] = v;
      },
    };
  }
}