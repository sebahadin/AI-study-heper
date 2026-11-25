import { expect } from 'chai';
import { mkdtemp, mkdir, writeFile, copyFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

describe('Shared upload integration configuration', () => {
  it('loads root integration keys without overriding existing app settings; environment wins', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'classmate-config-'));
    try {
      const source = path.join(directory, 'backend/src');
      await mkdir(source, { recursive: true });
      await copyFile(fileURLToPath(new URL('../../src/config.mjs', import.meta.url)), path.join(source, 'config.mjs'));
      await symlink(fileURLToPath(new URL('../../node_modules', import.meta.url)), path.join(directory, 'backend/node_modules'));
      await writeFile(path.join(directory, '.env'), [
        'AI_SERVICE_TOKEN=root-test-token', 'R2_BUCKET_NAME=root-test-bucket',
        'R2_SECRET_ACCESS_KEY=root-test-secret', 'DSN=unrelated-root-dsn', 'SESSION_SECRET=unrelated-root-session',
      ].join('\n'));
      await writeFile(path.join(directory, 'backend/.env'), [
        'DSN=legacy-backend-dsn', 'SESSION_SECRET=legacy-backend-session',
        'AI_SERVICE_TOKEN=', 'R2_BUCKET_NAME=',
      ].join('\n'));
      const environment = { ...process.env, NODE_ENV: 'test' };
      for (const key of Object.keys(environment)) {
        if (/^(AI_|R2_)/.test(key) || ['DSN', 'SESSION_SECRET'].includes(key)) { delete environment[key]; }
      }
      environment.R2_SECRET_ACCESS_KEY = 'environment-test-secret';
      const script = `import { settings } from ${JSON.stringify(pathToFileURL(path.join(source, 'config.mjs')).href)}; process.stdout.write(JSON.stringify(settings));`;
      const result = await execute(process.execPath, ['--input-type=module', '-e', script], { env: environment });
      const settings = JSON.parse(result.stdout);
      expect(settings.aiServiceToken).to.equal('root-test-token');
      expect(settings.r2.bucket).to.equal('root-test-bucket');
      expect(settings.r2.secretAccessKey).to.equal('environment-test-secret');
      expect(settings.dsn).to.equal('legacy-backend-dsn');
      expect(settings.sessionSecret).to.equal('legacy-backend-session');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
