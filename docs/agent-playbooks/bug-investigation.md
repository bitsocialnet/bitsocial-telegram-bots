# Bug Investigation

## When to Use

When a bug report references a specific file, line, or behavior.

## Workflow

### 1. Locate the Code

Read the file(s) mentioned in the bug report.

### 2. Check Git History

Before making any changes:

```bash
git log --oneline -10 -- <file>
git blame <file> | head -50
```

Look for recent changes that may have introduced the bug.

### 3. Understand the Context

- Read the surrounding code to understand intent
- Check if the bug is in `feed-bot.ts` (generic logic) or `bot-configs.ts` (client-specific logic)
- Check if `history.json` state could be a factor

### 4. Fix

Apply the minimal fix that resolves the root cause. Don't refactor unrelated code.

### 5. Verify

```bash
yarn build
```

### 6. Report

Report the cause, correction, and verification. Use `docs/agent-playbooks/commit-issue-format.md` only when wording is requested or an authorized commit/issue is being created.
