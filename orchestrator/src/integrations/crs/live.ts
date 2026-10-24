/** Opt-in live T3 probe. All configuration stays server-side; only evidence is printed. */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CrsClient, CrsError, type CrsOptions } from './index.js';
import { CRS_CALHACKS_SANDBOX, CRS_SANDBOX_IDENTITIES } from './sandbox.js';

const envPath = fileURLToPath(new URL('../../../../.env.local', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

async function main(): Promise<void> {
  if (process.env.CRS_LIVE !== '1' || !process.env.CRS_USERNAME || !process.env.CRS_PASSWORD) {
    console.log('SKIP CRS: set CRS_LIVE=1 and CRS_USERNAME/CRS_PASSWORD to opt in.');
    return;
  }
  const id = Number(process.env.CRS_TEST_ID);
  if (!process.env.CRS_SANDBOX_MODULE) {
    // Default: the sponsor-published Cal Hacks personas (canned, free responses). CRS_TEST_ID 1-20 = P01-P20.
    if (!CRS_SANDBOX_IDENTITIES.some(identity => identity.testIdentityId === id)) throw new CrsError('CONFIGURATION');
    const client = new CrsClient({ ...CRS_CALHACKS_SANDBOX, username: process.env.CRS_USERNAME, password: process.env.CRS_PASSWORD });
    const publicRecords = await client.getPublicRecords(id);
    const fraudRisk = await client.getFraudRisk(id);
    console.log(JSON.stringify({ publicRecords, fraudRisk }));
    return;
  }
  // A trusted local module supplies only sponsor-confirmed business/OFAC bodies, paths and response parsers.
  // No generic identity input or guessed product routes are used by this script.
  const config: Pick<CrsOptions, 'identities' | 'products'> = await import(pathToFileURL(resolve(process.env.CRS_SANDBOX_MODULE)).href);
  if (!Number.isSafeInteger(id) || id < 1 || !config.identities?.some(identity => identity.testIdentityId === id && identity.businessCredit && identity.ofac) ||
      !config.products?.businessCredit || !config.products.ofac) throw new CrsError('CONFIGURATION');
  const client = new CrsClient({ ...config, username: process.env.CRS_USERNAME, password: process.env.CRS_PASSWORD });
  const business = await client.getBusinessCreditReport(id);
  const ofac = await client.checkOfac(id);
  console.log(JSON.stringify({ business, ofac }));
}

main().catch(error => {
  // Never serialize arbitrary module/transport/provider exceptions.
  console.error(error instanceof CrsError ? error.message : 'CRS live probe failed; verify local configuration.');
  process.exitCode = 1;
});
