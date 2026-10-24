# Client health check: unpublished TypeScript scaffold

Generated for issue #6 / spec §8.1 T5 with:

```powershell
npx --yes apify-cli create client-health-check --template ts-empty --skip-dependency-install --skip-git-init
```

This is the official `ts-empty` scaffold, with project metadata filled in. Its entry point initializes and exits the Apify SDK. It does not scrape, assess business health, or emit evidence. The generated example test is template boilerplate and is not evidence of health-check behavior.

The separate runner in `../smoke.mjs` exercised both Store Actors successfully: 16.892 seconds and $0.01075 actual total. See `../../docs/apify-smoke.md` for run IDs, limits, billing verification, and the preserved earlier cap refusals. No additional paid run is needed.

Input and dataset schemas pass `apify validate-schema`. Dependencies have not been installed and this scaffold has not been compiled, run, pushed, or published. Issue #26 owns health-check implementation and publication. No public Actor URL exists.

For future local scaffold development, install its dependencies in this directory and run `apify run`. Keep credentials in the ignored repository environment file. A successful local scaffold run would still not establish a passing live provider smoke test.
