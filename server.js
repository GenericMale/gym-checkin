require('dotenv').config(); // Lädt die .env Variablen ganz am Anfang

const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || '';

// Helper-Funktion für URLs in EJS
app.locals.url = (path) => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${BASE_PATH}${cleanPath}`;
};

// EJS Setup & Statische Dateien
app.set('view engine', 'ejs');
app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(`${BASE_PATH}/static`, express.static(path.join(__dirname, 'static')));

// Session mit Secret aus .env
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

// Datenbank-Pfad aus .env
const db = new sqlite3.Database(process.env.DB_PATH || './data/gym.db');

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS halls (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS trainers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, pin TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS trainer_halls (trainer_id INTEGER, hall_id INTEGER)");
    db.run(`CREATE TABLE IF NOT EXISTS checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trainer_id INTEGER,
        hall_id INTEGER,
        start_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_timestamp DATETIME,
        duration_minutes INTEGER
    )`);
    db.run("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
    
    // Initial Settings
    db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('max_session_minutes', '180')");
    db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('default_session_minutes', '90')");
});

const getSettings = (callback) => {
    db.all("SELECT * FROM settings", (err, rows) => {
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        callback(settings);
    });
};

const redirect = (res, url) => {
    return res.redirect(app.locals.url(url));
}

const requireAuth = (req, res, next) => {
    if (req.session.loggedIn) return next();
    redirect(res, '/admin/login');
};

// --- ROUTES ---
const router = express.Router();

// 1. Trainingsstart Seite
router.get('/checkin', (req, res) => {
    const hallId = req.query.hall;
    if (!hallId) return res.send("Ungültiger QR-Code: Hallen-ID fehlt.");

    db.get("SELECT name FROM halls WHERE id = ?", [hallId], (err, hall) => {
        if (!hall) return res.send("Halle nicht gefunden.");

        db.all(`SELECT t.id, t.name FROM trainers t
                JOIN trainer_halls th ON t.id = th.trainer_id
                WHERE th.hall_id = ? ORDER BY t.name ASC`, [hallId], (err, trainers) => {
            res.render('checkin', { hallId, hallName: hall.name, trainers });
        });
    });
});

router.post('/api/checkin', (req, res) => {
    const { trainerId, pin, hallId } = req.body;
    db.get("SELECT * FROM trainers WHERE id = ? AND pin = ?", [trainerId, pin], (err, trainer) => {
        if (!trainer) return res.status(401).json({ error: 'Falscher PIN. Bitte erneut versuchen.' });

        getSettings((settings) => {
            const maxMins = parseInt(settings.max_session_minutes);
            const defaultMins = parseInt(settings.default_session_minutes);

            db.get("SELECT * FROM checkins WHERE trainer_id = ? AND end_timestamp IS NULL ORDER BY start_timestamp DESC LIMIT 1", [trainerId], (err, openSession) => {
                const now = new Date();

                if (openSession) {
                    const startTime = new Date(openSession.start_timestamp + " UTC");
                    const diffMs = now - startTime;
                    const diffMins = Math.floor(diffMs / 1000 / 60);

                    if (diffMins < maxMins) {
                        // Session beenden
                        db.run("UPDATE checkins SET end_timestamp = CURRENT_TIMESTAMP, duration_minutes = ? WHERE id = ?", [diffMins, openSession.id], (err) => {
                            if (err) return res.status(500).json({ error: 'Datenbankfehler beim Beenden' });
                            res.json({ success: true, message: `Hallo ${trainer.name}! Deine Sitzung wurde nach ${diffMins} Minuten beendet.` });
                        });
                        return;
                    } else {
                        // Session zu lang -> mit Default abschließen und neu starten
                        db.run("UPDATE checkins SET end_timestamp = datetime(start_timestamp, '+' || ? || ' minutes'), duration_minutes = ? WHERE id = ?", [defaultMins, defaultMins, openSession.id], (err) => {
                            db.run("INSERT INTO checkins (trainer_id, hall_id) VALUES (?, ?)", [trainerId, hallId], function(err) {
                                if (err) return res.status(500).json({ error: 'Datenbankfehler beim Neustart' });
                                res.json({ success: true, message: `Alte Sitzung (${defaultMins} Min.) abgeschlossen. Neue Sitzung gestartet.` });
                            });
                        });
                        return;
                    }
                }

                // Neue Session starten
                db.run("INSERT INTO checkins (trainer_id, hall_id) VALUES (?, ?)", [trainerId, hallId], function(err) {
                    if (err) return res.status(500).json({ error: 'Datenbankfehler beim Starten' });
                    res.json({ success: true, message: `Hallo ${trainer.name}! Deine Sitzung wurde gestartet.` });
                });
            });
        });
    });
});

router.get('/api/session-status/:trainerId', (req, res) => {
    const { trainerId } = req.params;
    getSettings((settings) => {
        const maxMins = parseInt(settings.max_session_minutes);
        db.get("SELECT * FROM checkins WHERE trainer_id = ? AND end_timestamp IS NULL ORDER BY start_timestamp DESC LIMIT 1", [trainerId], (err, openSession) => {
            if (err) return res.status(500).json({ error: 'Datenbankfehler' });
            
            if (openSession) {
                const startTime = new Date(openSession.start_timestamp + " UTC");
                const diffMs = new Date() - startTime;
                const diffMins = Math.floor(diffMs / 1000 / 60);

                if (diffMins < maxMins) {
                    return res.json({ active: true, startTime: openSession.start_timestamp });
                }
            }
            res.json({ active: false });
        });
    });
});

// 2. Admin Login
router.get('/admin/login', (req, res) => res.render('login', { error: null }));
router.post('/admin/login', (req, res) => {
    // Passwort Abgleich mit .env Variable
    if (req.body.password === process.env.ADMIN_PASSWORD) {
        req.session.loggedIn = true;
        redirect(res, '/admin');
    } else {
        res.render('login', { error: 'Falsches Passwort' });
    }
});

router.get('/admin/logout', (req, res) => {
    req.session.destroy();
    redirect(res, '/admin/login');
});

// 3. Admin Dashboard
router.get('/admin', requireAuth, (req, res) => {
    const baseUrl = req.protocol + '://' + req.get('host') + BASE_PATH;

    db.all("SELECT * FROM halls", async (err, halls) => {
        for (let hall of halls) {
            hall.url = `${baseUrl}/checkin?hall=${hall.id}`;
            hall.qr = await QRCode.toDataURL(hall.url);
        }

        db.all("SELECT * FROM trainers", (err, trainers) => {
            db.all("SELECT * FROM trainer_halls", (err, assignments) => {
                getSettings((settings) => {
                    db.all(`SELECT c.*, COALESCE(t.name, 'Gelöscht') as trainer, COALESCE(h.name, 'Gelöscht') as hall
                            FROM checkins c
                            LEFT JOIN trainers t ON c.trainer_id = t.id
                            LEFT JOIN halls h ON c.hall_id = h.id
                            ORDER BY c.start_timestamp DESC LIMIT 100`, (err, logs) => {
                        res.render('admin', { halls, trainers, assignments, logs, settings });
                    });
                });
            });
        });
    });
});

// 4. Admin API Actions (Hallen & Trainer & Settings)
router.post('/admin/update-settings', requireAuth, (req, res) => {
    const { max_session_minutes, default_session_minutes } = req.body;
    db.run("UPDATE settings SET value = ? WHERE key = 'max_session_minutes'", [max_session_minutes], () => {
        db.run("UPDATE settings SET value = ? WHERE key = 'default_session_minutes'", [default_session_minutes], () => {
            redirect(res, '/admin');
        });
    });
});

router.post('/admin/add-hall', requireAuth, (req, res) => {
    db.run("INSERT INTO halls (name) VALUES (?)", [req.body.name], () => redirect(res, '/admin'));
});

router.post('/admin/delete-hall/:id', requireAuth, (req, res) => {
    db.run("DELETE FROM halls WHERE id = ?", [req.params.id], () => {
        db.run("DELETE FROM trainer_halls WHERE hall_id = ?", [req.params.id], () => redirect(res, '/admin'));
    });
});

router.post('/admin/add-trainer', requireAuth, (req, res) => {
    const { name, pin, halls } = req.body;
    db.run("INSERT INTO trainers (name, pin) VALUES (?, ?)", [name, pin], function(err) {
        const trainerId = this.lastID;
        const hallIds = Array.isArray(halls) ? halls : (halls ? [halls] : []);
        hallIds.forEach(hallId => {
            db.run("INSERT INTO trainer_halls (trainer_id, hall_id) VALUES (?, ?)", [trainerId, hallId]);
        });
        redirect(res, '/admin');
    });
});

router.post('/admin/edit-trainer/:id', requireAuth, (req, res) => {
    const trainerId = req.params.id;
    const { name, pin, halls } = req.body;
    db.run("UPDATE trainers SET name = ?, pin = ? WHERE id = ?", [name, pin, trainerId], () => {
        db.run("DELETE FROM trainer_halls WHERE trainer_id = ?", [trainerId], () => {
            const hallIds = Array.isArray(halls) ? halls : (halls ? [halls] : []);
            hallIds.forEach(hallId => {
                db.run("INSERT INTO trainer_halls (trainer_id, hall_id) VALUES (?, ?)", [trainerId, hallId]);
            });
            redirect(res, '/admin');
        });
    });
});

router.post('/admin/delete-trainer/:id', requireAuth, (req, res) => {
    db.run("DELETE FROM trainers WHERE id = ?", [req.params.id], () => {
        db.run("DELETE FROM trainer_halls WHERE trainer_id = ?", [req.params.id], () => redirect(res, '/admin'));
    });
});

// 5. Excel Export
router.get('/admin/export', requireAuth, (req, res) => {
    db.all(`SELECT 
                datetime(c.start_timestamp, 'localtime') as Start, 
                datetime(c.end_timestamp, 'localtime') as Ende,
                c.duration_minutes as Dauer_Min,
                COALESCE(t.name, 'Gelöscht') as Trainer, 
                COALESCE(h.name, 'Gelöscht') as Hall
            FROM checkins c
            LEFT JOIN trainers t ON c.trainer_id = t.id
            LEFT JOIN halls h ON c.hall_id = h.id
            ORDER BY c.start_timestamp DESC`, (err, rows) => {
        if (rows.length === 0) return res.send("Keine Daten.");
        const header = "Start,Ende,Dauer (Min),Trainer,Halle\n";
        const csv = rows.map(r => `"${r.Start}","${r.Ende || ''}","${r.Dauer_Min || ''}","${r.Trainer}","${r.Hall}"`).join('\n');
        res.header('Content-Type', 'text/csv; charset=utf-8');
        res.attachment('ktv-trainings-logs.csv');
        res.send('\uFEFF' + header + csv);
    });
});

app.use(BASE_PATH, router);
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    --------------------------------------------------
    🚀 KTV Admin-Tool bereit auf Port ${PORT}
    🔗 Lokal: http://localhost:${PORT}${BASE_PATH}/admin
    --------------------------------------------------
    `);
});