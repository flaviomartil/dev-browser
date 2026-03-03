var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// src/snapshot/browser-script.ts
import * as path from "path";
function getSnapshotScript() {
  if (cachedScript) return cachedScript;
  const snapshotDir = path.dirname(new URL(import.meta.url).pathname);
  cachedScript = `
(function() {
  // Skip if already injected
  if (window.__devBrowser_getAISnapshot) return;

  ${getDomUtilsCode()}
  ${getYamlCode()}
  ${getRoleUtilsCode()}
  ${getAriaSnapshotCode()}

  // Expose main functions
  window.__devBrowser_getAISnapshot = getAISnapshot;
  window.__devBrowser_selectSnapshotRef = selectSnapshotRef;
})();
`;
  return cachedScript;
}
function getDomUtilsCode() {
  return `
// === domUtils ===
let cacheStyle;
let cachesCounter = 0;

function beginDOMCaches() {
  ++cachesCounter;
  cacheStyle = cacheStyle || new Map();
}

function endDOMCaches() {
  if (!--cachesCounter) {
    cacheStyle = undefined;
  }
}

function getElementComputedStyle(element, pseudo) {
  const cache = cacheStyle;
  const cacheKey = pseudo ? undefined : element;
  if (cache && cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);
  const style = element.ownerDocument && element.ownerDocument.defaultView
    ? element.ownerDocument.defaultView.getComputedStyle(element, pseudo)
    : undefined;
  if (cache && cacheKey) cache.set(cacheKey, style);
  return style;
}

function parentElementOrShadowHost(element) {
  if (element.parentElement) return element.parentElement;
  if (!element.parentNode) return;
  if (element.parentNode.nodeType === 11 && element.parentNode.host)
    return element.parentNode.host;
}

function enclosingShadowRootOrDocument(element) {
  let node = element;
  while (node.parentNode) node = node.parentNode;
  if (node.nodeType === 11 || node.nodeType === 9)
    return node;
}

function closestCrossShadow(element, css, scope) {
  while (element) {
    const closest = element.closest(css);
    if (scope && closest !== scope && closest?.contains(scope)) return;
    if (closest) return closest;
    element = enclosingShadowHost(element);
  }
}

function enclosingShadowHost(element) {
  while (element.parentElement) element = element.parentElement;
  return parentElementOrShadowHost(element);
}

function isElementStyleVisibilityVisible(element, style) {
  style = style || getElementComputedStyle(element);
  if (!style) return true;
  if (style.visibility !== "visible") return false;
  const detailsOrSummary = element.closest("details,summary");
  if (detailsOrSummary !== element && detailsOrSummary?.nodeName === "DETAILS" && !detailsOrSummary.open)
    return false;
  return true;
}

function computeBox(element) {
  const style = getElementComputedStyle(element);
  if (!style) return { visible: true, inline: false };
  const cursor = style.cursor;
  if (style.display === "contents") {
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 && isElementVisible(child))
        return { visible: true, inline: false, cursor };
      if (child.nodeType === 3 && isVisibleTextNode(child))
        return { visible: true, inline: true, cursor };
    }
    return { visible: false, inline: false, cursor };
  }
  if (!isElementStyleVisibilityVisible(element, style))
    return { cursor, visible: false, inline: false };
  const rect = element.getBoundingClientRect();
  return { rect, cursor, visible: rect.width > 0 && rect.height > 0, inline: style.display === "inline" };
}

function isElementVisible(element) {
  return computeBox(element).visible;
}

function isVisibleTextNode(node) {
  const range = node.ownerDocument.createRange();
  range.selectNode(node);
  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function elementSafeTagName(element) {
  const tagName = element.tagName;
  if (typeof tagName === "string") return tagName.toUpperCase();
  if (element instanceof HTMLFormElement) return "FORM";
  return element.tagName.toUpperCase();
}

function normalizeWhiteSpace(text) {
  return text.split("\\u00A0").map(chunk =>
    chunk.replace(/\\r\\n/g, "\\n").replace(/[\\u200b\\u00ad]/g, "").replace(/\\s\\s*/g, " ")
  ).join("\\u00A0").trim();
}
`;
}
function getYamlCode() {
  return `
// === yaml ===
function yamlEscapeKeyIfNeeded(str) {
  if (!yamlStringNeedsQuotes(str)) return str;
  return "'" + str.replace(/'/g, "''") + "'";
}

function yamlEscapeValueIfNeeded(str) {
  if (!yamlStringNeedsQuotes(str)) return str;
  return '"' + str.replace(/[\\\\"\0-\\x1f\\x7f-\\x9f]/g, c => {
    switch (c) {
      case "\\\\": return "\\\\\\\\";
      case '"': return '\\\\"';
      case "\\b": return "\\\\b";
      case "\\f": return "\\\\f";
      case "\\n": return "\\\\n";
      case "\\r": return "\\\\r";
      case "\\t": return "\\\\t";
      default:
        const code = c.charCodeAt(0);
        return "\\\\x" + code.toString(16).padStart(2, "0");
    }
  }) + '"';
}

function yamlStringNeedsQuotes(str) {
  if (str.length === 0) return true;
  if (/^\\s|\\s$/.test(str)) return true;
  if (/[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f]/.test(str)) return true;
  if (/^-/.test(str)) return true;
  if (/[\\n:](\\s|$)/.test(str)) return true;
  if (/\\s#/.test(str)) return true;
  if (/[\\n\\r]/.test(str)) return true;
  if (/^[&*\\],?!>|@"'#%]/.test(str)) return true;
  if (/[{}\`]/.test(str)) return true;
  if (/^\\[/.test(str)) return true;
  if (!isNaN(Number(str)) || ["y","n","yes","no","true","false","on","off","null"].includes(str.toLowerCase())) return true;
  return false;
}
`;
}
function getRoleUtilsCode() {
  return `
// === roleUtils ===
const validRoles = ["alert","alertdialog","application","article","banner","blockquote","button","caption","cell","checkbox","code","columnheader","combobox","complementary","contentinfo","definition","deletion","dialog","directory","document","emphasis","feed","figure","form","generic","grid","gridcell","group","heading","img","insertion","link","list","listbox","listitem","log","main","mark","marquee","math","meter","menu","menubar","menuitem","menuitemcheckbox","menuitemradio","navigation","none","note","option","paragraph","presentation","progressbar","radio","radiogroup","region","row","rowgroup","rowheader","scrollbar","search","searchbox","separator","slider","spinbutton","status","strong","subscript","superscript","switch","tab","table","tablist","tabpanel","term","textbox","time","timer","toolbar","tooltip","tree","treegrid","treeitem"];

let cacheAccessibleName;
let cacheIsHidden;
let cachePointerEvents;
let ariaCachesCounter = 0;

function beginAriaCaches() {
  beginDOMCaches();
  ++ariaCachesCounter;
  cacheAccessibleName = cacheAccessibleName || new Map();
  cacheIsHidden = cacheIsHidden || new Map();
  cachePointerEvents = cachePointerEvents || new Map();
}

function endAriaCaches() {
  if (!--ariaCachesCounter) {
    cacheAccessibleName = undefined;
    cacheIsHidden = undefined;
    cachePointerEvents = undefined;
  }
  endDOMCaches();
}

function hasExplicitAccessibleName(e) {
  return e.hasAttribute("aria-label") || e.hasAttribute("aria-labelledby");
}

const kAncestorPreventingLandmark = "article:not([role]), aside:not([role]), main:not([role]), nav:not([role]), section:not([role]), [role=article], [role=complementary], [role=main], [role=navigation], [role=region]";

const kGlobalAriaAttributes = [
  ["aria-atomic", undefined],["aria-busy", undefined],["aria-controls", undefined],["aria-current", undefined],
  ["aria-describedby", undefined],["aria-details", undefined],["aria-dropeffect", undefined],["aria-flowto", undefined],
  ["aria-grabbed", undefined],["aria-hidden", undefined],["aria-keyshortcuts", undefined],
  ["aria-label", ["caption","code","deletion","emphasis","generic","insertion","paragraph","presentation","strong","subscript","superscript"]],
  ["aria-labelledby", ["caption","code","deletion","emphasis","generic","insertion","paragraph","presentation","strong","subscript","superscript"]],
  ["aria-live", undefined],["aria-owns", undefined],["aria-relevant", undefined],["aria-roledescription", ["generic"]]
];

function hasGlobalAriaAttribute(element, forRole) {
  return kGlobalAriaAttributes.some(([attr, prohibited]) => !prohibited?.includes(forRole || "") && element.hasAttribute(attr));
}

function hasTabIndex(element) {
  return !Number.isNaN(Number(String(element.getAttribute("tabindex"))));
}

function isFocusable(element) {
  return !isNativelyDisabled(element) && (isNativelyFocusable(element) || hasTabIndex(element));
}

function isNativelyFocusable(element) {
  const tagName = elementSafeTagName(element);
  if (["BUTTON","DETAILS","SELECT","TEXTAREA"].includes(tagName)) return true;
  if (tagName === "A" || tagName === "AREA") return element.hasAttribute("href");
  if (tagName === "INPUT") return !element.hidden;
  return false;
}

function isNativelyDisabled(element) {
  const isNativeFormControl = ["BUTTON","INPUT","SELECT","TEXTAREA","OPTION","OPTGROUP"].includes(elementSafeTagName(element));
  return isNativeFormControl && (element.hasAttribute("disabled") || belongsToDisabledFieldSet(element));
}

function belongsToDisabledFieldSet(element) {
  const fieldSetElement = element?.closest("FIELDSET[DISABLED]");
  if (!fieldSetElement) return false;
  const legendElement = fieldSetElement.querySelector(":scope > LEGEND");
  return !legendElement || !legendElement.contains(element);
}

const inputTypeToRole = {button:"button",checkbox:"checkbox",image:"button",number:"spinbutton",radio:"radio",range:"slider",reset:"button",submit:"button"};

function getIdRefs(element, ref) {
  if (!ref) return [];
  const root = enclosingShadowRootOrDocument(element);
  if (!root) return [];
  try {
    const ids = ref.split(" ").filter(id => !!id);
    const result = [];
    for (const id of ids) {
      const firstElement = root.querySelector("#" + CSS.escape(id));
      if (firstElement && !result.includes(firstElement)) result.push(firstElement);
    }
    return result;
  } catch { return []; }
}

const kImplicitRoleByTagName = {
  A: e => e.hasAttribute("href") ? "link" : null,
  AREA: e => e.hasAttribute("href") ? "link" : null,
  ARTICLE: () => "article", ASIDE: () => "complementary", BLOCKQUOTE: () => "blockquote", BUTTON: () => "button",
  CAPTION: () => "caption", CODE: () => "code", DATALIST: () => "listbox", DD: () => "definition",
  DEL: () => "deletion", DETAILS: () => "group", DFN: () => "term", DIALOG: () => "dialog", DT: () => "term",
  EM: () => "emphasis", FIELDSET: () => "group", FIGURE: () => "figure",
  FOOTER: e => closestCrossShadow(e, kAncestorPreventingLandmark) ? null : "contentinfo",
  FORM: e => hasExplicitAccessibleName(e) ? "form" : null,
  H1: () => "heading", H2: () => "heading", H3: () => "heading", H4: () => "heading", H5: () => "heading", H6: () => "heading",
  HEADER: e => closestCrossShadow(e, kAncestorPreventingLandmark) ? null : "banner",
  HR: () => "separator", HTML: () => "document",
  IMG: e => e.getAttribute("alt") === "" && !e.getAttribute("title") && !hasGlobalAriaAttribute(e) && !hasTabIndex(e) ? "presentation" : "img",
  INPUT: e => {
    const type = e.type.toLowerCase();
    if (type === "search") return e.hasAttribute("list") ? "combobox" : "searchbox";
    if (["email","tel","text","url",""].includes(type)) {
      const list = getIdRefs(e, e.getAttribute("list"))[0];
      return list && elementSafeTagName(list) === "DATALIST" ? "combobox" : "textbox";
    }
    if (type === "hidden") return null;
    if (type === "file") return "button";
    return inputTypeToRole[type] || "textbox";
  },
  INS: () => "insertion", LI: () => "listitem", MAIN: () => "main", MARK: () => "mark", MATH: () => "math",
  MENU: () => "list", METER: () => "meter", NAV: () => "navigation", OL: () => "list", OPTGROUP: () => "group",
  OPTION: () => "option", OUTPUT: () => "status", P: () => "paragraph", PROGRESS: () => "progressbar",
  SEARCH: () => "search", SECTION: e => hasExplicitAccessibleName(e) ? "region" : null,
  SELECT: e => e.hasAttribute("multiple") || e.size > 1 ? "listbox" : "combobox",
  STRONG: () => "strong", SUB: () => "subscript", SUP: () => "superscript", SVG: () => "img",
  TABLE: () => "table", TBODY: () => "rowgroup",
  TD: e => { const table = closestCrossShadow(e, "table"); const role = table ? getExplicitAriaRole(table) : ""; return role === "grid" || role === "treegrid" ? "gridcell" : "cell"; },
  TEXTAREA: () => "textbox", TFOOT: () => "rowgroup",
  TH: e => { const scope = e.getAttribute("scope"); if (scope === "col" || scope === "colgroup") return "columnheader"; if (scope === "row" || scope === "rowgroup") return "rowheader"; return "columnheader"; },
  THEAD: () => "rowgroup", TIME: () => "time", TR: () => "row", UL: () => "list"
};

function getExplicitAriaRole(element) {
  const roles = (element.getAttribute("role") || "").split(" ").map(role => role.trim());
  return roles.find(role => validRoles.includes(role)) || null;
}

function getImplicitAriaRole(element) {
  const fn = kImplicitRoleByTagName[elementSafeTagName(element)];
  return fn ? fn(element) : null;
}

function hasPresentationConflictResolution(element, role) {
  return hasGlobalAriaAttribute(element, role) || isFocusable(element);
}

function getAriaRole(element) {
  const explicitRole = getExplicitAriaRole(element);
  if (!explicitRole) return getImplicitAriaRole(element);
  if (explicitRole === "none" || explicitRole === "presentation") {
    const implicitRole = getImplicitAriaRole(element);
    if (hasPresentationConflictResolution(element, implicitRole)) return implicitRole;
  }
  return explicitRole;
}

function getAriaBoolean(attr) {
  return attr === null ? undefined : attr.toLowerCase() === "true";
}

function isElementIgnoredForAria(element) {
  return ["STYLE","SCRIPT","NOSCRIPT","TEMPLATE"].includes(elementSafeTagName(element));
}

function isElementHiddenForAria(element) {
  if (isElementIgnoredForAria(element)) return true;
  const style = getElementComputedStyle(element);
  const isSlot = element.nodeName === "SLOT";
  if (style?.display === "contents" && !isSlot) {
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 && !isElementHiddenForAria(child)) return false;
      if (child.nodeType === 3 && isVisibleTextNode(child)) return false;
    }
    return true;
  }
  const isOptionInsideSelect = element.nodeName === "OPTION" && !!element.closest("select");
  if (!isOptionInsideSelect && !isSlot && !isElementStyleVisibilityVisible(element, style)) return true;
  return belongsToDisplayNoneOrAriaHiddenOrNonSlotted(element);
}

function belongsToDisplayNoneOrAriaHiddenOrNonSlotted(element) {
  let hidden = cacheIsHidden?.get(element);
  if (hidden === undefined) {
    hidden = false;
    if (element.parentElement && element.parentElement.shadowRoot && !element.assignedSlot) hidden = true;
    if (!hidden) {
      const style = getElementComputedStyle(element);
      hidden = !style || style.display === "none" || getAriaBoolean(element.getAttribute("aria-hidden")) === true;
    }
    if (!hidden) {
      const parent = parentElementOrShadowHost(element);
      if (parent) hidden = belongsToDisplayNoneOrAriaHiddenOrNonSlotted(parent);
    }
    cacheIsHidden?.set(element, hidden);
  }
  return hidden;
}

function getAriaLabelledByElements(element) {
  const ref = element.getAttribute("aria-labelledby");
  if (ref === null) return null;
  const refs = getIdRefs(element, ref);
  return refs.length ? refs : null;
}

function getElementAccessibleName(element, includeHidden) {
  let accessibleName = cacheAccessibleName?.get(element);
  if (accessibleName === undefined) {
    accessibleName = "";
    const elementProhibitsNaming = ["caption","code","definition","deletion","emphasis","generic","insertion","mark","paragraph","presentation","strong","subscript","suggestion","superscript","term","time"].includes(getAriaRole(element) || "");
    if (!elementProhibitsNaming) {
      accessibleName = normalizeWhiteSpace(getTextAlternativeInternal(element, { includeHidden, visitedElements: new Set(), embeddedInTargetElement: "self" }));
    }
    cacheAccessibleName?.set(element, accessibleName);
  }
  return accessibleName;
}

function getTextAlternativeInternal(element, options) {
  if (options.visitedElements.has(element)) return "";
  const childOptions = { ...options, embeddedInTargetElement: options.embeddedInTargetElement === "self" ? "descendant" : options.embeddedInTargetElement };

  if (!options.includeHidden) {
    const isEmbeddedInHiddenReferenceTraversal = !!options.embeddedInLabelledBy?.hidden || !!options.embeddedInLabel?.hidden;
    if (isElementIgnoredForAria(element) || (!isEmbeddedInHiddenReferenceTraversal && isElementHiddenForAria(element))) {
      options.visitedElements.add(element);
      return "";
    }
  }

  const labelledBy = getAriaLabelledByElements(element);
  if (!options.embeddedInLabelledBy) {
    const accessibleName = (labelledBy || []).map(ref => getTextAlternativeInternal(ref, { ...options, embeddedInLabelledBy: { element: ref, hidden: isElementHiddenForAria(ref) }, embeddedInTargetElement: undefined, embeddedInLabel: undefined })).join(" ");
    if (accessibleName) return accessibleName;
  }

  const role = getAriaRole(element) || "";
  const tagName = elementSafeTagName(element);

  const ariaLabel = element.getAttribute("aria-label") || "";
  if (ariaLabel.trim()) { options.visitedElements.add(element); return ariaLabel; }

  if (!["presentation","none"].includes(role)) {
    if (tagName === "INPUT" && ["button","submit","reset"].includes(element.type)) {
      options.visitedElements.add(element);
      const value = element.value || "";
      if (value.trim()) return value;
      if (element.type === "submit") return "Submit";
      if (element.type === "reset") return "Reset";
      return element.getAttribute("title") || "";
    }
    if (tagName === "INPUT" && element.type === "image") {
      options.visitedElements.add(element);
      const alt = element.getAttribute("alt") || "";
      if (alt.trim()) return alt;
      const title = element.getAttribute("title") || "";
      if (title.trim()) return title;
      return "Submit";
    }
    if (tagName === "IMG") {
      options.visitedElements.add(element);
      const alt = element.getAttribute("alt") || "";
      if (alt.trim()) return alt;
      return element.getAttribute("title") || "";
    }
    if (!labelledBy && ["BUTTON","INPUT","TEXTAREA","SELECT"].includes(tagName)) {
      const labels = element.labels;
      if (labels?.length) {
        options.visitedElements.add(element);
        return [...labels].map(label => getTextAlternativeInternal(label, { ...options, embeddedInLabel: { element: label, hidden: isElementHiddenForAria(label) }, embeddedInLabelledBy: undefined, embeddedInTargetElement: undefined })).filter(name => !!name).join(" ");
      }
    }
  }

  const allowsNameFromContent = ["button","cell","checkbox","columnheader","gridcell","heading","link","menuitem","menuitemcheckbox","menuitemradio","option","radio","row","rowheader","switch","tab","tooltip","treeitem"].includes(role);
  if (allowsNameFromContent || !!options.embeddedInLabelledBy || !!options.embeddedInLabel) {
    options.visitedElements.add(element);
    const accessibleName = innerAccumulatedElementText(element, childOptions);
    const maybeTrimmedAccessibleName = options.embeddedInTargetElement === "self" ? accessibleName.trim() : accessibleName;
    if (maybeTrimmedAccessibleName) return accessibleName;
  }

  if (!["presentation","none"].includes(role) || tagName === "IFRAME") {
    options.visitedElements.add(element);
    const title = element.getAttribute("title") || "";
    if (title.trim()) return title;
  }

  options.visitedElements.add(element);
  return "";
}

function innerAccumulatedElementText(element, options) {
  const tokens = [];
  const visit = (node, skipSlotted) => {
    if (skipSlotted && node.assignedSlot) return;
    if (node.nodeType === 1) {
      const display = getElementComputedStyle(node)?.display || "inline";
      let token = getTextAlternativeInternal(node, options);
      if (display !== "inline" || node.nodeName === "BR") token = " " + token + " ";
      tokens.push(token);
    } else if (node.nodeType === 3) {
      tokens.push(node.textContent || "");
    }
  };
  const assignedNodes = element.nodeName === "SLOT" ? element.assignedNodes() : [];
  if (assignedNodes.length) {
    for (const child of assignedNodes) visit(child, false);
  } else {
    for (let child = element.firstChild; child; child = child.nextSibling) visit(child, true);
    if (element.shadowRoot) {
      for (let child = element.shadowRoot.firstChild; child; child = child.nextSibling) visit(child, true);
    }
  }
  return tokens.join("");
}

const kAriaCheckedRoles = ["checkbox","menuitemcheckbox","option","radio","switch","menuitemradio","treeitem"];
function getAriaChecked(element) {
  const tagName = elementSafeTagName(element);
  if (tagName === "INPUT" && element.indeterminate) return "mixed";
  if (tagName === "INPUT" && ["checkbox","radio"].includes(element.type)) return element.checked;
  if (kAriaCheckedRoles.includes(getAriaRole(element) || "")) {
    const checked = element.getAttribute("aria-checked");
    if (checked === "true") return true;
    if (checked === "mixed") return "mixed";
    return false;
  }
  return false;
}

const kAriaDisabledRoles = ["application","button","composite","gridcell","group","input","link","menuitem","scrollbar","separator","tab","checkbox","columnheader","combobox","grid","listbox","menu","menubar","menuitemcheckbox","menuitemradio","option","radio","radiogroup","row","rowheader","searchbox","select","slider","spinbutton","switch","tablist","textbox","toolbar","tree","treegrid","treeitem"];
function getAriaDisabled(element) {
  return isNativelyDisabled(element) || hasExplicitAriaDisabled(element);
}
function hasExplicitAriaDisabled(element, isAncestor) {
  if (!element) return false;
  if (isAncestor || kAriaDisabledRoles.includes(getAriaRole(element) || "")) {
    const attribute = (element.getAttribute("aria-disabled") || "").toLowerCase();
    if (attribute === "true") return true;
    if (attribute === "false") return false;
    return hasExplicitAriaDisabled(parentElementOrShadowHost(element), true);
  }
  return false;
}

const kAriaExpandedRoles = ["application","button","checkbox","combobox","gridcell","link","listbox","menuitem","row","rowheader","tab","treeitem","columnheader","menuitemcheckbox","menuitemradio","switch"];
function getAriaExpanded(element) {
  if (elementSafeTagName(element) === "DETAILS") return element.open;
  if (kAriaExpandedRoles.includes(getAriaRole(element) || "")) {
    const expanded = element.getAttribute("aria-expanded");
    if (expanded === null) return undefined;
    if (expanded === "true") return true;
    return false;
  }
  return undefined;
}

const kAriaLevelRoles = ["heading","listitem","row","treeitem"];
function getAriaLevel(element) {
  const native = {H1:1,H2:2,H3:3,H4:4,H5:5,H6:6}[elementSafeTagName(element)];
  if (native) return native;
  if (kAriaLevelRoles.includes(getAriaRole(element) || "")) {
    const attr = element.getAttribute("aria-level");
    const value = attr === null ? Number.NaN : Number(attr);
    if (Number.isInteger(value) && value >= 1) return value;
  }
  return 0;
}

const kAriaPressedRoles = ["button"];
function getAriaPressed(element) {
  if (kAriaPressedRoles.includes(getAriaRole(element) || "")) {
    const pressed = element.getAttribute("aria-pressed");
    if (pressed === "true") return true;
    if (pressed === "mixed") return "mixed";
  }
  return false;
}

const kAriaSelectedRoles = ["gridcell","option","row","tab","rowheader","columnheader","treeitem"];
function getAriaSelected(element) {
  if (elementSafeTagName(element) === "OPTION") return element.selected;
  if (kAriaSelectedRoles.includes(getAriaRole(element) || "")) return getAriaBoolean(element.getAttribute("aria-selected")) === true;
  return false;
}

function receivesPointerEvents(element) {
  const cache = cachePointerEvents;
  let e = element;
  let result;
  const parents = [];
  for (; e; e = parentElementOrShadowHost(e)) {
    const cached = cache?.get(e);
    if (cached !== undefined) { result = cached; break; }
    parents.push(e);
    const style = getElementComputedStyle(e);
    if (!style) { result = true; break; }
    const value = style.pointerEvents;
    if (value) { result = value !== "none"; break; }
  }
  if (result === undefined) result = true;
  for (const parent of parents) cache?.set(parent, result);
  return result;
}

function getCSSContent(element, pseudo) {
  const style = getElementComputedStyle(element, pseudo);
  if (!style) return undefined;
  const contentValue = style.content;
  if (!contentValue || contentValue === "none" || contentValue === "normal") return undefined;
  if (style.display === "none" || style.visibility === "hidden") return undefined;
  const match = contentValue.match(/^"(.*)"$/);
  if (match) {
    const content = match[1].replace(/\\\\"/g, '"');
    if (pseudo) {
      const display = style.display || "inline";
      if (display !== "inline") return " " + content + " ";
    }
    return content;
  }
  return undefined;
}
`;
}
function getAriaSnapshotCode() {
  return `
// === ariaSnapshot ===
let lastRef = 0;

function generateAriaTree(rootElement) {
  const options = { visibility: "ariaOrVisible", refs: "interactable", refPrefix: "", includeGenericRole: true, renderActive: true, renderCursorPointer: true };
  const visited = new Set();
  const snapshot = {
    root: { role: "fragment", name: "", children: [], element: rootElement, props: {}, box: computeBox(rootElement), receivesPointerEvents: true },
    elements: new Map(),
    refs: new Map(),
    iframeRefs: []
  };

  const visit = (ariaNode, node, parentElementVisible) => {
    if (visited.has(node)) return;
    visited.add(node);
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
      if (!parentElementVisible) return;
      const text = node.nodeValue;
      if (ariaNode.role !== "textbox" && text) ariaNode.children.push(node.nodeValue || "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node;
    const isElementVisibleForAria = !isElementHiddenForAria(element);
    let visible = isElementVisibleForAria;
    if (options.visibility === "ariaOrVisible") visible = isElementVisibleForAria || isElementVisible(element);
    if (options.visibility === "ariaAndVisible") visible = isElementVisibleForAria && isElementVisible(element);
    if (options.visibility === "aria" && !visible) return;
    const ariaChildren = [];
    if (element.hasAttribute("aria-owns")) {
      const ids = element.getAttribute("aria-owns").split(/\\s+/);
      for (const id of ids) {
        const ownedElement = rootElement.ownerDocument.getElementById(id);
        if (ownedElement) ariaChildren.push(ownedElement);
      }
    }
    const childAriaNode = visible ? toAriaNode(element, options) : null;
    if (childAriaNode) {
      if (childAriaNode.ref) {
        snapshot.elements.set(childAriaNode.ref, element);
        snapshot.refs.set(element, childAriaNode.ref);
        if (childAriaNode.role === "iframe") snapshot.iframeRefs.push(childAriaNode.ref);
      }
      ariaNode.children.push(childAriaNode);
    }
    processElement(childAriaNode || ariaNode, element, ariaChildren, visible);
  };

  function processElement(ariaNode, element, ariaChildren, parentElementVisible) {
    const display = getElementComputedStyle(element)?.display || "inline";
    const treatAsBlock = display !== "inline" || element.nodeName === "BR" ? " " : "";
    if (treatAsBlock) ariaNode.children.push(treatAsBlock);
    ariaNode.children.push(getCSSContent(element, "::before") || "");
    const assignedNodes = element.nodeName === "SLOT" ? element.assignedNodes() : [];
    if (assignedNodes.length) {
      for (const child of assignedNodes) visit(ariaNode, child, parentElementVisible);
    } else {
      for (let child = element.firstChild; child; child = child.nextSibling) {
        if (!child.assignedSlot) visit(ariaNode, child, parentElementVisible);
      }
      if (element.shadowRoot) {
        for (let child = element.shadowRoot.firstChild; child; child = child.nextSibling) visit(ariaNode, child, parentElementVisible);
      }
    }
    for (const child of ariaChildren) visit(ariaNode, child, parentElementVisible);
    ariaNode.children.push(getCSSContent(element, "::after") || "");
    if (treatAsBlock) ariaNode.children.push(treatAsBlock);
    if (ariaNode.children.length === 1 && ariaNode.name === ariaNode.children[0]) ariaNode.children = [];
    if (ariaNode.role === "link" && element.hasAttribute("href")) ariaNode.props["url"] = element.getAttribute("href");
    if (ariaNode.role === "textbox" && element.hasAttribute("placeholder") && element.getAttribute("placeholder") !== ariaNode.name) ariaNode.props["placeholder"] = element.getAttribute("placeholder");
  }

  beginAriaCaches();
  try { visit(snapshot.root, rootElement, true); }
  finally { endAriaCaches(); }
  normalizeStringChildren(snapshot.root);
  normalizeGenericRoles(snapshot.root);
  return snapshot;
}

function computeAriaRef(ariaNode, options) {
  if (options.refs === "none") return;
  if (options.refs === "interactable" && (!ariaNode.box.visible || !ariaNode.receivesPointerEvents)) return;
  let ariaRef = ariaNode.element._ariaRef;
  if (!ariaRef || ariaRef.role !== ariaNode.role || ariaRef.name !== ariaNode.name) {
    ariaRef = { role: ariaNode.role, name: ariaNode.name, ref: (options.refPrefix || "") + "e" + (++lastRef) };
    ariaNode.element._ariaRef = ariaRef;
  }
  ariaNode.ref = ariaRef.ref;
}

function toAriaNode(element, options) {
  const active = element.ownerDocument.activeElement === element;
  if (element.nodeName === "IFRAME") {
    const ariaNode = { role: "iframe", name: "", children: [], props: {}, element, box: computeBox(element), receivesPointerEvents: true, active };
    computeAriaRef(ariaNode, options);
    return ariaNode;
  }
  const defaultRole = options.includeGenericRole ? "generic" : null;
  const role = getAriaRole(element) || defaultRole;
  if (!role || role === "presentation" || role === "none") return null;
  const name = normalizeWhiteSpace(getElementAccessibleName(element, false) || "");
  const receivesPointerEventsValue = receivesPointerEvents(element);
  const box = computeBox(element);
  if (role === "generic" && box.inline && element.childNodes.length === 1 && element.childNodes[0].nodeType === Node.TEXT_NODE) return null;
  const result = { role, name, children: [], props: {}, element, box, receivesPointerEvents: receivesPointerEventsValue, active };
  computeAriaRef(result, options);
  if (kAriaCheckedRoles.includes(role)) result.checked = getAriaChecked(element);
  if (kAriaDisabledRoles.includes(role)) result.disabled = getAriaDisabled(element);
  if (kAriaExpandedRoles.includes(role)) result.expanded = getAriaExpanded(element);
  if (kAriaLevelRoles.includes(role)) result.level = getAriaLevel(element);
  if (kAriaPressedRoles.includes(role)) result.pressed = getAriaPressed(element);
  if (kAriaSelectedRoles.includes(role)) result.selected = getAriaSelected(element);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.type !== "checkbox" && element.type !== "radio" && element.type !== "file") result.children = [element.value];
  }
  return result;
}

function normalizeGenericRoles(node) {
  const normalizeChildren = (node) => {
    const result = [];
    for (const child of node.children || []) {
      if (typeof child === "string") { result.push(child); continue; }
      const normalized = normalizeChildren(child);
      result.push(...normalized);
    }
    const removeSelf = node.role === "generic" && !node.name && result.length <= 1 && result.every(c => typeof c !== "string" && !!c.ref);
    if (removeSelf) return result;
    node.children = result;
    return [node];
  };
  normalizeChildren(node);
}

function normalizeStringChildren(rootA11yNode) {
  const flushChildren = (buffer, normalizedChildren) => {
    if (!buffer.length) return;
    const text = normalizeWhiteSpace(buffer.join(""));
    if (text) normalizedChildren.push(text);
    buffer.length = 0;
  };
  const visit = (ariaNode) => {
    const normalizedChildren = [];
    const buffer = [];
    for (const child of ariaNode.children || []) {
      if (typeof child === "string") { buffer.push(child); }
      else { flushChildren(buffer, normalizedChildren); visit(child); normalizedChildren.push(child); }
    }
    flushChildren(buffer, normalizedChildren);
    ariaNode.children = normalizedChildren.length ? normalizedChildren : [];
    if (ariaNode.children.length === 1 && ariaNode.children[0] === ariaNode.name) ariaNode.children = [];
  };
  visit(rootA11yNode);
}

function hasPointerCursor(ariaNode) { return ariaNode.box.cursor === "pointer"; }

function renderAriaTree(ariaSnapshot) {
  const options = { visibility: "ariaOrVisible", refs: "interactable", refPrefix: "", includeGenericRole: true, renderActive: true, renderCursorPointer: true };
  const lines = [];
  let nodesToRender = ariaSnapshot.root.role === "fragment" ? ariaSnapshot.root.children : [ariaSnapshot.root];

  const visitText = (text, indent) => {
    const escaped = yamlEscapeValueIfNeeded(text);
    if (escaped) lines.push(indent + "- text: " + escaped);
  };

  const createKey = (ariaNode, renderCursorPointer) => {
    let key = ariaNode.role;
    if (ariaNode.name && ariaNode.name.length <= 900) {
      const name = ariaNode.name;
      if (name) {
        const stringifiedName = name.startsWith("/") && name.endsWith("/") ? name : JSON.stringify(name);
        key += " " + stringifiedName;
      }
    }
    if (ariaNode.checked === "mixed") key += " [checked=mixed]";
    if (ariaNode.checked === true) key += " [checked]";
    if (ariaNode.disabled) key += " [disabled]";
    if (ariaNode.expanded) key += " [expanded]";
    if (ariaNode.active && options.renderActive) key += " [active]";
    if (ariaNode.level) key += " [level=" + ariaNode.level + "]";
    if (ariaNode.pressed === "mixed") key += " [pressed=mixed]";
    if (ariaNode.pressed === true) key += " [pressed]";
    if (ariaNode.selected === true) key += " [selected]";
    if (ariaNode.ref) {
      key += " [ref=" + ariaNode.ref + "]";
      if (renderCursorPointer && hasPointerCursor(ariaNode)) key += " [cursor=pointer]";
    }
    return key;
  };

  const getSingleInlinedTextChild = (ariaNode) => {
    return ariaNode?.children.length === 1 && typeof ariaNode.children[0] === "string" && !Object.keys(ariaNode.props).length ? ariaNode.children[0] : undefined;
  };

  const visit = (ariaNode, indent, renderCursorPointer) => {
    const escapedKey = indent + "- " + yamlEscapeKeyIfNeeded(createKey(ariaNode, renderCursorPointer));
    const singleInlinedTextChild = getSingleInlinedTextChild(ariaNode);
    if (!ariaNode.children.length && !Object.keys(ariaNode.props).length) {
      lines.push(escapedKey);
    } else if (singleInlinedTextChild !== undefined) {
      lines.push(escapedKey + ": " + yamlEscapeValueIfNeeded(singleInlinedTextChild));
    } else {
      lines.push(escapedKey + ":");
      for (const [name, value] of Object.entries(ariaNode.props)) lines.push(indent + "  - /" + name + ": " + yamlEscapeValueIfNeeded(value));
      const childIndent = indent + "  ";
      const inCursorPointer = !!ariaNode.ref && renderCursorPointer && hasPointerCursor(ariaNode);
      for (const child of ariaNode.children) {
        if (typeof child === "string") visitText(child, childIndent);
        else visit(child, childIndent, renderCursorPointer && !inCursorPointer);
      }
    }
  };

  for (const nodeToRender of nodesToRender) {
    if (typeof nodeToRender === "string") visitText(nodeToRender, "");
    else visit(nodeToRender, "", !!options.renderCursorPointer);
  }
  return lines.join("\\n");
}

function getAISnapshot() {
  const snapshot = generateAriaTree(document.body);
  const refsObject = {};
  for (const [ref, element] of snapshot.elements) refsObject[ref] = element;
  window.__devBrowserRefs = refsObject;
  return renderAriaTree(snapshot);
}

function selectSnapshotRef(ref) {
  const refs = window.__devBrowserRefs;
  if (!refs) throw new Error("No snapshot refs found. Call getAISnapshot first.");
  const element = refs[ref];
  if (!element) throw new Error('Ref "' + ref + '" not found. Available refs: ' + Object.keys(refs).join(", "));
  return element;
}
`;
}
var cachedScript;
var init_browser_script = __esm({
  "src/snapshot/browser-script.ts"() {
    "use strict";
    cachedScript = null;
  }
});

