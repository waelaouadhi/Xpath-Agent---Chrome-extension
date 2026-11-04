(() => {
  const $ = (id) => document.getElementById(id);
  const core = window.XPathAgentCore;
  const evidence = window.XPathAgentEvidence;
  let selectedElement = null;
  let candidates = [];
  let selectedCandidate = null;
  let provisionalSelection = false;
  let pageContext = null;
  let evidenceState = evidence.createState();
  let validationRequestId = 0;
  let aiRequestId = 0;

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
    document.querySelector("main").setAttribute("aria-busy", String(isBusy));
    $("results").setAttribute("aria-busy", String(isBusy));
    $("pick").disabled = isBusy;
    $("generate").disabled = isBusy;
    $("ask-ai").disabled = isBusy;
    $("revalidate").disabled = isBusy;
  }

  function pageFromTab(tab) {
    let url = "";
    try { url = tab?.url ? new URL(tab.url).href : ""; } catch (_) {}
    let hostname = "";
    try { hostname = tab?.url ? new URL(tab.url).hostname : ""; } catch (_) {}
    return { identity: `${tab?.id || "unknown"}:${url}`, tabId: tab?.id || null, hostname };
  }

  function selectedTargetIdentity(element) {
    if (!element) return null;
    return JSON.stringify({
      tag: element.tag || "",
      text: element.text || "",
      attributes: element.attributes || {}
    });
  }

  function formatValidationTime(value) {
    if (!value) return "No validation yet.";
    return `Validated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}${evidenceState.hostname ? ` · ${evidenceState.hostname}` : ""}`;
  }

  function updateExportAvailability() {
    const enabled = Boolean(selectedCandidate && evidence.isCurrent(evidenceState, pageContext || {}));
    $("copy-locator").disabled = !enabled;
    $("copy-code").disabled = !enabled || !$("export").value;
    $("export").readOnly = !enabled;
    $("revalidate").hidden = !evidenceState.stale;
  }

  function updateWorkflowState() {
    const currentEvidence = Boolean(candidates.length && evidence.isCurrent(evidenceState, pageContext || {}));
    const steps = [
      { complete: Boolean(selectedElement), current: !selectedElement, blocked: false },
      { complete: Boolean(selectedElement && candidates.length), current: Boolean(selectedElement && !candidates.length), blocked: !selectedElement },
      { complete: currentEvidence, current: Boolean(candidates.length && !currentEvidence), blocked: !selectedElement || !candidates.length },
      { complete: Boolean(selectedCandidate && currentEvidence), current: Boolean(currentEvidence && !selectedCandidate), blocked: !currentEvidence || !selectedCandidate }
    ];
    document.querySelectorAll(".workflow-step").forEach((button) => {
      const step = steps[Number(button.dataset.workflowStep) - 1];
      button.classList.toggle("is-complete", step.complete);
      button.classList.toggle("is-blocked", step.blocked);
      button.toggleAttribute("aria-current", step.current);
      button.setAttribute("aria-disabled", String(step.blocked));
    });
  }

  function renderEvidenceState() {
    const container = $("evidence-status");
    const label = $("evidence-status-label");
    const meta = $("evidence-meta");
    const stale = evidenceState.stale;
    container.classList.toggle("stale", stale);
    container.classList.toggle("fresh", !stale);
    label.textContent = stale ? "Needs revalidation" : "Evidence current";
    meta.textContent = stale
      ? `${evidenceState.hostname ? `${evidenceState.hostname} · ` : ""}Page changed since the last successful validation.`
      : formatValidationTime(evidenceState.validatedAt);
    updateExportAvailability();
    updateWorkflowState();
  }

  function markEvidenceStale(message = "The inspected page changed. Revalidate before copying.") {
    evidenceState = evidence.markStale(evidenceState);
    validationRequestId++;
    aiRequestId++;
    renderEvidenceState();
    if (message) status(message, true);
    renderCandidates(candidates);
  }

  function validationToken() {
    const requestId = ++validationRequestId;
    return evidence.createValidationToken(evidenceState, pageContext?.identity || null, requestId);
  }

  function validationStillCurrent(token) {
    return evidence.isValidationCurrent(
      token,
      evidenceState,
      pageContext?.identity || null,
      validationRequestId
    );
  }

  async function syncPageContext(markStaleOnChange = true) {
    const tab = await currentTab();
    const next = pageFromTab(tab);
    if (pageContext && pageContext.identity !== next.identity) {
      if (markStaleOnChange) markEvidenceStale("The inspected page changed. Revalidate before copying.");
    }
    pageContext = next;
    renderEvidenceState();
    return tab;
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
    updateWorkflowState();
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
      updateExportAvailability();
      updateWorkflowState();
      return;
    }
    for (const item of candidates) {
      const card = document.createElement("article");
      card.className = "candidate" + (selectedCandidate?.value === item.value && selectedCandidate?.kind === item.kind ? " selected" : "") + (candidates[0] === item ? " recommended" : "") + (evidenceState.stale ? " stale" : "");
      const top = document.createElement("div"); top.className = "candidate-top";
      const title = document.createElement("div"); title.className = "rank-strategy";
      const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = `#${candidates.indexOf(item) + 1}`;
      const strategy = document.createElement("span"); strategy.className = "strategy"; strategy.textContent = item.strategy || (item.kind === "css" ? "CSS selector" : "XPath selector");
      title.append(rank, strategy);
      const source = document.createElement("div"); source.className = "source-label"; source.textContent = item.source === "ai" ? "Gemini suggestion, locally validated" : "Local candidate";
      const heading = document.createElement("div"); heading.append(title, source);
      const state = document.createElement("span"); state.className = "status " + (item.status || "unknown");
      state.textContent = core.formatMatchCount(item);
      state.setAttribute("aria-label", `Validation result: ${state.textContent}`);
      top.append(heading, state);
      const code = document.createElement("code"); code.textContent = item.value;
      const evidence = document.createElement("div"); evidence.className = "evidence-row";
      const count = document.createElement("span");
      count.className = "evidence primary-evidence";
      count.textContent = core.formatMatchCount(item);
      evidence.append(count);
      const target = document.createElement("span");
      const targetLabel = core.formatTargetMatch(item);
      target.className = `evidence ${item.targetMatch == null ? "unchecked" : item.targetMatch ? "match" : "mismatch"}`;
      target.textContent = targetLabel;
      evidence.append(target);
      const score = document.createElement("span");
      score.className = "evidence";
      score.textContent = core.formatHeuristicScore(item);
      evidence.append(score);
      const explanation = document.createElement("p");
      explanation.className = "candidate-explanation";
      explanation.textContent = item.explanation || "No ranking explanation available.";
      const guidance = document.createElement("p");
      guidance.className = "candidate-explanation";
      guidance.textContent = core.strategyGuidance(item.strategy);
      const provisional = document.createElement("p");
      provisional.className = "provisional-note";
      provisional.hidden = !(provisionalSelection && selectedCandidate?.value === item.value && selectedCandidate?.kind === item.kind);
      provisional.textContent = core.selectionNotice(true);
      const actions = document.createElement("div"); actions.className = "candidate-actions";
      const select = document.createElement("button"); select.className = "secondary"; select.textContent = "Select / export";
      select.addEventListener("click", () => chooseCandidate(item));
      const highlight = document.createElement("button"); highlight.className = "secondary"; highlight.textContent = "Highlight";
      highlight.addEventListener("click", async () => {
        try { await sendToPage({ type: "XPATH_AGENT_HIGHLIGHT", candidate: item }); status("Matching element highlighted."); }
        catch (e) { status(e.message || String(e), true); }
      });
      const copy = document.createElement("button"); copy.className = "secondary"; copy.textContent = "Copy";
      copy.disabled = evidenceState.stale;
      copy.addEventListener("click", async () => {
        if (!evidence.isCurrent(evidenceState, pageContext || {})) {
          status("Revalidate this locator before copying.", true);
          return;
        }
        try {
          await navigator.clipboard.writeText(item.value);
          status("Locator copied.");
        } catch (error) {
          status(`Unable to copy locator: ${error.message || error}`, true);
        }
      });
      actions.append(select, highlight, copy);
      card.append(top, code, evidence, explanation, guidance, provisional, actions);
      container.append(card);
    }
    updateExportAvailability();
    updateWorkflowState();
  }

  function chooseCandidate(item, isProvisional = false) {
    if (!evidence.isCurrent(evidenceState, pageContext || {})) {
      selectedCandidate = item;
      provisionalSelection = false;
      $("export").value = "";
      $("export-strategy").textContent = "Needs revalidation";
      renderCandidates(candidates);
      status("Revalidate this locator before exporting it.", true);
      return;
    }
    selectedCandidate = item;
    provisionalSelection = isProvisional;
    const framework = $("framework").value;
    $("export").value = framework === "playwright"
      ? core.exportPlaywright(item.value, item.kind, item)
      : core.exportSelenium(item.value, item.kind, item);
    $("export-strategy").textContent = item.strategy || (item.kind === "css" ? "CSS selector" : "XPath selector");
    renderCandidates(candidates);
    status(isProvisional ? "Best validated candidate selected provisionally. Review the evidence before exporting." : core.selectionNotice(false));
  }

  async function generateFromSelected() {
    if (!selectedElement?.candidates) {
      status("Pick an element first to generate local candidates.", true);
      return;
    }
    const token = validationToken();
    setBusy(true);
    try {
      status("Validating local candidates…");
      const validated = await sendToPage({ type: "XPATH_AGENT_INSPECT", candidates: selectedElement.candidates, target: "selected" });
      if (!validated?.ok) throw new Error(validated?.error || "Validation failed.");
      await syncPageContext();
      if (!validationStillCurrent(token)) return;
      const results = (validated.results || []).map((item) => ({ ...item, source: "local" }));
      renderCandidates(results);
      evidenceState = evidence.markValidated(evidenceState, pageContext);
      renderEvidenceState();
      if (results[0]) chooseCandidate(results[0], true);
    } finally {
      setBusy(false);
    }
  }

  async function validateCandidates(items, target = undefined, expectedRequestContext = null) {
    if (expectedRequestContext && !evidence.isRequestCurrent(
      expectedRequestContext,
      aiRequestId,
      pageContext,
      evidenceState,
      selectedTargetIdentity(selectedElement),
      $("target").value.trim()
    )) return null;
    const token = validationToken();
    const validated = await sendToPage({ type: "XPATH_AGENT_INSPECT", candidates: items, target });
    if (!validated?.ok) throw new Error(validated?.error || "Validation failed.");
    await syncPageContext();
    if (!validationStillCurrent(token)) return null;
    evidenceState = evidence.markValidated(evidenceState, pageContext);
    renderEvidenceState();
    return validated.results || [];
  }

  async function revalidateEvidence() {
    if (!candidates.length) {
      status("There are no locators to revalidate.", true);
      return;
    }
    const previous = selectedCandidate;
    setBusy(true);
    try {
      status("Revalidating locators against the current page…");
      const results = await validateCandidates(
        candidates.map(({ source, ...candidate }) => candidate),
        selectedElement ? "selected" : undefined
      );
      if (!results) return;
      const refreshed = results.map((item) => ({ ...item, source: previous?.source || "local" }));
      renderCandidates(refreshed);
      selectedCandidate = previous
        ? refreshed.find((item) => item.value === previous.value && item.kind === previous.kind) || null
        : null;
      if (selectedCandidate) chooseCandidate(selectedCandidate, false);
      else {
        $("export").value = "";
        $("export-strategy").textContent = "No selection";
        renderCandidates(refreshed);
      }
      const uniqueCount = refreshed.filter((item) => item.count === 1).length;
      status(`Revalidation complete. ${uniqueCount} unique candidate${uniqueCount === 1 ? "" : "s"} found.`);
    } catch (error) {
      markEvidenceStale("Revalidation failed. Existing evidence remains stale.");
      status(error.message || String(error), true);
    } finally {
      setBusy(false);
      updateExportAvailability();
    }
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
      markEvidenceStale("Page information refreshed. Revalidate before copying.");
      const result = await sendToPage({ type: "XPATH_AGENT_GET_PAGE_INFO" });
      $("page-meta").textContent = `${result.page.title} · ${new URL(result.page.url).hostname}`;
      status(`Page inspected. ${result.summary.length} interactive elements summarized.`);
    } catch (e) { status("Unable to inspect this page: " + (e.message || e), true); }
  });

  $("revalidate").addEventListener("click", () => {
    revalidateEvidence().catch((error) => status(error.message || String(error), true));
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
    await syncPageContext();
    const requestId = ++aiRequestId;
    const requestContext = evidence.createRequestContext(
      requestId,
      pageContext,
      evidenceState,
      selectedTargetIdentity(selectedElement),
      target
    );
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
      if (!evidence.isRequestCurrent(
        requestContext,
        aiRequestId,
        pageContext,
        evidenceState,
        selectedTargetIdentity(selectedElement),
        $("target").value.trim()
      )) {
        if (requestContext.requestId === aiRequestId) {
          status("AI response discarded because the inspected page or target changed.");
        }
        return;
      }
      status("Validating AI suggestions against the live DOM…");
      const validatedSuggestions = await validateCandidates(data.candidates || [], undefined, requestContext);
      if (!validatedSuggestions) {
        if (requestContext.requestId === aiRequestId) {
          status("AI suggestions discarded because the inspected page or target changed.");
        }
        return;
      }
      const suggestions = validatedSuggestions.map((item) => ({ ...item, source: "ai" }));
      if (!evidence.isRequestCurrent(
        requestContext,
        aiRequestId,
        pageContext,
        evidenceState,
        selectedTargetIdentity(selectedElement),
        $("target").value.trim()
      )) {
        if (requestContext.requestId === aiRequestId) {
          status("AI suggestions discarded because the inspected page or target changed.");
        }
        return;
      }
      renderCandidates(suggestions);
      if (suggestions[0]) chooseCandidate(suggestions[0], true);
      const uniqueCount = suggestions.filter((item) => item.count === 1).length;
      status(`AI suggestions validated. ${uniqueCount} unique candidate${uniqueCount === 1 ? "" : "s"} found.`);
    } catch (e) {
      if (!evidence.isRequestCurrent(
        requestContext,
        aiRequestId,
        pageContext,
        evidenceState,
        selectedTargetIdentity(selectedElement),
        $("target").value.trim()
      )) return;
      const message = e?.name === "AbortError"
        ? `AI backend timed out at ${backendUrl}.`
        : e instanceof TypeError && /fetch/i.test(e.message || "")
          ? `AI backend is unreachable at ${backendUrl}. Start the backend with "npm start" from the backend folder.`
          : e.message || String(e);
      status("AI request failed: " + message, true);
    } finally {
      clearTimeout(timeout);
      if (requestContext.requestId === aiRequestId) {
        setBusy(false);
        checkBackendStatus();
      }
    }
  });

  $("framework").addEventListener("change", () => { if (selectedCandidate) chooseCandidate(selectedCandidate); });
  $("copy-locator").addEventListener("click", async () => {
    if (!selectedCandidate) { status("Select a locator first.", true); return; }
    if (!evidence.isCurrent(evidenceState, pageContext || {})) {
      status("Revalidate this locator before copying.", true);
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedCandidate.value);
      status("Locator copied.");
    } catch (error) {
      status(`Unable to copy locator: ${error.message || error}`, true);
    }
  });
  $("copy-code").addEventListener("click", async () => {
    if (!$("export").value) { status("Select a locator first.", true); return; }
    if (!evidence.isCurrent(evidenceState, pageContext || {})) {
      status("Revalidate this code before copying.", true);
      return;
    }
    try {
      await navigator.clipboard.writeText($("export").value);
      status("Code copied.");
    } catch (error) {
      status(`Unable to copy code: ${error.message || error}`, true);
    }
  });

  document.querySelectorAll(".help-button").forEach((button) => {
    button.addEventListener("click", () => openHelp(button.dataset.help));
  });
  document.querySelectorAll(".workflow-step").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-disabled") === "true") {
        status(`Complete the earlier workflow step before opening ${button.querySelector("strong")?.textContent || "this step"}.`, true);
      }
      document.getElementById(button.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  $("help-close").addEventListener("click", () => $("help-dialog").close());
  $("help-dismiss").addEventListener("click", () => $("help-dialog").close());
  $("help-dialog").addEventListener("click", (event) => {
    if (event.target === $("help-dialog")) $("help-dialog").close();
  });

  chrome.tabs.onActivated.addListener(() => {
    markEvidenceStale("The active tab changed. Revalidate before copying.");
    syncPageContext(false).catch((error) => status(error.message || String(error), true));
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (pageContext?.tabId !== tabId) return;
    if (changeInfo.url || changeInfo.status === "loading") {
      markEvidenceStale("The page is changing. Revalidate before copying.");
      syncPageContext().catch((error) => status(error.message || String(error), true));
    }
  });

  syncPageContext(false).then(() => status("Ready. Pick an element to start."))
    .catch((e) => status(e.message || String(e), true));
  renderEvidenceState();
  updateWorkflowState();
  checkBackendStatus();
})();
