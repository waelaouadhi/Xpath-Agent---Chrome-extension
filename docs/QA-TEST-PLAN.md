# QA Test Plan — XPath Agent Chrome Extension

## Scope
Validate local locator generation, candidate validation, side-panel interaction, AI request boundaries, and export formatting.

## Risk-based coverage
| Risk | Test | Expected result |
|---|---|---|
| High | XPath string contains apostrophes and quotation marks | Correct XPath literal syntax is produced |
| High | Invalid XPath / invalid CSS candidate | Validation returns zero matches and does not crash |
| High | Candidate matches zero elements | UI reports no matches |
| High | Candidate matches multiple elements | UI marks selector ambiguous |
| High | AI backend is unavailable | UI reports a useful error; local features remain usable |
| High | API key missing | Backend returns 503 and a clear error |
| High | Page contains prompt-injection-like text | AI system instructions treat page content as untrusted |
| Medium | `data-testid` is available | Candidate generated from stable attribute |
| Medium | Candidate selected for Playwright | `page.locator()` export and count assertion are generated |
| Medium | Candidate selected for Selenium | `By.XPATH` / `By.CSS_SELECTOR` export is generated |
| Medium | Restricted Chrome page is active | Extension reports inability to inspect instead of crashing |
| Medium | Picker cancelled with Escape | Picker stops |
| Medium | Copy locator / code | Clipboard receives exact text |

## Exit criteria
- All Node unit/API tests pass.
- Manual smoke test passes on a local HTML fixture and a representative QA application.
- Every generated locator is validated against the live DOM before it is used in a test.
- AI-generated selectors remain suggestions until validated by the browser.

## Automated coverage in this repository

- `node --test extension/tests/*.test.cjs`: local generation, escaping, semantic exports, invalid selector handling, target identity, and ranking.
- `cd backend; npm test`: health endpoint, request validation, missing configuration, malformed model output, and provider timeout handling.

Browser integration scenarios remain manual: site permission approval/denial, normal-page picker selection, restricted-page messaging, repeated picker start/stop, clipboard behavior, and cross-browser Brave/Chrome behavior.
