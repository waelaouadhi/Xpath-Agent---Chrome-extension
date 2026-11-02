(() => {
  if (window.__xpathAgentContentLoaded) return;
  window.__xpathAgentContentLoaded = true;

  const core = window.XPathAgentCore;
  let pickerActive = false;
  let hovered = null;
  let selected = null;
  const originalStyles = new Map();

  function highlight(el, color = "#7c3aed") {
    if (!el) return;
    if (!originalStyles.has(el)) {
      originalStyles.set(el, {
        outline: el.style.outline,
        outlineOffset: el.style.outlineOffset
      });
    }
    el.style.setProperty("outline", `2px solid ${color}`, "important");
    el.style.setProperty("outline-offset", "2px", "important");
  }

  function clearHighlight(el) {
    const styles = originalStyles.get(el);
    if (!el || !styles) return;
    el.style.setProperty("outline", styles.outline || "", "important");
    el.style.setProperty("outline-offset", styles.outlineOffset || "", "important");
    originalStyles.delete(el);
  }

  function restoreHover() {
    if (hovered && hovered !== selected) {
      clearHighlight(hovered);
    }
    hovered = null;
  }

  function onMouseMove(event) {
    if (!pickerActive) return;
    const el = event.target;
    if (!(el instanceof Element) || el.closest("#xpath-agent-picker-banner")) return;
    restoreHover();
    hovered = el;
    highlight(el, "#2563eb");
  }

  function onClick(event) {
    if (!pickerActive) return;
    const el = event.target;
    if (!(el instanceof Element) || el.closest("#xpath-agent-picker-banner")) return;
    event.preventDefault();
    event.stopPropagation();
    pickerActive = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    restoreHover();
    const banner = document.getElementById("xpath-agent-picker-banner");
    if (banner) banner.remove();
    if (selected) clearHighlight(selected);
    selected = el;
    highlight(selected, "#16a34a");
    chrome.runtime.sendMessage({ source: "XPATH_AGENT", type: "ELEMENT_SELECTED", element: core.inspectElement(selected) });
  }

  function stopPicker(clearSelected = true) {
    pickerActive = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    restoreHover();
    const banner = document.getElementById("xpath-agent-picker-banner");
    if (banner) banner.remove();
    if (clearSelected && selected) {
      clearHighlight(selected);
      selected = null;
    }
  }

  function startPicker() {
    stopPicker(true);
    pickerActive = true;
    const banner = document.createElement("div");
    banner.id = "xpath-agent-picker-banner";
    banner.textContent = "XPath Agent: click an element to inspect · Esc to cancel";
    Object.assign(banner.style, {
      position: "fixed", top: "8px", left: "50%", transform: "translateX(-50%)",
      zIndex: "2147483647", background: "#111827", color: "#fff", padding: "10px 14px",
      borderRadius: "8px", font: "13px/1.4 system-ui, sans-serif", boxShadow: "0 4px 18px #0005",
      pointerEvents: "none"
    });
    document.documentElement.appendChild(banner);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pickerActive) stopPicker();
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === "XPATH_AGENT_PICK") {
        startPicker();
        sendResponse({ ok: true });
      } else if (message?.type === "XPATH_AGENT_INSPECT") {
        const candidates = Array.isArray(message.candidates) ? message.candidates : [];
        const target = message.target === "selected" ? selected : null;
        sendResponse({ ok: true, results: core.validateCandidates(document, candidates, target) });
      } else if (message?.type === "XPATH_AGENT_GET_PAGE_INFO") {
        sendResponse({
          ok: true,
          page: { title: document.title, url: location.href },
          summary: Array.from(document.querySelectorAll("button, a, input, select, textarea, [role='button'], [data-testid]"))
            .slice(0, 100).map((el) => ({
              tag: el.tagName.toLowerCase(),
              text: core.elementText(el).slice(0, 100),
              attributes: {
                id: el.id || "",
                name: el.getAttribute("name") || "",
                type: el.getAttribute("type") || "",
                "data-testid": el.getAttribute("data-testid") || "",
                "aria-label": el.getAttribute("aria-label") || ""
              }
            }))
        });
      } else if (message?.type === "XPATH_AGENT_HIGHLIGHT") {
        const candidate = message.candidate;
        if (!candidate || !["css", "xpath"].includes(candidate.kind) || typeof candidate.value !== "string") {
          sendResponse({ ok: false, error: "Invalid locator candidate." });
          return true;
        }
        let el = null;
        if (candidate.kind === "css") el = document.querySelector(candidate.value);
        else el = document.evaluate(candidate.value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (el instanceof Element) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          highlight(el, "#16a34a");
          sendResponse({ ok: true });
        } else sendResponse({ ok: false, error: "No matching element" });
      } else if (message?.type === "XPATH_AGENT_STOP_PICK") {
        stopPicker();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "Unknown page request." });
      }
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }
    return true;
  });
})();
