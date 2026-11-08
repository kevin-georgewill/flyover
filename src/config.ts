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
  IP_HASH_SALT: z.string().min(16).default('development-only-change-this-salt')
});
const result = schema.safeParse(process.env);
if (!result.success) throw new Error(`Invalid environment: ${JSON.stringify(result.error.flatten().fieldErrors)}`);
export const env = result.data;
export const corsOrigins = env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
