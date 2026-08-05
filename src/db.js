import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const dbDir = process.env.DB_PATH || './data';
const dbPath = path.join(dbDir, 'gym.db');

// Ensure directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

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
    `CREATE TABLE IF NOT EXISTS trainers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      pin TEXT,
      main_wage_first_hour REAL DEFAULT 0.0,
      main_wage_additional REAL DEFAULT 0.0,
      helper_wage REAL DEFAULT 0.0
    )`
  );
  try {
    await run('ALTER TABLE trainers ADD COLUMN main_wage_first_hour REAL DEFAULT 0.0');
  } catch (_e) {}
  try {
    await run('ALTER TABLE trainers ADD COLUMN main_wage_additional REAL DEFAULT 0.0');
  } catch (_e) {}
  try {
    await run('ALTER TABLE trainers ADD COLUMN helper_wage REAL DEFAULT 0.0');
  } catch (_e) {}
  try {
    await run('UPDATE trainers SET main_wage_first_hour = main_wage, main_wage_additional = main_wage WHERE (main_wage_first_hour IS NULL OR main_wage_first_hour = 0) AND main_wage IS NOT NULL');
  } catch (_e) {}

  await run(`CREATE TABLE IF NOT EXISTS turnplan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    hall_id INTEGER,
    trainer_id INTEGER,
    is_special INTEGER DEFAULT 0,
    remarks TEXT,
    weekdays TEXT,
    time_from TEXT,
    time_to TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turnplan_id INTEGER,
    hall_id INTEGER,
    hall_name TEXT,
    main_trainer_id INTEGER,
    main_trainer_name TEXT,
    course_name TEXT,
    date TEXT,
    start_time TEXT,
    end_time TEXT,
    duration_minutes INTEGER,
    main_wage_first_hour REAL DEFAULT 0.0,
    main_wage_additional REAL DEFAULT 0.0,
    remarks TEXT,
    start_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  try { await run('ALTER TABLE checkins ADD COLUMN turnplan_id INTEGER'); } catch (_e) {}
  try { await run('ALTER TABLE checkins ADD COLUMN main_trainer_id INTEGER'); } catch (_e) {}
  try { await run('ALTER TABLE checkins ADD COLUMN hall_name TEXT'); } catch (_e) {}
  try { await run('ALTER TABLE checkins ADD COLUMN main_trainer_name TEXT'); } catch (_e) {}
  try { await run('ALTER TABLE checkins ADD COLUMN course_name TEXT'); } catch (_e) {}
  try { await run('ALTER TABLE checkins ADD COLUMN date TEXT'); } catch (_e) {}
  try { await run('ALTER TABLE checkins ADD COLUMN start_time TEXT'); } catch (_e) {}
  try { await run('ALTER TABLE checkins ADD COLUMN end_time TEXT'); } catch (_e) {}
  try { await run('ALTER TABLE checkins ADD COLUMN remarks TEXT'); } catch (_e) {}
  try { await run('ALTER TABLE checkins ADD COLUMN main_wage_first_hour REAL DEFAULT 0.0'); } catch (_e) {}
  try { await run('ALTER TABLE checkins ADD COLUMN main_wage_additional REAL DEFAULT 0.0'); } catch (_e) {}

  // Migrate old trainer_id to main_trainer_id
  try {
    await run('UPDATE checkins SET main_trainer_id = trainer_id WHERE main_trainer_id IS NULL AND trainer_id IS NOT NULL');
  } catch (_e) {}
  try {
    await run("UPDATE checkins SET date = strftime('%Y-%m-%d', start_timestamp) WHERE date IS NULL AND start_timestamp IS NOT NULL");
  } catch (_e) {}

  await run(`CREATE TABLE IF NOT EXISTS checkin_helpers (
    checkin_id INTEGER,
    trainer_id INTEGER,
    trainer_name TEXT,
    helper_wage REAL DEFAULT 0.0,
    PRIMARY KEY (checkin_id, trainer_id)
  )`);

  try { await run('ALTER TABLE checkin_helpers ADD COLUMN trainer_name TEXT'); } catch (_e) {}
  try { await run('ALTER TABLE checkin_helpers ADD COLUMN helper_wage REAL DEFAULT 0.0'); } catch (_e) {}

  await run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('grace_period_minutes', '30')");
  await run('DROP TABLE IF EXISTS trainer_halls');
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
