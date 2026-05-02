# MUXEL Project Handoff

This document is the operating manual for future AI agents or developers working on MUXEL. Read this before changing code. It captures the current architecture, known traps, build/test flows, Electron packaging details, editor behavior, and the cautions learned while fixing bugs.

## Project Snapshot

MUXEL is a block-based editor built with Next.js App Router, React, Tiptap, Zustand, dnd-kit, Tailwind CSS, and Electron.

The same source code powers both targets:

- Web/dev app: `npm run dev`, served at `http://127.0.0.1:3000`.
- Desktop app: Electron wraps the production Next standalone server and packages it into `dist/MUXEL.exe`.

The app currently has no real backend. Editor/page state is in the client-side Zustand store only. A backend such as Supabase or Postgres may be added later, so avoid desktop-only architecture decisions that would block server routes, API endpoints, auth, or a database layer.

## Critical Instruction From `AGENTS.md`

This project uses a modern Next.js version with possible breaking changes from older assumptions. Before coding Next.js behavior, read the relevant docs in:

```text
node_modules/next/dist/docs/
```

Useful docs already relevant to this repo:

- `node_modules/next/dist/docs/01-app/01-getting-started/17-deploying.md`
- `node_modules/next/dist/docs/01-app/02-guides/custom-server.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`

Do not rely blindly on old Next.js knowledge.

## Important Commands

Install dependencies:

```powershell
npm install
```

Run web development app:

```powershell
npm run dev
```

Run Electron against the dev server:

```powershell
npm run electron:dev
```

Lint:

```powershell
npm run lint
```

Build the Next production app:

```powershell
npm run build
```

Build the desktop executable:

```powershell
npm run desktop:build
```

The packaged app is generated at:

```text
dist/MUXEL.exe
```

`npm run dist` is an alias for `npm run desktop:build`.

## Testing Strategy

Use fast web testing during normal development:

1. Run `npm run dev`.
2. Open `http://127.0.0.1:3000`.
3. Test editor behavior in the browser.
4. Run `npm run lint`.
5. Run `npm run build`.

For changes that affect Electron, packaging, assets, fonts, Next config, environment handling, startup, or final release quality:

1. Run `npm run desktop:build`.
2. Launch `dist/MUXEL.exe`.
3. Confirm the app opens without error dialogs.
4. Smoke-test editor behavior inside the packaged app.

Helpful packaged-app QA trick:

```powershell
$env:MUXEL_PORT = '39571'
Start-Process -FilePath (Resolve-Path 'dist\MUXEL.exe').Path
Remove-Item Env:\MUXEL_PORT -ErrorAction SilentlyContinue
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:39571'
```

`MUXEL_PORT` is only for deterministic QA. Normal double-click launch uses a free private local port automatically.

After QA, stop test-launched packaged processes if needed:

```powershell
Get-Process MUXEL -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Top-Level Structure

```text
AGENTS.md
HANDOFF.md
electron/main.mjs
eslint.config.mjs
next.config.ts
package.json
src/app/
src/components/editor/
src/lib/
src/store/
```

Generated folders:

```text
.next/
dist/
node_modules/
```

Do not edit generated folders manually.

## Next.js Architecture

`src/app/page.tsx` renders the editor page.

`src/app/layout.tsx` configures global metadata and the JetBrains Mono font using `next/font/google`.

`src/app/globals.css` defines the dark theme, editor selection styling, placeholder styling, and custom cross-block selection CSS.

`next.config.ts` has:

```ts
output: "standalone"
```

This is required for Electron packaging. Do not remove it unless the Electron packaging strategy is rewritten.

Why standalone matters:

- `next build` emits `.next/standalone/server.js`.
- Electron packages that standalone server under `resources/next-server`.
- The desktop app starts that bundled Next server locally.

## Electron Architecture

Electron entry:

```text
electron/main.mjs
```

Key behavior:

- In development, Electron loads `ELECTRON_START_URL` or `http://127.0.0.1:3000`.
- In packaged mode, Electron starts the bundled Next standalone server from `process.resourcesPath/next-server/server.js`.
- It chooses a free `127.0.0.1` port automatically.
- It waits until the server responds before opening the BrowserWindow.
- It uses secure renderer settings: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- External links are opened with `shell.openExternal`; only the local app origin is allowed in-window.
- A single-instance lock keeps repeat launches focused on the existing app window.

Important packaging details in `package.json`:

- `main`: `electron/main.mjs`
- `build.extraResources` copies:
  - `.next/standalone` to `next-server`, excluding `node_modules`.
  - `.next/standalone/node_modules` to `next-server/node_modules`.
  - `.next/static` to `next-server/.next/static`.
  - `public` to `next-server/public`.
