/** Opt-in live T3 probe. All configuration stays server-side; only evidence is printed. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CrsClient, CrsError, type CrsOptions } from './index.js';

async function main(): Promise<void> {
  if (process.env.CRS_LIVE !== '1' || !process.env.CRS_USERNAME || !process.env.CRS_PASSWORD) {
    console.log('SKIP CRS: set CRS_LIVE=1 and CRS_USERNAME/CRS_PASSWORD to opt in.');
    return;
  }
  // A trusted local module supplies only sponsor-confirmed test bodies, paths and response parsers.
  // No generic identity input or guessed product routes are used by this script.
  if (!process.env.CRS_SANDBOX_MODULE) {
    console.log('SKIP CRS: missing sponsor-confirmed CRS_SANDBOX_MODULE (see integrations/crs/README.md).');
    return;
  }
  const config: Pick<CrsOptions, 'identities' | 'products'> = await import(pathToFileURL(resolve(process.env.CRS_SANDBOX_MODULE)).href);
  const id = Number(process.env.CRS_TEST_ID);
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
