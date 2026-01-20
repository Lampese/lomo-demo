import "./style.css";
import {
  create_doc,
  apply_edit_utf16,
  mark_utf16,
  unmark_utf16,
  render_html,
  get_text,
  drain_updates,
  apply_updates,
} from "../_build/js/release/build/lomo_web.js";

const DEBUG =
  new URLSearchParams(window.location.search).has("debug") ||
  window.localStorage.getItem("lomoDebug") === "1";

function debug(label, payload) {
  if (!DEBUG) return;
  if (payload === undefined) {
    console.log(`[lomo-web] ${label}`);
  } else {
    console.log(`[lomo-web] ${label}`, payload);
  }
}

const linkToggle = document.querySelector("#linkToggle");
const linkLabel = document.querySelector("#linkLabel");
const linkPulse = document.querySelector("#linkPulse");
const queueAB = document.querySelector("#queueAB");
const queueBA = document.querySelector("#queueBA");

const leftEditor = document.querySelector('[data-editor="left"]');
const rightEditor = document.querySelector('[data-editor="right"]');

const leftId = create_doc(1);
const rightId = create_doc(2);

const state = {
  online: true,
  left: {
    id: leftId,
    el: leftEditor,
    text: "",
    outbox: [],
    isRendering: false,
    ignoreInput: false,
    renderToken: 0,
    lastSelection: null,
  },
  right: {
    id: rightId,
    el: rightEditor,
    text: "",
    outbox: [],
    isRendering: false,
    ignoreInput: false,
    renderToken: 0,
    lastSelection: null,
  },
};

function readText(el) {
  return (el.textContent || "").replace(/\u00a0/g, " ");
}

function diffText(prev, next) {
  if (prev === next) return null;
  let start = 0;
  const prevLen = prev.length;
  const nextLen = next.length;
  while (start < prevLen && start < nextLen && prev[start] === next[start]) {
    start += 1;
  }
  let endPrev = prevLen - 1;
  let endNext = nextLen - 1;
  while (
    endPrev >= start &&
    endNext >= start &&
    prev[endPrev] === next[endNext]
  ) {
    endPrev -= 1;
    endNext -= 1;
  }
  const deleteCount = Math.max(0, endPrev - start + 1);
  const insertText = next.slice(start, endNext + 1);
  return { start, deleteCount, insertText };
}

function selectionOffsets(root) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return null;
  }
  const startRange = document.createRange();
  startRange.setStart(root, 0);
  startRange.setEnd(range.startContainer, range.startOffset);
  const start = startRange.toString().length;

  const endRange = document.createRange();
  endRange.setStart(root, 0);
  endRange.setEnd(range.endContainer, range.endOffset);
  const end = endRange.toString().length;

  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function findNodeAtOffset(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  let count = 0;
  while (current) {
    const len = current.textContent.length;
    if (count + len >= offset) {
      return { node: current, offset: offset - count };
    }
    count += len;
    current = walker.nextNode();
  }
  return { node: root, offset: root.childNodes.length };
}

