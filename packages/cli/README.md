# Zeko CLI

Connect a local Codex or Claude Code session to a Zeko canvas. Requires Node.js 20.9 or later.

```sh
npm install -g @botter_code/zeko
```

From a hosted canvas, open **Connect an agent → Zeko CLI** and run the displayed setup command. Paste the workspace token when the terminal prompts you. Run `zeko launch` in your project directory to open the coding agent.

For local Zeko, run `zeko launch --url http://localhost:4747`. Add `--provider claude` to choose Claude Code.

Run `zeko --help` for available commands. Use the same server address and provider when checking or stopping the background companion.