- `win.signAndEditExecutable` is `false` because this Windows environment failed to unpack electron-builder signing helpers due to symlink privileges.
- The desktop output is a Windows portable executable named `MUXEL.exe`.

Known Electron packaging trap:

If the packaged app opens an error dialog or cannot start, check that this exists:

```text
dist/win-unpacked/resources/next-server/node_modules/next
```

If it is missing, the standalone dependencies were not copied and `server.js` cannot `require("next")`.

Known Windows signing trap:

Electron-builder may fail while extracting `winCodeSign` with an error like:

```text
Cannot create symbolic link : A required privilege is not held by the client.
```

Do not force admin/system changes casually. The current workaround is `signAndEditExecutable: false`, which builds an unsigned portable exe. Unsigned apps may trigger Windows SmartScreen on some machines.

## Editor Data Model

Types live in:

```text
src/lib/editor-types.ts
```

Main concepts:

- `BlockType`: `paragraph`, `h1`, `h2`, `h3`, `bullet_list`, `numbered_list`, `quote`, `divider`, `code`, `callout`.
- `Block`: `id`, `type`, `content`, `children`, `parentId`, optional `properties`.
- `PageState`: `id`, `title`, `coverImage`, `icon`, `blocks`, `rootBlocks`.
- `FocusRequest`: target block and `start`/`end` focus position.

State lives in:

```text
src/store/editor-store.ts
```

The store owns:

- Page title, icon, cover image.
- Blocks by id.
- Root block order.
- Active block id.
- Focus requests.
- Selected block ids.
- Undo/redo history.

Important helpers:

- `createHistorySnapshot`
- `pushHistory`
- `restoreHistorySnapshot`
- `cloneBlocks`
- `collectSubtreeIds`
- `cloneSubtree`
- `getSiblingIds`
- `replaceSiblingIds`

Undo/redo:

- Store-level, not Tiptap-level.
- `StarterKit` has Tiptap undo disabled with `undoRedo: false`.
- History limit is `100`.
- Text/title updates merge within `TEXT_HISTORY_MERGE_MS = 800`.
- Structural changes push history immediately.

Do not re-enable Tiptap native undo without redesigning history. It will conflict with cross-block and store-level undo behavior.

## Block Utilities

Utility file:

```text
src/lib/block-utils.ts
```

Important constants/functions:

- `EMPTY_BLOCK_HTML = "<p></p>"`
- `SLASH_COMMANDS`
- `blockSupportsText`
- `isListBlock`
- `blockIsEmpty`
- `blockHasDraftContent`
- `stripHtml`
- `stripHtmlPreservingWhitespace`
- `extractInlineHtml`
- `wrapInlineHtml`
- `mergeInlineHtml`
- `sanitizeContentForBlockType`
- `placeholderForBlockType`
- `flattenBlockIds`
- `getPreviousVisibleBlockId`
- `getSiblingIndex`
- `getDepth`

Whitespace caution:

- `blockIsEmpty` trims text and is used to decide whether a block is logically empty.
- `blockHasDraftContent` preserves whitespace and is used for draft/placeholder behavior.
- Do not casually replace these with a single helper. Empty blocks, whitespace-only blocks, and placeholder visibility have different semantics.

## Main Editor Components

### `src/components/editor/muxel-editor-page.tsx`

Top-level editor page. Renders `PageHeader` and `BlockList`.

Clicking empty space below content can add a block below the active/contentful block.

### `src/components/editor/page-header.tsx`

Controls:

- Page title contenteditable.
- Add/remove icon.
- Add/remove cover.

Title shortcuts:

- Enter focuses the first block.
- Ctrl/Cmd+Z uses store undo.
- Ctrl+Y and Ctrl/Cmd+Shift+Z use store redo.

Important: title is not Tiptap. Keep it synchronized via `textContent` and the store.

### `src/components/editor/block-list.tsx`

This is the most sensitive editor file.

Responsibilities:

- Renders all blocks in flattened tree order.
- Sets up dnd-kit for block drag/drop.
- Implements custom cross-block text selection.
- Tracks selected block ids.
- Paints custom text-only selection highlight rects.
- Handles copy for custom selection.
- Handles deleting all blocks when the full document is selected.

Selection design:

- Native browser selection is used for normal same-block selections when possible.
- Cross-block selection uses custom `Range` calculations and overlay rectangles.
- The overlay is text-only, not full-block selection.
- Selection chrome such as toolbar/menus/drag handles is marked with `data-editor-selection-chrome` and `.muxel-selection-chrome` so it does not become selected/highlighted.
- Empty blocks and placeholder-only blocks should not count as selected text blocks unless they contain real selected non-whitespace text.

