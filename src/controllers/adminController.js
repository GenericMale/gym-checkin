import db from '../db.js';
import { generateQRCode } from '../utils/qrcode.js';
import { createExportWorkbook, createTrainerWorkbook } from '../utils/excel.js';
import logger from '../utils/logger.js';

const BASE_PATH = process.env.BASE_PATH || '';

const redirect = (res, url) => {
  const cleanPath = url.startsWith('/') ? url : `/${url}`;
  return res.redirect(`${BASE_PATH}${cleanPath}`);
};

export const getLogin = (req, res) => res.render('login', { error: null });

export const postLogin = (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    redirect(res, '/admin');
  } else {
    res.render('login', { error: req.__('ERROR_INVALID_PASSWORD') });
  }
};

export const logout = (req, res) => {
  req.session.destroy();
  redirect(res, '/admin/login');
};

export const getDashboard = async (req, res) => {
  const baseUrl = req.protocol + '://' + req.get('host') + BASE_PATH;

  try {
    const halls = await db.all('SELECT * FROM halls ORDER BY name ASC');
    for (let hall of halls) {
      hall.url = `${baseUrl}/checkin?hall=${hall.id}`;
      hall.qr = await generateQRCode(hall.url);
    }

    const trainers = await db.all('SELECT * FROM trainers ORDER BY name ASC');
    const assignments = await db.all('SELECT * FROM trainer_halls');
    const settings = await db.getSettings();

    res.render('admin', { halls, trainers, assignments, settings });
  } catch (err) {
    logger.error('Datenbankfehler in getDashboard', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const getProtocol = async (req, res) => {
  const { month, trainer, hall } = req.query;

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const selectedMonth = month || defaultMonth;

  let query = `
        SELECT c.*, COALESCE(t.name, ?) as trainer, COALESCE(h.name, ?) as hall
        FROM checkins c
        LEFT JOIN trainers t ON c.trainer_id = t.id
        LEFT JOIN halls h ON c.hall_id = h.id
        WHERE strftime('%Y-%m', c.start_timestamp) = ?
    `;
  const params = [req.__('ERROR_DELETED'), req.__('ERROR_DELETED'), selectedMonth];

  if (trainer) {
    query += ' AND c.trainer_id = ?';
    params.push(trainer);
  }
  if (hall) {
    query += ' AND c.hall_id = ?';
    params.push(hall);
  }

  query += ' ORDER BY c.start_timestamp DESC';

  try {
    const logs = await db.all(query, params);
    const trainers = await db.all('SELECT id, name FROM trainers ORDER BY name ASC');
    const halls = await db.all('SELECT id, name FROM halls ORDER BY name ASC');
    const settings = await db.getSettings();

    res.render('protocol', {
      logs,
      trainers,
      halls,
      settings,
      filters: { month: selectedMonth, trainer, hall },
    });
  } catch (err) {
    logger.error('Datenbankfehler in getProtocol', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const updateSettings = async (req, res) => {
  const { max_session_minutes, default_session_minutes, hourly_wage } = req.body;
  try {
    await db.run("UPDATE settings SET value = ? WHERE key = 'max_session_minutes'", [
      max_session_minutes,
    ]);
    await db.run("UPDATE settings SET value = ? WHERE key = 'default_session_minutes'", [
      default_session_minutes,
    ]);
    await db.run("UPDATE settings SET value = ? WHERE key = 'hourly_wage'", [hourly_wage]);
    redirect(res, '/admin');
  } catch (err) {
    logger.error('Datenbankfehler in updateSettings', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const addHall = async (req, res) => {
  try {
    await db.run('INSERT INTO halls (name) VALUES (?)', [req.body.name]);
    redirect(res, '/admin');
  } catch (err) {
    logger.error('Datenbankfehler in addHall', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const editHall = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  try {
    await db.run('UPDATE halls SET name = ? WHERE id = ?', [name, id]);
    redirect(res, '/admin');
  } catch (err) {
    logger.error('Datenbankfehler in editHall', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const deleteHall = async (req, res) => {
  try {
    await db.run('DELETE FROM halls WHERE id = ?', [req.params.id]);
    await db.run('DELETE FROM trainer_halls WHERE hall_id = ?', [req.params.id]);
    redirect(res, '/admin');
  } catch (err) {
    logger.error('Datenbankfehler in deleteHall', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const addTrainer = async (req, res) => {
  const { name, pin, halls } = req.body;
  try {
    const result = await db.run('INSERT INTO trainers (name, pin) VALUES (?, ?)', [name, pin]);
    const trainerId = result.lastID;
    const hallIds = Array.isArray(halls) ? halls : halls ? [halls] : [];
    for (const hallId of hallIds) {
      await db.run('INSERT INTO trainer_halls (trainer_id, hall_id) VALUES (?, ?)', [
        trainerId,
        hallId,
      ]);
    }
    redirect(res, '/admin');
  } catch (err) {
    logger.error('Datenbankfehler in addTrainer', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const editTrainer = async (req, res) => {
  const trainerId = req.params.id;
  const { name, pin, halls } = req.body;
  try {
    await db.run('UPDATE trainers SET name = ?, pin = ? WHERE id = ?', [name, pin, trainerId]);
    await db.run('DELETE FROM trainer_halls WHERE trainer_id = ?', [trainerId]);
    const hallIds = Array.isArray(halls) ? halls : halls ? [halls] : [];
    for (const hallId of hallIds) {
      await db.run('INSERT INTO trainer_halls (trainer_id, hall_id) VALUES (?, ?)', [
        trainerId,
        hallId,
      ]);
    }
    redirect(res, '/admin');
  } catch (err) {
    logger.error('Datenbankfehler in editTrainer', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const deleteTrainer = async (req, res) => {
  try {
    await db.run('DELETE FROM trainers WHERE id = ?', [req.params.id]);
    await db.run('DELETE FROM trainer_halls WHERE trainer_id = ?', [req.params.id]);
    redirect(res, '/admin');
  } catch (err) {
    logger.error('Datenbankfehler in deleteTrainer', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const deleteCheckin = async (req, res) => {
  try {
    await db.run('DELETE FROM checkins WHERE id = ?', [req.params.id]);
    res.status(200).send('OK');
  } catch (err) {
    logger.error('Datenbankfehler in deleteCheckin', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const addCheckin = async (req, res) => {
  const { trainer_id, hall_id, date, start_time, end_time } = req.body;
  try {
    const start = new Date(`${date}T${start_time}`);
    const end = new Date(`${date}T${end_time}`);
    if (end < start) end.setDate(end.getDate() + 1);
    const durationMinutes = Math.round((end - start) / (1000 * 60));

    const toSqlTimestamp = (date) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
    };

    await db.run(
      'INSERT INTO checkins (trainer_id, hall_id, start_timestamp, end_timestamp, duration_minutes) VALUES (?, ?, ?, ?, ?)',
      [trainer_id, hall_id, toSqlTimestamp(start), toSqlTimestamp(end), durationMinutes]
    );

    redirect(res, '/admin/protocol');
  } catch (err) {
    logger.error('Datenbankfehler in addCheckin', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const editCheckin = async (req, res) => {
  const { id } = req.params;
  const { trainer_id, hall_id, date, start_time, end_time } = req.body;
  try {
    const start = new Date(`${date}T${start_time}`);
    const end = new Date(`${date}T${end_time}`);
    if (end < start) end.setDate(end.getDate() + 1);
    const durationMinutes = Math.round((end - start) / (1000 * 60));

    const toSqlTimestamp = (date) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
    };

    await db.run(
      'UPDATE checkins SET trainer_id = ?, hall_id = ?, start_timestamp = ?, end_timestamp = ?, duration_minutes = ? WHERE id = ?',
      [trainer_id, hall_id, toSqlTimestamp(start), toSqlTimestamp(end), durationMinutes, id]
    );

    redirect(res, '/admin/protocol');
  } catch (err) {
    logger.error('Datenbankfehler in editCheckin', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const deleteFilteredCheckins = async (req, res) => {
  const { month, trainer, hall } = req.body;
  let query = "DELETE FROM checkins WHERE strftime('%Y-%m', start_timestamp) = ?";
  const params = [month];

  if (trainer) {
    query += ' AND trainer_id = ?';
    params.push(trainer);
  }
  if (hall) {
    query += ' AND hall_id = ?';
    params.push(hall);
  }

  try {
    await db.run(query, params);
    res.status(200).send('OK');
  } catch (err) {
    logger.error('Datenbankfehler in deleteFilteredCheckins', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const exportAll = async (req, res) => {
  const { month } = req.query;
  const now = new Date();
  const selectedMonth =
    month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    const settings = await db.getSettings();
    const hourlyWage = parseFloat(settings.hourly_wage);

    const rows = await db.all(
      `
            SELECT c.*, COALESCE(t.name, ?) as trainer_name, COALESCE(h.name, ?) as hall_name
            FROM checkins c
            LEFT JOIN trainers t ON c.trainer_id = t.id
            LEFT JOIN halls h ON c.hall_id = h.id
            WHERE strftime('%Y-%m', c.start_timestamp) = ?
            ORDER BY t.name ASC, c.start_timestamp ASC
        `,
      [req.__('ERROR_UNKNOWN'), req.__('ERROR_DELETED'), selectedMonth]
    );

    const workbook = await createExportWorkbook(
      rows,
      hourlyWage,
      req.__.bind(req),
      req.getLocale() || 'de'
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=ktv-abrechnung-${selectedMonth}.xlsx`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error('Exportfehler in exportAll', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const exportTrainer = async (req, res) => {
  const { trainerId, pin, month } = req.body;

  try {
    const trainer = await db.get('SELECT * FROM trainers WHERE id = ? AND pin = ?', [
      trainerId,
      pin,
    ]);
    if (!trainer) return res.status(401).send(req.__('ERROR_INVALID_PIN'));

    let selectedMonth = month;
    const now = new Date();
    if (month === 'current') {
      selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    } else if (month === 'last') {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      selectedMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    }

    const settings = await db.getSettings();
    const hourlyWage = parseFloat(settings.hourly_wage);

    const rows = await db.all(
      `
            SELECT c.*, COALESCE(h.name, ?) as hall_name
            FROM checkins c
            LEFT JOIN halls h ON c.hall_id = h.id
            WHERE c.trainer_id = ? AND strftime('%Y-%m', c.start_timestamp) = ?
            ORDER BY c.start_timestamp ASC
        `,
      [req.__('ERROR_DELETED'), trainerId, selectedMonth]
    );

    const workbook = await createTrainerWorkbook(
      trainer.name,
      rows,
      hourlyWage,
      req.__.bind(req),
      req.getLocale() || 'de'
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=ktv-abrechnung-${trainer.name.replace(/\s+/g, '_')}-${selectedMonth}.xlsx`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error('Exportfehler in exportTrainer', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};
