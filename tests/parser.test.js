import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/utils/parser.js';

test('parses a valid command', () => {
  const parsed = parseCommand('!song believer', '!');
  assert.equal(parsed.name, 'song');
  assert.equal(parsed.args, 'believer');
  assert.deepEqual(parsed.argList, ['believer']);
});

test('parses multi-word arguments', () => {
  const parsed = parseCommand('!song Imagine Dragons Believer', '!');
  assert.equal(parsed.args, 'Imagine Dragons Believer');
});

test('returns null for messages without the prefix', () => {
  assert.equal(parseCommand('hello there', '!'), null);
});

test('returns null for the bare prefix', () => {
  assert.equal(parseCommand('!', '!'), null);
});

test('returns null for empty input', () => {
  assert.equal(parseCommand('', '!'), null);
  assert.equal(parseCommand(null, '!'), null);
});

test('normalizes command case', () => {
  assert.equal(parseCommand('!MENU', '!').name, 'menu');
  assert.equal(parseCommand('!Song Believer', '!').name, 'song');
});

test('normalizes whitespace', () => {
  const parsed = parseCommand('!  song    believer   ', '!');
  assert.equal(parsed.name, 'song');
  assert.equal(parsed.args, 'believer');
});

test('supports custom prefix', () => {
  const parsed = parseCommand('.ping', '.');
  assert.equal(parsed.name, 'ping');
});

test('command with no arguments returns empty args', () => {
  const parsed = parseCommand('!menu', '!');
  assert.equal(parsed.args, '');
  assert.deepEqual(parsed.argList, []);
});