import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Synchronous execution inside BEGIN/COMMIT: no await permits interleaving. */
export function d1(database) {
  function prepare(sql) {
    let values = [];
    const statement = {
      bind(...params) { values = params.map(v => v === undefined ? null : v); return statement; },
      async first() { return database.prepare(sql).get(...values) ?? null; },
      async all() { return { results: database.prepare(sql).all(...values) }; },
      async run() { return statement.execute(); },
      execute() { return { success: true, meta: database.prepare(sql).run(...values) }; },
    };
    return statement;
  }
  return { prepare, async batch(statements) {
    database.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(s => s.execute()); database.exec('COMMIT'); return results; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  } };
}

/** Applied Drizzle migrations are immutable. Import older bootstrap databases
 * without replaying their DDL; upgrades thereafter are journalled transactions.
 * This is a host startup operation, never schema DDL in a request handler. */
export function migrate(database, root, dbPath = ':memory:') {
  const folder = join(root, '.openai', 'drizzle');
  const migrations = readdirSync(folder).filter(f => /^\d+.*\.sql$/.test(f)).sort();
  const hasJournal = database.prepare("SELECT name FROM sqlite_master WHERE name='fintwin_migrations'").get();
  const applied = new Set(hasJournal ? database.prepare('SELECT name FROM fintwin_migrations').all().map(r => r.name) : []);
  if (migrations.every(f => applied.has(f))) return;
  if (dbPath !== ':memory:' && existsSync(dbPath)) {
    const backup = `${dbPath}.backup-${Date.now()}`;
    mkdirSync(dirname(backup), { recursive: true });
    database.prepare('VACUUM INTO ?').run(backup);
    console.info('FinTwin: pre-migration database backup created beside the local database.');
  }
  database.exec('CREATE TABLE IF NOT EXISTS fintwin_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const file of migrations) {
    if (applied.has(file)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      const sql = readFileSync(join(folder, file), 'utf8');
      // Only the legacy bootstrap migrations were historically run without a
      // journal. Introspect exact object names when importing that history.
      const statements = sql.split('--> statement-breakpoint').flatMap(s => s.split(';')).map(s => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
      for (const statement of statements) {
        const object = statement.match(/^CREATE (?:TABLE|INDEX)(?: IF NOT EXISTS)? [`"]?(\w+)/i)?.[1];
        if (Number(file.slice(0, 4)) <= 2 && object && database.prepare('SELECT name FROM sqlite_master WHERE name=?').get(object)) continue;
        database.exec(statement);
      }
      // Migration 0002 deliberately left these columns to a legacy runtime
      // bootstrap. Import that exact historical gap here, not in worker routes.
      if (file.startsWith('0002')) for (const [table, column, ddl] of [
        ['user_profiles','onboarding_done','INTEGER NOT NULL DEFAULT 0'],
        ['user_profiles','voice_autoplay','INTEGER NOT NULL DEFAULT 1'],
        ['user_profiles','sample_loaded','INTEGER NOT NULL DEFAULT 0'],
        ['conversation_turns','cards',"TEXT NOT NULL DEFAULT '[]'"],
        ['conversation_turns','suggestions',"TEXT NOT NULL DEFAULT '[]'"],
        ['conversation_turns','meta',"TEXT NOT NULL DEFAULT '{}'"],
      ]) if (!database.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      database.prepare('INSERT INTO fintwin_migrations VALUES (?,?)').run(file, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
}
