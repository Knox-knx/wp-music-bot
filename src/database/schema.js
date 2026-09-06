export const MAX_MIGRATION_VERSION = 1;

const MIGRATIONS = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS groups (
          id TEXT PRIMARY KEY,
          name TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          ad_enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS muted_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          created_by TEXT,
          UNIQUE(group_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_muted_user ON muted_users(user_id);

        CREATE TABLE IF NOT EXISTS banned_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          created_by TEXT,
          reason TEXT,
          UNIQUE(group_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_banned_user ON banned_users(user_id);

        CREATE TABLE IF NOT EXISTS advertisements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          times_per_day INTEGER NOT NULL DEFAULT 2,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          created_by TEXT
        );

        CREATE TABLE IF NOT EXISTS ad_schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          play_date TEXT NOT NULL,
          slot INTEGER NOT NULL,
          send_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          UNIQUE(play_date, slot)
        );
        CREATE INDEX IF NOT EXISTS idx_ad_schedules_date ON ad_schedules(play_date, status);

        CREATE TABLE IF NOT EXISTS ad_delivery_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          schedule_id INTEGER,
          group_id TEXT,
          status TEXT NOT NULL,
          error TEXT,
          sent_at INTEGER NOT NULL,
          UNIQUE(schedule_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ad_delivery_logs_sent ON ad_delivery_logs(sent_at);

        CREATE TABLE IF NOT EXISTS command_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          command TEXT NOT NULL,
          args TEXT,
          chat_id TEXT,
          sender_id TEXT,
          status TEXT NOT NULL,
          duration_ms INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_command_logs_created ON command_logs(created_at);

        CREATE TABLE IF NOT EXISTS moderation_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          group_id TEXT,
          user_id TEXT,
          actor_id TEXT,
          detail TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_moderation_logs
          ON moderation_logs(group_id, user_id, created_at);

        CREATE TABLE IF NOT EXISTS bot_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
];

export function runMigrations(db) {
  const current = db.pragma('user_version', { simple: true });
  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      const apply = db.transaction(() => {
        migration.up(db);
        db.pragma(`user_version = ${migration.version}`);
      });
      apply();
    }
  }
}