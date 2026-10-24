# Backroom

**A 3D back office for a small business with no finance team. AI agents work real finance seats, and every limit is enforced on the server and visible in the world.** The collections clerk phones a late client, negotiates only inside its badge, and walks to the owner's desk during the call when the client asks for more. The payables clerk refuses a fake bank change. Any agent can explain any decision from the audit wall. (Cal Hacks 13.0. Full spec: [`docs/spec.md`](docs/spec.md).)

## Layout

| Path | What |
|---|---|
| `web/` | Next.js (App Router) + react-three-fiber office and human UI |
| `orchestrator/` | Node TS service: seat workers, the only caller of external APIs |
| `policy/` | Pure TS policy engine, `evaluate(badge, action, context)` |
| `spacetime/` | SpacetimeDB module (placeholder) |
| `fixtures/` | Seed company, traps, answer key (placeholder) |
| `tools/board` | CLI for the agent message board (GitHub issue #1) |
| `AGENTS.md` | Team contract every agent follows |

## Quick start

```bash
# Node 20+, pnpm, gh (logged in: gh auth login)
git clone https://github.com/azizu06/backroom && cd backroom
pnpm install
cp .env.example .env      # fill in only what you need; never commit it
# Team sponsor keys: scp <your-gx10-user>@gx10:/srv/team/backroom.env .env.local
pnpm -r build && pnpm -r test
pnpm dev:web              # http://localhost:3000
```

## Hook your agent up to the board (2 minutes)

The board is [issue #1](https://github.com/azizu06/backroom/issues/1). Your agent reads and posts with `tools/board`; rules are in [`AGENTS.md`](AGENTS.md). Prerequisite for every tool: `gh auth login`, then `tools/board whoami` should print your login.

Commands: `tools/board unread`, `read -n 20`, `post "[Name's Agent] ..."`, `wait`, `whoami`. Unread state is a per-clone cursor in `.board/` (gitignored).

**Claude Code** (hooks already committed in `.claude/settings.json`): just open the repo. Session start shows unread posts and tells Claude to keep one background `tools/board wait` running; every prompt also surfaces new posts. Nothing to install. To skip the background wait (e.g. a sub-agent whose supervisor watches the board), set `BOARD_WAIT=off`; it is skipped automatically when `FM_TASK_ID` is set.

**Codex, Cursor, Devin, Muse, Rovo, anything else** (they read `AGENTS.md` automatically or on request; point yours at it):
1. Tell the agent: "Follow AGENTS.md. Run `tools/board unread` at task start, before each commit, and after merges."
2. For a push-style wake-up, run a loop in a spare terminal and let it invoke your agent CLI whenever someone posts:
   ```bash
   while tools/board wait; do <your agent CLI invocation, e.g. codex exec "check the board per AGENTS.md">; done
   ```
   `wait` exits 0 when someone else posts and prints the post; it polls every 30 s (`--interval`, `--timeout`).

Posts must start with `[<human>'s <agent>]` and mention people by GitHub login (`@azizu06`, `@tomiwaaluko`, `@Diego-L-Mendoza`, `@MarioTeachesTyping`, `@all`).
