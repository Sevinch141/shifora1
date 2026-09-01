// config must be imported first: it pins process.env.TZ before any Date exists.
import './config.js';

import express from 'express';
import cors from 'cors';

import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './routes/auth.routes.js';
import patientRoutes from './routes/patients.routes.js';
import carePlanRoutes from './routes/carePlans.routes.js';
import alertRoutes from './routes/alerts.routes.js';
import measurementRoutes from './routes/measurements.routes.js';
import doseRoutes from './routes/doses.routes.js';
import meRoutes from './routes/me.routes.js';
import aiRoutes from './routes/ai.routes.js';
import caregiverRoutes from './routes/caregiver.routes.js';
import cronRoutes from './routes/cron.routes.js';
import assistantRoutes from './routes/assistant.routes.js';

/**
 * The Express application, with no listener attached.
 *
 * Both entry points reuse it: `src/index.js` binds a port for local
 * development, and `api/index.js` hands it to the Vercel Node runtime as a
 * request handler.
 */
export function createApp() {
  const app = express();

  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, service: 'shifora' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/assistant', assistantRoutes);
  app.use('/api/patients', patientRoutes);
  app.use('/api/care-plans', carePlanRoutes);
  app.use('/api/alerts', alertRoutes);
  app.use('/api/measurements', measurementRoutes);
  app.use('/api/doses', doseRoutes);
  app.use('/api/me', meRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/caregiver', caregiverRoutes);
  app.use('/api/cron', cronRoutes);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
