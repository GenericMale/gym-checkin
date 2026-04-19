import 'dotenv/config';
import app from './src/app.js';
import db from './src/db.js';
import logger from './src/utils/logger.js';

const HOSTNAME = process.env.HOSTNAME || '0.0.0.0';
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || '';

const startServer = async () => {
  try {
    logger.info('Initializing database...');
    await db.initDb();
    logger.info('Database initialized.');

    const server = app.listen(PORT, HOSTNAME, () => {
      logger.info(`Admin-Tool ready on http://${HOSTNAME}:${PORT}${BASE_PATH}/admin`);
    });

    const shutdown = () => {
      logger.info('Shutdown signal received. Closing server...');
      server.close(() => {
        logger.info('HTTP server closed.');
        db.db.close((err) => {
          if (err) {
            logger.error('Error closing database:', err);
            process.exit(1);
          }
          logger.info('Database connection closed.');
          process.exit(0);
        });
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

startServer();
