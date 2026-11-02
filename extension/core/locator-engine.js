/* Shared, dependency-free locator helpers. Works in a browser and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XPathAgentCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function xpathLiteral(value) {
    const s = String(value ?? "");
    if (!s.includes("'")) return "'" + s + "'";
    if (!s.includes('"')) return '"' + s + '"';
    const parts = s.split("'");
    return "concat(" + parts.map((part, i) =>
      (i ? `, "'", ` : "") + "'" + part + "'"
    ).join("") + ")";
  }

  function cssEscape(value) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(String(value));
    const input = String(value);
    let output = "";
    for (let index = 0; index < input.length; index++) {
      const code = input.charCodeAt(index);
      const char = input[index];
      if (code === 0) { output += "\\FFFD "; continue; }
      if ((code >= 1 && code <= 31) || code === 127 || (index === 0 && code >= 48 && code <= 57) || (index === 1 && code >= 48 && code <= 57 && input[0] === "-")) {
        output += `\\${code.toString(16)} `;
      } else if (index === 0 && char === "-" && input.length === 1) {
        output += "\\-";
      } else if (code >= 128 || char === "-" || char === "_" || code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122) {
        output += char;
      } else {
        output += `\\${char}`;
      }
    }
    return output;
  }

  function cssString(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, "\\A ")}"`;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function elementText(el) {
    return normalizeText(el?.innerText || el?.textContent || "");
  }

  function isUniqueXPath(doc, xpath) {
    try {
      const result = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return result.snapshotLength === 1;
    } catch (_) { return false; }
  }

  function countXPath(doc, xpath) {
    try {
      return doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength;
    } catch (_) { return 0; }
  }

  function countCss(doc, selector) {
    try { return doc.querySelectorAll(selector).length; }
    catch (_) { return 0; }
  }

  function candidateScore(candidate) {
    const strategy = String(candidate?.strategy || "").toLowerCase();
    const value = String(candidate?.value || "");
    let score = candidate?.kind === "css" ? 55 : 50;
    if (/testid|data-test|data-qa/.test(strategy)) score += 38;
    else if (/^id$|css id/.test(strategy)) score += 34;
    else if (/role|label|name/.test(strategy)) score += 28;
    else if (/aria|placeholder|title/.test(strategy)) score += 22;
    else if (/class/.test(strategy)) score += 14;
    else if (/text/.test(strategy)) score += 8;
    if (/nth-child|\[\d+\]|\/html|\/body/.test(value)) score -= 35;
    if (/contains\(/.test(value)) score -= 8;
    return Math.max(0, Math.min(100, score));
  }

  function absoluteXPath(el) {
    const segments = [];
    let node = el;
    while (node?.tagName) {
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      segments.unshift(`${node.tagName.toLowerCase()}[${index}]`);
      node = node.parentElement;
    }
    return segments.length ? `/${segments.join("/")}` : "";
  }

  function candidatesForElement(el) {
    if (!el || !el.tagName) return [];
    const tag = el.tagName.toLowerCase();
    const out = [];
    const add = (strategy, value, kind = "xpath", metadata = {}) => {
      if (value && !out.some((x) => x.value === value && x.kind === kind)) {
        out.push({ strategy, value, kind, ...metadata });
      }
    };
    const attrs = ["data-testid", "data-test", "data-qa", "aria-label", "name", "placeholder", "title"];
    for (const attr of attrs) {
      const value = el.getAttribute?.(attr);
      if (value) {
        const xp = `//${tag}[@${attr}=${xpathLiteral(value)}]`;
        const exportType = attr === "data-testid" ? "testid" : null;
        const strategy = ["data-testid", "data-test", "data-qa"].includes(attr) ? `Test ID: ${attr}` : `Attribute: ${attr}`;
        add(strategy, xp, "xpath", exportType ? { exportType, exportValue: value } : {});
        if (attr === "data-testid" || attr === "data-test" || attr === "data-qa") {
          add(`CSS test attribute: ${attr}`, `${tag}[${attr}=${cssString(value)}]`, "css", exportType ? { exportType, exportValue: value } : {});
        }
      }
    }
    const id = el.getAttribute?.("id");
    if (id) {
      add("ID (XPath)", `//*[@id=${xpathLiteral(id)}]`, "xpath", { exportType: "id", exportValue: id, exportSelector: `#${cssEscape(id)}` });
      add("ID (CSS)", `#${cssEscape(id)}`, "css", { exportType: "id", exportValue: id, exportSelector: `#${cssEscape(id)}` });
    }
    const name = el.getAttribute?.("name");
    if (name) add("Name", `${tag}[name=${cssString(name)}]`, "css", { exportType: "name", exportValue: name });

    const role = el.getAttribute?.("role");
    const accessibleName = el.getAttribute?.("aria-label");
    if (role && accessibleName) {
      add("Accessible role and name", `//*[@role=${xpathLiteral(role)} and @aria-label=${xpathLiteral(accessibleName)}]`, "xpath", { exportType: "role", exportRole: role, exportValue: accessibleName });
    }

    const classes = String(el.getAttribute?.("class") || "").split(/\s+/)
      .filter((name) => name && name.length <= 40 && !(/[0-9]{2,}|^css-|^sc-|^jsx-/.test(name)));
    if (classes.length) {
      const classSelector = classes.slice(0, 3).map((name) => `.${cssEscape(name)}`).join("");
      add("Stable class combination", `${tag}${classSelector}`, "css");
    }

    const label = el.closest?.("label");
    const labelText = elementText(label);
    if (labelText && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) {
      add("Associated label", `//label[normalize-space(.)=${xpathLiteral(labelText)}]//${tag}`);
    }

    const text = elementText(el);
    if (text && text.length <= 100 && !["INPUT", "TEXTAREA"].includes(el.tagName)) {
      add("Exact text", `//${tag}[normalize-space(.)=${xpathLiteral(text)}]`);
      if (text.length <= 40) add("Text contains", `//${tag}[contains(normalize-space(.), ${xpathLiteral(text)})]`);
    }
    const type = el.getAttribute?.("type");
    if (type) {
      add("Type (XPath)", `//${tag}[@type=${xpathLiteral(type)}]`);
      add("Type (CSS)", `${tag}[type=${cssString(type)}]`, "css");
    }

    // Relative structural fallback: use stable attributes on ancestors where available.
    let parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 4) {
      const parentId = parent.getAttribute?.("id");
      const parentTestId = parent.getAttribute?.("data-testid");
      if (parentId) {
        add("Relative to ancestor ID", `//*[@id=${xpathLiteral(parentId)}]//${tag}${id ? `[@id=${xpathLiteral(id)}]` : ""}`);
        break;
      }
      if (parentTestId) {
        add("Relative to ancestor test ID", `//*[@data-testid=${xpathLiteral(parentTestId)}]//${tag}`);
        break;
      }
      parent = parent.parentElement;
      depth++;
    }

    const absolute = absoluteXPath(el);
    if (absolute) add("Last resort absolute XPath", absolute);
    return out;
  }

  function validateCandidates(doc, candidates, targetElement = null) {
    return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
      let count = 0;
      let valid = false;
      let targetMatch = null;
      const shapeValid = candidate && ["css", "xpath"].includes(candidate.kind) && typeof candidate.value === "string" && candidate.value.length > 0;
      try {
        if (!shapeValid) throw new Error("Invalid candidate shape");
        if (candidate.kind === "css") {
          const nodes = doc.querySelectorAll(candidate.value);
          count = nodes.length;
          valid = true;
          if (targetElement) targetMatch = Array.from(nodes).includes(targetElement);
        } else {
          const result = doc.evaluate(candidate.value, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          count = result.snapshotLength;
          valid = true;
          if (targetElement) {
            targetMatch = false;
            for (let index = 0; index < result.snapshotLength; index++) {
              if (result.snapshotItem(index) === targetElement) targetMatch = true;
            }
          }
        }
      } catch (_) {}
      const status = !valid ? "invalid" : count === 1 ? "unique" : count === 0 ? "no-match" : "ambiguous";
      let score = candidateScore(candidate);
      if (!valid) score = 0;
      else if (count === 1) score += 12;
      else if (count === 0) score -= 20;
      else score -= 25;
      if (targetMatch === true) score += 10;
      if (targetMatch === false) score -= 40;
      score = Math.max(0, Math.min(100, score));
      const strategy = String(candidate?.strategy || "").toLowerCase();
      const explanation = !valid
        ? "Invalid or unsupported selector; it could not be evaluated."
        : targetMatch === false
          ? "This selector is valid but does not identify the selected element."
          : count === 0
            ? "No element matched this selector on the current page."
            : count > 1
              ? "Multiple elements matched; add a stable attribute or more specific relationship."
              : /absolute/.test(strategy)
                ? "Unique match, but the absolute DOM path is structurally fragile."
                : /text/.test(strategy)
                  ? "Unique match based on visible text; wording or localization may change."
                  : `Unique match${targetMatch === true ? " for the selected element" : ""}; heuristic stability score ${score}/100.`;
      return {
        ...candidate,
        count,
        valid,
        validationCompleted: true,
        unique: valid && count === 1,
        targetMatch,
        score,
        explanation,
        status
      };
    }).sort((a, b) => {
      const rank = (x) => !x.valid ? 5 : x.count === 1 && x.targetMatch === true ? 0 : x.count === 1 && x.targetMatch == null ? 1 : x.count > 1 ? 2 : x.count === 1 ? 3 : x.count === 0 ? 4 : 5;
      return rank(a) - rank(b) || b.score - a.score;
    });
  }

  function inspectElement(el) {
    if (!el) return null;
    const attrs = {};
    for (const attr of Array.from(el.attributes || [])) attrs[attr.name] = attr.value;
    return {
      tag: el.tagName.toLowerCase(),
      text: elementText(el).slice(0, 300),
      attributes: attrs,
      candidates: candidatesForElement(el)
    };
  }

  function exportPlaywright(locator, kind = "xpath", metadata = {}) {
    if (metadata.exportType === "testid") {
      return `const locator = page.getByTestId(${JSON.stringify(metadata.exportValue)});\nawait expect(locator).toHaveCount(1);\nawait expect(locator).toBeVisible();`;
    }
    if (metadata.exportType === "role") {
      return `const locator = page.getByRole(${JSON.stringify(metadata.exportRole)}, { name: ${JSON.stringify(metadata.exportValue)} });\nawait expect(locator).toHaveCount(1);\nawait expect(locator).toBeVisible();`;
    }
    if (metadata.exportType === "id" && metadata.exportSelector) {
      return `const locator = page.locator(${JSON.stringify(metadata.exportSelector)});\nawait expect(locator).toHaveCount(1);\nawait expect(locator).toBeVisible();`;
    }
    const expression = kind === "css" ? locator : `xpath=${locator}`;
    return `const locator = page.locator(${JSON.stringify(expression)});\nawait expect(locator).toHaveCount(1);\nawait expect(locator).toBeVisible();`;
  }

  function exportSelenium(locator, kind = "xpath", metadata = {}) {
    const by = metadata.exportType === "id" ? "By.ID" : metadata.exportType === "name" ? "By.NAME" : kind === "css" ? "By.CSS_SELECTOR" : "By.XPATH";
    const value = metadata.exportType === "id" || metadata.exportType === "name" ? metadata.exportValue : locator;
    return `from selenium.webdriver.common.by import By\nfrom selenium.webdriver.support.ui import WebDriverWait\nfrom selenium.webdriver.support import expected_conditions as EC\n\nlocator = (${by}, ${JSON.stringify(value)})\nelement = WebDriverWait(driver, 10).until(EC.visibility_of_element_located(locator))`;
  }

  return {
    xpathLiteral, normalizeText, elementText, candidatesForElement,
    validateCandidates, countXPath, countCss, inspectElement,
    exportPlaywright, exportSelenium, candidateScore
  };
});
