import { CrsClient } from '../../orchestrator/src/integrations/crs';
import { CRS_CALHACKS_SANDBOX, crsSandboxFixtureFetch } from '../../orchestrator/src/integrations/crs/sandbox';
import { createCrsBankChangeRisk } from '../../orchestrator/src/vendor/crs';
import { createPreCallHealthCheck } from '../../orchestrator/src/collections/apify';
import { ApifyBudget, createContactRunner } from '../../orchestrator/src/agents/tools/vendor-apify';
import { MemoryVendorEvidenceStore } from '../../orchestrator/src/agents/tools/vendor';

/** Actual sponsor adapters and role evidence store, synthetic HTTP only. Never a live sponsor measurement. */
export function judgeSponsors() {
  const requests: { method: string; host: string; path: string }[] = [];
  const records: any[] = [];
  const crsResults: any[] = [];
  const datasets = new Map<string, { contact: boolean; website: string }>();
  let sequence = 0;
  const http: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ method: init?.method ?? 'GET', host: url.hostname, path: url.pathname });
    if (url.hostname === 'api-sandbox.stitchcredit.com') return crsSandboxFixtureFetch(input, init);
    if (url.hostname !== 'api.apify.com') throw new Error('JUDGE_SPONSOR_NETWORK_FORBIDDEN');
    if (url.pathname.endsWith('/runs')) {
      const body = JSON.parse(String(init?.body));
      const contact = url.pathname.includes('/acts/');
      const dataset = `sponsordataset${++sequence}`;
      datasets.set(dataset, { contact, website: contact ? body.startUrls[0].url : body.website });
      return Response.json({ data: { id: `sponsorrun${sequence}`, status: 'SUCCEEDED', defaultDatasetId: dataset, usageTotalUsd: 0 } });
    }
    const dataset = datasets.get(url.pathname.split('/')[3]!);
    if (!dataset) throw new Error('JUDGE_DATASET_NOT_STARTED');
    return Response.json(dataset.contact
      ? [{ emails: [`accounts@${new URL(dataset.website).hostname}`], phones: ['+12025550100'] }]
      : [{ signals: [{ type: 'website_reachable', value: true, sourceUrl: dataset.website, observedAt: new Date().toISOString() }] }]);
  };
  const client = new CrsClient({ ...CRS_CALHACKS_SANDBOX, username: 'judge-fixture', password: 'judge-fixture', fetch: http });
  const evidence = new MemoryVendorEvidenceStore();
  const put = evidence.put.bind(evidence);
  evidence.put = async (activation, record) => {
    const result = await put(activation, record);
    if (!records.some(row => row.ref === result.ref)) records.push(structuredClone(result));
    return result;
  };
  // Explicit synthetic mappings; the frozen company intentionally has no real CRS identity mapping.
  const identity = (vendorId: string) => vendorId === 'cedar' ? 13 : 1;
  const risk = createCrsBankChangeRisk(client, identity);
  return {
    vendor: {
      evidence, budget: new ApifyBudget({ demoCapUsd: 20, perCaseRuns: 2 }),
      health: createPreCallHealthCheck({ NODE_ENV: 'test', PRECALL_APIFY: 'live', APIFY_TOKEN: 'judge-fixture' }, http),
      contact: createContactRunner({ token: 'judge-fixture', fetch: http }),
      bankChangeRisk: { async check(vendorId: string) {
        const result = await risk.check(vendorId); crsResults.push({ vendorId, product: 'fraudRisk', ...result }); return result;
      } },
      async publicRecords(vendorId: string) {
        const result = await client.getPublicRecords(identity(vendorId));
        crsResults.push({ vendorId, ...result });
        return { bankruptcies: result.summary.bankruptcies!, evidenceRef: `crs:sha256:${result.responseHash}` };
      },
    },
    proof: () => ({ mode: 'mocked_sponsor_transport', requests: structuredClone(requests),
      evidence: structuredClone(records), crsResults: structuredClone(crsResults) }),
  };
}
