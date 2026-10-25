# Check before judging

From an isolated checkout with dependencies, Chromium and a production build installed:

```sh
node tools/judge-check.mjs --live-origin https://YOUR-DEMO-ORIGIN
```

Alternatively set `JUDGE_LIVE_ORIGIN`. There is no default origin. Keep the real origin private; do not paste it into the public board.

The command prints one PASS/FAIL table and exits 0 only when every row passes:

- Local judge-path browser rehearsal, on owned loopback ports 3049/3050. It exercises invoice agent handoffs, bank-change hold, passkey approval, $743 payment, exact reconciliation, callback, hostility, wrong-person and dispute stops. The bank and model turns are offline; no phone is dialed.
- GET `/api/demo-status`: valid service evidence and no reported unreachable service. The table includes reported service states and model ON/OFF; PASS does not mean every service was live-verified.
- GET `/api/controller/view`: Dana has a registered passkey. It does not sign in or request an approval.
- GET `/api/pay/active`: idle or a valid unexpired public payment-link shape. It does not open or pay the link.

Live probes send no credentials and reject redirects. They never POST, dial, enroll, approve, reset, or pay. They read current evidence; they cannot prove a future provider call will succeed.

Run heavy builds on the owned build host with `pnpm -r build`. The command fails if the build is missing or `web/.env*` files could inject live configuration. It strips inherited provider configuration from the local test process. Existing local ports must be free; it does not reuse a running test server.

Local browser output and audit attachments are saved in the temporary evidence directory printed in the table. Keep that output when reporting a failure. The real live origin is supplied at run time; automated integration tests use a local HTTPS fixture.

Tool tests:

```sh
node --test tools/judge-check.test.mjs
```
