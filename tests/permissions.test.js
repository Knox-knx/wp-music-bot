import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionService } from '../src/services/permissionService.js';
import { parseConfig } from '../src/config.js';
import { createSilentLogger } from '../src/utils/logger.js';

const config = parseConfig({
  NODE_ENV: 'test',
  OWNER_NUMBERS: '919111111111',
  ADMIN_NUMBERS: '919222222222',
});

function fakeChat(participants) {
  return {
    id: { _serialized: '123@g.us' },
    isGroup: true,
    participants,
  };
}

function makeService(chat) {
  return createPermissionService({
    config,
    logger: createSilentLogger(),
    getChat: async () => chat,
  });
}

test('owner is recognized by id', () => {
  const svc = makeService(fakeChat([]));
  assert.ok(svc.isOwnerId('919111111111@c.us'));
  assert.ok(!svc.isOwnerId('919999999999@c.us'));
});

test('owner is recognized in all canonical forms', () => {
  const svc = makeService(fakeChat([]));
  assert.ok(svc.isOwnerId('919111111111'), 'bare number');
  assert.ok(svc.isOwnerId('919111111111@c.us'), 'with @c.us');
  assert.ok(svc.isOwnerId('919111111111:5@c.us'), 'with device suffix');
  assert.ok(svc.isOwnerId(' 919111111111 '), 'with whitespace');
  assert.ok(!svc.isOwnerId('919999999999@c.us'), 'normal user rejected');
});

test('owner lid is resolved through the wid resolver', async () => {
  const svc = createPermissionService({
    config,
    logger: createSilentLogger(),
    getChat: async () => null,
    resolveWidNumber: async (jid) => {
      assert.equal(jid, '1409000000000001@lid');
      return '919111111111';
    },
  });
  assert.equal(await svc.isOwnerIdAsync('1409000000000001@lid'), true);
  assert.equal(await svc.isOwnerIdAsync('1409000000000002@lid'), false);
});

test('lid resolution is cached and failures do not leak', async () => {
  let calls = 0;
  const svc = createPermissionService({
    config,
    logger: createSilentLogger(),
    getChat: async () => null,
    resolveWidNumber: async () => {
      calls += 1;
      return null;
    },
  });
  assert.equal(await svc.isOwnerIdAsync('1409000000000003@lid'), false);
  assert.equal(await svc.isOwnerIdAsync('1409000000000003@lid'), false);
  assert.equal(calls, 1, 'resolution should be cached');
  assert.equal(svc.isOwnerId('1409000000000003@lid'), false, 'sync check never resolves lids');
});

test('owner-only gate uses lid resolution for command dispatch', async () => {
  const svc = createPermissionService({
    config,
    logger: createSilentLogger(),
    getChat: async () => null,
    resolveWidNumber: async (jid) => {
      if (jid === '1409000000000001@lid') return '919111111111';
      return null;
    },
  });
  assert.equal(await svc.isOwnerIdAsync('1409000000000001@lid'), true);
  assert.equal(await svc.canManage({ chatId: '123@g.us', senderId: '1409000000000001@lid', isGroup: true }).then((r) => r.ok), true);
});

test('configured admin is recognized', () => {
  const svc = makeService(fakeChat([]));
  assert.ok(svc.isConfiguredAdminId('919222222222@c.us'));
});

test('group admin detection works', async () => {
  const svc = makeService(
    fakeChat([
      { id: { _serialized: '919333333333@c.us' }, isAdmin: true },
      { id: { _serialized: '919444444444@c.us' }, isAdmin: false },
    ])
  );
  assert.ok(await svc.isGroupAdmin('123@g.us', '919333333333@c.us'));
  assert.ok(!(await svc.isGroupAdmin('123@g.us', '919444444444@c.us')));
});

test('getLevel returns OWNER / GROUP_ADMIN / USER', async () => {
  const svc = makeService(
    fakeChat([
      { id: { _serialized: '919333333333@c.us' }, isAdmin: true },
      { id: { _serialized: '919444444444@c.us' }, isAdmin: false },
    ])
  );
  assert.equal(await svc.getLevel('123@g.us', '919111111111@c.us'), 'OWNER');
  assert.equal(await svc.getLevel('123@g.us', '919333333333@c.us'), 'GROUP_ADMIN');
  assert.equal(await svc.getLevel('123@g.us', '919444444444@c.us'), 'USER');
});

test('bot admin detection works', async () => {
  const svc = makeService(
    fakeChat([
      { id: { _serialized: '919000000000@c.us' }, isAdmin: true },
    ])
  );
  assert.ok(await svc.isBotGroupAdmin('123@g.us', '919000000000@c.us'));
  assert.ok(!(await svc.isBotGroupAdmin('123@g.us', '919555555555@c.us')));
});

test('canManage denies normal users', async () => {
  const svc = makeService(
    fakeChat([
      { id: { _serialized: '919444444444@c.us' }, isAdmin: false },
      { id: { _serialized: '919000000000@c.us' }, isAdmin: true },
    ])
  );
  const result = await svc.canManage({
    chatId: '123@g.us',
    senderId: '919444444444@c.us',
    isGroup: true,
  });
  assert.equal(result.ok, false);
});

test('canManage allows group admins', async () => {
  const svc = makeService(
    fakeChat([
      { id: { _serialized: '919333333333@c.us' }, isAdmin: true },
    ])
  );
  const result = await svc.canManage({
    chatId: '123@g.us',
    senderId: '919333333333@c.us',
    isGroup: true,
  });
  assert.equal(result.ok, true);
});

test('canModerate requires bot to be admin', async () => {
  const svc = makeService(
    fakeChat([
      { id: { _serialized: '919333333333@c.us' }, isAdmin: true },
      { id: { _serialized: '919000000000@c.us' }, isAdmin: false },
    ])
  );
  const result = await svc.canModerate({
    chatId: '123@g.us',
    senderId: '919333333333@c.us',
    isGroup: true,
    botWid: '919000000000@c.us',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /bot/i);
});

test('canModerate allows when both sender and bot are admins', async () => {
  const svc = makeService(
    fakeChat([
      { id: { _serialized: '919333333333@c.us' }, isAdmin: true },
      { id: { _serialized: '919000000000@c.us' }, isAdmin: true },
    ])
  );
  const result = await svc.canModerate({
    chatId: '123@g.us',
    senderId: '919333333333@c.us',
    isGroup: true,
    botWid: '919000000000@c.us',
  });
  assert.equal(result.ok, true);
});
test('canManage returns a friendly error when chat lookup fails', async () => {
  const svc = createPermissionService({
    config,
    logger: createSilentLogger(),
    getChat: async () => {
      throw new Error('r');
    },
  });
  const result = await svc.canManage({
    chatId: '123@g.us',
    senderId: '919333333333@c.us',
    isGroup: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /temporarily unavailable/i);
});

test('isGroupAdmin never throws when chat lookup fails', async () => {
  const svc = createPermissionService({
    config,
    logger: createSilentLogger(),
    getChat: async () => {
      throw new Error('r');
    },
  });
  assert.equal(await svc.isGroupAdmin('123@g.us', '919333333333@c.us'), false);
  assert.equal(await svc.isBotGroupAdmin('123@g.us', '919000000000@c.us'), false);
});
