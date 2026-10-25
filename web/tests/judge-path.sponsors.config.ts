import { defineConfig } from '@playwright/test';
import base from './judge-path.config';

if (!base.webServer || Array.isArray(base.webServer)) throw new Error('JUDGE_SINGLE_HOST_REQUIRED');
export default defineConfig({ ...base, metadata: { spacetimeProof: true },
  webServer: { ...base.webServer, env: { JUDGE_SPACETIME: '1' }, timeout: 180_000 },
});