Critical selection classes in `globals.css`:

```css
.muxel-selection-chrome
body.muxel-cross-block-selecting
```

Do not remove these unless the whole selection model is replaced.

Known selection edge cases to test after changes:

- Drag-select from bottom text block up to top text block.
- Drag-select top to bottom with empty blocks in between.
- Hold left mouse button after selecting and move slightly; highlight should not flicker.
- Open the block context menu while text is selected; menu text should not be highlighted.
- Selection that crosses an empty block should not turn that empty block into `Heading 1` or another type on bulk transform.
- Copy after custom selection should copy the selected text, not chrome/menu text.

### `src/components/editor/block-wrapper.tsx`

Wraps each block with:

- dnd-kit sortable node.
- Plus button.
- Drag/format grip.
- Context menu.

Important implementation details:

- The menu is portaled to `document.body`.
- Menu and toolbar-ish chrome use `data-editor-selection-chrome="true"` and `.muxel-selection-chrome`.
- Drag and click on the grip are disambiguated by pointer movement distance.
- Bulk type changes apply to selected block ids only when the clicked block is among the selected blocks.

### `src/components/editor/editor-block.tsx`

This is the Tiptap editor for a single block. It is another sensitive file.

Important behavior:

- Uses `useEditor` with `immediatelyRender: false`.
- Disables unsupported StarterKit pieces and Tiptap undo history.
- Keeps each block as a small Tiptap editor instance.
- Syncs content to Zustand on `onUpdate`.
- Applies markdown shortcuts like `# `, `## `, `- `, `1. `, `> `, and triple backticks.
- Shows placeholders only when the block is active and empty.
- Handles slash command menu positioning and keyboard navigation.
- Handles floating formatting toolbar.

Enter behavior:

- Plain Enter escapes current block, creates a new block below, and focuses it.
- Shift+Enter or Alt+Enter inserts a hard break inside the current block.
- Ctrl/Cmd+Enter also creates a new block below.
- Empty list block + Enter converts to paragraph.

Focus handoff after Enter is intentionally robust:

- Uses `flushSync` when adding the block.
- Maintains a `registeredEditors` map from block id to Tiptap editor instance.
- Calls `focusBlockWhenReady` to focus the new block as soon as its Tiptap instance exists.
- `focusEditorInstance` directly focuses both `editor.view.dom` and `editor.view`, then calls `editor.commands.focus`.

Do not simplify this unless you re-test fast typing after Enter. A previous bug caused immediate text after Enter to append to the old block.

Keyboard shortcuts:

- Ctrl/Cmd+Z: store undo.
- Ctrl+Y: store redo.
- Ctrl/Cmd+Shift+Z: store redo.
- Backspace at start: delete empty block or merge into previous block.
- Tab/Shift+Tab: indent/outdent.

Placeholder behavior:

- Placeholder should appear only on the active block.
- Whitespace-only content is treated carefully; check `blockHasDraftContent`.

### `floating-formatting-toolbar.tsx`

Floating inline formatting toolbar for a Tiptap selection.

### `slash-command-menu.tsx`

Slash command menu for block type changes.

## Styling And Font

Global styling:

```text
src/app/globals.css
```

Font:

- JetBrains Mono is loaded in `src/app/layout.tsx`.
- CSS variable: `--font-jetbrains-mono`.
- Tailwind theme maps `--font-sans` to JetBrains Mono.
- Body font family is JetBrains Mono fallback monospace.

Selection color:

```css
::selection {
  background: rgba(116, 182, 255, 0.58);
}
```

The custom overlay uses the same blue-ish selection background.

## Backend Readiness

The current Electron strategy preserves Next as the app server. This is good for adding a backend later.

Recommended future backend paths:

- Supabase client from client components for auth/simple CRUD.
- Next route handlers/server actions for API boundaries.
- Postgres via server-side code only, not from Electron renderer.
- Keep secrets out of client components and out of Electron renderer.

Do not put database credentials in:

- React client components.
- Zustand store.
- Browser localStorage.
- Electron renderer.
- Public environment variables.

Use server-only environment variables and Next route handlers/server actions when introducing privileged database access.

## Dependency And Audit Notes

Current npm audit note:

- `npm audit --omit=dev` reports 2 moderate vulnerabilities through Next's PostCSS dependency.
- The suggested `npm audit fix --force` would install a breaking old Next version (`next@9.3.3`) according to npm's output.
- Do not run `npm audit fix --force` blindly.

