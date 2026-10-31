# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

KISS Translator: bilingual web page translation delivered as a browser extension (Chrome/Edge/Firefox/Thunderbird), a userscript (Tampermonkey/Violentmonkey, incl. an iOS Safari variant), and a static web page (homepage + hosted options page). All three are built from the same `src/` tree. `package.json` is the only version source. Work happens on `dev`; `master` is release-only.

## Commands

Node >= 20, pnpm >= 9.

```sh
pnpm start                     # web dev server (localhost:3000, REACT_APP_CLIENT=web)
pnpm start:userscript          # userscript dev mode
pnpm build:chrome              # build/chrome (also base for edge)
pnpm build:safari-output       # build/safari output (then packaged by build:safari)
pnpm build:firefox             # build/firefox
pnpm build:thunderbird
pnpm build:web                 # hosted site for GitHub Pages (see target note)
pnpm build:userscript-ios      # iOS Safari userscript
pnpm build:homepage            # static homepage (web client, homepage-only entry)
pnpm build:rules               # rules JSON via src/rules.js
pnpm check:pr                  # pre-PR gate: format + web + iOS userscript + rules + chrome (CI=true, warnings are errors)
pnpm build+zip                 # full build of all targets + zip (what CI release runs)
```

Note on targets: `src/scripts/build-task.mjs` maps `--target=web` to `REACT_APP_CLIENT=userscript` (hosted userscript web build deployed to GitHub Pages) and `--target=homepage` to `REACT_APP_CLIENT=web` with `REACT_APP_WEB_APP=homepage`. `--target=edge` just copies `build/chrome`; `--target=edge-dev` builds as chrome with the file bridge enabled in dev. So don't infer the client type from the target name — read `build-task.mjs`.

Versioning/release: `pnpm version:patch|minor|major`, `pnpm version:set -- X.Y.Z` (auto-syncs `.env` and all `public/manifest*.json`); `pnpm sync-version` re-syncs after a manual `package.json` edit. Release flow is documented in `VERSION_MANAGEMENT.md` and automated by the `.agents/skills/release-kiss-translator` skill: bump on `dev` → update CHANGELOG in Chinese → `pnpm build+zip` → PR `dev`→`master` titled `Release vX` → tag `vX` on `master` (pushing the tag triggers `.github/workflows/release.yml`, which builds, deploys `build/web` to GitHub Pages and creates the release from the top CHANGELOG section).

Tests:

```sh
pnpm test -- --watchAll=false                          # full Jest suite (CRA react-app-rewired; watch mode by default)
pnpm test -- --watchAll=false src/libs/translator.test.js   # single file
pnpm test -- --watchAll=false -t "test name"           # by name
pnpm test:local-ai                                     # Vitest for src/localAi (Jest ignores these)
pnpm test:build                                        # node --test bundle build tests
pnpm test:file-translation-build
pnpm test:subtitle-segmentation
pnpm test:terms
```

Jest (via `react-scripts`) picks up `*.test.js` co-located next to sources; `src/localAi/**` tests are `.ts` and run only under Vitest. `tsconfig.json` excludes `src/localAi/core/__tests__`. The codebase is JS with JSDoc; TypeScript is only used in `src/localAi` and `src/providers/contracts.ts`.

## Architecture

### One source tree, many runtime contexts

Build-time `process.env.REACT_APP_CLIENT` (`src/config/client.js`, re-exported as `client`/`isExt`/`isGm`/`isWeb`/`isFirefox` from `src/libs/client.js`) selects the webpack config in `config-overrides.js`:

- `chrome`/`firefox`/`thunderbird` → `extWebpack`: multi-entry extension bundle (`popup`, `options`, `background`, `content`, `injector-subtitle`, `injector-shadowroot`, `file-bridge`) with fixed output filenames matching `public/manifest*.json`.
- `userscript` → `userscriptWebpack`: single-chunk build with the `==UserScript==` banner and `@connect` list injected by Terser.
- `web` → `webWebpack`: hosted site; with `REACT_APP_WEB_APP=homepage` only the homepage entry is emitted, otherwise the options page (which talks to the userscript via a GM bridge in `src/common.js`).

`src/scripts/build-task.mjs` orchestrates each target (env vars, `BUILD_PATH`, offscreen/local-AI asset copying, manifest post-processing).

At runtime, in-page contexts mark themselves with `globalThis.__KISS_CONTEXT__` (`content`, `options`, `background`, …), read by `getContext()` in `src/libs/browser.js`. Code frequently branches on both axes (`isExt` vs `isGm`, and context within extension).

### Entry points

- `src/content.js` → `run()` in `src/common.js`: the in-page translator (rule matching, blacklist, FAB, subtitle startup, `TranslatorManager`).
- `src/background.js`: service worker — message router between content/options/popup, network fetch proxy (content sends fetches through background to escape page CSP/CORS), context menus, commands, separate window, screenshot/image translation, local-AI RPC host, HTTP cache.
- `src/options.js` / `src/popup.js`: React roots (`src/views/Options`, popup). All MUI.
- `src/userscript.js`: userscript bootstrap; `src/fileBridge.js`: iframe bridge used by file translation.

