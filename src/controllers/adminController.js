import db from '../db.js';
import { generateQRCode } from '../utils/qrcode.js';
import { generateExport } from '../utils/prae.js';
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
    redirect(res, '/admin/turnplan');
  } else {
    res.render('login', { error: req.__('ERROR_INVALID_PASSWORD') });
  }
};

export const logout = (req, res) => {
  req.session.destroy();
  redirect(res, '/admin/login');
};

export const getTurnplan = async (req, res) => {
  try {
    const turnplan = await db.all(`
      SELECT tp.*, h.name as hall_name, t.name as trainer_name
      FROM turnplan tp
      LEFT JOIN halls h ON tp.hall_id = h.id
      LEFT JOIN trainers t ON tp.trainer_id = t.id
      ORDER BY h.name ASC, tp.time_from ASC
    `);

    const halls = await db.all('SELECT * FROM halls ORDER BY name ASC');
    const trainers = await db.all('SELECT * FROM trainers ORDER BY name ASC');
    const settings = await db.getSettings();

    res.render('turnplan', { turnplan, halls, trainers, settings, activeTab: 'turnplan' });
  } catch (err) {
    logger.error('Datenbankfehler in getTurnplan', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const getTrainers = async (req, res) => {
  try {
    const trainers = await db.all('SELECT * FROM trainers ORDER BY name ASC');
    res.render('trainers', { trainers, activeTab: 'trainers' });
  } catch (err) {
    logger.error('Datenbankfehler in getTrainers', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const getHalls = async (req, res) => {
  const baseUrl = req.protocol + '://' + req.get('host') + BASE_PATH;
  try {
    const halls = await db.all('SELECT * FROM halls ORDER BY name ASC');
    for (let hall of halls) {
      hall.url = `${baseUrl}/checkin?hall=${hall.id}`;
      hall.qr = await generateQRCode(hall.url);
    }
    res.render('halls', { halls, activeTab: 'halls' });
  } catch (err) {
    logger.error('Datenbankfehler in getHalls', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const getProtocol = async (req, res) => {
  const { month, trainer, hall } = req.query;

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const selectedMonth = month || defaultMonth;

  try {
    let query = `
      SELECT c.*,
             COALESCE(tp.name, c.remarks, 'Einheit') as course_name,
             COALESCE(h.name, ?) as hall_name,
             COALESCE(mt.name, ?) as main_trainer_name,
             COALESCE(mt.main_wage, 0) as main_wage
      FROM checkins c
      LEFT JOIN turnplan tp ON c.turnplan_id = tp.id
      LEFT JOIN halls h ON c.hall_id = h.id
      LEFT JOIN trainers mt ON c.main_trainer_id = mt.id
      WHERE (strftime('%Y-%m', c.date) = ? OR strftime('%Y-%m', c.start_timestamp) = ?)
    `;
    const params = [req.__('ERROR_DELETED'), req.__('ERROR_DELETED'), selectedMonth, selectedMonth];

    if (trainer) {
      query += ` AND (c.main_trainer_id = ? OR c.id IN (SELECT checkin_id FROM checkin_helpers WHERE trainer_id = ?))`;
      params.push(trainer, trainer);
    }
    if (hall) {
      query += ' AND c.hall_id = ?';
      params.push(hall);
    }

    query += ' ORDER BY c.date DESC, c.start_time DESC, c.start_timestamp DESC';

    const checkinRows = await db.all(query, params);
    const allHelpers = await db.all(`
      SELECT ch.checkin_id, t.id as trainer_id, t.name, COALESCE(t.helper_wage, 0) as helper_wage
      FROM checkin_helpers ch
      JOIN trainers t ON ch.trainer_id = t.id
    `);

    const helpersByCheckin = {};
    allHelpers.forEach((h) => {
      if (!helpersByCheckin[h.checkin_id]) helpersByCheckin[h.checkin_id] = [];
      helpersByCheckin[h.checkin_id].push(h);
    });

    const logs = checkinRows.map((c) => {
      const helpers = helpersByCheckin[c.id] || [];
      const durationHours = (c.duration_minutes || 0) / 60;
      const mainPay = durationHours * (c.main_wage || 0);
      const helperPay = helpers.reduce((sum, h) => sum + durationHours * (h.helper_wage || 0), 0);
      const totalPay = mainPay + helperPay;

      return {
        ...c,
        helpers,
        mainPay,
        helperPay,
        totalPay,
      };
    });

    const trainers = await db.all('SELECT id, name FROM trainers ORDER BY name ASC');
    const halls = await db.all('SELECT id, name FROM halls ORDER BY name ASC');
    const settings = await db.getSettings();

    res.render('protocol', {
      logs,
      trainers,
      halls,
      settings,
      filters: { month: selectedMonth, trainer, hall },
      activeTab: 'protocol',
    });
  } catch (err) {
    logger.error('Datenbankfehler in getProtocol', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const updateSettings = async (req, res) => {
  const { grace_period_minutes } = req.body;
  try {
    await db.run(
      'INSERT INTO settings (key, value) VALUES (\'grace_period_minutes\', ?) ON CONFLICT(key) DO UPDATE SET value = ?',
      [grace_period_minutes, grace_period_minutes]
    );
    redirect(res, '/admin/turnplan');
  } catch (err) {
    logger.error('Datenbankfehler in updateSettings', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const addHall = async (req, res) => {
  try {
    await db.run('INSERT INTO halls (name) VALUES (?)', [req.body.name]);
    redirect(res, '/admin/halls');
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
    redirect(res, '/admin/halls');
  } catch (err) {
    logger.error('Datenbankfehler in editHall', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const deleteHall = async (req, res) => {
  try {
    await db.run('DELETE FROM halls WHERE id = ?', [req.params.id]);
    await db.run('DELETE FROM turnplan WHERE hall_id = ?', [req.params.id]);
    redirect(res, '/admin/halls');
  } catch (err) {
    logger.error('Datenbankfehler in deleteHall', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const addTrainer = async (req, res) => {
  const { name, pin, main_wage, helper_wage } = req.body;
  try {
    await db.run(
      'INSERT INTO trainers (name, pin, main_wage, helper_wage) VALUES (?, ?, ?, ?)',
      [name, pin, parseFloat(main_wage) || 0, parseFloat(helper_wage) || 0]
    );
    redirect(res, '/admin/trainers');
  } catch (err) {
    logger.error('Datenbankfehler in addTrainer', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const editTrainer = async (req, res) => {
  const trainerId = req.params.id;
  const { name, pin, main_wage, helper_wage } = req.body;
  try {
    await db.run(
      'UPDATE trainers SET name = ?, pin = ?, main_wage = ?, helper_wage = ? WHERE id = ?',
      [name, pin, parseFloat(main_wage) || 0, parseFloat(helper_wage) || 0, trainerId]
    );
    redirect(res, '/admin/trainers');
  } catch (err) {
    logger.error('Datenbankfehler in editTrainer', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const deleteTrainer = async (req, res) => {
  try {
    await db.run('DELETE FROM trainers WHERE id = ?', [req.params.id]);
    redirect(res, '/admin/trainers');
  } catch (err) {
    logger.error('Datenbankfehler in deleteTrainer', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const addTurnplan = async (req, res) => {
  const { name, hall_id, trainer_id, is_special, remarks, weekdays, time_from, time_to } = req.body;
  try {
    const days = Array.isArray(weekdays) ? weekdays : weekdays ? [weekdays] : [];
    await db.run(
      `INSERT INTO turnplan (name, hall_id, trainer_id, is_special, remarks, weekdays, time_from, time_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        hall_id,
        trainer_id,
        is_special ? 1 : 0,
        remarks || '',
        JSON.stringify(days),
        time_from,
        time_to,
      ]
    );
    redirect(res, '/admin/turnplan');
  } catch (err) {
    logger.error('Datenbankfehler in addTurnplan', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const editTurnplan = async (req, res) => {
  const { id } = req.params;
  const { name, hall_id, trainer_id, is_special, remarks, weekdays, time_from, time_to } = req.body;
  try {
    const days = Array.isArray(weekdays) ? weekdays : weekdays ? [weekdays] : [];
    await db.run(
      `UPDATE turnplan
       SET name = ?, hall_id = ?, trainer_id = ?, is_special = ?, remarks = ?, weekdays = ?, time_from = ?, time_to = ?
       WHERE id = ?`,
      [
        name,
        hall_id,
        trainer_id,
        is_special ? 1 : 0,
        remarks || '',
        JSON.stringify(days),
        time_from,
        time_to,
        id,
      ]
    );
    redirect(res, '/admin/turnplan');
  } catch (err) {
    logger.error('Datenbankfehler in editTurnplan', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const deleteTurnplan = async (req, res) => {
  try {
    await db.run('DELETE FROM turnplan WHERE id = ?', [req.params.id]);
    redirect(res, '/admin/turnplan');
  } catch (err) {
    logger.error('Datenbankfehler in deleteTurnplan', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const deleteCheckin = async (req, res) => {
  try {
    await db.run('DELETE FROM checkin_helpers WHERE checkin_id = ?', [req.params.id]);
    await db.run('DELETE FROM checkins WHERE id = ?', [req.params.id]);
    res.status(200).send('OK');
  } catch (err) {
    logger.error('Datenbankfehler in deleteCheckin', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const addCheckin = async (req, res) => {
  const { turnplan_id, hall_id, main_trainer_id, helper_ids, date, start_time, end_time, remarks } = req.body;
  try {
    const [sH, sM] = start_time.split(':').map(Number);
    const [eH, eM] = end_time.split(':').map(Number);
    let durationMinutes = eH * 60 + eM - (sH * 60 + sM);
    if (durationMinutes < 0) durationMinutes += 24 * 60;

    const result = await db.run(
      `INSERT INTO checkins (turnplan_id, hall_id, main_trainer_id, date, start_time, end_time, duration_minutes, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [turnplan_id || null, hall_id, main_trainer_id, date, start_time, end_time, durationMinutes, remarks || '']
    );

    const checkinId = result.lastID;
    const helpers = Array.isArray(helper_ids) ? helper_ids : helper_ids ? [helper_ids] : [];
    for (const hId of helpers) {
      if (hId && parseInt(hId) !== parseInt(main_trainer_id)) {
        await db.run('INSERT INTO checkin_helpers (checkin_id, trainer_id) VALUES (?, ?)', [checkinId, hId]);
      }
    }

    redirect(res, '/admin/protocol');
  } catch (err) {
    logger.error('Datenbankfehler in addCheckin', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const editCheckin = async (req, res) => {
  const { id } = req.params;
  const { hall_id, main_trainer_id, helper_ids, date, start_time, end_time, remarks } = req.body;
  try {
    const [sH, sM] = start_time.split(':').map(Number);
    const [eH, eM] = end_time.split(':').map(Number);
    let durationMinutes = eH * 60 + eM - (sH * 60 + sM);
    if (durationMinutes < 0) durationMinutes += 24 * 60;

    await db.run(
      `UPDATE checkins
       SET hall_id = ?, main_trainer_id = ?, date = ?, start_time = ?, end_time = ?, duration_minutes = ?, remarks = ?
       WHERE id = ?`,
      [hall_id, main_trainer_id, date, start_time, end_time, durationMinutes, remarks || '', id]
    );

    await db.run('DELETE FROM checkin_helpers WHERE checkin_id = ?', [id]);
    const helpers = Array.isArray(helper_ids) ? helper_ids : helper_ids ? [helper_ids] : [];
    for (const hId of helpers) {
      if (hId && parseInt(hId) !== parseInt(main_trainer_id)) {
        await db.run('INSERT INTO checkin_helpers (checkin_id, trainer_id) VALUES (?, ?)', [id, hId]);
      }
    }

    redirect(res, '/admin/protocol');
  } catch (err) {
    logger.error('Datenbankfehler in editCheckin', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const deleteFilteredCheckins = async (req, res) => {
  const { month, trainer, hall } = req.body;
  let query = "DELETE FROM checkins WHERE (strftime('%Y-%m', date) = ? OR strftime('%Y-%m', start_timestamp) = ?)";
  const params = [month, month];

  if (trainer) {
    query += ` AND (main_trainer_id = ? OR id IN (SELECT checkin_id FROM checkin_helpers WHERE trainer_id = ?))`;
    params.push(trainer, trainer);
  }
  if (hall) {
    query += ' AND hall_id = ?';
    params.push(hall);
  }

  try {
    let subQuery = "SELECT id FROM checkins WHERE (strftime('%Y-%m', date) = ? OR strftime('%Y-%m', start_timestamp) = ?)";
    const subParams = [month, month];
    if (trainer) {
      subQuery += ` AND (main_trainer_id = ? OR id IN (SELECT checkin_id FROM checkin_helpers WHERE trainer_id = ?))`;
      subParams.push(trainer, trainer);
    }
    if (hall) {
      subQuery += ' AND hall_id = ?';
      subParams.push(hall);
    }
    const toDelete = await db.all(subQuery, subParams);
    for (const item of toDelete) {
      await db.run('DELETE FROM checkin_helpers WHERE checkin_id = ?', [item.id]);
    }

    await db.run(query, params);
    res.status(200).send('OK');
  } catch (err) {
    logger.error('Datenbankfehler in deleteFilteredCheckins', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

const getTrainerExportData = async (selectedMonth, filterTrainerId = null, filterHallId = null) => {
  const trainers = await db.all('SELECT * FROM trainers ORDER BY name ASC');
  const rowsByTrainer = {};

  for (const t of trainers) {
    if (filterTrainerId && parseInt(filterTrainerId) !== t.id) continue;

    let mainQuery = `
      SELECT c.date, c.start_timestamp, c.duration_minutes
      FROM checkins c
      WHERE c.main_trainer_id = ? AND (strftime('%Y-%m', c.date) = ? OR strftime('%Y-%m', c.start_timestamp) = ?)
    `;
    const mainParams = [t.id, selectedMonth, selectedMonth];
    if (filterHallId) {
      mainQuery += ' AND c.hall_id = ?';
      mainParams.push(filterHallId);
    }
    const mainSessions = await db.all(mainQuery, mainParams);

    let helperQuery = `
      SELECT c.date, c.start_timestamp, c.duration_minutes
      FROM checkins c
      JOIN checkin_helpers ch ON c.id = ch.checkin_id
      WHERE ch.trainer_id = ? AND (strftime('%Y-%m', c.date) = ? OR strftime('%Y-%m', c.start_timestamp) = ?)
    `;
    const helperParams = [t.id, selectedMonth, selectedMonth];
    if (filterHallId) {
      helperQuery += ' AND c.hall_id = ?';
      helperParams.push(filterHallId);
    }
    const helperSessions = await db.all(helperQuery, helperParams);

    const trainerRows = [];
    mainSessions.forEach((s) => {
      const durationHours = (s.duration_minutes || 0) / 60;
      trainerRows.push({
        date: s.date || s.start_timestamp,
        pay: durationHours * (t.main_wage || 0),
      });
    });

    helperSessions.forEach((s) => {
      const durationHours = (s.duration_minutes || 0) / 60;
      trainerRows.push({
        date: s.date || s.start_timestamp,
        pay: durationHours * (t.helper_wage || 0),
      });
    });

    if (trainerRows.length > 0) {
      rowsByTrainer[t.name] = trainerRows;
    }
  }

  return rowsByTrainer;
};

export const exportAll = async (req, res) => {
  const { month, trainer, hall } = req.query;
  const now = new Date();
  const selectedMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    const rowsByTrainer = await getTrainerExportData(selectedMonth, trainer, hall);
    if (Object.keys(rowsByTrainer).length === 0) {
      return res.status(404).send('Keine Daten für Export vorhanden');
    }

    const { buffer, filename, contentType } = await generateExport(rowsByTrainer, selectedMonth);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(buffer);
  } catch (err) {
    logger.error('Exportfehler in exportAll', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const exportTrainer = async (req, res) => {
  const { trainerId, pin, month } = req.body;

  try {
    const trainer = await db.get('SELECT * FROM trainers WHERE id = ? AND pin = ?', [trainerId, pin]);
    if (!trainer) return res.status(401).send(req.__('ERROR_INVALID_PIN'));

    let selectedMonth = month;
    const now = new Date();
    if (month === 'current') {
      selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    } else if (month === 'last') {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      selectedMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    }

    const rowsByTrainer = await getTrainerExportData(selectedMonth, trainerId);
    if (!rowsByTrainer[trainer.name]) {
      rowsByTrainer[trainer.name] = [];
    }

    const { buffer, filename, contentType } = await generateExport(rowsByTrainer, selectedMonth);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(buffer);
  } catch (err) {
    logger.error('Exportfehler in exportTrainer', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};
