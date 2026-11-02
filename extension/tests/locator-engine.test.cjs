const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core/locator-engine.js");

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
