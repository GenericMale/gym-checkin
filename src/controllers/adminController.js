import db from '../db.js';
import { generateQRCode } from '../utils/qrcode.js';
import { generateExport } from '../utils/prae.js';
import { calculateTrainerDailyWage } from '../utils/wage.js';
import { getZonedNow, getZonedMonthStr } from '../utils/time.js';
import logger from '../utils/logger.js';

const BASE_PATH = process.env.BASE_PATH || '';

const WEEKDAY_ORDER = { Mo: 0, Di: 1, Mi: 2, Do: 3, Fr: 4, Sa: 5, So: 6 };

const turnplanSortKey = (item) => {
  let day;
  try {
    const arr = JSON.parse(item.weekdays);
    day = Array.isArray(arr) && arr.length > 0 ? arr[0] : '';
  } catch {
    day = item.weekdays ? item.weekdays.split(',')[0].trim() : '';
  }
  const time = item.time_from ? item.time_from.replace(':', '') : '0000';
  const dayOrder = WEEKDAY_ORDER[day] ?? 7;
  const hall = (item.hall_name || '').toLowerCase();
  return `${String(dayOrder).padStart(2, '0')}_${hall}_${time}`;
};

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
      SELECT tp.*, h.name as hall_name,
        (SELECT GROUP_CONCAT(t2.name, ', ')
         FROM turnplan_trainers tt
         JOIN trainers t2 ON tt.trainer_id = t2.id
         WHERE tt.turnplan_id = tp.id) as trainer_names
      FROM turnplan tp
      LEFT JOIN halls h ON tp.hall_id = h.id
      ORDER BY h.name ASC, tp.time_from ASC
    `);

    const trainerRows = await db.all('SELECT turnplan_id, trainer_id FROM turnplan_trainers');
    const turnplanTrainerMap = {};
    trainerRows.forEach((r) => {
      if (!turnplanTrainerMap[r.turnplan_id]) turnplanTrainerMap[r.turnplan_id] = [];
      turnplanTrainerMap[r.turnplan_id].push(r.trainer_id);
    });

    turnplan.sort((a, b) => {
      const byDayTime = turnplanSortKey(a).localeCompare(turnplanSortKey(b));
      if (byDayTime !== 0) return byDayTime;
      return (a.hall_name || '').localeCompare(b.hall_name || '');
    });

    const halls = await db.all('SELECT * FROM halls ORDER BY name ASC');
    const trainers = await db.all('SELECT * FROM trainers WHERE is_trainer = 1 ORDER BY name ASC');
    const settings = await db.getSettings();

    res.render('turnplan', {
      turnplan,
      halls,
      trainers,
      settings,
      turnplanTrainerMap,
      activeTab: 'turnplan',
    });
  } catch (err) {
    logger.error('Datenbankfehler in getTurnplan', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const getTrainers = async (req, res) => {
  try {
    const trainers = await db.all(
      'SELECT * FROM trainers ORDER BY is_trainer DESC, is_helper DESC, name ASC'
    );
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

  const defaultMonth = getZonedMonthStr();
  const selectedMonth = month || defaultMonth;

  try {
    let query = `
      SELECT c.*,
             COALESCE(c.course_name, tp.name, c.remarks, ?) as course_name,
             COALESCE(c.hall_name, h.name, ?) as hall_name,
             COALESCE(c.main_trainer_name, mt.name, ?) as main_trainer_name,
             COALESCE(c.main_wage_first_hour, mt.main_wage_first_hour, 0) as main_wage_first_hour,
             COALESCE(c.main_wage_additional, mt.main_wage_additional, 0) as main_wage_additional
      FROM checkins c
      LEFT JOIN turnplan tp ON c.turnplan_id = tp.id
      LEFT JOIN halls h ON c.hall_id = h.id
      LEFT JOIN trainers mt ON c.main_trainer_id = mt.id
      WHERE strftime('%Y-%m', c.date) = ?
    `;
    const params = [
      req.__('DEFAULT_UNIT_NAME'),
      req.__('ERROR_DELETED'),
      req.__('ERROR_DELETED'),
      selectedMonth,
    ];

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
      SELECT ch.checkin_id, ch.trainer_id, COALESCE(ch.trainer_name, t.name) as name, COALESCE(ch.helper_wage, t.helper_wage, 0) as helper_wage
      FROM checkin_helpers ch
      LEFT JOIN trainers t ON ch.trainer_id = t.id
    `);

    const helpersByCheckin = {};
    allHelpers.forEach((h) => {
      if (!helpersByCheckin[h.checkin_id]) helpersByCheckin[h.checkin_id] = [];
      helpersByCheckin[h.checkin_id].push(h);
    });

    // Group main checkins by (main_trainer_id, date) for daily tiered wage calculation
    const mainSessionsByTrainerDate = {};

    checkinRows.forEach((c) => {
      const tId = c.main_trainer_id;
      const date = c.date;
      const key = `${tId}_${date}`;
      if (!mainSessionsByTrainerDate[key]) mainSessionsByTrainerDate[key] = [];
      mainSessionsByTrainerDate[key].push(c);
    });

    // Pre-calculate session breakdown per (main_trainer_id, date)
    const sessionMainPayMap = {};
    Object.keys(mainSessionsByTrainerDate).forEach((key) => {
      const mainSessions = mainSessionsByTrainerDate[key];
      const { mainBreakdown } = calculateTrainerDailyWage(mainSessions, []);
      Object.keys(mainBreakdown).forEach((checkinId) => {
        sessionMainPayMap[checkinId] = mainBreakdown[checkinId].pay;
      });
    });

    const logs = checkinRows.map((c) => {
      const helpers = helpersByCheckin[c.id] || [];
      const mainPay = typeof sessionMainPayMap[c.id] === 'number' ? sessionMainPayMap[c.id] : 0;
      const helperPay = helpers.reduce((sum, h) => sum + (h.helper_wage || 0), 0);
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
    const mainTrainers = await db.all(
      'SELECT id, name FROM trainers WHERE is_trainer = 1 ORDER BY name ASC'
    );
    const helperTrainers = await db.all(
      'SELECT id, name FROM trainers WHERE is_helper = 1 ORDER BY name ASC'
    );
    const halls = await db.all('SELECT id, name FROM halls ORDER BY name ASC');
    const settings = await db.getSettings();

    res.render('protocol', {
      logs,
      trainers,
      mainTrainers,
      helperTrainers,
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
      "INSERT INTO settings (key, value) VALUES ('grace_period_minutes', ?) ON CONFLICT(key) DO UPDATE SET value = ?",
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
  const {
    name,
    pin,
    svn,
    birth_date,
    address,
    iban,
    is_trainer,
    is_helper,
    main_wage_first_hour,
    main_wage_additional,
    helper_wage,
  } = req.body;
  const isTrainer = is_trainer ? 1 : 0;
  const isHelper = is_helper ? 1 : 0;
  try {
    await db.run(
      `INSERT INTO trainers (name, pin, svn, birth_date, address, iban, is_trainer, is_helper, main_wage_first_hour, main_wage_additional, helper_wage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        isTrainer ? pin : '',
        svn || '',
        birth_date || '',
        address || '',
        iban || '',
        isTrainer,
        isHelper,
        parseFloat(main_wage_first_hour) || 0,
        parseFloat(main_wage_additional) || 0,
        parseFloat(helper_wage) || 0,
      ]
    );
    redirect(res, '/admin/trainers');
  } catch (err) {
    logger.error('Datenbankfehler in addTrainer', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const editTrainer = async (req, res) => {
  const trainerId = req.params.id;
  const {
    name,
    pin,
    svn,
    birth_date,
    address,
    iban,
    is_trainer,
    is_helper,
    main_wage_first_hour,
    main_wage_additional,
    helper_wage,
  } = req.body;
  const isTrainer = is_trainer ? 1 : 0;
  const isHelper = is_helper ? 1 : 0;
  try {
    await db.run(
      `UPDATE trainers
       SET name = ?, pin = ?, svn = ?, birth_date = ?, address = ?, iban = ?,
           is_trainer = ?, is_helper = ?,
           main_wage_first_hour = ?, main_wage_additional = ?, helper_wage = ?
       WHERE id = ?`,
      [
        name,
        isTrainer ? pin : '',
        svn || '',
        birth_date || '',
        address || '',
        iban || '',
        isTrainer,
        isHelper,
        parseFloat(main_wage_first_hour) || 0,
        parseFloat(main_wage_additional) || 0,
        parseFloat(helper_wage) || 0,
        trainerId,
      ]
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
  const { name, hall_id, trainer_ids, remarks, weekdays, time_from, time_to } = req.body;
  try {
    const days = Array.isArray(weekdays) ? weekdays : weekdays ? [weekdays] : [];
    const trainerIds = Array.isArray(trainer_ids) ? trainer_ids : trainer_ids ? [trainer_ids] : [];
    const result = await db.run(
      `INSERT INTO turnplan (name, hall_id, trainer_id, remarks, weekdays, time_from, time_to)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        hall_id,
        trainerIds[0] || null,
        remarks || '',
        JSON.stringify(days),
        time_from,
        time_to,
      ]
    );
    for (const tId of trainerIds) {
      await db.run(
        'INSERT OR IGNORE INTO turnplan_trainers (turnplan_id, trainer_id) VALUES (?, ?)',
        [result.lastID, tId]
      );
    }
    redirect(res, '/admin/turnplan');
  } catch (err) {
    logger.error('Datenbankfehler in addTurnplan', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const editTurnplan = async (req, res) => {
  const { id } = req.params;
  const { name, hall_id, trainer_ids, remarks, weekdays, time_from, time_to } = req.body;
  try {
    const days = Array.isArray(weekdays) ? weekdays : weekdays ? [weekdays] : [];
    const trainerIds = Array.isArray(trainer_ids) ? trainer_ids : trainer_ids ? [trainer_ids] : [];
    await db.run(
      `UPDATE turnplan
       SET name = ?, hall_id = ?, trainer_id = ?, remarks = ?, weekdays = ?, time_from = ?, time_to = ?
       WHERE id = ?`,
      [
        name,
        hall_id,
        trainerIds[0] || null,
        remarks || '',
        JSON.stringify(days),
        time_from,
        time_to,
        id,
      ]
    );
    await db.run('DELETE FROM turnplan_trainers WHERE turnplan_id = ?', [id]);
    for (const tId of trainerIds) {
      await db.run(
        'INSERT OR IGNORE INTO turnplan_trainers (turnplan_id, trainer_id) VALUES (?, ?)',
        [id, tId]
      );
    }
    redirect(res, '/admin/turnplan');
  } catch (err) {
    logger.error('Datenbankfehler in editTurnplan', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const deleteTurnplan = async (req, res) => {
  try {
    await db.run('DELETE FROM turnplan_trainers WHERE turnplan_id = ?', [req.params.id]);
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
  const { turnplan_id, hall_id, main_trainer_id, helper_ids, date, start_time, end_time, remarks } =
    req.body;
  try {
    const hall = await db.get('SELECT * FROM halls WHERE id = ?', [hall_id]);
    const trainer = await db.get('SELECT * FROM trainers WHERE id = ?', [main_trainer_id]);

    const [sH, sM] = start_time.split(':').map(Number);
    const [eH, eM] = end_time.split(':').map(Number);
    let durationMinutes = eH * 60 + eM - (sH * 60 + sM);
    if (durationMinutes < 0) durationMinutes += 24 * 60;

    let courseName = remarks || req.__('DEFAULT_UNIT_NAME');
    if (turnplan_id) {
      const course = await db.get('SELECT * FROM turnplan WHERE id = ?', [turnplan_id]);
      if (course) courseName = course.name;
    }

    const result = await db.run(
      `INSERT INTO checkins (
        turnplan_id, hall_id, hall_name,
        main_trainer_id, main_trainer_name,
        course_name, date, start_time, end_time,
        duration_minutes, main_wage_first_hour, main_wage_additional, remarks
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        turnplan_id || null,
        hall_id,
        hall ? hall.name : '',
        main_trainer_id,
        trainer ? trainer.name : '',
        courseName,
        date,
        start_time,
        end_time,
        durationMinutes,
        trainer ? parseFloat(trainer.main_wage_first_hour) || 0 : 0,
        trainer ? parseFloat(trainer.main_wage_additional) || 0 : 0,
        remarks || '',
      ]
    );

    const checkinId = result.lastID;
    const helpers = Array.isArray(helper_ids) ? helper_ids : helper_ids ? [helper_ids] : [];
    for (const hId of helpers) {
      if (hId && parseInt(hId) !== parseInt(main_trainer_id)) {
        const hTrainer = await db.get('SELECT * FROM trainers WHERE id = ?', [hId]);
        if (hTrainer) {
          await db.run(
            `INSERT INTO checkin_helpers (checkin_id, trainer_id, trainer_name, helper_wage)
             VALUES (?, ?, ?, ?)`,
            [checkinId, hTrainer.id, hTrainer.name, parseFloat(hTrainer.helper_wage) || 0]
          );
        }
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
    const hall = await db.get('SELECT * FROM halls WHERE id = ?', [hall_id]);
    const trainer = await db.get('SELECT * FROM trainers WHERE id = ?', [main_trainer_id]);

    const [sH, sM] = start_time.split(':').map(Number);
    const [eH, eM] = end_time.split(':').map(Number);
    let durationMinutes = eH * 60 + eM - (sH * 60 + sM);
    if (durationMinutes < 0) durationMinutes += 24 * 60;

    await db.run(
      `UPDATE checkins
       SET hall_id = ?, hall_name = ?,
           main_trainer_id = ?, main_trainer_name = ?,
           date = ?, start_time = ?, end_time = ?, duration_minutes = ?,
           main_wage_first_hour = ?, main_wage_additional = ?, remarks = ?
       WHERE id = ?`,
      [
        hall_id,
        hall ? hall.name : '',
        main_trainer_id,
        trainer ? trainer.name : '',
        date,
        start_time,
        end_time,
        durationMinutes,
        trainer ? parseFloat(trainer.main_wage_first_hour) || 0 : 0,
        trainer ? parseFloat(trainer.main_wage_additional) || 0 : 0,
        remarks || '',
        id,
      ]
    );

    await db.run('DELETE FROM checkin_helpers WHERE checkin_id = ?', [id]);
    const helpers = Array.isArray(helper_ids) ? helper_ids : helper_ids ? [helper_ids] : [];
    for (const hId of helpers) {
      if (hId && parseInt(hId) !== parseInt(main_trainer_id)) {
        const hTrainer = await db.get('SELECT * FROM trainers WHERE id = ?', [hId]);
        if (hTrainer) {
          await db.run(
            `INSERT INTO checkin_helpers (checkin_id, trainer_id, trainer_name, helper_wage)
             VALUES (?, ?, ?, ?)`,
            [id, hTrainer.id, hTrainer.name, parseFloat(hTrainer.helper_wage) || 0]
          );
        }
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
  let query = "DELETE FROM checkins WHERE strftime('%Y-%m', date) = ?";
  const params = [month];

  if (trainer) {
    query += ` AND (main_trainer_id = ? OR id IN (SELECT checkin_id FROM checkin_helpers WHERE trainer_id = ?))`;
    params.push(trainer, trainer);
  }
  if (hall) {
    query += ' AND hall_id = ?';
    params.push(hall);
  }

  try {
    let subQuery = "SELECT id FROM checkins WHERE strftime('%Y-%m', date) = ?";
    const subParams = [month];
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
      SELECT c.id, c.date, c.start_time, c.start_timestamp, c.duration_minutes, c.main_wage_first_hour, c.main_wage_additional
      FROM checkins c
      WHERE c.main_trainer_id = ? AND strftime('%Y-%m', c.date) = ?
    `;
    const mainParams = [t.id, selectedMonth];
    if (filterHallId) {
      mainQuery += ' AND c.hall_id = ?';
      mainParams.push(filterHallId);
    }
    const mainSessions = await db.all(mainQuery, mainParams);

    let helperQuery = `
      SELECT c.id, c.date, c.start_time, c.start_timestamp, c.duration_minutes, ch.helper_wage
      FROM checkins c
      JOIN checkin_helpers ch ON c.id = ch.checkin_id
      WHERE ch.trainer_id = ? AND strftime('%Y-%m', c.date) = ?
    `;
    const helperParams = [t.id, selectedMonth];
    if (filterHallId) {
      helperQuery += ' AND c.hall_id = ?';
      helperParams.push(filterHallId);
    }
    const helperSessions = await db.all(helperQuery, helperParams);

    // Group by date (YYYY-MM-DD)
    const sessionsByDate = {};
    mainSessions.forEach((s) => {
      const date = s.date;
      if (!sessionsByDate[date]) sessionsByDate[date] = { main: [], helper: [] };
      sessionsByDate[date].main.push(s);
    });
    helperSessions.forEach((s) => {
      const date = s.date;
      if (!sessionsByDate[date]) sessionsByDate[date] = { main: [], helper: [] };
      sessionsByDate[date].helper.push(s);
    });

    const trainerRows = [];
    Object.keys(sessionsByDate).forEach((date) => {
      const { totalPay } = calculateTrainerDailyWage(
        sessionsByDate[date].main,
        sessionsByDate[date].helper
      );
      trainerRows.push({
        date,
        pay: totalPay,
      });
    });

    if (trainerRows.length > 0) {
      rowsByTrainer[t.name] = { trainer: t, rows: trainerRows };
    }
  }

  return rowsByTrainer;
};

export const exportAll = async (req, res) => {
  const { month, trainer, hall } = req.query;
  const selectedMonth = month || getZonedMonthStr();

  try {
    const rowsByTrainer = await getTrainerExportData(selectedMonth, trainer, hall);
    if (Object.keys(rowsByTrainer).length === 0) {
      return res.status(404).send(req.__('ERROR_NO_EXPORT_DATA'));
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
    const trainer = await db.get('SELECT * FROM trainers WHERE id = ? AND pin = ?', [
      trainerId,
      pin,
    ]);
    if (!trainer) return res.status(401).send(req.__('ERROR_INVALID_PIN'));

    let selectedMonth = month;
    if (month === 'current') {
      selectedMonth = getZonedMonthStr();
    } else if (month === 'last') {
      const { year, month: m } = getZonedNow();
      selectedMonth = m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, '0')}`;
    }

    const rowsByTrainer = await getTrainerExportData(selectedMonth, trainerId);
    if (!rowsByTrainer[trainer.name]) {
      rowsByTrainer[trainer.name] = { trainer, rows: [] };
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
