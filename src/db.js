import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const dbPath = process.env.DB_PATH || './data/gym.db';
const db = new sqlite3.Database(dbPath);

const dbGet = promisify(db.get.bind(db));
const dbAll = promisify(db.all.bind(db));

// Custom run wrapper to support this.lastID and this.changes
const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const initDb = async () => {
  await run('CREATE TABLE IF NOT EXISTS halls (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
  await run(
    'CREATE TABLE IF NOT EXISTS trainers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, pin TEXT)'
  );
  await run('CREATE TABLE IF NOT EXISTS trainer_halls (trainer_id INTEGER, hall_id INTEGER)');
  await run(`CREATE TABLE IF NOT EXISTS checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trainer_id INTEGER,
        hall_id INTEGER,
        start_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_timestamp DATETIME,
        duration_minutes INTEGER
    )`);
  await run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');

  // Initial Settings
  await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('max_session_minutes', '180')");
  await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('default_session_minutes', '90')");
  await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('hourly_wage', '20')");
};

const getSettings = async () => {
  const rows = await dbAll('SELECT * FROM settings');
  const settings = {};
  rows.forEach((row) => (settings[row.key] = row.value));
  return settings;
};

const get = (sql, params = []) => dbGet(sql, params);
const all = (sql, params = []) => dbAll(sql, params);

export default {
  initDb,
  getSettings,
  run,
  get,
  all,
  db,
};