// src/client.ts
var client_exports = {};
__export(client_exports, {
  connect: () => connect,
  waitForPageLoad: () => waitForPageLoad
});
import { chromium } from "playwright";
async function waitForPageLoad(page2, options = {}) {
  const {
    timeout = 1e4,
    pollInterval = 50,
    minimumWait = 100,
    waitForNetworkIdle = true
  } = options;
  const startTime = Date.now();
  let lastState = null;
  if (minimumWait > 0) {
    await new Promise((resolve) => setTimeout(resolve, minimumWait));
  }
  while (Date.now() - startTime < timeout) {
    try {
      lastState = await getPageLoadState(page2);
      const documentReady = lastState.documentReadyState === "complete";
      const networkIdle = !waitForNetworkIdle || lastState.pendingRequests.length === 0;
      if (documentReady && networkIdle) {
        return {
          success: true,
          readyState: lastState.documentReadyState,
          pendingRequests: lastState.pendingRequests.length,
          waitTimeMs: Date.now() - startTime,
          timedOut: false
        };
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
  return {
    success: false,
    readyState: lastState?.documentReadyState ?? "unknown",
    pendingRequests: lastState?.pendingRequests.length ?? 0,
    waitTimeMs: Date.now() - startTime,
    timedOut: true
  };
}
async function getPageLoadState(page2) {
  const result = await page2.evaluate(() => {
    const g = globalThis;
    const perf = g.performance;
    const doc = g.document;
    const now = perf.now();
    const resources = perf.getEntriesByType("resource");
    const pending = [];
    const adPatterns = [
      "doubleclick.net",
      "googlesyndication.com",
      "googletagmanager.com",
      "google-analytics.com",
      "facebook.net",
      "connect.facebook.net",
      "analytics",
      "ads",
      "tracking",
      "pixel",
      "hotjar.com",
      "clarity.ms",
      "mixpanel.com",
      "segment.com",
      "newrelic.com",
      "nr-data.net",
      "/tracker/",
      "/collector/",
      "/beacon/",
      "/telemetry/",
      "/log/",
      "/events/",
      "/track.",
      "/metrics/"
    ];
    const nonCriticalTypes = ["img", "image", "icon", "font"];
    for (const entry of resources) {
      if (entry.responseEnd === 0) {
        const url = entry.name;
        const isAd = adPatterns.some((pattern) => url.includes(pattern));
        if (isAd) continue;
        if (url.startsWith("data:") || url.length > 500) continue;
        const loadingDuration = now - entry.startTime;
        if (loadingDuration > 1e4) continue;
        const resourceType = entry.initiatorType || "unknown";
        if (nonCriticalTypes.includes(resourceType) && loadingDuration > 3e3) continue;
        const isImageUrl = /\.(jpg|jpeg|png|gif|webp|svg|ico)(\?|$)/i.test(url);
        if (isImageUrl && loadingDuration > 3e3) continue;
        pending.push({
          url,
          loadingDurationMs: Math.round(loadingDuration),
          resourceType
        });
      }
    }
    return {
      documentReadyState: doc.readyState,
      documentLoading: doc.readyState !== "complete",
      pendingRequests: pending
    };
  });
  return result;
}
async function connect(serverUrl = "http://localhost:9222") {
  let browser = null;
  let wsEndpoint = null;
  let connectingPromise = null;
  async function ensureConnected() {
    if (browser && browser.isConnected()) {
      return browser;
    }
    if (connectingPromise) {
      return connectingPromise;
    }
    connectingPromise = (async () => {
      try {
        const res = await fetch(serverUrl);
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}: ${await res.text()}`);
        }
        const info = await res.json();
        wsEndpoint = info.wsEndpoint;
        browser = await chromium.connectOverCDP(wsEndpoint);
        return browser;
      } finally {
        connectingPromise = null;
      }
    })();
    return connectingPromise;
  }
  async function findPageByTargetId(b, targetId) {
    for (const context of b.contexts()) {
      for (const page2 of context.pages()) {
        let cdpSession;
        try {
          cdpSession = await context.newCDPSession(page2);
          const { targetInfo } = await cdpSession.send("Target.getTargetInfo");
          if (targetInfo.targetId === targetId) {
            return page2;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("Target closed") && !msg.includes("Session closed")) {
            console.warn(`Unexpected error checking page target: ${msg}`);
          }
        } finally {
          if (cdpSession) {
            try {
              await cdpSession.detach();
            } catch {
            }
          }
        }
      }
    }
    return null;
  }
  async function getPage(name2, options) {
    const res = await fetch(`${serverUrl}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name2, viewport: options?.viewport })
    });
    if (!res.ok) {
      throw new Error(`Failed to get page: ${await res.text()}`);
    }
    const pageInfo = await res.json();
    const { targetId } = pageInfo;
    const b = await ensureConnected();
    const infoRes = await fetch(serverUrl);
    const info = await infoRes.json();
    const isExtensionMode = info.mode === "extension";
    if (isExtensionMode) {
      const allPages = b.contexts().flatMap((ctx) => ctx.pages());
      if (allPages.length === 0) {
        throw new Error(`No pages available in browser`);
      }
      if (allPages.length === 1) {
        return allPages[0];
      }
      if (pageInfo.url) {
        const matchingPage = allPages.find((p) => p.url() === pageInfo.url);
        if (matchingPage) {
          return matchingPage;
        }
      }
      if (!allPages[0]) {
        throw new Error(`No pages available in browser`);
      }
      return allPages[0];
    }
    const page2 = await findPageByTargetId(b, targetId);
    if (!page2) {
      throw new Error(`Page "${name2}" not found in browser contexts`);
    }
    return page2;
  }
  return {
    page: getPage,
    async list() {
      const res = await fetch(`${serverUrl}/pages`);
      const data = await res.json();
      return data.pages;
    },
    async close(name2) {
      const res = await fetch(`${serverUrl}/pages/${encodeURIComponent(name2)}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        throw new Error(`Failed to close page: ${await res.text()}`);
      }
    },
    async disconnect() {
      if (browser) {
        await browser.close();
        browser = null;
      }
    },
    async getAISnapshot(name) {
      const page = await getPage(name);
      const snapshotScript = getSnapshotScript();
      const snapshot = await page.evaluate((script) => {
        const w = globalThis;
        if (!w.__devBrowser_getAISnapshot) {
          eval(script);
        }
        return w.__devBrowser_getAISnapshot();
      }, snapshotScript);
      return snapshot;
    },
    async selectSnapshotRef(name2, ref) {
      const page2 = await getPage(name2);
      const elementHandle = await page2.evaluateHandle((refId) => {
        const w2 = globalThis;
        const refs = w2.__devBrowserRefs;
        if (!refs) {
          throw new Error("No snapshot refs found. Call getAISnapshot first.");
        }
        const element2 = refs[refId];
        if (!element2) {
          throw new Error(
            `Ref "${refId}" not found. Available refs: ${Object.keys(refs).join(", ")}`
          );
        }
        return element2;
      }, ref);
      const element = elementHandle.asElement();
      if (!element) {
        await elementHandle.dispose();
        return null;
      }
      return element;
    },
    async getServerInfo() {
      const res = await fetch(serverUrl);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}: ${await res.text()}`);
      }
      const info = await res.json();
      return {
        wsEndpoint: info.wsEndpoint,
        mode: info.mode ?? "launch",
        extensionConnected: info.extensionConnected
      };
    },
    async listTabs() {
      const res = await fetch(`${serverUrl}/tabs`);
      if (!res.ok) {
        throw new Error(`Failed to list tabs: ${await res.text()}`);
      }
      const data = await res.json();
      return data.tabs;
    },
    async attachTab(tabId, name2) {
      const res = await fetch(`${serverUrl}/tabs/${tabId}/attach`, {
        method: "POST"
      });
      if (!res.ok) {
        throw new Error(`Failed to attach tab: ${await res.text()}`);
      }
      return await res.json();
    },
    async snapshot() {
      const res = await fetch(`${serverUrl}/targets`);
      if (!res.ok) {
        throw new Error(`Failed to get targets: ${await res.text()}`);
      }
      const data = await res.json();
      return data.targets;
    }
  };
}
var init_client = __esm({
  "src/client.ts"() {
    "use strict";
    init_browser_script();
  }
});

