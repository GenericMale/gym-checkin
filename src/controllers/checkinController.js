import db from '../db.js';
import logger from '../utils/logger.js';

export const getCheckinPage = async (req, res) => {
  const hallId = req.query.hall;
  if (!hallId) return res.send(req.__('ERROR_INVALID_QR'));

  try {
    const hall = await db.get('SELECT name FROM halls WHERE id = ?', [hallId]);
    if (!hall) return res.send(req.__('ERROR_HALL_NOT_FOUND'));

    const trainers = await db.all(
      `SELECT t.id, t.name FROM trainers t
                JOIN trainer_halls th ON t.id = th.trainer_id
                WHERE th.hall_id = ? ORDER BY t.name ASC`,
      [hallId]
    );

    res.render('checkin', { hallId, hallName: hall.name, trainers });
  } catch (err) {
    logger.error('Datenbankfehler in getCheckinPage', err);
    res.status(500).send(req.__('ERROR_DB'));
  }
};

export const postCheckin = async (req, res) => {
  const { trainerId, pin, hallId } = req.body;
  try {
    const trainer = await db.get('SELECT * FROM trainers WHERE id = ? AND pin = ?', [
      trainerId,
      pin,
    ]);
    if (!trainer) return res.status(401).json({ error: req.__('ERROR_INVALID_PIN_RETRY') });

    const settings = await db.getSettings();
    const maxMins = parseInt(settings.max_session_minutes);
    const defaultMins = parseInt(settings.default_session_minutes);

    const openSession = await db.get(
      'SELECT * FROM checkins WHERE trainer_id = ? AND end_timestamp IS NULL ORDER BY start_timestamp DESC LIMIT 1',
      [trainerId]
    );
    const now = new Date();

    if (openSession) {
      const startTime = new Date(openSession.start_timestamp + ' UTC');
      const diffMs = now - startTime;
      const diffMins = Math.floor(diffMs / 1000 / 60);

      if (diffMins < maxMins) {
        // Session beenden
        await db.run(
          'UPDATE checkins SET end_timestamp = CURRENT_TIMESTAMP, duration_minutes = ? WHERE id = ?',
          [diffMins, openSession.id]
        );
        return res.json({
          success: true,
          message: req.__('MESSAGE_SESSION_STOPPED', trainer.name, diffMins),
        });
      } else {
        // Session zu lang -> mit Default abschließen und neu starten
        await db.run(
          "UPDATE checkins SET end_timestamp = datetime(start_timestamp, '+' || ? || ' minutes'), duration_minutes = ? WHERE id = ?",
          [defaultMins, defaultMins, openSession.id]
        );
        await db.run('INSERT INTO checkins (trainer_id, hall_id) VALUES (?, ?)', [
          trainerId,
          hallId,
        ]);
        return res.json({
          success: true,
          message: req.__('MESSAGE_SESSION_RESTARTED', defaultMins),
        });
      }
    }

    // Neue Session starten
    await db.run('INSERT INTO checkins (trainer_id, hall_id) VALUES (?, ?)', [trainerId, hallId]);
    res.json({
      success: true,
      message: req.__('MESSAGE_SESSION_STARTED', trainer.name),
    });
  } catch (err) {
    logger.error('Datenbankfehler in postCheckin', err);
    res.status(500).json({ error: req.__('ERROR_DB') });
  }
};

export const getSessionStatus = async (req, res) => {
  const { trainerId } = req.params;
  try {
    const settings = await db.getSettings();
    const maxMins = parseInt(settings.max_session_minutes);
    const openSession = await db.get(
      'SELECT * FROM checkins WHERE trainer_id = ? AND end_timestamp IS NULL ORDER BY start_timestamp DESC LIMIT 1',
      [trainerId]
    );

    if (openSession) {
      const startTime = new Date(openSession.start_timestamp + ' UTC');
      const diffMs = new Date() - startTime;
      const diffMins = Math.floor(diffMs / 1000 / 60);

      if (diffMins < maxMins) {
        return res.json({ active: true, startTime: openSession.start_timestamp });
      }
    }
    res.json({ active: false });
  } catch (err) {
    logger.error('Datenbankfehler in getSessionStatus', err);
    res.status(500).json({ error: req.__('ERROR_DB') });
  }
};
