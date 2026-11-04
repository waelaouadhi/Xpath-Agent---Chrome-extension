const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core/locator-engine.js");
const evidence = require("../core/evidence-state.js");

test("xpathLiteral handles simple strings", () => {
  assert.equal(core.xpathLiteral("hello"), "'hello'");
});

test("xpathLiteral handles both quote types", () => {
  const literal = core.xpathLiteral(`it's "ready"`);
  assert.match(literal, /^concat\(/);
});

test("normalizeText collapses whitespace", () => {
  assert.equal(core.normalizeText("  Log\n  in   "), "Log in");
});

test("Playwright export uses xpath prefix for XPath selectors", () => {
  const result = core.exportPlaywright("//button[@id='login']", "xpath");
  assert.match(result, /page\.locator/);
  assert.match(result, /xpath=/);
  assert.match(result, /toHaveCount\(1\)/);
});

test("Playwright export leaves CSS selector as CSS", () => {
  const result = core.exportPlaywright("#login", "css");
  assert.match(result, /page\.locator\("#login"\)/);
});

test("Selenium export chooses the correct By strategy", () => {
  assert.match(core.exportSelenium("//button", "xpath"), /By\.XPATH/);
  assert.match(core.exportSelenium("#login", "css"), /By\.CSS_SELECTOR/);
});

test("semantic export uses test ID and role APIs when metadata is available", () => {
  assert.match(core.exportPlaywright("//*[@data-testid='login']", "xpath", { exportType: "testid", exportValue: "login" }), /getByTestId\("login"\)/);
  assert.match(core.exportPlaywright("//*[@role='button']", "xpath", { exportType: "role", exportRole: "button", exportValue: "Sign in" }), /getByRole\("button", \{ name: "Sign in" \}\)/);
  assert.match(core.exportPlaywright("//*[@id='login']", "xpath", { exportType: "id", exportSelector: "#login" }), /page\.locator\("#login"\)/);
  assert.match(core.exportSelenium("//*[@id='login']", "xpath", { exportType: "id", exportValue: "login" }), /By\.ID/);
});

test("candidate generation tolerates missing element", () => {
  assert.deepEqual(core.candidatesForElement(null), []);
});

test("candidate generation labels ID, Name, and test attributes and escapes CSS values", () => {
  const el = {
    tagName: "INPUT",
    attributes: [],
    parentElement: null,
    getAttribute(name) {
      return {
        id: "email.field",
        name: "user[primary]",
        "data-testid": "email\"field"
      }[name] || null;
    },
    innerText: "",
    textContent: ""
  };
  const candidates = core.candidatesForElement(el);
  assert.ok(candidates.some((item) => item.strategy === "ID (CSS)" && item.value === "#email\\.field"));
  assert.ok(candidates.some((item) => item.strategy === "Name" && item.value.includes("user[primary]")));
  assert.ok(candidates.some((item) => item.strategy === "CSS test attribute: data-testid" && item.value.includes('email\\"field')));
});

test("inspectElement reports tag, text and attributes", () => {
  const el = {
    tagName: "BUTTON",
    innerText: "  Sign in ",
    attributes: [{ name: "data-testid", value: "login" }],
    getAttribute(name) { return name === "data-testid" ? "login" : null; },
    parentElement: null
  };
  const result = core.inspectElement(el);
  assert.equal(result.tag, "button");
  assert.equal(result.text, "Sign in");
  assert.equal(result.attributes["data-testid"], "login");
  assert.ok(result.candidates.some((x) => x.value.includes("data-testid")));
});

test("validateCandidates reports invalid selectors safely", () => {
  global.XPathResult = { ORDERED_NODE_SNAPSHOT_TYPE: 7 };
  const doc = {
    querySelectorAll(selector) {
      if (selector === "[") throw new Error("invalid CSS");
      return [];
    },
    evaluate() { throw new Error("invalid XPath"); }
  };
  const [result] = core.validateCandidates(doc, [{ strategy: "bad", kind: "css", value: "[" }]);
  assert.equal(result.valid, false);
  assert.equal(result.status, "invalid");
  assert.equal(result.count, 0);
});

test("validateCandidates reports target identity and stable ranking", () => {
  global.XPathResult = { ORDERED_NODE_SNAPSHOT_TYPE: 7 };
  const target = { id: "login" };
  const doc = {
    querySelectorAll(selector) {
      return selector === "#login" ? [target] : [target, { id: "other" }];
    },
    evaluate() { return { snapshotLength: 0, snapshotItem() { return null; } }; }
  };
  const results = core.validateCandidates(doc, [
    { strategy: "Text contains", kind: "css", value: ".button" },
    { strategy: "CSS ID", kind: "css", value: "#login" }
  ], target);
  assert.equal(results[0].value, "#login");
  assert.equal(results[0].targetMatch, true);
  assert.equal(results[0].unique, true);
  assert.match(results[0].explanation, /stability score/);
});

test("validateCandidates distinguishes duplicate matches, wrong targets, and unsupported kinds", () => {
  global.XPathResult = { ORDERED_NODE_SNAPSHOT_TYPE: 7 };
  const target = { id: "selected" };
  const other = { id: "other" };
  const doc = {
    querySelectorAll(selector) {
      if (selector === "#duplicate") return [target, other];
      if (selector === "#other") return [other];
      return [];
    },
    evaluate() { return { snapshotLength: 0, snapshotItem() { return null; } }; }
  };
  const results = core.validateCandidates(doc, [
    { strategy: "ID (CSS)", kind: "css", value: "#duplicate" },
    { strategy: "ID (CSS)", kind: "css", value: "#other" },
    { strategy: "Unknown", kind: "regex", value: "selected" }
  ], target);
  const duplicate = results.find((item) => item.value === "#duplicate");
  const wrongTarget = results.find((item) => item.value === "#other");
  const unsupported = results.find((item) => item.kind === "regex");
  assert.equal(duplicate.status, "ambiguous");
  assert.equal(duplicate.unique, false);
  assert.equal(duplicate.targetMatch, true);
  assert.equal(wrongTarget.status, "unique");
  assert.equal(wrongTarget.targetMatch, false);
  assert.equal(unsupported.status, "invalid");
  assert.equal(unsupported.validationCompleted, true);
});

test("recommendation presentation exposes match count and selected-element identity", () => {
  assert.equal(core.formatMatchCount({ validationCompleted: true, count: 1 }), "1 match (unique)");
  assert.equal(core.formatMatchCount({ validationCompleted: true, count: 3 }), "3 matches");
  assert.equal(core.formatTargetMatch({ targetMatch: true }), "Matches selected element");
  assert.equal(core.formatTargetMatch({ targetMatch: false }), "Does not match selected element");
  assert.equal(core.formatTargetMatch({ targetMatch: null }), "Selected element not checked");
});

test("recommendation presentation handles missing and invalid scores honestly", () => {
  assert.equal(core.formatHeuristicScore({ score: 82 }), "Heuristic comparison score: 82/100");
  assert.equal(core.formatHeuristicScore({}), "Heuristic comparison score unavailable");
  assert.equal(core.formatMatchCount({ status: "invalid", validationCompleted: true, count: 0 }), "Invalid selector");
});

test("recommendation guidance covers core locator strategies", () => {
  assert.match(core.strategyGuidance("Test ID: data-testid"), /automation/);
  assert.match(core.strategyGuidance("ID (CSS)"), /ID/);
  assert.match(core.strategyGuidance("Name"), /form control/);
  assert.match(core.strategyGuidance("Accessible role and name"), /semantic/);
  assert.match(core.strategyGuidance("Exact text"), /localization/);
  assert.match(core.strategyGuidance("Last resort absolute XPath"), /fragile/);
});

test("automatic selection is explicitly provisional", () => {
  assert.match(core.selectionNotice(true), /Provisional selection/);
  assert.match(core.selectionNotice(true), /before exporting/);
  assert.equal(core.selectionNotice(false), "Selected locator for export.");
});

test("evidence is current after successful validation and export remains available", () => {
  const page = { identity: "tab-1:https://example.test/login", hostname: "example.test" };
  let state = evidence.createState();
  state = evidence.markValidated(state, page);
  assert.equal(evidence.isCurrent(state, page), true);
  assert.equal(state.hostname, "example.test");
  assert.ok(state.validatedAt);
});

test("refresh invalidates previous evidence while preserving page metadata", () => {
  const page = { identity: "tab-1:https://example.test/login", hostname: "example.test" };
  let state = evidence.markValidated(evidence.createState(), page);
  state = evidence.markStale(state);
  assert.equal(evidence.isCurrent(state, page), false);
  assert.equal(state.stale, true);
  assert.equal(state.hostname, "example.test");
});

test("navigation invalidates evidence for the new page identity", () => {
  const firstPage = { identity: "tab-1:https://example.test/login", hostname: "example.test" };
  const nextPage = { identity: "tab-1:https://example.test/account", hostname: "example.test" };
  let state = evidence.markValidated(evidence.createState(), firstPage);
  state = evidence.markStale(state);
  assert.equal(evidence.isCurrent(state, nextPage), false);
});

test("active-tab changes cannot reuse evidence from another tab", () => {
  const firstPage = { identity: "tab-1:https://example.test/login", hostname: "example.test" };
  const otherTab = { identity: "tab-2:https://example.test/login", hostname: "example.test" };
  const state = evidence.markValidated(evidence.createState(), firstPage);
  assert.equal(evidence.isCurrent(state, otherTab), false);
});

test("successful revalidation restores export eligibility", () => {
  const page = { identity: "tab-1:https://example.test/login", hostname: "example.test" };
  let state = evidence.markValidated(evidence.createState(), page);
  state = evidence.markStale(state);
  state = evidence.markValidated(state, page);
  assert.equal(state.stale, false);
  assert.equal(evidence.isCurrent(state, page), true);
});

test("failed revalidation keeps export eligibility disabled", () => {
  const page = { identity: "tab-1:https://example.test/login", hostname: "example.test" };
  const state = evidence.markStale(evidence.markValidated(evidence.createState(), page));
  assert.equal(evidence.isCurrent(state, page), false);
  assert.equal(state.stale, true);
});

test("stale validation responses cannot become current for a newer page", () => {
  const firstPage = { identity: "tab-1:https://example.test/login", hostname: "example.test" };
  const nextPage = { identity: "tab-1:https://example.test/account", hostname: "example.test" };
  let state = evidence.markValidated(evidence.createState(), firstPage);
  const requestPageIdentity = state.pageIdentity;
  state = evidence.markStale(state);
  state = evidence.markValidated(state, nextPage);
  assert.notEqual(requestPageIdentity, state.pageIdentity);
  assert.equal(evidence.isCurrent(state, firstPage), false);
  assert.equal(evidence.isCurrent(state, nextPage), true);
});

test("validation guard rejects an older async response after evidence changes", () => {
  const firstPage = { identity: "tab-1:https://example.test/login", hostname: "example.test" };
  const nextPage = { identity: "tab-1:https://example.test/account", hostname: "example.test" };
  let state = evidence.markValidated(evidence.createState(), firstPage);
  const token = evidence.createValidationToken(state, firstPage.identity, 1);
  state = evidence.markStale(state);
  state = evidence.markValidated(state, nextPage);
  assert.equal(evidence.isValidationCurrent(token, state, nextPage.identity, 2), false);
});

test("AI request context accepts a response on the original page", () => {
  const page = { identity: "tab-1:https://example.test/login", tabId: 1 };
  const state = evidence.createState();
  const context = evidence.createRequestContext(1, page, state, "target-a", "login");
  assert.equal(evidence.isRequestCurrent(context, 1, page, state, "target-a", "login"), true);
});

test("AI request context rejects active-tab changes", () => {
  const page = { identity: "tab-1:https://example.test/login", tabId: 1 };
  const otherTab = { identity: "tab-2:https://example.test/login", tabId: 2 };
  const state = evidence.createState();
  const context = evidence.createRequestContext(1, page, state, "target-a", "login");
  assert.equal(evidence.isRequestCurrent(context, 1, otherTab, state, "target-a", "login"), false);
});

test("AI request context rejects navigation and evidence revision changes", () => {
  const page = { identity: "tab-1:https://example.test/login", tabId: 1 };
  const nextPage = { identity: "tab-1:https://example.test/account", tabId: 1 };
  let state = evidence.createState();
  const context = evidence.createRequestContext(1, page, state, "target-a", "login");
  state = evidence.markStale(state);
  assert.equal(evidence.isRequestCurrent(context, 1, nextPage, state, "target-a", "login"), false);
  assert.equal(evidence.isRequestCurrent(context, 1, page, state, "target-a", "login"), false);
});

test("newer AI request wins when responses arrive out of order", () => {
  const page = { identity: "tab-1:https://example.test/login", tabId: 1 };
  const state = evidence.createState();
  const older = evidence.createRequestContext(1, page, state, null, "login");
  const newer = evidence.createRequestContext(2, page, state, null, "account");
  assert.equal(evidence.isRequestCurrent(older, 2, page, state, null, "account"), false);
  assert.equal(evidence.isRequestCurrent(newer, 2, page, state, null, "account"), true);
});

test("AI request context rejects target changes and stale failures", () => {
  const page = { identity: "tab-1:https://example.test/login", tabId: 1 };
  const state = evidence.createState();
  const context = evidence.createRequestContext(1, page, state, "target-a", "login");
  assert.equal(evidence.isRequestCurrent(context, 1, page, state, "target-b", "login"), false);
  assert.equal(evidence.isRequestCurrent(context, 1, page, evidence.markStale(state), "target-a", "login"), false);
});
