import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Funciona tanto con `tsx src/server.ts` como con el JavaScript compilado.
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env'),
  override: false
});
const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:4200'),
  APP_URL: z.string().url().default('http://localhost:4200'),
  ENABLE_DEMO_DATA: z.coerce.boolean().default(false),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).default('Gestion de Captura <no-reply@example.com>')
});

const parsedEnv = schema.parse(process.env);
export const env = { ...parsedEnv, API_PORT: parsedEnv.API_PORT ?? parsedEnv.PORT ?? 3000 };
export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
