/** Pure zero-dependency line + inline-word diff engine shared by web History and Obsidian plugin. */

function splitLines(text) {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  return normalized === "" ? [] : normalized.split("\n");
}

function tokenizeWords(line) {
  if (!line) return [];
  return line.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu) || [line];
}

function lcsOps(a, b, maxCells) {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  const ops = [];

  for (let i = 0; i < prefix; i++) {
    ops.push({ kind: "same", aIdx: i, bIdx: i, value: a[i] });
  }

  if (midA.length === 0) {
    for (let j = 0; j < midB.length; j++) {
      ops.push({ kind: "add", aIdx: null, bIdx: prefix + j, value: midB[j] });
    }
  } else if (midB.length === 0) {
    for (let i = 0; i < midA.length; i++) {
      ops.push({ kind: "del", aIdx: prefix + i, bIdx: null, value: midA[i] });
    }
  } else if (midA.length * midB.length > maxCells) {
    for (let i = 0; i < midA.length; i++) {
      ops.push({ kind: "del", aIdx: prefix + i, bIdx: null, value: midA[i] });
    }
    for (let j = 0; j < midB.length; j++) {
      ops.push({ kind: "add", aIdx: null, bIdx: prefix + j, value: midB[j] });
    }
  } else {
    const m = midA.length;
    const n = midB.length;
    const width = n + 1;
    const dp = new Int32Array((m + 1) * width);
    for (let i = m - 1; i >= 0; i--) {
      const row = i * width;
      const nextRow = (i + 1) * width;
      const ai = midA[i];
      for (let j = n - 1; j >= 0; j--) {
        if (ai === midB[j]) {
          dp[row + j] = dp[nextRow + j + 1] + 1;
        } else {
          const down = dp[nextRow + j];
          const right = dp[row + j + 1];
          dp[row + j] = down >= right ? down : right;
        }
      }
    }
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (midA[i] === midB[j]) {
        ops.push({ kind: "same", aIdx: prefix + i, bIdx: prefix + j, value: midA[i] });
        i++;
        j++;
      } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
        ops.push({ kind: "del", aIdx: prefix + i, bIdx: null, value: midA[i] });
        i++;
      } else {
        ops.push({ kind: "add", aIdx: null, bIdx: prefix + j, value: midB[j] });
        j++;
      }
    }
    while (i < m) {
      ops.push({ kind: "del", aIdx: prefix + i, bIdx: null, value: midA[i] });
      i++;
    }
    while (j < n) {
      ops.push({ kind: "add", aIdx: null, bIdx: prefix + j, value: midB[j] });
      j++;
    }
  }

  const tailStartA = a.length - suffix;
  const tailStartB = b.length - suffix;
  for (let k = 0; k < suffix; k++) {
    ops.push({ kind: "same", aIdx: tailStartA + k, bIdx: tailStartB + k, value: a[tailStartA + k] });
  }
  return ops;
}

function coalesceSegments(segments) {
  const out = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.type === seg.type) prev.text += seg.text;
    else out.push({ type: seg.type, text: seg.text });
  }
  return out;
}

export function diffInlineWords(oldLine, newLine) {
  const a = tokenizeWords(String(oldLine ?? ""));
  const b = tokenizeWords(String(newLine ?? ""));
  const ops = lcsOps(a, b, 120_000);
  const oldSegs = [];
  const newSegs = [];
  for (const op of ops) {
    if (op.kind === "same") {
      oldSegs.push({ type: "equal", text: op.value });
      newSegs.push({ type: "equal", text: op.value });
    } else if (op.kind === "del") {
      oldSegs.push({ type: "del", text: op.value });
    } else {
      newSegs.push({ type: "add", text: op.value });
    }
  }
  return { oldSegments: coalesceSegments(oldSegs), newSegments: coalesceSegments(newSegs) };
}

export function diffMarkdownLines(oldText, newText, options = {}) {
  const context = typeof options.context === "number" && options.context >= 0 ? Math.floor(options.context) : 2;
  let inlinePairs = Number.isSafeInteger(options.maxInlinePairs) && options.maxInlinePairs >= 0
    ? options.maxInlinePairs : Infinity;
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = lcsOps(a, b, 900_000);

  let addedLines = 0;
  let removedLines = 0;
  const rows = ops.map((op) => {
    if (op.kind === "add") addedLines++;
    else if (op.kind === "del") removedLines++;
    return {
      type: "line",
      kind: op.kind,
      oldLine: op.aIdx === null ? null : op.aIdx + 1,
      newLine: op.bIdx === null ? null : op.bIdx + 1,
      text: op.value,
      segments: null,
    };
  });

  // Annotate paired adjacent del/add blocks with inline word highlights.
  let idx = 0;
  while (idx < rows.length && inlinePairs > 0) {
    if (rows[idx].kind !== "del") {
      idx++;
      continue;
    }
    const delStart = idx;
    while (idx < rows.length && rows[idx].kind === "del") idx++;
    const addStart = idx;
    while (idx < rows.length && rows[idx].kind === "add") idx++;
    const delCount = addStart - delStart;
    const addCount = idx - addStart;
    const paired = Math.min(delCount, addCount);
    for (let k = 0; k < paired && inlinePairs > 0; k++) {
      const delRow = rows[delStart + k];
      const addRow = rows[addStart + k];
      if (delRow.text.length <= 2000 && addRow.text.length <= 2000) {
        const inline = diffInlineWords(delRow.text, addRow.text);
        delRow.segments = inline.oldSegments;
        addRow.segments = inline.newSegments;
        inlinePairs--;
      }
    }
  }

  const identical = addedLines === 0 && removedLines === 0;
  if (identical) {
    return { blocks: [], addedLines: 0, removedLines: 0, identical: true, totalOldLines: a.length, totalNewLines: b.length };
  }

  // Mark rows within `context` of any changed line as visible; collapse long unchanged runs.
  const keep = new Uint8Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind !== "same") {
      const lo = Math.max(0, i - context);
      const hi = Math.min(rows.length - 1, i + context);
      for (let k = lo; k <= hi; k++) keep[k] = 1;
    }
  }

  const blocks = [];
  let cursor = 0;
  while (cursor < rows.length) {
    if (keep[cursor]) {
      blocks.push(rows[cursor]);
      cursor++;
      continue;
    }
    const runStart = cursor;
    while (cursor < rows.length && !keep[cursor]) cursor++;
    const hidden = rows.slice(runStart, cursor);
    if (hidden.length <= 2) {
      for (const row of hidden) blocks.push(row);
    } else {
      blocks.push({ type: "collapsed", count: hidden.length, lines: hidden });
    }
  }

  return {
    blocks,
    addedLines,
    removedLines,
    identical: false,
    totalOldLines: a.length,
    totalNewLines: b.length,
  };
}
