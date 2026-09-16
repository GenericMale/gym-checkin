import db from '../db.js';
import logger from '../utils/logger.js';
import { getZonedNow, getZonedDateStr, getAppTimeZone } from '../utils/time.js';
import { parseParticipantNames } from '../utils/participants.js';

const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const parseWeekdays = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
};

const getCourseWindowState = (entry, currentDay, currentMinutes, gracePeriod) => {
  const startMins = timeToMinutes(entry.time_from);
  const endMins = timeToMinutes(entry.time_to);
  const onDay = parseWeekdays(entry.weekdays).includes(currentDay);
  const inWindow =
    currentMinutes >= startMins - gracePeriod && currentMinutes <= endMins + gracePeriod;
  if (!onDay || !inWindow) return null;
  if (currentMinutes < startMins) return 'upcoming';
  if (currentMinutes > endMins) return 'ended';
  return 'running';
};

const getGracePeriod = async () => {
  const settings = await db.getSettings();
  return parseInt(settings.grace_period_minutes || '30', 10);
};

const getHallCourses = (hallId) =>
  db.all(
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

const getCourseTrainerMap = async (hallId) => {
  const rows = await db.all(
    `SELECT tt.turnplan_id, tt.trainer_id
     FROM turnplan_trainers tt
     JOIN turnplan tp ON tt.turnplan_id = tp.id
     WHERE tp.hall_id = ?`,
    [hallId]
  );
  const map = {};
  rows.forEach((r) => {
    if (!map[r.turnplan_id]) map[r.turnplan_id] = [];
    map[r.turnplan_id].push(r.trainer_id);
  });
  return map;
};

const toCoursePayload = (entry, statusKey, req) => {
  let statusLabel = req.__('checkin.statusRunning');
  if (statusKey === 'upcoming') statusLabel = req.__('checkin.statusUpcoming', entry.time_from);
  else if (statusKey === 'ended') statusLabel = req.__('checkin.statusEnded', entry.time_to);

  return {
    id: entry.id,
    name: entry.name,
    timeFrom: entry.time_from,
    timeTo: entry.time_to,
    trainerNames: entry.trainer_names || '',
    participants: parseParticipantNames(entry.participants),
    statusKey,
    statusLabel,
  };
};

export const getCheckinPage = async (req, res) => {
  const hallId = req.query.hall;
  if (!hallId) return res.send(req.__('errors.invalidQr'));

  try {
    const hall = await db.get('SELECT * FROM halls WHERE id = ?', [hallId]);
    if (!hall) return res.send(req.__('errors.hallNotFound'));

    const gracePeriod = await getGracePeriod();
    const now = getZonedNow();
    const currentMinutes = now.hour * 60 + now.minute;

    const turnplanEntries = await getHallCourses(hallId);
    const trainersByCourse = await getCourseTrainerMap(hallId);

    const activeTrainerIds = new Set();
    let activeCourseCount = 0;
    turnplanEntries.forEach((entry) => {
      const statusKey = getCourseWindowState(entry, now.dayCode, currentMinutes, gracePeriod);
      if (!statusKey) return;
      activeCourseCount += 1;
      (trainersByCourse[entry.id] || []).forEach((id) => activeTrainerIds.add(id));
    });

    let trainers = [];
    if (activeTrainerIds.size > 0) {
      const ids = Array.from(activeTrainerIds);
      const placeholders = ids.map(() => '?').join(', ');
      trainers = await db.all(
        `SELECT id, name FROM trainers
         WHERE is_trainer = 1 AND pin IS NOT NULL AND pin != '' AND id IN (${placeholders})
         ORDER BY name ASC`,
        ids
      );
    }

    const helpers = await db.all(
      'SELECT id, name FROM trainers WHERE is_helper = 1 ORDER BY name ASC'
    );

    res.render('checkin', {
      hallId,
      hallName: hall.name,
      trainers,
      helpers,
      activeCourseCount,
      gracePeriod,
      appTimeZone: getAppTimeZone(),
    });
  } catch (err) {
    logger.error('Datenbankfehler in getCheckinPage', err);
    res.status(500).send(req.__('errors.db'));
  }
};

export const postTrainerCourses = async (req, res) => {
  const { hallId, trainerId, pin } = req.body;

  try {
    const trainer = await db.get('SELECT * FROM trainers WHERE id = ? AND pin = ?', [
      trainerId,
      pin,
    ]);
    if (!trainer) return res.status(401).json({ error: req.__('errors.invalidPinRetry') });
    if (!trainer.is_trainer || !trainer.pin || !trainer.pin.trim()) {
      return res.status(403).json({ error: req.__('errors.trainerDisabled') });
    }

    const hall = await db.get('SELECT * FROM halls WHERE id = ?', [hallId]);
    if (!hall) return res.status(404).json({ error: req.__('errors.hallNotFound') });

    const gracePeriod = await getGracePeriod();
    const now = getZonedNow();
    const currentMinutes = now.hour * 60 + now.minute;

    const turnplanEntries = await db.all(
      `SELECT tp.*,
        (SELECT GROUP_CONCAT(t2.name, ', ')
         FROM turnplan_trainers tt
         JOIN trainers t2 ON tt.trainer_id = t2.id
         WHERE tt.turnplan_id = tp.id) as trainer_names
       FROM turnplan tp
       JOIN turnplan_trainers allowed ON allowed.turnplan_id = tp.id AND allowed.trainer_id = ?
       WHERE tp.hall_id = ?
       ORDER BY tp.time_from ASC`,
      [trainerId, hallId]
    );

    const dateStr = getZonedDateStr();
    const confirmedRows = await db.all(
      'SELECT turnplan_id FROM checkins WHERE date = ? AND turnplan_id IS NOT NULL',
      [dateStr]
    );
    const confirmedCourseIds = new Set(confirmedRows.map((r) => r.turnplan_id));

    const courses = [];
    turnplanEntries.forEach((entry) => {
      if (confirmedCourseIds.has(entry.id)) return;
      const statusKey = getCourseWindowState(entry, now.dayCode, currentMinutes, gracePeriod);
      if (!statusKey) return;
      courses.push(toCoursePayload(entry, statusKey, req));
    });

    res.json({
      success: true,
      trainer: { id: trainer.id, name: trainer.name },
      courses,
    });
  } catch (err) {
    logger.error('Datenbankfehler in postTrainerCourses', err);
    res.status(500).json({ error: req.__('errors.db') });
  }
};

export const postCheckin = async (req, res) => {
  const { turnplanId, trainerId, pin, helperIds, hallId } = req.body;

  try {
    const trainer = await db.get('SELECT * FROM trainers WHERE id = ? AND pin = ?', [
      trainerId,
      pin,
    ]);
    if (!trainer) return res.status(401).json({ error: req.__('errors.invalidPinRetry') });
    if (!trainer.is_trainer || !trainer.pin || !trainer.pin.trim()) {
      return res.status(403).json({ error: req.__('errors.trainerDisabled') });
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
        return res.status(403).json({ error: req.__('checkin.trainerNotAllowed') });
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
        return res.status(409).json({ error: req.__('checkin.alreadyConfirmed') });
      }
    }

    const startTime = course ? course.time_from : `${pad(now.hour)}:${pad(now.minute)}`;
    const endTime = course ? course.time_to : startTime;

    const sMins = timeToMinutes(startTime);
    let eMins = timeToMinutes(endTime);
    if (eMins < sMins) eMins += 24 * 60;
    const durationMinutes = course ? eMins - sMins : 60;
    const courseName = course ? course.name : req.__('common.unit');

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
        return res.status(409).json({ error: req.__('checkin.alreadyConfirmed') });
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
      message: req.__('checkin.sessionConfirmed', trainer.name, courseName),
    });
  } catch (err) {
    logger.error('Datenbankfehler in postCheckin', err);
    res.status(500).json({ error: req.__('errors.db') });
  }
};

export const getSessionStatus = async (req, res) => {
  const { hallId } = req.params;
  try {
    const gracePeriod = await getGracePeriod();
    const now = getZonedNow();
    const currentMinutes = now.hour * 60 + now.minute;

    const turnplanEntries = await db.all(
      'SELECT tp.*, t.name as main_trainer_name FROM turnplan tp LEFT JOIN trainers t ON tp.trainer_id = t.id WHERE tp.hall_id = ?',
      [hallId]
    );

    const active = turnplanEntries.find(
      (entry) => getCourseWindowState(entry, now.dayCode, currentMinutes, gracePeriod) !== null
    );

    res.json({ active: !!active, course: active || null });
  } catch (err) {
    logger.error('Datenbankfehler in getSessionStatus', err);
    res.status(500).json({ error: req.__('errors.db') });
  }
};
