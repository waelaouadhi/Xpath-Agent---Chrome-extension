# XPath Agent

XPath Agent is my personal QA automation engineering project. I am developing it as a Manifest V3 Chrome/Brave extension to help QA engineers inspect DOM elements, compare maintainable locator strategies, validate selectors against the live page, and reuse the result in Playwright or Selenium tests.

The current implementation includes a local locator engine, an optional Google Gemini backend, a side-panel workbench, framework exports, and automated tests for the locator engine and backend API.

> This is a starter implementation inspired by the two-stage XPath Agent concept. It is not a byte-for-byte port of the Feilian repository and does not claim to reproduce its internal prompts or evaluation results.

## Architecture

```text
Chrome Side Panel
   ├── Local locator engine (content script + shared core)
   ├── XPath/CSS validation against live DOM
   ├── Playwright / Selenium code export
  └── Optional AI request → Node backend → Google Gemini
```

## Requirements

- Google Chrome with Manifest V3 side panel support
- Node.js 20+ for the optional backend and tests
- A Google Gemini API key only if you want AI suggestions

## 1. Load the extension

1. Unzip the project.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the `extension/` folder.
5. Open a normal `http://` or `https://` webpage (not `chrome://...`, Brave internal pages, the Chrome Web Store, or another restricted page).
6. Click the extension icon, then use the side panel. Click **Pick element** and approve access for the current site when prompted.

The extension requests `activeTab`, `scripting`, `sidePanel`, and `clipboardWrite` permissions. Persistent `http`/`https` access is optional and requested only by the Pick action for the current site. Page inspection is triggered by an explicit user action. The AI backend host is configurable in the side panel and is not contacted unless you explicitly request an AI suggestion.

If access is denied, use the browser extension details page to allow access to the current site, then click **Pick element** again. Browser-internal pages cannot be inspected by extensions.

## 2. Use local mode

1. Open the side panel.
2. Enter a description such as `Login button`, or use **Pick element** and click an element in the page.
3. Select **Generate local locators**.
4. Review the ranked XPath/CSS candidates, match counts, target identity, and stability explanation.
5. Copy a selector or export code for Playwright or Selenium.

Local mode works without an API key.

### Locator validation and ranking

Every generated candidate is evaluated against the current document. The engine records whether evaluation completed, match count, uniqueness, and whether the result contains the selected element when a target is available. These are separate facts: a unique selector can still point to the wrong element, and a unique selector is not a guarantee of long-term stability.

The displayed heuristic score starts with a strategy weight, then applies deterministic evidence adjustments: unique matches receive a bonus, zero or multiple matches are penalized, selected-target matches receive a bonus, wrong-target matches receive a strong penalty, and invalid candidates score zero. Absolute XPath and text-based strategies also receive maintainability penalties in the base strategy score. The score is a comparison aid, not a reliability percentage.

## 3. Enable AI mode (optional)

Start the backend:

```bash
cd backend
# Create or edit the private .env file and set AI_API_KEY. The configuration below uses Google Gemini.
npm install
npm start
```

Default backend URL: `http://localhost:8787`.

Example `.env`:

```env
PORT=8787
AI_PROVIDER=google
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
AI_API_KEY=replace-with-your-gemini-api-key
AI_MODEL=gemini-flash-lite-latest
AI_THINKING_LEVEL=LOW
```

The backend accepts a concise DOM summary and target description. Gemini provider calls are limited to 120 seconds and use the configured thinking level for locator generation. It uses a two-stage flow:
1. Extract likely target cues from the supplied DOM summary.
2. Generate XPath and CSS candidates from those cues.

Do not send pages containing sensitive or confidential information to an external model. The backend limits request size, retries transient provider responses, and returns model output as suggestions; the extension independently validates selectors in the live page. The backend is intended for local development. Add authentication, rate limiting, HTTPS, origin restrictions, and organization-approved data handling before deploying it to a shared environment.

The backend uses Google's native Gemini `generateContent` API. Create a key in Google AI Studio and put it only in the private `.env` file. The extension does not receive or store the key.

## 4. Run tests

```bash
# Local locator core tests (no dependencies)
node --test extension/tests/*.test.cjs

# Backend tests
cd backend
npm install
npm test
```

## 5. Project layout

```text
extension/
  manifest.json
  service-worker.js
  sidepanel.html
  sidepanel.css
  sidepanel.js
  content.js
  core/locator-engine.js
  assets/xpath-agent-logo.png
  tests/locator-engine.test.cjs
backend/
  package.json
  .env
  src/server.js
  src/ai.js
  test/server.test.js
```

## Known limitations / next steps

- The picker currently works in the top-level document; cross-origin iframes and closed shadow roots are not traversed.
- Local generation ranks test IDs, IDs, accessible role/name metadata, labels, names, stable classes, and text, then reports match count, target identity, validity, and a stability score. It cannot guarantee stability across future application releases.
- XPath 1.0 is used because it is supported by browser `document.evaluate`.
- The AI endpoint is an optional development backend, not production-hardened.
- Browser UI automation tests were not run in this repository because Playwright/browser fixtures are not configured. Manual browser validation is still required.
- Chrome and Brave restricted pages cannot be inspected by extensions. Cross-origin iframes, closed shadow roots, and content inside them are not traversed.

## Architecture and access flow

```text
Side panel --user action--> optional site permission
  |                         |
  +-- runtime message --> service worker --scripting.executeScript--> content script
                                  |
                                  +--> locator engine / picker / live DOM validation
```

The service worker is the only extension component that injects page code. The content script owns picker state and DOM operations. The side panel renders state and exports validated candidates.
