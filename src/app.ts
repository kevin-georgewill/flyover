import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { corsOrigins } from './config';
import { router } from './routes';
import { HttpError } from './errors';
import swaggerUi from 'swagger-ui-express';
import path from 'node:path';
import { prisma } from './prisma';
export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.get('/', (_req, res) =>
  res.json({
    name: 'Flyover API',
    version: '1.0.0',
    basePath: '/api/v1',
    documentation: '/docs',
    health: '/api/v1/health',
  })
);
// Interactive API documentation
app.get('/docs/openapi.yaml', (_req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'docs/openapi.yaml'));
});

app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(undefined, {
    swaggerOptions: {
      url: '/docs/openapi.yaml',
      persistAuthorization: true,
    },
    customSiteTitle: 'Flyover API Documentation',
  })
);
app.use('/api/v1', router);
app.use((_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details: err.flatten() } });
  if (err instanceof HttpError) return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'A record with this value already exists' } });
  console.error(err);
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
});
