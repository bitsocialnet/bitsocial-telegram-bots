# Commit & Issue Format

## When to Use

Use this format when the user requests wording or authorizes creating a commit or issue. A code change alone does not require an issue, a suggested issue, or publication. Existing authorization applies without repeated approval.

## Commit Title Format

Use Conventional Commits with a **required scope**:

```
type(scope): description
```

| Type | When |
|---|---|
| `feat` | New feature or bot |
| `fix` | Bug fix |
| `refactor` | Code restructuring without behavior change |
| `perf` | Performance optimization |
| `docs` | Documentation only |
| `chore` | Tooling, deps, config |

**Scope** is a short human-readable name for the area affected:

- `5chan-feed`, `seedit-feed` — specific bot
- `bot` — generic bot logic (`feed-bot.ts`)
- `config` — bot configurations
- `types` — type definitions
- `infra` — CI, deploy, scripts

Examples:

```
feat(seedit-feed): add seedit bot config
fix(bot): prevent duplicate sends on restart
refactor(config): extract shared community parser
```

## GitHub Issue Format

```
### Title
Short imperative description

### Body
- What: 1-2 sentence summary
- Why: motivation
- Acceptance criteria (if applicable)
```

Example:

```
### Title
fix(bot): prevent duplicate sends on restart

### Body
- What: Posts are re-sent after bot restart because history.json isn't loaded before first cycle
- Why: Users see duplicate posts in Telegram channels
- AC: No duplicate posts after restart with existing history.json
```
