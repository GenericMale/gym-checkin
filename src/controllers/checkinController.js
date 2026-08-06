import db from '../db.js';
import logger from '../utils/logger.js';
import { getZonedNow, getZonedDateStr, getAppTimeZone } from '../utils/time.js';

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
      `SELECT tp.*,
        (SELECT GROUP_CONCAT(t2.name, ', ')
         FROM turnplan_trainers tt
         JOIN trainers t2 ON tt.trainer_id = t2.id
         WHERE tt.turnplan_id = tp.id) as trainer_names
       FROM turnplan tp
       WHERE tp.hall_id = ?
       ORDER BY tp.time_from ASC`,
      [hallId]
    );

    const allowedRows = await db.all(
      `SELECT tt.turnplan_id, tt.trainer_id
       FROM turnplan_trainers tt
       JOIN turnplan tp ON tt.turnplan_id = tp.id
       WHERE tp.hall_id = ?`,
      [hallId]
    );
    const allowedByCourse = {};
    allowedRows.forEach((r) => {
      if (!allowedByCourse[r.turnplan_id]) allowedByCourse[r.turnplan_id] = [];
      allowedByCourse[r.turnplan_id].push(r.trainer_id);
    });

    const settings = await db.getSettings();
    const gracePeriod = parseInt(settings.grace_period_minutes || '30', 10);

    const now = getZonedNow();
    const currentDay = now.dayCode;
    const currentMinutes = now.hour * 60 + now.minute;

    const courses = [];
    turnplanEntries.forEach((entry) => {
      let weekdays;
      try {
        weekdays = JSON.parse(entry.weekdays);
      } catch {
        weekdays = entry.weekdays ? entry.weekdays.split(',').map((s) => s.trim()) : [];
      }

      const startMins = timeToMinutes(entry.time_from);
      const endMins = timeToMinutes(entry.time_to);
      const graceStartMins = startMins - gracePeriod;
      const graceEndMins = endMins + gracePeriod;

      const onDay = weekdays.includes(currentDay);
      const inWindow = currentMinutes >= graceStartMins && currentMinutes <= graceEndMins;
      if (!onDay || !inWindow) return;

      let statusKey = 'running';
      if (currentMinutes < startMins) statusKey = 'upcoming';
      else if (currentMinutes > endMins) statusKey = 'ended';

      let statusLabel = req.__('CHECKIN_STATUS_RUNNING');
      if (statusKey === 'upcoming')
        statusLabel = req.__('CHECKIN_STATUS_UPCOMING', entry.time_from);
      else if (statusKey === 'ended') statusLabel = req.__('CHECKIN_STATUS_ENDED', entry.time_to);

      courses.push({
        ...entry,
        weekdays,
        statusKey,
        statusLabel,
        trainerNames: entry.trainer_names || '',
        allowedTrainerIds: allowedByCourse[entry.id] || [],
      });
    });

    const trainers = await db.all(
      "SELECT id, name, pin FROM trainers WHERE is_trainer = 1 AND pin IS NOT NULL AND pin != '' ORDER BY name ASC"
    );
    const helpers = await db.all(
      'SELECT id, name FROM trainers WHERE is_helper = 1 ORDER BY name ASC'
    );

    res.render('checkin', {
      hallId,
      hallName: hall.name,
      courses,
      trainers,
      helpers,
      gracePeriod,
      appTimeZone: getAppTimeZone(),
    });
  } catch (err) {
    logger.error('Datenbankfehler in getCheckinPage', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const postCheckin = async (req, res) => {
  const { turnplanId, trainerId, pin, helperIds, hallId } = req.body;

  try {
    const trainer = await db.get('SELECT * FROM trainers WHERE id = ? AND pin = ?', [
      trainerId,
      pin,
    ]);
    if (!trainer) return res.status(401).json({ error: req.__('ERROR_INVALID_PIN_RETRY') });
    if (!trainer.is_trainer || !trainer.pin || !trainer.pin.trim()) {
      return res.status(403).json({ error: req.__('ERROR_TRAINER_DISABLED') });
    }

    const hall = await db.get('SELECT * FROM halls WHERE id = ?', [hallId]);
    const hallName = hall ? hall.name : '';

    let course = null;
    if (turnplanId) {
      course = await db.get('SELECT * FROM turnplan WHERE id = ?', [turnplanId]);
      const allowed = await db.get(
        'SELECT 1 FROM turnplan_trainers WHERE turnplan_id = ? AND trainer_id = ?',
        [turnplanId, trainerId]
      );
      if (!allowed) {
        return res.status(403).json({ error: req.__('CHECKIN_TRAINER_NOT_ALLOWED') });
      }
    }

    const now = getZonedNow();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = getZonedDateStr();

    if (turnplanId) {
      const existing = await db.get('SELECT id FROM checkins WHERE turnplan_id = ? AND date = ?', [
        turnplanId,
        dateStr,
      ]);
      if (existing) {
        return res.status(409).json({ error: req.__('CHECKIN_ALREADY_CONFIRMED') });
      }
    }

    const startTime = course ? course.time_from : `${pad(now.hour)}:${pad(now.minute)}`;
    const endTime = course ? course.time_to : startTime;

    const sMins = timeToMinutes(startTime);
    let eMins = timeToMinutes(endTime);
    if (eMins < sMins) eMins += 24 * 60;
    const durationMinutes = course ? eMins - sMins : 60;
    const courseName = course ? course.name : req.__('DEFAULT_UNIT_NAME');

    let result;
    try {
      result = await db.run(
        `INSERT INTO checkins (
          turnplan_id, hall_id, hall_name,
          main_trainer_id, main_trainer_name,
          course_name, date, start_time, end_time,
          duration_minutes, main_wage_first_hour, main_wage_additional, remarks
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          turnplanId || null,
          hallId || (course ? course.hall_id : null),
          hallName,
          trainerId,
          trainer.name,
          courseName,
          dateStr,
          startTime,
          endTime,
          durationMinutes,
          parseFloat(trainer.main_wage_first_hour) || 0,
          parseFloat(trainer.main_wage_additional) || 0,
          course ? course.remarks : '',
        ]
      );
    } catch (insertErr) {
      if (String(insertErr.message).includes('UNIQUE')) {
        return res.status(409).json({ error: req.__('CHECKIN_ALREADY_CONFIRMED') });
      }
      throw insertErr;
    }

    const checkinId = result.lastID;
    const helpers = Array.isArray(helperIds) ? helperIds : helperIds ? [helperIds] : [];
    for (const hId of helpers) {
      if (hId && parseInt(hId) !== parseInt(trainerId)) {
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

    res.json({
      success: true,
      message: req.__('MESSAGE_SESSION_CONFIRMED', trainer.name, courseName),
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

    const now = getZonedNow();
    const currentDay = now.dayCode;
    const currentMinutes = now.hour * 60 + now.minute;

    const active = turnplanEntries.find((entry) => {
      let weekdays;
      try {
        weekdays = JSON.parse(entry.weekdays);
      } catch {
        weekdays = entry.weekdays ? entry.weekdays.split(',').map((s) => s.trim()) : [];
      }
      const startMins = timeToMinutes(entry.time_from) - gracePeriod;
      const endMins = timeToMinutes(entry.time_to) + gracePeriod;
      return (
        weekdays.includes(currentDay) && currentMinutes >= startMins && currentMinutes <= endMins
      );
    });

    res.json({ active: !!active, course: active || null });
  } catch (err) {
    logger.error('Datenbankfehler in getSessionStatus', err);
    res.status(500).json({ error: req.__('ERROR_DB') });
  }
};