// src/mcp-server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// src/relay.ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
async function serveRelay(options = {}) {
  const port = options.port ?? 9222;
  const host = options.host ?? "127.0.0.1";
  const connectedTargets = /* @__PURE__ */ new Map();
  const namedPages = /* @__PURE__ */ new Map();
  const playwrightClients = /* @__PURE__ */ new Map();
  let extensionWs = null;
  const extensionPendingRequests = /* @__PURE__ */ new Map();
  let extensionMessageId = 0;
  function log2(...args) {
    console.error("[relay]", ...args);
  }
  function sendToPlaywright(message, clientId) {
    const messageStr = JSON.stringify(message);
    if (clientId) {
      const client2 = playwrightClients.get(clientId);
      if (client2) {
        client2.ws.send(messageStr);
      }
    } else {
      for (const client2 of playwrightClients.values()) {
        client2.ws.send(messageStr);
      }
    }
  }
  function sendAttachedToTarget(target, clientId, waitingForDebugger = false) {
    const event = {
      method: "Target.attachedToTarget",
      params: {
        sessionId: target.sessionId,
        targetInfo: { ...target.targetInfo, attached: true },
        waitingForDebugger
      }
    };
    if (clientId) {
      const client2 = playwrightClients.get(clientId);
      if (client2 && !client2.knownTargets.has(target.targetId)) {
        client2.knownTargets.add(target.targetId);
        client2.ws.send(JSON.stringify(event));
      }
    } else {
      for (const client2 of playwrightClients.values()) {
        if (!client2.knownTargets.has(target.targetId)) {
          client2.knownTargets.add(target.targetId);
          client2.ws.send(JSON.stringify(event));
        }
      }
    }
  }
  async function sendToExtension({
    method,
    params,
    timeout = 3e4
  }) {
    if (!extensionWs) {
      throw new Error("Extension not connected");
    }
    const id = ++extensionMessageId;
    const message = { id, method, params };
    extensionWs.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        extensionPendingRequests.delete(id);
        reject(new Error(`Extension request timeout after ${timeout}ms: ${method}`));
      }, timeout);
      extensionPendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
    });
  }
  async function routeCdpCommand({
    method,
    params,
    sessionId
  }) {
    switch (method) {
      case "Browser.getVersion":
        return {
          protocolVersion: "1.3",
          product: "Chrome/Extension-Bridge",
          revision: "1.0.0",
          userAgent: "dev-browser-relay/1.0.0",
          jsVersion: "V8"
        };
      case "Browser.setDownloadBehavior":
        return {};
      case "Target.setAutoAttach":
        if (sessionId) {
          break;
        }
        return {};
      case "Target.setDiscoverTargets":
        return {};
      case "Target.attachToBrowserTarget":
        return { sessionId: "browser" };
      case "Target.detachFromTarget":
        if (sessionId === "browser" || params?.sessionId === "browser") {
          return {};
        }
        break;
      case "Target.attachToTarget": {
        const targetId = params?.targetId;
        if (!targetId) {
          throw new Error("targetId is required for Target.attachToTarget");
        }
        for (const target of connectedTargets.values()) {
          if (target.targetId === targetId) {
            return { sessionId: target.sessionId };
          }
        }
        throw new Error(`Target ${targetId} not found in connected targets`);
      }
      case "Target.getTargetInfo": {
        const targetId = params?.targetId;
        if (targetId) {
          for (const target of connectedTargets.values()) {
            if (target.targetId === targetId) {
              return { targetInfo: target.targetInfo };
            }
          }
        }
        if (sessionId) {
          const target = connectedTargets.get(sessionId);
          if (target) {
            return { targetInfo: target.targetInfo };
          }
        }
        const firstTarget = Array.from(connectedTargets.values())[0];
        return { targetInfo: firstTarget?.targetInfo };
      }
      case "Target.getTargets":
        return {
          targetInfos: Array.from(connectedTargets.values()).map((t) => ({
            ...t.targetInfo,
            attached: true
          }))
        };
      case "Target.createTarget":
      case "Target.closeTarget":
        return await sendToExtension({
          method: "forwardCDPCommand",
          params: { method, params }
        });
    }
    return await sendToExtension({
      method: "forwardCDPCommand",
      params: { sessionId, method, params }
    });
  }
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  app.get("/", (c) => {
    return c.json({
      wsEndpoint: `ws://${host}:${port}/cdp`,
      extensionConnected: extensionWs !== null,
      mode: "extension"
    });
  });
  app.get("/pages", (c) => {
    return c.json({
      pages: Array.from(namedPages.keys())
    });
  });
  app.post("/pages", async (c) => {
    const body = await c.req.json();
    const name2 = body.name;
    if (!name2) {
      return c.json({ error: "name is required" }, 400);
    }
    const existingSessionId = namedPages.get(name2);
    if (existingSessionId) {
      const target = connectedTargets.get(existingSessionId);
      if (target) {
        await sendToExtension({
          method: "forwardCDPCommand",
          params: {
            method: "Target.activateTarget",
            params: { targetId: target.targetId }
          }
        });
        return c.json({
          wsEndpoint: `ws://${host}:${port}/cdp`,
          name: name2,
          targetId: target.targetId,
          url: target.targetInfo.url
        });
      }
      namedPages.delete(name2);
    }
    if (!extensionWs) {
      return c.json({ error: "Extension not connected" }, 503);
    }
    try {
      const result = await sendToExtension({
        method: "forwardCDPCommand",
        params: { method: "Target.createTarget", params: { url: "about:blank" } }
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      for (const [sessionId, target] of connectedTargets) {
        if (target.targetId === result.targetId) {
          namedPages.set(name2, sessionId);
          await sendToExtension({
            method: "forwardCDPCommand",
            params: {
              method: "Target.activateTarget",
              params: { targetId: target.targetId }
            }
          });
          return c.json({
            wsEndpoint: `ws://${host}:${port}/cdp`,
            name: name2,
            targetId: target.targetId,
            url: target.targetInfo.url
          });
        }
      }
      throw new Error("Target created but not found in registry");
    } catch (err) {
      log2("Error creating tab:", err);
      return c.json({ error: err.message }, 500);
    }
  });
  app.delete("/pages/:name", (c) => {
    const name2 = c.req.param("name");
    const deleted = namedPages.delete(name2);
    return c.json({ success: deleted });
  });
  app.get("/tabs", async (c) => {
    if (!extensionWs) {
      return c.json({ error: "Extension not connected" }, 503);
    }
    try {
      const result = await sendToExtension({ method: "listTabs" });
      return c.json(result);
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });
  app.post("/tabs/:tabId/attach", async (c) => {
    if (!extensionWs) {
      return c.json({ error: "Extension not connected" }, 503);
    }
    const tabId = parseInt(c.req.param("tabId"), 10);
    if (isNaN(tabId)) {
      return c.json({ error: "Invalid tabId" }, 400);
    }
    try {
      const result = await sendToExtension({
        method: "attachTab",
        params: { tabId }
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      for (const [sessionId, target] of connectedTargets) {
        if (!namedPages.has(`tab-${tabId}`)) {
          namedPages.set(`tab-${tabId}`, sessionId);
          break;
        }
      }
      return c.json(result);
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });
  app.get("/targets", (c) => {
    const targets = Array.from(connectedTargets.values()).map((t) => ({
      sessionId: t.sessionId,
      targetId: t.targetId,
      title: t.targetInfo.title,
      url: t.targetInfo.url
    }));
    return c.json({ targets });
  });
  app.get(
    "/cdp/:clientId?",
    upgradeWebSocket((c) => {
      const clientId = c.req.param("clientId") || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return {
        onOpen(_event, ws) {
          if (playwrightClients.has(clientId)) {
            log2(`Rejecting duplicate client ID: ${clientId}`);
            ws.close(1e3, "Client ID already connected");
            return;
          }
          playwrightClients.set(clientId, { id: clientId, ws, knownTargets: /* @__PURE__ */ new Set() });
          log2(`Playwright client connected: ${clientId}`);
        },
        async onMessage(event, _ws) {
          let message;
          try {
            message = JSON.parse(event.data.toString());
          } catch {
            return;
          }
          const { id, sessionId, method, params } = message;
          if (!extensionWs) {
            sendToPlaywright(
              {
                id,
                sessionId,
                error: { message: "Extension not connected" }
              },
              clientId
            );
            return;
          }
          try {
            const result = await routeCdpCommand({ method, params, sessionId });
            if (method === "Target.setAutoAttach" && !sessionId) {
              for (const target of connectedTargets.values()) {
                sendAttachedToTarget(target, clientId);
              }
            }
            if (method === "Target.setDiscoverTargets" && params?.discover) {
              for (const target of connectedTargets.values()) {
                sendToPlaywright(
                  {
                    method: "Target.targetCreated",
                    params: {
                      targetInfo: { ...target.targetInfo, attached: true }
                    }
                  },
                  clientId
                );
              }
            }
            if (method === "Target.attachToTarget" && result?.sessionId) {
              const targetId = params?.targetId;
              const target = Array.from(connectedTargets.values()).find(
                (t) => t.targetId === targetId
              );
              if (target) {
                sendAttachedToTarget(target, clientId);
              }
            }
            sendToPlaywright({ id, sessionId, result }, clientId);
          } catch (e) {
            log2("Error handling CDP command:", method, e);
            sendToPlaywright(
              {
                id,
                sessionId,
                error: { message: e.message }
              },
              clientId
            );
          }
        },
        onClose() {
          playwrightClients.delete(clientId);
          log2(`Playwright client disconnected: ${clientId}`);
        },
        onError(event) {
          log2(`Playwright WebSocket error [${clientId}]:`, event);
        }
      };
    })
  );
  app.get(
    "/extension",
    upgradeWebSocket(() => {
      return {
        onOpen(_event, ws) {
          if (extensionWs) {
            log2("Closing existing extension connection");
            extensionWs.close(4001, "Extension Replaced");
            connectedTargets.clear();
            namedPages.clear();
            for (const pending of extensionPendingRequests.values()) {
              pending.reject(new Error("Extension connection replaced"));
            }
            extensionPendingRequests.clear();
          }
          extensionWs = ws;
          log2("Extension connected");
        },
        async onMessage(event, ws) {
          let message;
          try {
            message = JSON.parse(event.data.toString());
          } catch {
            ws.close(1e3, "Invalid JSON");
            return;
          }
          if ("id" in message && typeof message.id === "number") {
            const pending = extensionPendingRequests.get(message.id);
            if (!pending) {
              log2("Unexpected response with id:", message.id);
              return;
            }
            extensionPendingRequests.delete(message.id);
            if (message.error) {
              pending.reject(new Error(message.error));
            } else {
              pending.resolve(message.result);
            }
            return;
          }
          if ("method" in message && message.method === "log") {
            const { level, args } = message.params;
            console.error(`[extension:${level}]`, ...args);
            return;
          }
          if ("method" in message && message.method === "forwardCDPEvent") {
            const eventMsg = message;
            const { method, params, sessionId } = eventMsg.params;
            if (method === "Target.attachedToTarget") {
              const targetParams = params;
              const target = {
                sessionId: targetParams.sessionId,
                targetId: targetParams.targetInfo.targetId,
                targetInfo: targetParams.targetInfo
              };
              connectedTargets.set(targetParams.sessionId, target);
              log2(`Target attached: ${targetParams.targetInfo.url} (${targetParams.sessionId})`);
              sendAttachedToTarget(target);
            } else if (method === "Target.detachedFromTarget") {
              const detachParams = params;
              connectedTargets.delete(detachParams.sessionId);
              for (const [name2, sid] of namedPages) {
                if (sid === detachParams.sessionId) {
                  namedPages.delete(name2);
                  break;
                }
              }
              log2(`Target detached: ${detachParams.sessionId}`);
              sendToPlaywright({
                method: "Target.detachedFromTarget",
                params: detachParams
              });
            } else if (method === "Target.targetInfoChanged") {
              const infoParams = params;
              for (const target of connectedTargets.values()) {
                if (target.targetId === infoParams.targetInfo.targetId) {
                  target.targetInfo = infoParams.targetInfo;
                  break;
                }
              }
              sendToPlaywright({
                method: "Target.targetInfoChanged",
                params: infoParams
              });
            } else {
              sendToPlaywright({
                sessionId,
                method,
                params
              });
            }
          }
        },
        onClose(_event, ws) {
          if (extensionWs && extensionWs !== ws) {
            log2("Old extension connection closed");
            return;
          }
          log2("Extension disconnected");
          for (const pending of extensionPendingRequests.values()) {
            pending.reject(new Error("Extension connection closed"));
          }
          extensionPendingRequests.clear();
          extensionWs = null;
          connectedTargets.clear();
          namedPages.clear();
          for (const client2 of playwrightClients.values()) {
            client2.ws.close(1e3, "Extension disconnected");
          }
          playwrightClients.clear();
        },
        onError(event) {
          log2("Extension WebSocket error:", event);
        }
      };
    })
  );
  const server = serve({ fetch: app.fetch, port, hostname: host });
  injectWebSocket(server);
  const wsEndpoint2 = `ws://${host}:${port}/cdp`;
  log2("CDP relay server started");
  log2(`  HTTP: http://${host}:${port}`);
  log2(`  CDP endpoint: ${wsEndpoint2}`);
  log2(`  Extension endpoint: ws://${host}:${port}/extension`);
  log2("");
  log2("Waiting for extension to connect...");
  return {
    wsEndpoint: wsEndpoint2,
    port,
    async stop() {
      for (const client2 of playwrightClients.values()) {
        client2.ws.close(1e3, "Server stopped");
      }
      playwrightClients.clear();
      extensionWs?.close(1e3, "Server stopped");
      server.close();
    }
  };
}

// src/mcp-server.ts
init_client();
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname as dirname2 } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
var __dirname = dirname2(fileURLToPath(import.meta.url));
function log(...args) {
  console.error("[mcp]", ...args);
}
var relay = null;
var client = null;
var initializing = null;
async function ensureReady() {
  if (client) return client;
  if (initializing) {
    await initializing;
    return client;
  }
  initializing = (async () => {
    try {
      const res = await fetch("http://127.0.0.1:9222", {
        signal: AbortSignal.timeout(1e3)
      });
      if (res.ok) {
        log("Relay already running on port 9222");
      }
    } catch {
      log("Starting relay server...");
      relay = await serveRelay({ port: 9222, host: "127.0.0.1" });
      log("Relay started");
    }
    client = await connect("http://127.0.0.1:9222");
    log("Client connected");
  })();
  try {
    await initializing;
  } finally {
    initializing = null;
  }
  return client;
}
async function resolvePageName(name2) {
  const c = await ensureReady();
  if (name2) {
    const page2 = await c.page(name2);
    return { page: page2, pageName: name2 };
  }
  const targets = await c.snapshot();
  if (targets.length > 0) {
    const t = targets[0];
    const pageName = `target-${t.targetId.slice(0, 8)}`;
    const page2 = await c.page(pageName);
    return { page: page2, pageName };
  }
  const tabs = await c.listTabs();
  const activeTab = tabs.find((t) => t.active);
  if (activeTab) {
    const result = await c.attachTab(activeTab.tabId);
    const pageName = `tab-${activeTab.tabId}`;
    const page2 = await c.page(pageName);
    return { page: page2, pageName };
  }
  throw new Error("No tabs available. Open a tab in the browser first.");
}
var TOOLS = [
  {
    name: "browser_list_tabs",
    description: "List all browser tabs with their IDs, titles, URLs, and whether they are attached for automation.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "browser_attach_tab",
    description: "Attach to a browser tab by its tab ID to enable automation. Optionally assign a name for easy reference.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "The tab ID to attach to" },
        name: { type: "string", description: "Optional name to assign to the attached tab" }
      },
      required: ["tabId"]
    }
  },
  {
    name: "browser_snapshot",
    description: "List all currently controlled (attached) targets with their session IDs, titles, and URLs.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "browser_navigate",
    description: "Navigate a page to a URL and wait for it to load.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to navigate to" },
        name: { type: "string", description: "Page name (auto-resolves if omitted)" }
      },
      required: ["url"]
    }
  },
  {
    name: "browser_read_page",
    description: "Read the text content of a page or a specific element. Returns innerText truncated to 50k characters.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Page name (auto-resolves if omitted)" },
        selector: { type: "string", description: "CSS selector to read from (defaults to body)" }
      }
    }
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of a page. Returns the file path to the saved PNG image.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Page name (auto-resolves if omitted)" },
        fullPage: { type: "boolean", description: "Capture full scrollable page (default: false)" }
      }
    }
  },
  {
    name: "browser_click",
    description: "Click an element on a page by CSS selector or text content.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector or text to click" },
        name: { type: "string", description: "Page name (auto-resolves if omitted)" }
      },
      required: ["selector"]
    }
  },
  {
    name: "browser_type",
    description: "Type text into an input element on a page.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the input element" },
        text: { type: "string", description: "Text to type" },
        name: { type: "string", description: "Page name (auto-resolves if omitted)" },
        pressEnter: { type: "boolean", description: "Press Enter after typing (default: false)" }
      },
      required: ["selector", "text"]
    }
  },
  {
    name: "browser_evaluate",
    description: "Execute JavaScript in the page context and return the result.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "JavaScript code to evaluate" },
        name: { type: "string", description: "Page name (auto-resolves if omitted)" }
      },
      required: ["script"]
    }
  },
  {
    name: "browser_get_snapshot",
    description: "Get an ARIA accessibility tree snapshot of the page in YAML format. Useful for understanding page structure without screenshots.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Page name (auto-resolves if omitted)" }
      }
    }
  }
];
async function handleToolCall(name2, args) {
  const text = (t) => ({ content: [{ type: "text", text: t }] });
  try {
    switch (name2) {
      case "browser_list_tabs": {
        const c = await ensureReady();
        const tabs = await c.listTabs();
        return text(JSON.stringify(tabs, null, 2));
      }
      case "browser_attach_tab": {
        const c = await ensureReady();
        const tabId = args.tabId;
        const tabName = args.name;
        const result = await c.attachTab(tabId, tabName);
        return text(JSON.stringify(result, null, 2));
      }
      case "browser_snapshot": {
        const c = await ensureReady();
        const targets = await c.snapshot();
        return text(JSON.stringify(targets, null, 2));
      }
      case "browser_navigate": {
        const url = args.url;
        const { page: page2, pageName } = await resolvePageName(args.name);
        await page2.goto(url, { waitUntil: "domcontentloaded", timeout: 3e4 });
        const { waitForPageLoad: waitForPageLoad2 } = await Promise.resolve().then(() => (init_client(), client_exports));
        await waitForPageLoad2(page2, { timeout: 1e4 });
        const title = await page2.title();
        return text(`Navigated "${pageName}" to ${url}
Title: ${title}`);
      }
      case "browser_read_page": {
        const { page: page2 } = await resolvePageName(args.name);
        const selector = args.selector || "body";
        const content = await page2.evaluate(
          (sel) => {
            const doc = globalThis.document;
            const el = doc.querySelector(sel);
            return el ? el.innerText : `Element not found: ${sel}`;
          },
          selector
        );
        const truncated = content.length > 5e4 ? content.slice(0, 5e4) + "\n...[truncated]" : content;
        return text(truncated);
      }
      case "browser_screenshot": {
        const { page: page2, pageName } = await resolvePageName(args.name);
        const fullPage = args.fullPage ?? false;
        const screenshotDir = join(tmpdir(), "dev-browser-screenshots");
        mkdirSync(screenshotDir, { recursive: true });
        const filename = `screenshot-${Date.now()}.png`;
        const filepath = join(screenshotDir, filename);
        const buffer = await page2.screenshot({ fullPage, type: "png" });
        writeFileSync(filepath, buffer);
        return text(`Screenshot saved: ${filepath}
Page: ${pageName}
Use the Read tool to view it.`);
      }
      case "browser_click": {
        const { page: page2 } = await resolvePageName(args.name);
        const selector = args.selector;
        try {
          await page2.locator(selector).click({ timeout: 5e3 });
        } catch {
          await page2.getByText(selector, { exact: false }).first().click({ timeout: 5e3 });
        }
        return text(`Clicked: ${selector}`);
      }
      case "browser_type": {
        const { page: page2 } = await resolvePageName(args.name);
        const selector = args.selector;
        const inputText = args.text;
        const pressEnter = args.pressEnter ?? false;
        const locator = page2.locator(selector);
        await locator.fill(inputText, { timeout: 5e3 });
        if (pressEnter) {
          await locator.press("Enter");
        }
        return text(`Typed "${inputText}" into ${selector}${pressEnter ? " + Enter" : ""}`);
      }
      case "browser_evaluate": {
        const { page: page2 } = await resolvePageName(args.name);
        const script2 = args.script;
        const result = await page2.evaluate(script2);
        const output = result === void 0 ? "undefined" : JSON.stringify(result, null, 2);
        return text(output);
      }
      case "browser_get_snapshot": {
        const c = await ensureReady();
        const pageName = args.name;
        if (pageName) {
          const snapshot3 = await c.getAISnapshot(pageName);
          return text(snapshot3);
        }
        const targets = await c.snapshot();
        if (targets.length === 0) {
          throw new Error("No controlled targets. Use browser_attach_tab first.");
        }
        const t = targets[0];
        const autoName = `target-${t.targetId.slice(0, 8)}`;
        await c.page(autoName);
        const snapshot2 = await c.getAISnapshot(autoName);
        return text(snapshot2);
      }
      default:
        return text(`Unknown tool: ${name2}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Tool error [${name2}]:`, message);
    return { content: [{ type: "text", text: `Error: ${message}` }] };
  }
}
async function startMcpServer() {
  const server = new Server(
    { name: "dev-browser", version: "0.0.1" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: name2, arguments: args } = request.params;
    return handleToolCall(name2, args ?? {});
  });
  const shutdown = async () => {
    log("Shutting down...");
    if (client) {
      try {
        await client.disconnect();
      } catch {
      }
      client = null;
    }
    if (relay) {
      try {
        await relay.stop();
      } catch {
      }
      relay = null;
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server running on stdio");
}

// scripts/start-mcp.ts
startMcpServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
