# Agent entry points

This repository commits `AGENTS.md` for Codex and Cursor and a `CLAUDE.md` import for Claude Code. It has no committed lifecycle hooks, custom agents, or skill catalog. Do not assume a formatter, install, or verification command runs automatically.

Run the commands required by the affected change explicitly. Keep Git cleanup, dependency installation, builds, bot startup, and Telegram sends out of automatic session-end hooks.

If a future task needs a hook, use the app’s native configuration and test its actual input format: [Claude settings](https://code.claude.com/docs/en/hooks), [Cursor hooks](https://cursor.com/docs/hooks), and [Codex hooks](https://learn.chatgpt.com/docs/hooks). Shared behavior can use a common script, but matching JSON files do not establish equivalent runtime behavior.
