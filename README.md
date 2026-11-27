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

Open [Zeko on localhost](http://localhost:4747). By default, canvases, requests, and settings are stored locally in `.zeko/`.

Open [the landing-page example](examples/landing-page.html) in a browser to try the sample **Draft → Compare → Keep** workflow.

## PostgreSQL storage

Set `DATABASE_URL` in `.env.local` to save canvases in PostgreSQL with Drizzle. If your provider uses a private certificate authority, include `sslmode=verify-full&sslrootcert=/path/to/ca.crt` in the URL.

```bash
npm run db:migrate
npm run db:import-local  # Copy existing .zeko canvases if you want to move them to PostgreSQL
npm run dev
```

The import preserves canvas IDs and chat history, skips IDs already in PostgreSQL, and keeps the original files. Zeko stores the full canvas snapshot in `zeko.canvases`, including frames, history, and Memory. The app serves live canvas updates from its running process. Changes from a second Zeko process are checked against the saved revision.

## Hosted preview

The Dockerfile runs one private Zeko workspace. On Render, set the health check to `/api/health` and add a secret file named `zeko.env` with `DATABASE_URL` and a strong `ZEKO_PREVIEW_PASSWORD`. If you upload a CA certificate, use its `/etc/secrets/` path in the database URL. Run the database migrations before deploying.

### Google sign-in

Create a Web application OAuth client with an External audience in Google Auth Platform. Add `https://YOUR_HOST/api/auth/callback/google` to its authorized redirect URIs.

Add a Render secret file named `zeko-auth.env` and restart the service.

```dotenv
AUTH_URL=https://YOUR_HOST
AUTH_SECRET=replace-with-a-random-secret
AUTH_GOOGLE_ID=your-google-client-id
AUTH_GOOGLE_SECRET=your-google-client-secret
```

Generate `AUTH_SECRET` with `openssl rand -base64 32`. Zeko requests the standard OpenID profile and email scopes and requires a verified email. Run `npm run db:migrate` before enabling Google sign-in.

Google sign-in saves the user's profile and latest sign-in time in `zeko.users` and the Google account ID in `zeko.oauth_accounts`. OAuth access and refresh tokens stay out of PostgreSQL. Each user owns the canvases in `zeko.account_canvases`. The original private workspace uses `zeko.canvases`. The hosted database role needs SELECT, INSERT, and UPDATE on these tables.

Until Google is configured, the browser uses HTTP Basic with username `zeko` and the preview password. Hosted MCP clients sign in through the browser with the same Google workspace. The hosted database role needs SELECT, INSERT, and DELETE on `zeko.mcp_oauth_grants`. Existing Basic-auth MCP credentials point to the original workspace.

## Alternates

Explore several directions for one screen without losing any. Select a frame and press **B** (or **Alternates** in the
top bar) to see its versions as a tree: the original at the top, and each alternate under the one it branched from.
Click a version to show it on the canvas, **Branch** to ask your agent for more versions from it (optionally with a
direction, such as "denser" or "a sidebar layout"), and **Keep only** to settle on one. Agents make alternates with
`create_sketch` and `variant_of`.

## State map

Press **M** (or **State map** in the top bar) to see every screen and state on the page, laid out from the start
screen along the prototype's links. Screens with a route usually need loading, empty and error states too; the map
lists the ones missing, and **Design with agent** asks your agent to make them from the screen's default state.
Agents read the same map with `get_state_map`.

## Design drift

Check that what got built matches what was designed. Select a design sketch, open **Details → Build**, and enter
the address of the page that implements it (for example `http://localhost:3000/pricing`). Zeko captures the page
beside the design, renders both at the design's width, matches their elements, and lists every difference:
spacing, sizes, colors (including a hardcoded value where the design uses a token), type, copy, and missing or extra
elements. Each difference is pinned on the build, with the change to make in code.

**Send fixes to agent** hands the open differences to your coding agent; **Capture again** re-checks after the fix.
Mark a difference **Intentional** to accept it; it stays accepted across checks. **Build it with your agent** asks the
agent to implement the design, capture its build and work until nothing is left open. Agents can run the same loop
over MCP with `capture_build` and `check_drift`.

Hosted Zeko can't reach a dev server on your computer, so capture a deployed preview there, or run Zeko locally.

## Agent chat

Choose an agent in the Agents panel and sign in to its local CLI if needed. Zeko bundles the ACP adapters for Codex and Claude. It also finds Cursor, Gemini CLI, GitHub Copilot, OpenCode, Kimi Code, and Mistral Vibe when their CLIs are installed on `PATH`.

Zeko reads models, thinking effort, and other session settings from the selected agent over ACP. The model picker keeps older versions under **More models** and caches its options between chats. Use **Refresh models** to check the agent again. Replies, thinking, and tool activity update live through the Vercel AI SDK. **Stop reply** cancels the active turn. Chats and their selected settings are saved with the canvas.

## Zeko CLI

Install Node.js 22 or later, then install the CLI from npm.

```bash
npm install -g @botter_code/zeko@latest
```

If you installed the earlier GitHub release, run `npm uninstall -g @zeko/cli` before installing from npm.

Run `zeko` once and approve it in your browser. The Agents panel shows **CLI connected** when the desktop process is online. Your ACP agents run on your computer using their local sign-in. Chat, model options, and cancellation go through ACP.

Use `zeko status` to check the connection and `zeko stop` to stop the companion. It reconnects while running and the device approval is valid for 30 days. Run `zeko --pair` to approve it again or switch accounts.

## External MCP connection

Use the **MCP** button for the connection command and sign-in steps for your client. Hosted Zeko uses the same `/api/mcp` URL across canvases. Claude Code signs in through **/mcp → zeko → Authenticate**, and Codex supports `codex mcp login zeko`. Approve the connection in your browser, then open the canvas you want the client to work on.

For local connections, add `?as=<name>` so the board knows who is working, and append `&board=<canvas-id>` to pin the connection to a canvas.

```bash
claude mcp add --transport http zeko "http://localhost:4747/api/mcp?as=Claude"
codex mcp add zeko --url "http://localhost:4747/api/mcp?as=Codex"
```

The app's start scripts listen on loopback. Other Streamable HTTP clients can use the URL in the **Other** tab.

Tools:

- Reading: `get_board`, `get_frame`, `get_guidelines`
- Layer editing: `get_layers` reads the layer tree and computed styles. `edit_layers` saves a batch of text, CSS, attribute and layout edits as one version.
- Images and drawing: `place_image` and `place_svg` add images and drawings the agent made with its own tools, `get_image` shows it a sketch's picture to rework, and `add_shader` adds animated mesh gradient, liquid, grain, paper and halftone layers
- Components: `create_component`, `get_component`, `insert_component`, `update_component` (every instance follows)
- From and to code: `snapshot_url` captures a live webpage as an editable sketch; `get_frame_code` returns a sketch as HTML or a React component with the tokens, fonts, images and components it relies on; `capture_build` and `check_drift` compare the implemented page with its design
- Designing: `create_sketch` (with `variant_of` to join a deck), `edit_sketch`, `append_to_sketch` for long pages,
  `fit_frame_to_content`, `delete_frame` (only frames the agent made)
- Checking its own work: `screenshot_frame` returns the rendered sketch as an image, `inspect_frame` returns
  element boxes, fonts, colors and overflow
- History: `list_versions`, `restore_version`
- Working with people: `set_status`, `claim_task`, `complete_task`, `reply_to_comment`, `update_guidelines`

Zeko calls no AI models of its own. Images and drawings come from your agents: they create them with their own
tools and place them with `place_image` and `place_svg`. Placed images are stored in the sketch as compressed
WebP, so a sketch stays a single self-contained file, and placed SVG is stripped of scripts and external references.

In browsers with WebMCP (`navigator.modelContext`), an open canvas also offers its tools to in-browser agents:
reading the canvas and selection, creating and editing sketches, styling the selected element, comments,
design requests, tokens and frame code.

Screenshots, inspection, PNG export and webpage snapshots render in a headless Chrome. With `ZEKO_HOSTED=1`,
snapshots and placed image addresses refuse private networks. Zeko uses the Chrome already installed;
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
