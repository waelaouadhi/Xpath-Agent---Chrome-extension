(() => {
  const $ = (id) => document.getElementById(id);
  const core = window.XPathAgentCore;
  let selectedElement = null;
  let candidates = [];
  let selectedCandidate = null;

  const helpContent = {
    picker: {
      title: "Select an element",
      body: "Use the picker to capture one real DOM element from the page. XPath Agent prevents the page's normal click while selection is active.",
      steps: ["Click Select element and grant site access if requested.", "Hover over the target, then click it.", "Use Stop picking or Escape to cancel without selecting a target."]
    },
    target: {
      title: "Target description",
      body: "A short description helps Gemini suggest locators when you do not have a selected element. Local locators still require a picked element for exact target identity.",
      steps: ["Describe the target, such as Login button or Email field.", "Use Generate local locators after selecting an element.", "Use Ask Gemini for optional natural-language suggestions."]
    },
    inspector: {
      title: "Selected element",
      body: "This section shows facts captured from the selected DOM node. These details are evidence about the element, not a locator result.",
      steps: ["Check the tag, role, accessible name, and stable attributes.", "Expand View all attributes for the complete captured snapshot.", "Refresh page information if the tab changed."]
    },
    recommendations: {
      title: "Locator recommendations",
      body: "Candidates are evaluated against the current page. Match count and selected-element identity are measured; the stability score is a transparent heuristic, not a guarantee.",
      steps: ["Prefer a unique candidate that matches the selected element.", "Read the explanation for attribute, text, class, or structural tradeoffs.", "Highlight a candidate to inspect its live match before exporting it."]
    },
    export: {
      title: "Export test code",
      body: "Export uses the locator you selected and the framework shown in the menu. The generated snippet is ready to copy into a test and should still be reviewed in your project.",
      steps: ["Select a recommendation first.", "Choose Playwright JavaScript or Selenium Python.", "Copy the locator or the complete test snippet."]
    }
  };

  function status(message, isError = false) {
    $("status").textContent = message;
    $("status").classList.toggle("error", isError);
  }

  function setBusy(isBusy) {
    $("pick").disabled = isBusy;
    $("generate").disabled = isBusy;
    $("ask-ai").disabled = isBusy;
  }

  function openHelp(key) {
    const content = helpContent[key];
    if (!content) return;
    $("help-title").textContent = content.title;
    $("help-body").textContent = content.body;
    const steps = $("help-steps");
    steps.replaceChildren();
    for (const step of content.steps) {
      const item = document.createElement("li");
      item.textContent = step;
      steps.append(item);
    }
    $("help-dialog").showModal();
  }

  async function currentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");
    const url = tab.url ? new URL(tab.url) : null;
    $("page-meta").textContent = tab.title ? `${tab.title} · ${url?.hostname || "restricted page"}` : (tab.url || "Restricted page");
    return tab;
  }

  async function requestPageAccess(tab) {
    if (typeof tab.url !== "string" || !tab.url.trim()) {
      const granted = await chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] });
      if (!granted) throw new Error("Site access was not granted. Allow http(s) access and click Pick element again.");
      return;
    }
    let url;
    try {
      url = new URL(tab.url);
    } catch (_) {
      throw new Error("The active tab URL is unavailable. Open a normal http(s) webpage and try again.");
    }
    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("This browser page cannot be inspected. Open a normal http(s) webpage first.");
    }
    const origin = `${url.protocol}//${url.host}/*`;
    if (await chrome.permissions.contains({ origins: [origin] })) return;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) throw new Error("Site access was not granted. Allow access and click Pick element again.");
  }

  async function sendToPage(message) {
    await currentTab();
    const response = await chrome.runtime.sendMessage({ type: "XPATH_AGENT_PAGE_REQUEST", request: message });
    if (!response?.ok) throw new Error(response?.error || "The page did not accept the request.");
    return response;
  }

  function setPickerState(isPicking) {
    $("pick").disabled = isPicking;
    $("stop-pick").disabled = !isPicking;
    $("picker-state").innerHTML = "";
    const icon = document.createElement("span");
    icon.className = "state-icon";
    icon.textContent = isPicking ? "!" : "1";
    const text = document.createElement("span");
    text.textContent = isPicking ? "Picker active. Hover and click an element on the page. Escape cancels." : "Click Select element, then click a page element. Escape cancels.";
    $("picker-state").append(icon, text);
  }

  function setDetails(element) {
    selectedElement = element;
    $("element-details").textContent = element ? JSON.stringify(element, null, 2) : "No element selected.";
    const summary = $("element-summary");
    summary.replaceChildren();
    if (!element) {
      summary.className = "element-summary empty-summary";
      summary.textContent = "No element selected.";
      return;
    }
    summary.className = "element-summary";
    const grid = document.createElement("div");
    grid.className = "element-grid";
    const fields = [
      ["Tag", element.tag || "unknown"],
      ["Role", element.attributes?.role || "Not provided"],
      ["Accessible name", element.attributes?.["aria-label"] || "Not provided"],
      ["ID", element.attributes?.id || "Not provided"],
      ["Test ID", element.attributes?.["data-testid"] || "Not provided"],
      ["Name", element.attributes?.name || "Not provided"],
      ["Text preview", element.text || "No text", true]
    ];
    for (const [label, value, wide] of fields) {
      const field = document.createElement("div");
      field.className = "element-field" + (wide ? " element-field-wide" : "");
      const fieldLabel = document.createElement("div"); fieldLabel.className = "field-label"; fieldLabel.textContent = label;
      const fieldValue = document.createElement("div"); fieldValue.className = "field-value"; fieldValue.title = String(value); fieldValue.textContent = String(value);
      field.append(fieldLabel, fieldValue); grid.append(field);
    }
    summary.append(grid);
  }

  function renderCandidates(items) {
    candidates = items || [];
    $("result-count").textContent = String(candidates.length);
    const container = $("results");
    container.replaceChildren();
    if (!candidates.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "No candidates yet.";
      container.append(p);
      return;
    }
    for (const item of candidates) {
      const card = document.createElement("article");
      card.className = "candidate" + (selectedCandidate?.value === item.value && selectedCandidate?.kind === item.kind ? " selected" : "") + (candidates[0] === item ? " recommended" : "");
      const top = document.createElement("div"); top.className = "candidate-top";
      const title = document.createElement("div"); title.className = "rank-strategy";
      const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = `#${candidates.indexOf(item) + 1}`;
      const strategy = document.createElement("span"); strategy.className = "strategy"; strategy.textContent = item.strategy || (item.kind === "css" ? "CSS selector" : "XPath selector");
      title.append(rank, strategy);
      const source = document.createElement("div"); source.className = "source-label"; source.textContent = item.source === "ai" ? "Gemini suggestion, locally validated" : "Local candidate";
      const heading = document.createElement("div"); heading.append(title, source);
      const state = document.createElement("span"); state.className = "status " + (item.status || "unknown");
      state.textContent = item.count == null ? "not checked" : item.status === "invalid" ? "invalid" : `${item.count} match${item.count === 1 ? "" : "es"}`;
      top.append(heading, state);
      const code = document.createElement("code"); code.textContent = item.value;
      const evidence = document.createElement("div"); evidence.className = "evidence-row";
      if (item.count != null) { const count = document.createElement("span"); count.className = "evidence"; count.textContent = item.count === 1 ? "Unique match" : `${item.count} matches`; evidence.append(count); }
      if (item.targetMatch === true) { const match = document.createElement("span"); match.className = "evidence match"; match.textContent = "Matches selected element"; evidence.append(match); }
      if (item.targetMatch === false) { const mismatch = document.createElement("span"); mismatch.className = "evidence mismatch"; mismatch.textContent = "Does not match selected element"; evidence.append(mismatch); }
      const explanation = document.createElement("p");
      explanation.className = "candidate-explanation";
      explanation.textContent = `${item.explanation || "Not validated"}${item.targetMatch === false ? "; does not match the selected element" : ""}`;
      const actions = document.createElement("div"); actions.className = "candidate-actions";
      const select = document.createElement("button"); select.className = "secondary"; select.textContent = "Select / export";
      select.addEventListener("click", () => chooseCandidate(item));
      const highlight = document.createElement("button"); highlight.className = "secondary"; highlight.textContent = "Highlight";
      highlight.addEventListener("click", async () => {
        try { await sendToPage({ type: "XPATH_AGENT_HIGHLIGHT", candidate: item }); status("Matching element highlighted."); }
        catch (e) { status(e.message || String(e), true); }
      });
      const copy = document.createElement("button"); copy.className = "secondary"; copy.textContent = "Copy";
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(item.value); status("Locator copied.");
      });
      actions.append(select, highlight, copy);
      card.append(top, code, evidence, explanation, actions);
      container.append(card);
    }
  }

  function chooseCandidate(item) {
    selectedCandidate = item;
    const framework = $("framework").value;
    $("export").value = framework === "playwright"
      ? core.exportPlaywright(item.value, item.kind, item)
      : core.exportSelenium(item.value, item.kind, item);
    $("export-strategy").textContent = item.strategy || (item.kind === "css" ? "CSS selector" : "XPath selector");
    renderCandidates(candidates);
    status("Selected locator for export.");
  }

  async function generateFromSelected() {
    if (!selectedElement?.candidates) {
      status("Pick an element first to generate local candidates.", true);
      return;
    }
    setBusy(true);
    try {
      status("Validating local candidates…");
      const validated = await sendToPage({ type: "XPATH_AGENT_INSPECT", candidates: selectedElement.candidates, target: "selected" });
      if (!validated?.ok) throw new Error(validated?.error || "Validation failed.");
      const results = (validated.results || []).map((item) => ({ ...item, source: "local" }));
      renderCandidates(results);
      if (results[0]) chooseCandidate(results[0]);
    } finally {
      setBusy(false);
    }
  }

  async function validateCandidates(items) {
    const validated = await sendToPage({ type: "XPATH_AGENT_INSPECT", candidates: items });
    if (!validated?.ok) throw new Error(validated?.error || "Validation failed.");
    return validated.results || [];
  }

  async function checkBackendStatus() {
    const state = $("backend-state");
    const label = $("backend-state-label");
    const base = $("backend-url").value.trim().replace(/\/+$/, "");
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
      if (!response.ok) throw new Error("health check failed");
      state.classList.add("online");
      state.classList.remove("offline");
      label.textContent = "AI ready";
    } catch (_) {
      state.classList.add("offline");
      state.classList.remove("online");
      label.textContent = "AI offline";
    }
  }

  $("pick").addEventListener("click", async () => {
    try {
      setBusy(true);
      status("Starting picker…");
      const tab = await currentTab();
      await requestPageAccess(tab);
      await sendToPage({ type: "XPATH_AGENT_PICK" });
      setBusy(false);
      setPickerState(true);
      status("Picker active. Click an element in the webpage; press Esc to cancel.");
    } catch (e) { setBusy(false); setPickerState(false); status("Could not start picker: " + (e.message || e), true); }
  });

  $("stop-pick").addEventListener("click", async () => {
    try {
      await sendToPage({ type: "XPATH_AGENT_STOP_PICK" });
      setPickerState(false);
      status("Picker stopped.");
    } catch (e) { status("Could not stop picker: " + (e.message || e), true); }
  });

  $("generate").addEventListener("click", async () => {
    try {
      if (selectedElement?.candidates) await generateFromSelected();
      else {
        const description = $("target").value.trim();
        if (!description) { status("Enter a target description or pick an element.", true); return; }
        status("Local mode needs a picked element for exact DOM-based candidates. Use AI for natural-language descriptions.", true);
      }
    } catch (e) { status(e.message || String(e), true); }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.source !== "XPATH_AGENT" || message?.type !== "ELEMENT_SELECTED") return;
    setDetails(message.element);
    $("target").value = message.element?.text || `${message.element?.tag || "element"} element`;
    setPickerState(false);
    status("Element selected. Validating local locator candidates…");
    generateFromSelected().catch((e) => status(e.message || String(e), true));
  });

  $("refresh").addEventListener("click", async () => {
    try {
      const result = await sendToPage({ type: "XPATH_AGENT_GET_PAGE_INFO" });
      $("page-meta").textContent = `${result.page.title} · ${new URL(result.page.url).hostname}`;
      status(`Page inspected. ${result.summary.length} interactive elements summarized.`);
    } catch (e) { status("Unable to inspect this page: " + (e.message || e), true); }
  });

  $("ask-ai").addEventListener("click", async () => {
    const target = $("target").value.trim();
    if (!target) { status("Enter a target description first.", true); return; }
    const backendUrl = $("backend-url").value.trim().replace(/\/+$/, "");
    let endpoint;
    try {
      endpoint = new URL(`${backendUrl}/api/locators`);
      if (!/^https?:$/.test(endpoint.protocol)) throw new Error("Backend URL must use http or https.");
    } catch (e) {
      status(e.message || "Enter a valid backend URL.", true);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 130000);
    setBusy(true);
    try {
      status("Preparing a limited DOM summary…");
      const page = await sendToPage({ type: "XPATH_AGENT_GET_PAGE_INFO" });
      const response = await fetch(endpoint.href, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, page: page.page, elements: page.summary }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Backend returned ${response.status}`);
      status("Validating AI suggestions against the live DOM…");
      const suggestions = (await validateCandidates(data.candidates || [])).map((item) => ({ ...item, source: "ai" }));
      renderCandidates(suggestions);
      if (suggestions[0]) chooseCandidate(suggestions[0]);
      const uniqueCount = suggestions.filter((item) => item.count === 1).length;
      status(`AI suggestions validated. ${uniqueCount} unique candidate${uniqueCount === 1 ? "" : "s"} found.`);
    } catch (e) {
      const message = e?.name === "AbortError"
        ? `AI backend timed out at ${backendUrl}.`
        : e instanceof TypeError && /fetch/i.test(e.message || "")
          ? `AI backend is unreachable at ${backendUrl}. Start the backend with "npm start" from the backend folder.`
          : e.message || String(e);
      status("AI request failed: " + message, true);
    } finally {
      clearTimeout(timeout);
      setBusy(false);
      checkBackendStatus();
    }
  });

  $("framework").addEventListener("change", () => { if (selectedCandidate) chooseCandidate(selectedCandidate); });
  $("copy-locator").addEventListener("click", async () => {
    if (!selectedCandidate) { status("Select a locator first.", true); return; }
    await navigator.clipboard.writeText(selectedCandidate.value); status("Locator copied.");
  });
  $("copy-code").addEventListener("click", async () => {
    if (!$("export").value) { status("Select a locator first.", true); return; }
    await navigator.clipboard.writeText($("export").value); status("Code copied.");
  });

  document.querySelectorAll(".help-button").forEach((button) => {
    button.addEventListener("click", () => openHelp(button.dataset.help));
  });
  $("help-close").addEventListener("click", () => $("help-dialog").close());
  $("help-dismiss").addEventListener("click", () => $("help-dialog").close());
  $("help-dialog").addEventListener("click", (event) => {
    if (event.target === $("help-dialog")) $("help-dialog").close();
  });

  currentTab().then(() => status("Ready. Pick an element to start."))
    .catch((e) => status(e.message || String(e), true));
  checkBackendStatus();
})();