function restoreSelection(root, selection) {
  if (!selection) return;
  const startPos = findNodeAtOffset(root, selection.start);
  const endPos = findNodeAtOffset(root, selection.end);
  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function renderEditor(side, keepSelection) {
  const selection = keepSelection ? selectionOffsets(side.el) : null;
  const renderToken = side.renderToken + 1;
  side.renderToken = renderToken;
  side.isRendering = true;
  side.ignoreInput = true;
  const html = render_html(side.id);
  side.el.innerHTML = html || "";
  side.text = get_text(side.id);
  debug("render", {
    doc: side.id,
    keepSelection,
    htmlLen: html ? html.length : 0,
    textLen: side.text.length,
  });
  restoreSelection(side.el, selection);
  if (selection && selection.start !== selection.end) {
    side.lastSelection = selection;
  }
  side.isRendering = false;
  setTimeout(() => {
    if (side.renderToken === renderToken) {
      side.ignoreInput = false;
    }
  }, 0);
}

function updateQueues() {
  queueAB.textContent = String(state.left.outbox.length);
  queueBA.textContent = String(state.right.outbox.length);
}

function applyUpdates(to, updates) {
  if (!updates.length) return;
  debug("applyUpdates", { target: to.id, count: updates.length });
  apply_updates(to.id, updates);
  renderEditor(to, document.activeElement === to.el);
}

function syncFrom(from, to) {
  const updates = drain_updates(from.id);
  debug("drainUpdates", {
    from: from.id,
    count: updates.length,
    online: state.online,
  });
  if (!updates.length) return;
  if (state.online) {
    applyUpdates(to, updates);
  } else {
    from.outbox.push(...updates);
  }
  updateQueues();
}

function flushOutbox(from, to) {
  if (!from.outbox.length) return;
  const updates = from.outbox.splice(0, from.outbox.length);
  debug("flushOutbox", { from: from.id, to: to.id, count: updates.length });
  applyUpdates(to, updates);
  updateQueues();
}

function handleInput(side, other, event) {
  if (side.isRendering || side.ignoreInput) return;
  if (event && event.isTrusted === false) return;
  const nextText = readText(side.el);
  const change = diffText(side.text, nextText);
  if (!change) return;
  debug("inputChange", {
    doc: side.id,
    start: change.start,
    deleteCount: change.deleteCount,
    insertLen: change.insertText.length,
  });
  const ok = apply_edit_utf16(
    side.id,
    change.start,
    change.deleteCount,
    change.insertText,
  );
  debug("applyEdit", { doc: side.id, ok });
  if (!ok) {
    renderEditor(side, true);
    return;
  }
  side.text = nextText;
  syncFrom(side, other);
}

function resolveSelection(side) {
  const current = selectionOffsets(side.el);
  if (current && current.start !== current.end) {
    side.lastSelection = current;
    return current;
  }
  return side.lastSelection;
}

function clampSelection(side, selection) {
  if (!selection) return null;
  const maxLen = side.text.length;
  let start = Math.max(0, Math.min(selection.start, maxLen));
  let end = Math.max(0, Math.min(selection.end, maxLen));
  if (end <= start) return null;
  return { start, end };
}

function applyMark(side, other, key) {
  const selection = clampSelection(side, resolveSelection(side));
  if (!selection) return;
  const len = selection.end - selection.start;
  const ok = mark_utf16(side.id, selection.start, len, key);
  debug("mark", { doc: side.id, key, selection, ok });
  renderEditor(side, true);
  syncFrom(side, other);
}

function clearMarks(side, other) {
  const selection = clampSelection(side, resolveSelection(side));
  if (!selection) return;
  const len = selection.end - selection.start;
  debug("clearMarks", { doc: side.id, selection });
  ["bold", "italic", "underline", "code"].forEach((key) => {
    unmark_utf16(side.id, selection.start, len, key);
  });
  renderEditor(side, true);
  syncFrom(side, other);
}

function attachToolbar(side, other) {
  const toolbar = side.el.closest(".editor").querySelector(".toolbar");
  toolbar.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) {
      event.preventDefault();
    }
  });
  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const mark = button.dataset.mark;
    const action = button.dataset.action;
    if (action === "clear") {
      clearMarks(side, other);
      return;
    }
    if (mark) {
      applyMark(side, other, mark);
    }
  });
}

function seedDoc(side, text) {
  if (!text) return;
  apply_edit_utf16(side.id, 0, 0, text);
  side.text = text;
}

leftEditor.addEventListener("input", (event) =>
  handleInput(state.left, state.right, event),
);
rightEditor.addEventListener("input", (event) =>
  handleInput(state.right, state.left, event),
);
leftEditor.addEventListener("mouseup", () => resolveSelection(state.left));
leftEditor.addEventListener("keyup", () => resolveSelection(state.left));
rightEditor.addEventListener("mouseup", () => resolveSelection(state.right));
rightEditor.addEventListener("keyup", () => resolveSelection(state.right));
document.addEventListener("selectionchange", () => {
  const leftSel = selectionOffsets(state.left.el);
  if (leftSel && leftSel.start !== leftSel.end) {
    state.left.lastSelection = leftSel;
    debug("selection", { doc: state.left.id, current: leftSel });
  }
  const rightSel = selectionOffsets(state.right.el);
  if (rightSel && rightSel.start !== rightSel.end) {
    state.right.lastSelection = rightSel;
    debug("selection", { doc: state.right.id, current: rightSel });
  }
});

attachToolbar(state.left, state.right);
attachToolbar(state.right, state.left);

linkToggle.addEventListener("change", () => {
  state.online = linkToggle.checked;
  linkLabel.textContent = state.online ? "Online" : "Offline";
  linkPulse.classList.toggle("is-online", state.online);
  if (state.online) {
    flushOutbox(state.left, state.right);
    flushOutbox(state.right, state.left);
  }
});

seedDoc(
  state.left,
  "Offline mode lets you keep editing. Toggle the link to sync and merge.\nSelect text and hit a mark button to decorate it.",
);
syncFrom(state.left, state.right);
renderEditor(state.left, false);
renderEditor(state.right, false);
updateQueues();
