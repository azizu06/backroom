# Web browser specs

Build first, then run every Playwright config sequentially (stops at the first failure):

```sh
pnpm --filter @backroom/web exec playwright install chromium   # once
pnpm --filter @backroom/web build
pnpm --filter @backroom/web test:browser
```

Each config starts its own server (`reuseExistingServer: false`) on a unique port, so any two can run at once.

| Script | Config | Port | Covers |
|---|---|---|---|
| `test:approvals:browser` | `playwright.approvals.config.ts` | 3020 | `/controller` passkey approval card |
| `test:controller:browser` | `playwright.controller.config.ts` | 3036 | `/controller` live inbox: escalation rings in without a link, forged decision rejected |
| `test:audit:browser` | `playwright.audit.config.ts` | 3031 | `/audit` audit wall |
| `test:payments:browser` | `playwright.payments.config.ts` | 3032 | `/pay` page (`next dev`, `BACKROOM_PAYMENT_DEMO=1`) |
| `test:inbox:browser` | `playwright.inbox.config.ts` | 3033 | `/inbox` tray |
| `test:policy:browser` | `playwright.policy.config.ts` | 3034 | `/policy` editor |
| `test:office:browser` | `playwright.office.config.ts` | 3035 | `/office` lobby audit wall + ask-why |
| `test:replay:browser` | `playwright.replay.config.ts` | 3254 | `/office?replay=core-offline` replay |

`web/scripts/verify-office.mjs` is separate: it expects an office server on port 3244 (`OFFICE_URL`) and writes evidence screenshots to `docs/evidence`.
Some specs regenerate PNGs under `docs/evidence`; do not commit them (`git checkout -- docs/evidence`).
