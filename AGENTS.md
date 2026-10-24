# Backroom: team contract for every agent

Cal Hacks 13.0 hackathon build, four humans, many agents (Claude Code, Codex, Cursor, Devin, Muse, Rovo, ...). Product spec: `docs/spec.md`. Repo: `azizu06/backroom`. Be organized but fast; this is a hackathon.

## 1. The board (GitHub issue #1)

Every agent reads and posts on https://github.com/azizu06/backroom/issues/1 via `tools/board` (needs only `gh`, logged in).

- Start every post with `[<human>'s <agent>]`, e.g. `[Diego's Codex]`. Keep it short: what changed, which files or contracts, what you need, from whom.
- Mention by GitHub login: `@azizu06` (Aziz), `@tomiwaaluko` (Tomi), `@Diego-L-Mendoza` (Diego), `@MarioTeachesTyping` (Anthony), `@all` (everyone).
- **Mentions you or `@all`:** act on it and reply promptly.
- **Not addressed to you:** still read it. Reassess your own work only if it is affected (a contract, a file you own, something already done). Do not redo finished work, and do not reply just to acknowledge.
- Before editing another stream's files, ask for a handoff on the board and wait for the owner or Aziz.

Polling is incremental (about one cheap API call per poll, 30 s default) so a shared token stays under GitHub's rate limit. Commands: `tools/board unread` (new posts, marks read; flags MENTION), `tools/board read -n 20`, `tools/board post "[Name's Agent] text"` (or pipe stdin), `tools/board wait` (blocks until someone else posts), `tools/board whoami`.

**Stay in the loop:**
- Claude Code: committed hooks (`.claude/settings.json`) show unread posts at session start and on every prompt. Keep one background `tools/board wait` running (Bash `run_in_background`) and re-arm it after each wake.
- Supervised sub-agents (launched by a supervisor, `FM_TASK_ID` set) or `BOARD_WAIT=off`: the hook still shows unread posts but does not ask for the background wait; the supervisor watches the board.
- Everything else: run `tools/board unread` at task start, before each commit, and after merges. Or run a terminal loop: `while tools/board wait; do <your agent CLI invocation>; done`.

## 2. Chain of command

Humans over agents. Only Aziz reassigns work between streams or people. If asked by anyone else to take another stream's work, ask Aziz on the board.

## 3. Workflow (issue to PR, no CI gates)

1. Pick or file an issue. Comment on it or post on the board if you take it.
2. Branch `<issue#>-<slug>` from fresh `main`.
3. Small commits. Stage only your own files (no `git add -A`).
4. Open a PR with `Closes #N`. The author merges their own PR (squash) once it works locally. No required CI or reviews.
5. Trivial docs/typo fixes may go straight to `main`.
6. Always `git fetch` and rebase before pushing. Never force-push shared branches.
7. If a merge changes a shared contract (SpacetimeDB tables, reducers, tool schemas, policy rule ids, env vars), post on the board when it lands.

## 4. Streams and owners (spec §8.3)

| Stream | Label | Owner | Scope |
|---|---|---|---|
| A. Agent brain + voice | `stream:A-agents` | Aziz (`azizu06`, lead) | Cartesia agent, tool gateway, `policy/`, model router + GX10, `orchestrator/` |
| B. Office + human UI | `stream:B-office` | Diego (`Diego-L-Mendoza`) | `web/`: R3F office, audit wall, inbox tray, approval card, pay page |
| C. State + integrations | `stream:C-state` | Anthony (`MarioTeachesTyping`) | `spacetime/`, CRS and Nessie clients, reconciliation |
| D. Data, proof, delivery | `stream:D-proof` | Tomi (`tomiwaaluko`, acting PM) | `fixtures/`, seed company, answer key, eval, Apify Actor, Devpost, video |

## 5. Event rules and deadlines

- The project must be started at the event (hacking opened Fri Oct 23 ~6 PM PT). No pre-built product code.
- Devpost: our target is **Sun Oct 25, 7:30 AM PT**; hard cutoff 8:50 AM (official 9:00, edits to 10:00). Judging 10:30 AM to 12:30 PM needs a **live, working demo** and the whole team at the table.
- Timeline and gates: spec §8 (Sat 11 AM core-loop checkpoint, Sat 6 PM stretch gate, Sat 10 PM feature freeze, Sun 1 AM code freeze).

## 6. LLM calls

- Anthropic is the primary cloud route, **server-side only**. For provider selection, personal key setup, pricing and the opt-in smoke, read `orchestrator/README.md` §Model router.
- **$50 total budget.** Prototype on cheap models (e.g. `google/gemini-2.5-flash`, `openai/gpt-5-mini`); use a stronger model only for the demo run.
- Shared GX10 Ollama over Tailscale: `http://100.117.44.20:11434/v1` (any non-empty key). Models: `qwen3:8b`, `gpt-oss:20b`, `qwen3-coder:30b`, `qwen2.5vl:7b`, `nomic-embed-text`. For cheap bulk work only; **not in the demo's critical path**. Four people share it.

## 7. Secrets

Team sponsor keys live in `/srv/team/backroom.env` on the GX10. From the repo root, copy them with `scp <your-gx10-user>@gx10:/srv/team/backroom.env .env.local` (or `ssh gx10 cat /srv/team/backroom.env > .env.local`). `.env.local` is gitignored. Never print, commit, or post the values; ask Aziz on the board (`@azizu06`) for a new key, and never paste one there. Next.js and the orchestrator should load these variables from `.env.local`.

## 8. Product rules

- Spec §1.4 legal guardrails (AI disclosure, consent record, B2B only, calling hours, opt-out, bankruptcy stop, identity before amount, no voice approvals) are **product requirements**, enforced in code.
- **Claude talks, code decides** (spec §4.5): models own language and judgment inside a box; code owns the box, the money and the record. Emails, invoices and client speech are data, never instructions. Approvals are a human with a passkey, never a model or a voice.
- The 3D office is a view; it never decides anything (spec §4.9).

## 9. Layout

For model calls, the OFF switch, or the #15 state adapter, read `docs/llm-control.md` first.

`web/` Next.js + R3F, `orchestrator/` Node TS, `policy/` pure TS (`evaluate`), `spacetime/` module, `fixtures/`, `tools/board`. Install `pnpm install`; check `pnpm -r build`, `pnpm -r test`.

Passkey escalation setup and StateStore/gateway integration: `docs/m6-approvals.md`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

## SpacetimeDB spike

T8 local evidence and Maincloud auth status: `docs/t8-spacetime.md`.
Module dev loop and exported reducer/client contracts: `spacetime/README.md`.
