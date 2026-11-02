chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

function pageAccessError(error) {
  const message = String(error?.message || error || "Unknown page access error");
  if (/Cannot access contents|permission|host permission|not allowed/i.test(message)) {
    return "This page is not accessible. Use Pick on a normal http(s) webpage and grant site access when prompted.";
  }
  return message;
}

async function injectContentScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["core/locator-engine.js", "content.js"]
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "XPATH_AGENT_OPEN_PANEL" && sender.tab?.windowId != null) {
    chrome.sidePanel.open({ windowId: sender.tab.windowId })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === "XPATH_AGENT_PAGE_REQUEST") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("No active tab found.");
        if (typeof tab.url === "string" && tab.url) {
          let url;
          try {
            url = new URL(tab.url);
          } catch (_) {
            throw new Error("The active tab URL is invalid. Open a normal http(s) webpage first.");
          }
          if (!/^https?:$/.test(url.protocol)) {
            throw new Error("This browser page cannot be inspected. Open a normal http(s) webpage first.");
          }
        }
        await injectContentScripts(tab.id);
        const response = await chrome.tabs.sendMessage(tab.id, message.request || {});
        sendResponse(response || { ok: false, error: "The page returned no response." });
      } catch (error) {
        sendResponse({ ok: false, error: pageAccessError(error) });
      }
    })();
    return true;
  }
  return false;
});
