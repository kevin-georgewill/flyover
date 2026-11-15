import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  IP_HASH_SALT: z.string().min(16).default('development-only-change-this-salt'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000').transform((value) => value.replace(/\/+$/, '')),
  COMMISSION_RELEASE_INTERVAL_MS: z.coerce.number().int().min(10000).default(60000),
  COMMISSION_RELEASE_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  INTEGRATION_ENCRYPTION_KEY: z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^[a-f0-9]{64}$/i).optional())
});
const result = schema.safeParse(process.env);
if (!result.success) throw new Error(`Invalid environment: ${JSON.stringify(result.error.flatten().fieldErrors)}`);
export const env = result.data;
export const corsOrigins = env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
