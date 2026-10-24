# Replay backup (Refs #24, spec §6.3)

Open `/office?replay=core-offline` for the recorded run in the 3D office, or
`/audit?replay=core-offline` for its full audit wall. These are **REPLAY**, never
live: the toolbar stays at the top while scrolling and a fixed REPLAY disclosure
stays visible on both routes, including failed/missing recordings and the phone
floor-plan view. Live integration status is replaced by replay disclosure.

Play/pause, 0.25–8× speed, position scrubbing and phase selection affect both the
state and audit cursor. Avatar interpolation uses the recording clock, so pause
and backwards seeks also freeze/rewind their positions. The same `OfficeState`
feeds the 3D and 2D views. No reducer, tool, model, audit API, payment or approval
is invoked by playback; model control stays disabled. Audit detail shows original
inputs, outcomes, quotes and hashes. Ask-why is omitted because a new explanation
would be a new model/read request rather than part of the recording.

## Recording

From the repo root:

```sh
pnpm demo:core --record my-backup
# Then restart/rebuild the web app if it is a production build:
pnpm --filter @backroom/web build
# /office?replay=my-backup or /audit?replay=my-backup
```

Names use letters, digits, `_` or `-` (64 characters max). Files are created
exclusively at `fixtures/replays/<name>.jsonl`; existing recordings are never
overwritten. `--live` and `--record` cannot be combined. Only review and commit
synthetic recordings: bundled files are public through their replay pages.
Do not place real client data, credentials or recordings from a real call there.
The recorder does not read `.env.local` or make network/model calls.

`core-offline.jsonl` was captured by `pnpm demo:core --record core-offline`:
140 ordered frames, 25,375 ms, four separate demo phases (Collections #1042,
inbox LLM on, inbox LLM off, Northfield AP). Original synthetic sponsor responses,
scripted voice turns and software test passkey remain explicitly synthetic. This
is a state/audit backup; it does not contain call audio. Pair it with an honestly
labeled recorded audio/video clip if using the final voice fallback in §6.3.

The CLI deliberately waits 180 ms after each recorded mutation so the fast,
scripted demo is viewable. Frame offsets are actual wall-clock elapsed capture
times, including that pacing; the player does not invent or reorder timestamps.
Audit timestamps stay untouched, even where demo services use a fixed fixture
clock. Replay position and audit event time are distinct.

## Contract

`@backroom/orchestrator` exports `createReplayRecorder`, `parseReplay` and the
`ReplayRecording` types. The recorder attaches to a fresh `StateStore` before
registration and serializes its successful mutations. It then reads agents,
tasks, escalations, policy/runtime state and incremental audit entries through
public read APIs; it never inspects a store's private maps or copies reducer
arguments/credentials. IDs are discovered through registration/enqueue and
escalation results because StateStore has no list-agents/tasks API. This is an
office/audit projection, **not a database backup or a restore endpoint**: invoice
and external bank records are not independently readable through StateStore;
their recorded audit receipts remain in the original chains. Invoice transitions
still produce timed mutation frames.

Each JSONL has a versioned header/provenance, ordered frames (full visible state
plus newly appended audits), then a required end marker with frame count,
duration and SHA-256 of every preceding line. `parseReplay` rejects incomplete or
edited files and verifies the complete original audit chain separately for each
phase. IDs/sequence numbers/hashes are not rewritten across phases. The file
digest detects accidental editing/truncation; it is not a signature against a
party replacing the file and digest together.

`web/lib/replay/player.ts` exports an `OfficeState` producer with `connection:
'replay'` and a cached playback cursor. `AuditWall({recording})` consumes the same
phase's verified audit prefix without opening an operator session or polling
live state. Live `AuditWall()` behavior remains unchanged. Recordings are loaded
server-side from the bundled fixture directory with strict basename validation;
there is no arbitrary-file or upload API. Next file tracing includes the fixture
files for the office/audit routes.

## Verification

```sh
pnpm -r test
pnpm -r typecheck
pnpm --filter @backroom/web build
pnpm --filter @backroom/web exec playwright test --config playwright.replay.config.ts
```

Tests cover intermediate target preservation, phase-local chains, tampering and
truncation rejection, timing/speed/pause/rewind, bundled-file/path validation,
desktop 3D + floor-plan parity, phone overflow, missing-file fail-closed labeling,
original audit policy quotes and zero `/api/` requests during playback. Headless
screenshots are in `docs/evidence/replay/`. They show the saved synthetic run,
not proof of live sponsor services, voice, or physical-laptop frame rate.
