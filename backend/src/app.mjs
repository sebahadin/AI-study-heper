import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settings } from './config.mjs';
import passport from './auth.mjs';
import { connectDatabase } from './db.mjs';
import { errorHandler } from './http.mjs';
import authRoutes from './routes/auth.mjs';
import dashboardRoutes from './routes/dashboard.mjs';
import coursesRoutes from './routes/courses.mjs';
import booksRoutes from './routes/books.mjs';
import notesRoutes from './routes/notes.mjs';
import flashcardsRoutes from './routes/flashcards.mjs';
import { createDocumentsRouter } from './routes/documents.mjs';
import { createDocumentJobsRouter } from './routes/document-jobs.mjs';
import { createDocumentJobService } from './documents/job-service.mjs';

export function createApp({ sessionStore, frontendDirectory, documentService, documentJobsService, internalServiceToken = settings.aiServiceToken } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (settings.production) {
    app.set('trust proxy', 1);
  }
  const jobs = documentJobsService || createDocumentJobService();
  app.use('/internal/document-jobs', createDocumentJobsRouter(jobs, { token: internalServiceToken }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const ownOrigin = `${req.protocol}://${req.get('host')}`;
      if (req.get('sec-fetch-site') === 'cross-site' || (origin && origin !== ownOrigin && origin !== settings.clientOrigin)) {
        return res.status(403).json({ error: 'This request origin is not allowed.' });
      }
    }
    next();
  });
  const store = sessionStore || (!settings.testing && settings.dsn ? MongoStore.create({ mongoUrl: settings.dsn, collectionName: 'sessions' }) : undefined);
  app.use(session({
    name: 'classmate.sid',
    secret: settings.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: { httpOnly: true, sameSite: 'lax', secure: settings.production, maxAge: 1000 * 60 * 60 * 24 * 7 },
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/courses', coursesRoutes);
  app.use('/api/books', booksRoutes);
  app.use('/api/notes', notesRoutes);
  app.use('/api/flashcards', flashcardsRoutes);
  app.use('/api/documents', createDocumentsRouter(documentService, jobs));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

  const frontend = frontendDirectory || fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
  if (existsSync(path.join(frontend, 'index.html'))) {
    app.use(express.static(frontend));
    app.get('/{*path}', (req, res, next) => {
      if (path.extname(req.path)) {
        return next();
      }
      res.sendFile(path.join(frontend, 'index.html'));
    });
  }
  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(errorHandler);
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (settings.production && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required in production.');
  }
  await connectDatabase();
  createApp().listen(settings.port, () => console.log(`Classmate API running at http://localhost:${settings.port}`));
}
