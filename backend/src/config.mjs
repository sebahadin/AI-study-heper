import { config, parse } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

// Read only shared integration settings; preserve the app's existing .env behavior.
const sharedPath = fileURLToPath(new URL('../../.env', import.meta.url));
const shared = existsSync(sharedPath) ? parse(readFileSync(sharedPath)) : {};
const integrationValue = name => process.env[name] || shared[name];

export const settings = {
  port: Number(process.env.PORT || 3000),
  production: process.env.NODE_ENV === 'production',
  testing: process.env.NODE_ENV === 'test',
  dsn: process.env.DSN,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  aiServiceUrl: integrationValue('AI_SERVICE_URL') || 'http://127.0.0.1:8001',
  aiServiceToken: integrationValue('AI_SERVICE_TOKEN'),
  r2: {
    accountId: integrationValue('R2_ACCOUNT_ID'),
    bucket: integrationValue('R2_BUCKET_NAME'),
    accessKeyId: integrationValue('R2_ACCESS_KEY_ID'),
    secretAccessKey: integrationValue('R2_SECRET_ACCESS_KEY'),
  },
};
