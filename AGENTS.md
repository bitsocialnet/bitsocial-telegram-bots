# AGENTS.md

## Purpose

This file defines the always-on rules for AI agents working on bitsocial-telegram-bots.
Use this as the default policy. Load linked playbooks only when their trigger condition applies.

## Surprise Handling

If you encounter something surprising or ambiguous while working, alert the developer immediately.
After confirmation, add a concise entry to `docs/agent-playbooks/known-surprises.md` so future agents avoid the same issue.
Only record items that are repo-specific, likely to recur, and have a concrete mitigation.

## Project Overview

bitsocial-telegram-bots runs Telegram feed bots for Bitsocial clients. Each bot monitors a specific client's community list (e.g. 5chan directories, Seedit communities) and forwards new posts to Telegram channels/groups.

**Key design principle:** each Bitsocial client has its own exclusive community list and its own bot. Bots do NOT cross-link between clients — the 5chan bot links only to 5chan, the Seedit bot links only to Seedit, etc. This is because each client curates its own communities with its own UX.

## Instruction Priority

- **MUST** rules are mandatory.
- **SHOULD** rules are strong defaults unless task context requires a different choice.
- If guidance conflicts, prefer: user request > MUST > SHOULD > playbooks.

## Task Router (Read First)

| Situation | Required action |
|---|---|
| Bot logic changed (`src/feed-bot.ts`, `src/index.ts`) | Run `yarn build` to verify compilation |
| Bot config added/changed (`src/bot-configs.ts`, `src/types.ts`) | Run `yarn build` and verify community list URL is reachable |
| `package.json` changed | Run `yarn install` to keep `yarn.lock` in sync |
| Bug report in a specific file/line | Start with git history scan from `docs/agent-playbooks/bug-investigation.md` before editing |
| GitHub operation needed | Use `gh` CLI, not GitHub MCP |
| User asks for commit/issue phrasing | Use `docs/agent-playbooks/commit-issue-format.md` |
| Surprising/ambiguous repo behavior encountered | Alert developer and, once confirmed, document in `docs/agent-playbooks/known-surprises.md` |

## Stack

- Node.js + TypeScript
- Telegraf (Telegram bot framework)
- @plebbit/plebbit-js (Bitsocial/Plebbit protocol)
- p-queue (concurrency control)
- tslog (logging)
- dotenv (configuration)
- yarn

## Project Structure

```text
src/
├── index.ts        # Entry point: env config, Plebbit init, bot startup
├── feed-bot.ts     # Generic feed bot loop (shared by all bots)
├── bot-configs.ts  # Per-client bot configurations (5chan-feed, etc.)
├── types.ts        # Shared types (BotConfig, CommunityInfo)
└── modules.d.ts    # TypeScript module declarations
docs/
└── agent-playbooks/  # On-demand playbooks (load only when relevant)
```

## Architecture

### Multi-Bot Design

Each bot is defined by a `BotConfig` in `src/bot-configs.ts`. A config specifies:

- **listUrl** — where to fetch the community list (e.g. `5chan-directories.json`)
- **parseCommunities** — how to parse communities from that list
- **getPostUrl** — how to build a link back to the client for a given post
- **getPostButtons** — what inline buttons to show on Telegram messages
- **getCommunityLabel** — how to display a community name in logs/messages
- **filterNsfw** — whether to exclude NSFW communities

The active bot is selected via the `BOT_NAME` environment variable (defaults to `5chan-feed`).

### Client Isolation

Each bot only links to its own client. The 5chan bot produces "View on 5chan" buttons, the Seedit bot will produce "View on Seedit" buttons. Never mix clients in a single bot's output.

### Post Processing Flow

1. Fetch community list from `listUrl`
2. For each community, resolve via Plebbit and load the latest posts page
3. For each new post: check history, verify not removed/deleted/old, format caption, send to Telegram
4. Track processed CIDs in `history.json` to avoid duplicates
5. Repeat every 30 seconds

## Core MUST Rules

### Package and Dependency Rules

- Use `yarn`, never `npm`.
- Pin exact dependency versions (`package@x.y.z`), never `^` or `~`.
- Keep lockfile synchronized when dependency manifests change.

### Bot Architecture Rules

- Each bot config MUST only link to its own client — never cross-link to other Bitsocial clients.
- Each bot config MUST define all methods in the `BotConfig` interface.
- Community lists MUST be fetched from `bitsocialnet/lists` on GitHub.
- New bot configs MUST be registered in the `botConfigs` map in `src/bot-configs.ts`.

### Code Organization Rules

- Keep `feed-bot.ts` generic — client-specific logic belongs in `bot-configs.ts`.
- Add comments for complex/non-obvious code; skip obvious comments.
- Shared types go in `src/types.ts`.

### Bug Investigation Rules

- For bug reports tied to a specific file/line, check relevant git history before any fix.
- Minimum sequence: `git log --oneline` or `git blame` first, then scoped `git show` for relevant commits.
- Full workflow: `docs/agent-playbooks/bug-investigation.md`.

### Verification Rules

- Never mark work complete without verification.
- After code changes, run: `yarn build`.
- If build fails, fix and re-run until passing.

### Tooling Constraints

- Use `gh` CLI for GitHub work (issues, PRs, actions, projects, search).
- Do not use GitHub MCP.

### Security and Boundaries

- Never commit secrets, `.env` files, or API keys.
- Never push to a remote unless the user explicitly asks.

## Core SHOULD Rules

- Keep context lean: delegate heavy/verbose tasks to subprocesses when available.
- For complex work, parallelize independent checks.
- When proposing or implementing meaningful code changes, include both:
  - a Conventional Commit title suggestion
  - a short GitHub issue suggestion
  Use the format playbook: `docs/agent-playbooks/commit-issue-format.md`.
- When stuck on a bug, search the web for recent fixes/workarounds.
- After user corrections, identify root cause and apply the lesson in subsequent steps.

## Common Commands

```bash
yarn install
yarn start                # Start bot (uses BOT_NAME env, defaults to 5chan-feed)
yarn start:5chan-feed      # Start the 5chan feed bot explicitly
yarn build                # TypeScript compilation check
yarn dev                  # Development mode with watch
```

## Playbooks (Load On Demand)

Use these only when relevant to the active task:

- Adding a new bot: `docs/agent-playbooks/adding-a-bot.md`
- Commit/issue output format: `docs/agent-playbooks/commit-issue-format.md`
- Bug investigation workflow: `docs/agent-playbooks/bug-investigation.md`
- Hooks setup and scripts: `docs/agent-playbooks/hooks-setup.md`
- Known surprises log: `docs/agent-playbooks/known-surprises.md`
