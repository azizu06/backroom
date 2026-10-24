# Client health check: unpublished TypeScript scaffold

Generated for issue #6 / spec §8.1 T5 with:

```powershell
npx --yes apify-cli create client-health-check --template ts-empty --skip-dependency-install --skip-git-init
```

The entry point probes the public website and turns supplied Maps fields into typed signals: `maps_status`, `website_reachable`, `phone_match`, and an explicit `distress_news` boolean. It does not start a paid Maps run, and scraped page text is not returned. The generated `1 + 1` test is still template boilerplate. `src/signals.test.ts` covers the signal contract.

The separate runner in `../smoke.mjs` exercised both Store Actors successfully: 16.892 seconds and $0.01075 actual total. See `../../docs/apify-smoke.md` for run IDs, limits, billing verification, and the preserved earlier cap refusals. No additional paid run is needed.

Input and dataset schemas describe the company and the signal record. Dependencies are still uninstalled, and this Actor has not been pushed or published. Store publication and the Devpost run-id link need Aziz. No public Actor URL exists.

For future local scaffold development, install its dependencies in this directory and run `apify run`. Keep credentials in the ignored repository environment file. A successful local scaffold run would still not establish a passing live provider smoke test.
