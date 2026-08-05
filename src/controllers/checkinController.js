import db from '../db.js';
import logger from '../utils/logger.js';

const getDayCode = (date = new Date()) => {
  const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return days[date.getDay()];
};

const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

export const getCheckinPage = async (req, res) => {
  const hallId = req.query.hall;
  if (!hallId) return res.send(req.__('ERROR_INVALID_QR'));

  try {
    const hall = await db.get('SELECT * FROM halls WHERE id = ?', [hallId]);
    if (!hall) return res.send(req.__('ERROR_HALL_NOT_FOUND'));

    const turnplanEntries = await db.all(
      `SELECT tp.*, t.name as main_trainer_name
       FROM turnplan tp
       LEFT JOIN trainers t ON tp.trainer_id = t.id
       WHERE tp.hall_id = ?
       ORDER BY tp.time_from ASC`,
      [hallId]
    );

    const settings = await db.getSettings();
    const gracePeriod = parseInt(settings.grace_period_minutes || '30', 10);

    const now = new Date();
    const currentDay = getDayCode(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    let activeCourse = null;
    const parsedEntries = turnplanEntries.map((entry) => {
      let weekdays = [];
      try {
        weekdays = JSON.parse(entry.weekdays);
      } catch (_e) {
        weekdays = entry.weekdays ? entry.weekdays.split(',').map((s) => s.trim()) : [];
      }

      const startMins = timeToMinutes(entry.time_from) - gracePeriod;
      const endMins = timeToMinutes(entry.time_to) + gracePeriod;
      const isActive = weekdays.includes(currentDay) && currentMinutes >= startMins && currentMinutes <= endMins;

      const item = { ...entry, weekdays, isActive };
      if (isActive && !activeCourse) {
        activeCourse = item;
      }
      return item;
    });

    const trainers = await db.all('SELECT id, name, pin FROM trainers ORDER BY name ASC');

    res.render('checkin', {
      hallId,
      hallName: hall.name,
      turnplanEntries: parsedEntries,
      activeCourse,
      trainers,
      gracePeriod,
    });
  } catch (err) {
    logger.error('Datenbankfehler in getCheckinPage', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const postCheckin = async (req, res) => {
  const { turnplanId, trainerId, pin, helperIds, hallId } = req.body;

  try {
    const trainer = await db.get('SELECT * FROM trainers WHERE id = ? AND pin = ?', [trainerId, pin]);
    if (!trainer) return res.status(401).json({ error: req.__('ERROR_INVALID_PIN_RETRY') });

    let course = null;
    if (turnplanId) {
      course = await db.get('SELECT * FROM turnplan WHERE id = ?', [turnplanId]);
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const startTime = course ? course.time_from : `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const endTime = course ? course.time_to : startTime;

    const sMins = timeToMinutes(startTime);
    let eMins = timeToMinutes(endTime);
    if (eMins < sMins) eMins += 24 * 60;
    const durationMinutes = course ? eMins - sMins : 60;

    const result = await db.run(
      `INSERT INTO checkins (turnplan_id, hall_id, main_trainer_id, date, start_time, end_time, duration_minutes, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        turnplanId || null,
        hallId || (course ? course.hall_id : null),
        trainerId,
        dateStr,
        startTime,
        endTime,
        durationMinutes,
        course ? course.name : '',
      ]
    );

    const checkinId = result.lastID;
    const helpers = Array.isArray(helperIds) ? helperIds : helperIds ? [helperIds] : [];
    for (const hId of helpers) {
      if (hId && parseInt(hId) !== parseInt(trainerId)) {
        await db.run('INSERT INTO checkin_helpers (checkin_id, trainer_id) VALUES (?, ?)', [
          checkinId,
          hId,
        ]);
      }
    }

    res.json({
      success: true,
      message: req.__('MESSAGE_SESSION_CONFIRMED', trainer.name, course ? course.name : 'Einheit'),
    });
  } catch (err) {
    logger.error('Datenbankfehler in postCheckin', err);
    res.status(500).json({ error: req.__('ERROR_DB') });
  }
};

export const getSessionStatus = async (req, res) => {
  const { hallId } = req.params;
  try {
    const settings = await db.getSettings();
    const gracePeriod = parseInt(settings.grace_period_minutes || '30', 10);

    const turnplanEntries = await db.all(
      'SELECT tp.*, t.name as main_trainer_name FROM turnplan tp LEFT JOIN trainers t ON tp.trainer_id = t.id WHERE tp.hall_id = ?',
      [hallId]
    );

    const now = new Date();
    const currentDay = getDayCode(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const active = turnplanEntries.find((entry) => {
      let weekdays = [];
      try {
        weekdays = JSON.parse(entry.weekdays);
      } catch (_e) {
        weekdays = entry.weekdays ? entry.weekdays.split(',').map((s) => s.trim()) : [];
      }
      const startMins = timeToMinutes(entry.time_from) - gracePeriod;
      const endMins = timeToMinutes(entry.time_to) + gracePeriod;
      return weekdays.includes(currentDay) && currentMinutes >= startMins && currentMinutes <= endMins;
    });

    res.json({ active: !!active, course: active || null });
  } catch (err) {
    logger.error('Datenbankfehler in getSessionStatus', err);
    res.status(500).json({ error: req.__('ERROR_DB') });
  }
};
