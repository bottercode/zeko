# Zeko CLI

Connect local ACP agents to Zeko chat. Requires Node.js 22 or later.

```sh
npm install -g @botter_code/zeko@latest
```

Run `zeko` and approve the connection in your browser. In your canvas, open Agents to use an agent with its local sign-in. Zeko includes adapters for Codex and Claude Code and detects the installed CLIs for Cursor, Gemini CLI, GitHub Copilot, OpenCode, Kimi Code, and Mistral Vibe on `PATH`.

Run `zeko status` to check the connection, `zeko stop` to stop it, or `zeko --pair` to approve a new workspace connection.
