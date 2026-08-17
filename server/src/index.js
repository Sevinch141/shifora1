import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dbPath } from './db/index.js';
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
import { startScheduler } from './services/scheduler.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'shifora' }));

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/care-plans', carePlanRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/measurements', measurementRoutes);
app.use('/api/doses', doseRoutes);
app.use('/api/me', meRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/caregiver', caregiverRoutes);

// Serve the built client when it exists, so the prototype runs from one process.
const webDist = join(here, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(join(webDist, 'index.html')));
}

app.use('/api', notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Shifora API → http://localhost:${PORT}`);
  console.log(`Database    → ${dbPath}`);
  startScheduler();
});
