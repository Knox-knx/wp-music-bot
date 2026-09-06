// codes by: @LouisPy
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/schema.js';

export function createDbService({ dbPath, logger }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  try {
    runMigrations(db);
  } catch (err) {
    logger?.error({ err }, 'Database migration failed');
    try {
      db.close();
    } catch {
      /* already closing */
    }
    throw err;
  }

  const stmts = {
    upsertUser: db.prepare(
      `INSERT INTO users (id, name, first_seen_at, last_seen_at)
       VALUES (@id, @name, @now, @now)
       ON CONFLICT(id) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, users.name),
         last_seen_at = @now`
    ),
    upsertGroup: db.prepare(
      `INSERT INTO groups (id, name, active, ad_enabled, created_at, updated_at)
       VALUES (@id, @name, 1, 1, @now, @now)
       ON CONFLICT(id) DO UPDATE SET
         name = COALESCE(@name, groups.name),
         active = 1,
         updated_at = @now`
    ),
    markGroupInactive: db.prepare(
      `UPDATE groups SET active = 0, updated_at = @now WHERE id = @id`
    ),
    setGroupAdEnabled: db.prepare(
      `UPDATE groups SET ad_enabled = @value, updated_at = @now WHERE id = @id`
    ),
    isGroupAdEnabled: db.prepare(
      `SELECT ad_enabled FROM groups WHERE id = @id`
    ),
    getActiveAdGroups: db.prepare(
      `SELECT * FROM groups WHERE active = 1 AND ad_enabled = 1`
    ),
    getKnownGroups: db.prepare(`SELECT * FROM groups`),
    countActiveGroups: db.prepare(`SELECT COUNT(*) AS c FROM groups WHERE active = 1`),
    countUsers: db.prepare(`SELECT COUNT(*) AS c FROM users`),

    muteUser: db.prepare(
      `INSERT OR IGNORE INTO muted_users (group_id, user_id, created_at, created_by)
       VALUES (@groupId, @userId, @now, @createdBy)`
    ),
    unmuteUser: db.prepare(
      `DELETE FROM muted_users WHERE group_id = @groupId AND user_id = @userId`
    ),
    isMuted: db.prepare(
      `SELECT 1 AS found FROM muted_users WHERE group_id = @groupId AND user_id = @userId LIMIT 1`
    ),
    countMuted: db.prepare(`SELECT COUNT(*) AS c FROM muted_users`),

    banUser: db.prepare(
      `INSERT OR IGNORE INTO banned_users (group_id, user_id, created_at, created_by, reason)
       VALUES (@groupId, @userId, @now, @createdBy, @reason)`
    ),
    unbanUser: db.prepare(
      `DELETE FROM banned_users WHERE group_id = @groupId AND user_id = @userId`
    ),
    isBanned: db.prepare(
      `SELECT 1 AS found FROM banned_users WHERE group_id = @groupId AND user_id = @userId LIMIT 1`
    ),
    isBannedAnywhere: db.prepare(
      `SELECT group_id FROM banned_users WHERE user_id = @userId`
    ),
    countBanned: db.prepare(`SELECT COUNT(*) AS c FROM banned_users`),

    getAdvertisement: db.prepare(
      `SELECT * FROM advertisements ORDER BY id LIMIT 1`
    ),
    saveAdvertisement: db.prepare(
      `INSERT INTO advertisements (message, enabled, times_per_day, created_at, updated_at, created_by)
       VALUES (@message, 1, @timesPerDay, @now, @now, @createdBy)
       ON CONFLICT(id) DO UPDATE SET
         message = @message,
         enabled = 1,
         times_per_day = @timesPerDay,
         updated_at = @now`
    ),
    setAdEnabled: db.prepare(
      `UPDATE advertisements SET enabled = @value, updated_at = @now WHERE id = 1`
    ),
    setAdInterval: db.prepare(
      `UPDATE advertisements SET times_per_day = @value, updated_at = @now WHERE id = 1`
    ),

    insertScheduleSlot: db.prepare(
      `INSERT OR IGNORE INTO ad_schedules (play_date, slot, send_at, status)
       VALUES (@playDate, @slot, @sendAt, 'pending')`
    ),
    getScheduleSlots: db.prepare(
      `SELECT * FROM ad_schedules WHERE play_date = @playDate ORDER BY slot`
    ),
    countScheduleSlots: db.prepare(
      `SELECT COUNT(*) AS c FROM ad_schedules WHERE play_date = @playDate`
    ),
    getDueSlots: db.prepare(
      `SELECT * FROM ad_schedules
       WHERE play_date = @playDate AND status = 'pending' AND send_at <= @now
       ORDER BY send_at`
    ),
    claimSlot: db.prepare(
      `UPDATE ad_schedules SET status = 'processing'
       WHERE id = @id AND status = 'pending'`
    ),
    markSlotDelivered: db.prepare(
      `UPDATE ad_schedules SET status = 'sent' WHERE id = @id`
    ),

    insertDelivery: db.prepare(
      `INSERT OR IGNORE INTO ad_delivery_logs (schedule_id, group_id, status, error, sent_at)
       VALUES (@scheduleId, @groupId, @status, @error, @now)`
    ),
    updateDelivery: db.prepare(
      `UPDATE ad_delivery_logs SET status = @status, error = @error
       WHERE schedule_id = @scheduleId`
    ),
    countAdsSentOnDay: db.prepare(
      `SELECT COUNT(*) AS c FROM ad_delivery_logs
       WHERE status = 'sent' AND sent_at >= @dayStart AND sent_at < @dayEnd`
    ),

    logCommand: db.prepare(
      `INSERT INTO command_logs (command, args, chat_id, sender_id, status, duration_ms, created_at)
       VALUES (@command, @args, @chatId, @senderId, @status, @durationMs, @now)`
    ),
    countCommands: db.prepare(`SELECT COUNT(*) AS c FROM command_logs`),

    logModeration: db.prepare(
      `INSERT INTO moderation_logs (action, group_id, user_id, actor_id, detail, created_at)
       VALUES (@action, @groupId, @userId, @actorId, @detail, @now)`
    ),
    countWarnings: db.prepare(
      `SELECT COUNT(*) AS c FROM moderation_logs
       WHERE action = 'warn' AND group_id = @groupId AND user_id = @userId`
    ),
    countModeration: db.prepare(`SELECT COUNT(*) AS c FROM moderation_logs`),

    getSetting: db.prepare(`SELECT value FROM bot_settings WHERE key = @key`),
    setSetting: db.prepare(
      `INSERT INTO bot_settings (key, value) VALUES (@key, @value)
       ON CONFLICT(key) DO UPDATE SET value = @value`
    ),
    incrementSetting: db.prepare(
      `INSERT INTO bot_settings (key, value) VALUES (@key, '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`
    ),
  };

  const insertDeliveryTxn = db.transaction((row) => {
    return stmts.insertDelivery.run(row);
  });
  const claimSlotTxn = db.transaction((row) => {
    const changed = stmts.claimSlot.run(row).changes;
    if (!changed) return { claimed: false };
    return { claimed: true };
  });

  function normalizeNumber(id) {
    return String(id).split('@')[0].trim();
  }

  return {
    db,
    normalizeNumber,

    upsertUser(id, name = null) {
      const now = Date.now();
      stmts.upsertUser.run({ id, name: name ?? null, now });
    },
    upsertGroup(id, name = null) {
      const now = Date.now();
      stmts.upsertGroup.run({ id, name: name ?? null, now });
    },
    markGroupInactive(id) {
      stmts.markGroupInactive.run({ id, now: Date.now() });
    },
    setGroupAdEnabled(id, value) {
      stmts.setGroupAdEnabled.run({ id, value: value ? 1 : 0, now: Date.now() });
    },
    isGroupAdEnabled(id) {
      const row = stmts.isGroupAdEnabled.get({ id });
      if (!row) return true;
      return Boolean(row.ad_enabled);
    },
    getActiveAdGroups() {
      return stmts.getActiveAdGroups.all();
    },
    getKnownGroups() {
      return stmts.getKnownGroups.all();
    },
    countActiveGroups() {
      return stmts.countActiveGroups.get().c;
    },
    countKnownGroups() {
      return stmts.getKnownGroups.all().length;
    },
    countUsers() {
      return stmts.countUsers.get().c;
    },

    muteUser(groupId, userId, createdBy = null) {
      const result = stmts.muteUser.run({
        groupId,
        userId,
        createdBy,
        now: Date.now(),
      });
      return result.changes > 0;
    },
    unmuteUser(groupId, userId) {
      const result = stmts.unmuteUser.run({ groupId, userId });
      return result.changes > 0;
    },
    isMuted(groupId, userId) {
      return Boolean(stmts.isMuted.get({ groupId, userId }));
    },
    countMuted() {
      return stmts.countMuted.get().c;
    },

    banUser(groupId, userId, createdBy = null, reason = null) {
      const result = stmts.banUser.run({
        groupId,
        userId,
        createdBy,
        reason,
        now: Date.now(),
      });
      return result.changes > 0;
    },
    unbanUser(groupId, userId) {
      const result = stmts.unbanUser.run({ groupId, userId });
      return result.changes > 0;
    },
    isBanned(groupId, userId) {
      return Boolean(stmts.isBanned.get({ groupId, userId }));
    },
    isBannedAnywhere(userId) {
      const rows = stmts.isBannedAnywhere.all({ userId });
      return rows.length > 0 ? rows.map((r) => r.group_id) : [];
    },
    countBanned() {
      return stmts.countBanned.get().c;
    },

    getAdvertisement() {
      return stmts.getAdvertisement.get() ?? null;
    },
    saveAdvertisement({ message, timesPerDay, createdBy }) {
      stmts.saveAdvertisement.run({
        message,
        timesPerDay: Math.max(2, Math.min(5, Number(timesPerDay) || 2)),
        createdBy,
        now: Date.now(),
      });
    },
    setAdEnabled(value) {
      const ad = stmts.getAdvertisement.get();
      if (!ad) {
        stmts.saveAdvertisement.run({
          message: '',
          timesPerDay: 2,
          createdBy: null,
          now: Date.now(),
        });
      }
      stmts.setAdEnabled.run({ value: value ? 1 : 0, now: Date.now() });
    },
    getAdsEnabled() {
      const ad = stmts.getAdvertisement.get();
      return ad ? Boolean(ad.enabled) : true;
    },
    setAdInterval(n) {
      const value = Math.max(2, Math.min(5, Number(n) || 2));
      if (!stmts.getAdvertisement.get()) {
        stmts.saveAdvertisement.run({
          message: '',
          timesPerDay: value,
          createdBy: null,
          now: Date.now(),
        });
      }
      stmts.setAdInterval.run({ value, now: Date.now() });
    },
    getAdInterval() {
      const ad = stmts.getAdvertisement.get();
      return ad ? Number(ad.times_per_day) : 2;
    },

    insertScheduleSlot(playDate, slot, sendAt) {
      stmts.insertScheduleSlot.run({ playDate, slot, sendAt });
    },
    getScheduleSlots(playDate) {
      return stmts.getScheduleSlots.all({ playDate });
    },
    hasCompleteSchedule(playDate, count) {
      return stmts.countScheduleSlots.get({ playDate }).c >= count;
    },
    getDueSlots(playDate, now) {
      return stmts.getDueSlots.all({ playDate, now });
    },
    claimSlot(slotId) {
      return claimSlotTxn({ id: slotId, now: Date.now() });
    },
    markSlotDelivered(slotId) {
      stmts.markSlotDelivered.run({ id: slotId });
    },
    recordDelivery({ scheduleId, groupId, status, error }) {
      return insertDeliveryTxn({
        scheduleId: scheduleId ?? null,
        groupId: groupId ?? null,
        status,
        error: error ?? null,
        now: Date.now(),
      });
    },
    updateDelivery(scheduleId, status, error) {
      stmts.updateDelivery.run({ scheduleId, status, error: error ?? null });
    },
    countAdsSentOnDay(dayStart, dayEnd) {
      return stmts.countAdsSentOnDay.get({ dayStart, dayEnd }).c;
    },

    logCommand({ command, args, chatId, senderId, status, durationMs }) {
      stmts.logCommand.run({
        command,
        args: args ?? null,
        chatId,
        senderId,
        status,
        durationMs: durationMs ?? null,
        now: Date.now(),
      });
    },
    countCommands() {
      return stmts.countCommands.get().c;
    },

    logModeration({ action, groupId = null, userId = null, actorId = null, detail = null }) {
      stmts.logModeration.run({
        action,
        groupId,
        userId,
        actorId,
        detail,
        now: Date.now(),
      });
    },
    countWarnings(groupId, userId) {
      return stmts.countWarnings.get({ groupId, userId }).c;
    },
    countModeration() {
      return stmts.countModeration.get().c;
    },

    getSetting(key, fallback = null) {
      const row = stmts.getSetting.get({ key });
      return row ? row.value : fallback;
    },
    setSetting(key, value) {
      stmts.setSetting.run({ key, value: String(value) });
    },
    incrementSetting(key) {
      stmts.incrementSetting.run({ key });
    },
    getSettingInt(key, fallback = 0) {
      const row = stmts.getSetting.get({ key });
      const n = row ? Number(row.value) : NaN;
      return Number.isFinite(n) ? n : fallback;
    },

    stats() {
      return {
        users: stmts.countUsers.get().c,
        groupsActive: stmts.countActiveGroups.get().c,
        groupsKnown: stmts.getKnownGroups.all().length,
        commands: stmts.countCommands.get().c,
        muted: stmts.countMuted.get().c,
        banned: stmts.countBanned.get().c,
        moderationEvents: stmts.countModeration.get().c,
        songsProcessed: this.getSettingInt('songs_processed', 0),
        lyricsRequests: this.getSettingInt('lyrics_requests', 0),
        antispamActions: this.getSettingInt('antispam_actions', 0),
        mutedDeletions: this.getSettingInt('muted_deletions', 0),
      };
    },

    close() {
      try {
        db.close();
      } catch (err) {
        logger?.warn({ err }, 'Error closing database');
      }
    },
  };
}