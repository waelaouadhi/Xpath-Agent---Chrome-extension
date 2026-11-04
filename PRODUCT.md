# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

QA engineers and test automation engineers inspecting web applications, selecting DOM elements, and creating maintainable locators for automated tests.

## Product Purpose

XPath Agent is a Chrome/Brave extension that helps users inspect live DOM elements, compare locator strategies, validate selectors against the current page, and reuse the result in automated tests. Success means producing an evidence-backed locator that is understandable, easy to review, and ready to export.

## Positioning

XPath Agent ranks XPath/CSS candidates using live DOM evidence, validates match count and selected-element identity, explains stability tradeoffs, and exports directly to Playwright or Selenium.

## Operating Context

Users open the extension side panel while working on a regular HTTP or HTTPS webpage. They can pick an element from the page, review its attributes and generated locator candidates, highlight matches, and copy a locator or framework-specific test snippet. An optional local Node backend can provide Gemini suggestions when the user explicitly asks for them.

## Capabilities and Constraints

- Manifest V3 Chrome/Brave side-panel extension.
- Local locator generation and validation work without an API key.
- Generates and validates XPath and CSS candidates against the live DOM.
- Supports Playwright JavaScript and Selenium Python export snippets.
- AI assistance is optional, uses a configurable backend URL, and is requested explicitly.
- AI requests send only a concise DOM summary and target description to the configured backend.
- The product must not make or imply reliability guarantees that the evidence cannot support.
- Browser-restricted pages, cross-origin iframes, and closed shadow roots are out of scope.

## Evidence on Hand

- `README.md` documents the product purpose, architecture, workflows, limitations, and setup.
- `extension/sidepanel.html` contains the side-panel workbench and user-facing terminology.
- `extension/core/locator-engine.js` implements candidate generation, validation, ranking, and exports.
- `extension/assets/xpath-agent-logo.png` is an existing product asset.
- `extension/tests/locator-engine.test.cjs` and `backend/test/server.test.js` provide automated coverage for core and backend behavior.
- `docs/QA-TEST-PLAN.md` records high-risk locator validation cases.
- No customer testimonials, production benchmarks, or external reliability evidence are present; future work must not fabricate them.

## Product Principles

- Prefer live evidence over selector folklore.
- Make locator tradeoffs visible and reviewable.
- Keep the useful local workflow independent of AI availability.
- Preserve user control over page access and external data sharing.
- Export practical output without overstating certainty.