### Translation core (`src/libs/`)

- `translator.js` (~6k lines) + `translator.test.js` (~10k lines): DOM walking, text selection, rich-text node handling, batching, inserting bilingual nodes. This is where most web-page translation behavior lives.
- `translatorManager.js`: orchestrates a translation session (start/stop, settings, rules, APIs).
- `pool.js`, `batchQueue.js`, `request*.js`, `stream.js`: request scheduling, batching, streaming responses.
- `storage.js`, `storageState.js`, `storageTransactions.js`, `storageCoordination.js`, `sync.js`, `syncCrypto.js`: settings/rules/words persistence with versioned migrations (`config/setting.js` holds `CURRENT_SETTINGS_VERSION` and migration funcs) and WebDAV / KISS-Worker sync with encryption.

### Service/provider layer (`src/builtin-plugins/` + `src/providers/`)

All translation services are modeled as **plugins** (API v1), whether built in or installed:
- `src/builtin-plugins/` — native manifests for Baidu, Google, Microsoft, DeepL, OpenAI-compatible, Gemini, Claude, Ollama, Volcengine, Tencent, Yandex, Cloudflare, local AI, etc. Each declares services + capability descriptors (`capabilities.js`, `fields.js`, `presets.js`, `definitions.js`).
- `src/providers/` — the generic plugin engine: package install/upgrade/fingerprint/network scope (`package*.js`), declarative rules and script executors (`declarative*.js`, `scriptExecutor.js`, `scriptWorker.js`), invocation/runtime/host, scene adapters (`sceneAdapter.js`, `translationAdapter.js`), SDK and contract types. External plugins (from https://github.com/fishjar/kiss-translator-plugins) are ZIP/folder/repo imports installed at runtime; the repo only contains generic SDK tests here.
- Services are per-capability (translate, dictionary, subtitle segmentation, OCR, TTS, vision/layout, ASR) — see `src/config/serviceSelection.js`. When adding or changing a provider, touch the builtin manifest, its fields/capabilities, and the matching `*.test.js`.

### Settings UI (`src/views/`, `src/hooks/`)

Large React/MUI settings app with per-feature locale registration (`src/config/locales/*`, `i18n.*.js`) — new strings usually need to be registered there. Hooks in `src/hooks/` wrap storage, themes (M2/M3), API testing, sync, subtitle, etc.

### Local AI (`src/localAi/`)

In-browser inference (WebGPU/WASM via onnxruntime-web + transformers.js/wllama/paddleocr). Built separately with **Vite** (`vite.config.local-ai.ts`) into `.local-ai-build/` (workers: llm, llm-onnx, asr, tts, jev, doc, ocr; plus `offscreen.js`), then copied into `build/*/local-ai` by `build-task.mjs` via `src/scripts/local-ai-cache.mjs` (`pnpm build:local-ai` refreshes the cache; `build:chrome:clean` forces rebuild). At runtime `src/localAi/offscreen.ts` runs as an extension offscreen document and communicates via BroadcastChannel RPC (`runtime/rpc.ts`) with the background. Webpack resolves `runtimeManager` to `runtimeManager.webpack.js` (a stub) so extension UI bundles don't include in-page inference code. Tests use Vitest + fake-indexeddb.

### File translation (`src/fileTranslate.js`, `src/fileBridge.js`, `src/fileTranslation/`, `src/libs/pdf`, `epub`, `imageTranslate`)

A separate web app page (`public/file-translate.html`) runs in an iframe-free page context and talks to the extension background through `fileBridge.js` / `fileTranslation/protocol.js`. `pipelineCore.js` handles OCR → layout/formula → translation pipelines with result caching. Extension-only.

### Subtitles (`src/subtitle/`, `src/injectors/`, `src/injector-subtitle.js`)

Page-world injectors intercept platform caption requests (YouTube) and bridge data back; `BilingualSubtitleManager.js` renders merged bilingual captions; AI-based semantic segmentation lives in `src/subtitle/asr` / tests under `testdata/subtitle-samples`.

## Conventions

- Source comments, JSDoc, README, and CHANGELOG are in Chinese; expect Chinese doc comments and commit messages.
- Prettier is the formatter for `*.js/json/html` (`pnpm format`); `.prettierignore` excludes `public/`, `build/`, `package.json`, `node_modules`, `testdata/subtitle-samples`.
- Versions are never hand-edited in `.env` or `public/manifest*.json` — only `package.json` (+ `pnpm sync-version`).
- Features gated to desktop extensions (local AI, file translation, plugin install UI, clipboard auto-translate) should degrade or hide in userscript/web clients; check `isExt`/`isGm` before wiring entry points.
- Message names and command IDs live in `src/config/msg.js` — add constants there rather than inline strings.
