# Zeko

Zeko is a local-first design canvas for you and your coding agents. Put your product's screens and states on one board, watch sketches appear as agents work, and compare variants before choosing what to build.

- **Sketch frames** are whole HTML documents, usually written by an agent, labelled with the route and
  state they stand for.
- **Website frames** let you browse a reference site beside your sketches. Use the globe in the canvas toolbar to add one. For sites that block embedding, use **Open in browser**.
- **Decks** hold the variants of one screen. Flip with ← →, then **Keep** the one you want (K).
- **Loupe** compares two frames by wipe, see-through or side by side (L).
- **Arrange as sheet** lays the board out with one row per route and states left to right.
- **Chats** in the Agents panel send requests to connected agents. Start a new chat or reopen one from chat history.
- **Edit inside a sketch**: double-click it (or press Enter) to pick elements, see its layers, change text,
  type, color, spacing and size in the inspector, insert text, boxes, buttons and images, or retype text in place.
- **History**: every change to a sketch keeps the version before it; restore any of them from the inspector.
- **Memory** holds references, design guidelines, and optional skills that agents can read when designing.
- **Export** a sketch as PNG (1×, 2×, 3×), PDF, or HTML, or save the whole board as a `.zeko.json` file.
- **Search** with ⌘K jumps to any screen, comment or request.
- **Comments** pin to a spot on a frame; tick "Ask agents to act on it" to hand them over.
- Undo and redo cover every change you make (⌘Z, ⇧⌘Z).

## Run it

Use Node.js 22.12 or later.

```bash
git clone https://github.com/bottercode/zeko.git
cd zeko
npm ci
npm run dev
```

Open [Zeko on localhost](http://localhost:4747). Canvases, requests, and settings are stored locally in `.zeko/`.

Open [the landing-page example](examples/landing-page.html) in a browser to try the sample **Draft → Compare → Keep** workflow.

## Agent chat

Choose an agent in the Agents panel and sign in to its local CLI if needed. Zeko bundles the ACP adapters for Codex and Claude. It also finds Cursor, Gemini CLI, GitHub Copilot, and OpenCode when their CLIs are installed on `PATH`.

Zeko reads models, thinking effort, and other session settings from the selected agent over ACP. The model picker keeps older versions under **More models** and caches its options between chats. Use **Refresh models** to check the agent again. Replies, thinking, and tool activity update live through the Vercel AI SDK. **Stop reply** cancels the active turn. Chats and their selected settings are saved with the canvas.

## External MCP connection

Use the **MCP** button to connect an external client. Zeko serves MCP over Streamable HTTP at `/api/mcp`. Add `?as=<name>` so the board knows who is working, and append `&board=<canvas-id>` to pin the connection to a canvas.

```bash
claude mcp add --transport http zeko "http://localhost:4747/api/mcp?as=Claude"
codex mcp add zeko --url "http://localhost:4747/api/mcp?as=Codex"
```

The app's start scripts listen on loopback. Other Streamable HTTP clients can use the URL in the **Other** tab.

Tools:

- Reading: `get_board`, `get_frame`, `get_guidelines`
- Designing: `create_sketch` (with `variant_of` to join a deck), `edit_sketch`, `append_to_sketch` for long pages,
  `fit_frame_to_content`, `delete_frame` (only frames the agent made)
- Checking its own work: `screenshot_frame` returns the rendered sketch as an image, `inspect_frame` returns
  element boxes, fonts, colors and overflow
- History: `list_versions`, `restore_version`
- Working with people: `set_status`, `claim_task`, `complete_task`, `reply_to_comment`, `update_guidelines`

Screenshots, inspection and PNG export render in a headless Chrome. Zeko uses the Chrome already installed;
set `ZEKO_CHROME` to use another Chromium-based browser.

## How it's built

Next.js 16 (App Router) with one process for everything:

- `lib/ops.ts` is a pure `applyOp(board, op)` used by the server and by the browser's optimistic copy.
  `inverseOf(before, after)` derives the undo for any op.
- `lib/server/store.ts` keeps the board in memory, writes it to disk, and notifies listeners.
- `app/api/events` streams the board to browsers over server-sent events. `app/api/board` takes
  operations from people, and `app/api/mcp` takes them from agents.
- `components/` holds the studio: canvas, frame cards and decks, comments, loupe and panels.

## License

Zeko is released under the [MIT License](LICENSE). Third-party names, logos, and linked assets retain their respective owners’ rights.
