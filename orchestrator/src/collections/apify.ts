import Ajv from 'ajv';
import datasetSchema from '../../../apify/client-health-check/.actor/dataset_schema.json';
import { createApifyHealthCheck } from './adapters';
import { fakeHealthCheck } from './fakes';
import { projectHealthResult } from './checks';
import type { HealthCheck, PublicCompany } from './types';

const validateDatasetItem = new Ajv().compile(datasetSchema.fields);
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9]{1,100}$/.test(value);

/** The public business from the existing T5 seed probe, separate from synthetic AR identities. */
export const APIFY_DEMO_COMPANY: PublicCompany = {
  name: "Kim's Island Chinese Restaurant, Staten Island, New York", website: 'http://kimsislandsi.com/',
};

/** One start request, no retries: a lost response must never cause a second billable run. */
export function createApifyRunner(options: { token?: string; fetch?: typeof fetch } = {}) {
  const http = options.fetch ?? fetch;
  return async (company: PublicCompany, callerSignal: AbortSignal): Promise<unknown> => {
    const token = options.token ?? process.env.APIFY_TOKEN;
    if (!token) throw new Error('Apify token unavailable');
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(40_000)]);
    signal.throwIfAborted();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    // Cap both platform runtime and event charges. This private Actor only probes one website;
    // it does not launch Store Actors, Maps scrapers, or accept injected Maps observations.
    const params = new URLSearchParams({ build: '0.0.3', waitForFinish: '35', timeout: '35',
      memory: '128', maxTotalChargeUsd: '0.10', restartOnError: 'false' });
    const response = await http(`https://api.apify.com/v2/actors/WQJ4xRGzZN1xj967Z/runs?${params}`, {
      method: 'POST', headers, signal,
      body: JSON.stringify({ companyName: company.name, website: company.website }),
    });
    if (!response.ok) throw new Error('Apify run unavailable');
    const { data } = await response.json() as { data?: { id?: unknown; status?: unknown; defaultDatasetId?: unknown } };
    if (!data || !id(data.id) || data.status !== 'SUCCEEDED' || !id(data.defaultDatasetId)) throw new Error('Apify run pending');
    const itemsResponse = await http(`https://api.apify.com/v2/datasets/${data.defaultDatasetId}/items?format=json&clean=true&limit=2`, { headers, signal });
    if (!itemsResponse.ok) throw new Error('Apify dataset unavailable');
    const items: unknown = await itemsResponse.json();
    if (!Array.isArray(items) || items.length !== 1 || !validateDatasetItem(items[0])) throw new Error('Invalid Apify dataset');
    // The IDE schema is intentionally permissive. Apply the stricter runtime enum/date/URL projection too.
    const result = projectHealthResult(items[0]);
    signal.throwIfAborted();
    return { ...result, apifyRunId: data.id };
  };
}

/** Only this exact switch can initiate a paid run. Missing keys degrade through the pending audit. */
export function createPreCallHealthCheck(env: NodeJS.ProcessEnv = process.env, http?: typeof fetch): HealthCheck {
  if (env.PRECALL_APIFY !== 'live') return { ...fakeHealthCheck({ signals: [] }), label: 'FAKE' };
  return { ...createApifyHealthCheck(createApifyRunner({ token: env.APIFY_TOKEN, fetch: http })), label: 'Apify: live run pending' };
}
