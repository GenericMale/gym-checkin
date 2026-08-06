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
      svn TEXT DEFAULT '',
      birth_date TEXT DEFAULT '',
      address TEXT DEFAULT '',
      iban TEXT DEFAULT '',
      is_trainer INTEGER DEFAULT 0,
      is_helper INTEGER DEFAULT 0,
      main_wage_first_hour REAL DEFAULT 0.0,
      main_wage_additional REAL DEFAULT 0.0,
      helper_wage REAL DEFAULT 0.0
    )`
  );

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

  // Trainers allowed to check in for a course (many-to-many)
  await run(`CREATE TABLE IF NOT EXISTS turnplan_trainers (
    turnplan_id INTEGER,
    trainer_id INTEGER,
    PRIMARY KEY (turnplan_id, trainer_id)
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

  // Ensure each course session (turnplan_id + date) is only checked in once
  await run(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_turnplan_date ON checkins(turnplan_id, date)'
  );

  await run(`CREATE TABLE IF NOT EXISTS checkin_helpers (
    checkin_id INTEGER,
    trainer_id INTEGER,
    trainer_name TEXT,
    helper_wage REAL DEFAULT 0.0,
    PRIMARY KEY (checkin_id, trainer_id)
  )`);

  await run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  await run("INSERT OR IGNORE INTO settings (key, value) VALUES ('grace_period_minutes', '30')");
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