If updating Next, read the local Next docs first and test both web and desktop packaging.

## Git And Generated Files

Generated artifacts should remain ignored:

- `.next/`
- `dist/`
- `node_modules/`
- build outputs

`dist/MUXEL.exe` is a deliverable but not normally committed.

If `.codex/next-dev.*.log` changes during local dev, treat those as local tool logs, not product code.

## Common Gotchas

### `rg` May Fail On This Machine

`rg` has previously failed with `Access is denied`. If that happens, use PowerShell-native commands like:

```powershell
Get-ChildItem -Recurse
Select-String
Get-Content -Raw
```

### Linting Generated Files

If `npm run lint` starts reporting thousands of errors under `dist/` or `.next/`, ensure `eslint.config.mjs` ignores generated folders.

Current ignore includes:

```js
".next/**"
"out/**"
"build/**"
"dist/**"
"next-env.d.ts"
```

### Desktop Build Is Not Hot Reload

Changes to source are visible immediately only in the web dev server. The desktop exe must be rebuilt:

```powershell
npm run desktop:build
```

### Packaged App Uses Temp Extraction

The portable exe extracts to a temp folder when launched. Process paths may look like:

```text
C:\Users\User\AppData\Local\Temp\...\MUXEL.exe
```

That is normal for electron-builder portable output.

### Unsigned Executable

The current `.exe` is unsigned. Windows SmartScreen warnings are possible. This is expected until proper signing is configured.

### Electron Security

Do not enable `nodeIntegration` in the renderer. Do not disable `webSecurity`. Do not expose Node APIs to the editor unless a preload/IPC design is intentionally reviewed.

### External Links

Electron currently opens external URLs in the system browser and keeps only the app's local origin inside the BrowserWindow. Preserve this security posture.

## QA Checklist For Editor Changes

Run these after any editor behavior change:

1. Type text in the first block.
2. Press Enter and immediately type again; the second text must land in the new block.
3. Press Shift+Enter; it should create a line break inside the same block.
4. Ctrl/Cmd+Z should undo block text/structure.
5. Ctrl+Y and Ctrl/Cmd+Shift+Z should redo.
6. Backspace at start of non-first empty block should delete it and focus previous block.
7. Backspace at start of non-empty block should merge into previous block.
8. Slash command `/` should open only in the active block.
9. Placeholder should appear only in the active empty block.
10. Drag block handles with line breaks/spaces in block text; ordering should remain predictable.
11. Cross-block text selection should highlight only text, not whole blocks.
12. Cross-block selection with empty blocks between text blocks should still select all real text.
13. Holding mouse down after selection should not flicker or deselect.
14. Context menu opened during text selection should not become highlighted.
15. Bulk "Turn Into" should apply only to blocks with real selected text, not empty placeholder blocks.

## QA Checklist For Desktop Builds

After packaging:

1. Confirm the file exists:

```powershell
Get-Item dist\MUXEL.exe
```

2. Launch with a deterministic QA port:

```powershell
$env:MUXEL_PORT = '39571'
Start-Process -FilePath (Resolve-Path 'dist\MUXEL.exe').Path
Remove-Item Env:\MUXEL_PORT -ErrorAction SilentlyContinue
```

3. Probe the local server:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:39571'
```

Expected:

- HTTP `200`.
- HTML includes the app shell.
- Browser title is `Muxel Editor`.

4. Confirm dependency copy if startup fails:

```powershell
Test-Path dist\win-unpacked\resources\next-server\node_modules\next
```

5. Smoke test editor behavior.

6. Stop test processes:

```powershell
Get-Process MUXEL -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Best Practices For Future Agents

- Make small, targeted edits.
- Use `apply_patch` for manual code edits.
- Do not revert user changes.
- Read code before changing it; this editor has lots of interaction coupling.
- After source changes, run `npm run lint` and `npm run build`.
- For Electron/package-affecting changes, run `npm run desktop:build` and launch the real exe.
- Prefer testing in the browser for fast iteration, then verify packaged exe for release.
- Keep web and desktop using the same Next app source. Avoid duplicating UI logic in Electron.
- Preserve store-level undo/redo unless intentionally redesigning history.
- Preserve the custom cross-block selection model unless rewriting and stress-testing it thoroughly.
- Preserve secure Electron defaults.
- Do not run destructive commands like `git reset --hard` unless the user explicitly asks.

## Current Deliverable

The latest tested desktop executable is:

```text
dist/MUXEL.exe
```

It was verified by launching the packaged executable, probing its bundled local server, loading the editor UI, typing into blocks, pressing Enter to create a new block, and undoing text.
