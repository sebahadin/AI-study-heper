import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

export const settings = {
  port: Number(process.env.PORT || 3000),
  production: process.env.NODE_ENV === 'production',
  testing: process.env.NODE_ENV === 'test',
  dsn: process.env.DSN,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
};
