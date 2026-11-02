import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/server.js";
import { generateCandidates } from "../src/ai.js";

test("health endpoint responds", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: "xpath-agent-backend" });
  } finally { server.close(); }
});

test("locator endpoint rejects missing target", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/locators`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ elements: [] })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /target is required/);
  } finally { server.close(); }
});

test("AI helper fails clearly when API key is absent", async () => {
  await assert.rejects(
    generateCandidates({ target: "login", page: {}, elements: [] }, { AI_API_KEY: "" }),
    /AI_API_KEY is not configured/
  );
});

test("locator endpoint rejects oversized element summaries", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/locators`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "login", elements: Array.from({ length: 101 }, () => ({})) })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /at most 100/);
  } finally { server.close(); }
});

test("AI helper rejects malformed model JSON", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, async json() { return { choices: [{ message: { content: "not json" } }] }; } });
  try {
    await assert.rejects(
      generateCandidates({ target: "login", page: {}, elements: [] }, { AI_API_KEY: "test" }),
      /Model did not return a JSON object/
    );
  } finally { global.fetch = originalFetch; }
});

test("AI helper reports provider timeouts", async () => {
  const originalFetch = global.fetch;
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  try {
    await assert.rejects(
      generateCandidates({ target: "login", page: {}, elements: [] }, { AI_API_KEY: "test", AI_TIMEOUT_MS: "5" }),
      /timed out after 5ms/
    );
  } finally { global.fetch = originalFetch; }
});

test("AI helper supports native Google Gemini generateContent", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    const content = requests.length === 1
      ? '{"target_tag":"button","text_cues":["login"],"attribute_cues":[],"reason":"match"}'
      : '{"candidates":[{"strategy":"test id","kind":"css","value":"[data-testid=login]"}]}'
    return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: content }] } }] }; } };
  };
  try {
    const result = await generateCandidates(
      { target: "login", page: {}, elements: [] },
      {
        AI_PROVIDER: "google",
        AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        AI_API_KEY: "test-key",
        AI_MODEL: "gemini-test"
      }
    );
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /\/models\/gemini-test:generateContent\?key=test-key/);
    assert.equal(requests[0].body.generationConfig.responseMimeType, "application/json");
    assert.equal(result.candidates[0].kind, "css");
  } finally { global.fetch = originalFetch; }
});
