import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { I18n } from 'i18n';
import adminRoutes from './routes/adminRoutes.js';
import checkinRoutes from './routes/checkinRoutes.js';
import logger from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const i18n = new I18n({
  locales: ['de'],
  directory: path.join(__dirname, '../locales'),
  defaultLocale: 'de',
  cookie: 'lang',
  queryParameter: 'lang',
  autoReload: true,
  updateFiles: false,
  objectNotation: true,
});

const app = express();
const BASE_PATH = process.env.BASE_PATH || '';

// Security, logging, compression
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable CSP for simplicity with EJS/Inline scripts if needed, or configure properly
  })
);
app.use(morgan('dev'));
app.use(compression());

// i18n middleware
app.use(i18n.init);

// Helper-Funktion für URLs in EJS
app.locals.url = (pathStr) => {
  const cleanPath = pathStr.startsWith('/') ? pathStr : `/${pathStr}`;
  return `${BASE_PATH}${cleanPath}`;
};

// EJS Setup & Statische Dateien
app.set('view engine', 'ejs');
app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(`${BASE_PATH}/static`, express.static(path.join(__dirname, '../static')));

// Session
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' },
  })
);

// Routes
app.use(BASE_PATH, adminRoutes);
app.use(BASE_PATH, checkinRoutes);

// Error Handling Middleware
app.use((err, req, res, _next) => {
  logger.error(err.stack);
  res.status(500).send(req.__('ERROR_GENERIC'));
});

export default app;
