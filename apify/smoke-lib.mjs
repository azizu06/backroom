export const runOptions = Object.freeze({ timeout: '50', maxTotalChargeUsd: '0.50', restartOnError: 'false' });

export const cases = [
  {
    name: 'maps', actor: 'compass~crawler-google-places',
    input: {
      placeIds: ['ChIJJQz5EZzKw4kRCZ95UajbyGw'],
      maxCrawledPlacesPerSearch: 1, language: 'en', skipClosedPlaces: false,
      scrapePlaceDetailPage: false, scrapeDirectories: false, scrapeContacts: false,
      maximumLeadsEnrichmentRecords: 0, maxReviews: 0, maxImages: 0,
      scrapeReviewsPersonalData: false, enableCompetitorAnalysis: false,
    },
  },
  {
    name: 'search', actor: 'apify~google-search-scraper',
    input: {
      queries: "Kim's Island Chinese Restaurant Staten Island", maxPagesPerQuery: 1,
      countryCode: 'us', languageCode: 'en', maximumLeadsEnrichmentRecords: 0,
      aiOverview: { scrapeFullAiOverview: false }, aiModeSearch: { enableAiMode: false },
      geminiSearch: { enableGemini: false }, perplexitySearch: { enablePerplexity: false },
      chatGptSearch: { enableChatGpt: false }, copilotSearch: { enableCopilot: false },
      websiteContentScraper: { enable: false }, focusOnPaidAds: false,
      saveHtml: false, saveHtmlToKeyValueStore: false,
    },
  },
];

export function summarizeRun(run) {
  return {
    runId: run.id, status: run.status, buildId: run.buildId ?? null,
    startedAt: run.startedAt ?? null, finishedAt: run.finishedAt ?? null,
    durationSecs: run.startedAt && run.finishedAt ? (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000 : null,
    costUsd: typeof run.usageTotalUsd === 'number' ? run.usageTotalUsd : null,
    chargedEventCounts: run.chargedEventCounts ?? {},
  };
}

// The API can report SUCCEEDED before final event billing reaches usageTotalUsd.
export function billingComplete(run, primaryEvent) {
  const counts = run.chargedEventCounts ?? {};
  const prices = run.pricingInfo?.pricingPerEvent?.actorChargeEvents;
  if (!prices || !(counts[primaryEvent] >= 1) || typeof run.usageTotalUsd !== 'number') return false;
  let eventCost = 0;
  for (const [event, count] of Object.entries(counts)) {
    if (count === 0) continue;
    if (typeof prices[event]?.eventPriceUsd !== 'number') return false;
    eventCost += count * prices[event].eventPriceUsd;
  }
  return run.usageTotalUsd + 1e-10 >= eventCost;
}

export function publicItems(kind, items) {
  if (kind === 'maps') {
    const fields = ['title', 'url', 'placeId', 'website', 'permanentlyClosed', 'temporarilyClosed', 'scrapedAt'];
    return items.slice(0, 1).map(item => Object.fromEntries(fields.filter(k => Object.hasOwn(item, k)).map(k => [k, item[k]])));
  }
  return items.slice(0, 1).map(item => ({
    url: item.url,
    organicResults: (item.organicResults ?? []).slice(0, 10).map(result => ({ title: result.title, url: result.url })),
  }));
}
