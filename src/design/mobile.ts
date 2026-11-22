import type { DesignNode, Paint } from "./types";

// Phone view: rearranges a fixed desktop frame so it fits a narrow screen at full size,
// the way CSS flex-wrap would. Anything that can't be split is scaled down to fit.

const MAX_GAP_Y = 20; // vertical space kept between stacked blocks
const MAX_PAD = 16; // inner padding kept inside frames
const GAP_X = 10; // space between items placed side by side
const LINE_GAP = 12; // space between wrapped lines
const BAR_H = 72; // frames this short are treated as a toolbar / tab bar / input

let seq = 0;
const synth = (ch: DesignNode[], x: number, y: number, w: number, h: number, extra: Partial<DesignNode> = {}): DesignNode => ({
  id: `m~${seq++}`,
  t: "F",
  x,
  y,
  w,
  h,
  ch,
  ...extra,
});

type Rect = { x0: number; y0: number; x1: number; y1: number };
const bbox = (items: DesignNode[]): Rect => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of items) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  return { x0, y0, x1, y1 };
};
const move = (n: DesignNode, x: number, y: number): DesignNode => (n.x === x && n.y === y ? n : { ...n, x, y });
const hasImage = (p?: Paint[]) => Boolean(p?.some((q) => q.k === "i" || q.k === "u"));
const isLeaf = (n: DesignNode) => !n.ch?.length && n.t !== "T" && !n.g && !n.live;

// A plain shape sitting behind the rest of a group, like a card's background.
const isBackground = (n: DesignNode, r: Rect) =>
  isLeaf(n) && !hasImage(n.p) && !n.a?.length && n.w >= (r.x1 - r.x0) * 0.85 && n.h >= (r.y1 - r.y0) * 0.85;

function scaled(n: DesignNode, W: number): DesignNode {
  const s = W / n.w;
  return synth([{ ...n, x: 0, y: 0, ms: s }], n.x, n.y, W, n.h * s);
}

function fitText(n: DesignNode, W: number): DesignNode {
  const tx = n.tx!;
  const lh = tx.lh ?? (tx.s ?? 14) * 1.3;
  const lines = Math.max(1, Math.round(n.h / lh));
  const more = Math.ceil(lines * (n.w / W) * 1.05);
  return { ...n, w: W, h: Math.max(n.h, more * lh), tx: tx.r === "WIDTH_AND_HEIGHT" ? { ...tx, r: "HEIGHT" } : tx };
}

/** Returns a copy of `n` (same x/y) that is at most W wide. */
export function fit(n: DesignNode, W: number): DesignNode {
  if (n.w <= W + 0.5) return n;
  if (n.t === "T") return fitText(n, W);
  if (isLeaf(n) && !hasImage(n.p)) return { ...n, w: W };
  if (!n.ch?.length || n.g || n.live) return scaled(n, W);
  if (n.sc === "H" || n.sc === "B") return { ...n, w: W };
  if (n.h <= BAR_H) return fitBar(n, W);
  return fitFrame(n, W);
}

function fitFrame(n: DesignNode, W: number): DesignNode {
  const kids = n.ch!;
  const frame: Rect = { x0: 0, y0: 0, x1: n.w, y1: n.h };
  const bgs = kids.filter((k) => isBackground(k, frame));
  const rest = kids.filter((k) => !bgs.includes(k));
  if (!rest.length) return { ...n, w: W, ch: bgs.map((b) => ({ ...b, x: 0, w: W })) };
  const r = bbox(rest);
  const pad = Math.min(MAX_PAD, Math.max(0, r.x0));
  const top = Math.min(MAX_GAP_Y + 4, Math.max(0, r.y0));
  const bottom = Math.min(MAX_GAP_Y + 4, Math.max(0, n.h - r.y1));
  const g = group(rest, W - pad * 2);
  const h = top + g.h + bottom;
  const ch = [
    ...bgs.map((b) => ({ ...b, x: 0, y: 0, w: W, h })),
    ...g.ch.map((c) => move(c, c.x + pad, c.y + top)),
  ];
  return { ...n, w: W, h, ch };
}

// A short frame (toolbar, tabs, input, chip row).
function fitBar(n: DesignNode, W: number): DesignNode {
  const kids = n.ch!;
  const frame: Rect = { x0: 0, y0: 0, x1: n.w, y1: n.h };
  const bgs = kids.filter((k) => isBackground(k, frame));
  const rest = kids.filter((k) => !bgs.includes(k));
  const stretched = bgs.map((b) => ({ ...b, x: 0, w: W }));
  // Keep left items where they are and pull right-aligned items in, if that fits.
  const d = n.w - W;
  const right = rest.filter((k) => k.x + k.w / 2 >= n.w / 2 && k.x - d >= 0 && (k.t !== "T" || k.w <= W * 0.4));
  const rightStart = right.length ? bbox(right).x0 - d : W - Math.min(MAX_PAD, Math.max(0, n.w - bbox(rest).x1));
  // Text on the left gives up width (and wraps or clips) before anything moves.
  const left = rest
    .filter((k) => !right.includes(k))
    .map((k) => (k.t === "T" && k.x + k.w > rightStart - 4 && rightStart - 4 - k.x >= 40 ? { ...k, w: rightStart - 4 - k.x } : k));
  const leftEnd = left.length ? bbox(left).x1 : 0;
  if (leftEnd + 4 <= rightStart && right.every((k) => k.x - d >= 0)) {
    return { ...n, w: W, ch: [...stretched, ...left, ...right.map((k) => move(k, k.x - d, k.y))] };
  }
  // A row of small controls scrolls sideways, like a tab bar on a phone.
  if (rest.length >= 3 && rest.every((k) => k.w <= W * 0.6)) {
    return { ...n, w: W, sc: "H", c: 1 };
  }
  return fitFrame(n, W);
}

type Group = { ch: DesignNode[]; w: number; h: number };

/** Lays out sibling items within width W; positions in the result start at 0,0. */
function group(items: DesignNode[], W: number, depth = 0): Group {
  const b = bbox(items);
  const norm = items.map((n) => move(n, n.x - b.x0, n.y - b.y0));
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  if (bw <= W + 0.5) return { ch: norm, w: bw, h: bh };

  const box: Rect = { x0: 0, y0: 0, x1: bw, y1: bh };
  const bgs = norm.length > 1 ? norm.filter((k) => isBackground(k, box)) : [];
  const rest = norm.filter((k) => !bgs.includes(k));
  if (!rest.length) return { ch: norm.map((k) => ({ ...k, x: 0, w: W })), w: W, h: bh };

  let inner: Group;
  let padX = 0;
  let padY = 0;
  let padB = 0;
  if (bgs.length) {
    const r = bbox(rest);
    padX = Math.min(MAX_PAD, Math.max(0, r.x0));
    padY = Math.min(MAX_PAD, Math.max(0, r.y0));
    padB = Math.min(MAX_PAD, Math.max(0, bh - r.y1));
  }
  const avail = W - padX * 2;

  if (rest.length === 1) {
    const f = fit(move(rest[0], 0, 0), avail);
    inner = { ch: [f], w: f.w, h: f.h };
  } else {
    const bands = split(rest, "y");
    if (bands.length > 1) inner = stack(bands, avail, depth);
    else {
      const cols = split(rest, "x");
      if (cols.length > 1) inner = wrap(cols, avail, depth);
      else {
        // Layered items that can't be pulled apart: shrink them together.
        const r = bbox(rest);
        const s = avail / (r.x1 - r.x0);
        const layer = synth(rest.map((k) => move(k, k.x - r.x0, k.y - r.y0)), 0, 0, r.x1 - r.x0, r.y1 - r.y0, { ms: s });
        inner = { ch: [synth([layer], 0, 0, avail, (r.y1 - r.y0) * s)], w: avail, h: (r.y1 - r.y0) * s };
      }
    }
  }

  if (!bgs.length) return inner;
  const w = bgs.length ? W : inner.w;
  const h = padY + inner.h + padB;
  return {
    ch: [...bgs.map((k) => ({ ...k, x: 0, y: 0, w, h })), ...inner.ch.map((c) => move(c, c.x + padX, c.y + padY))],
    w,
    h,
  };
}

// Splits items into runs that don't overlap along the axis (rows for "y", columns for "x").
function split(items: DesignNode[], axis: "x" | "y"): DesignNode[][] {
  const start = (n: DesignNode) => (axis === "y" ? n.y : n.x);
  const size = (n: DesignNode) => (axis === "y" ? n.h : n.w);
  const sorted = [...items].sort((a, b) => start(a) - start(b));
  const runs: DesignNode[][] = [];
  let end = -Infinity;
  for (const n of sorted) {
    if (runs.length && start(n) < end - 1) {
      runs[runs.length - 1].push(n);
      end = Math.max(end, start(n) + size(n));
    } else {
      runs.push([n]);
      end = start(n) + size(n);
    }
  }
  // Keep the design's paint order inside each run.
  return runs.map((run) => items.filter((n) => run.includes(n)));
}

const asBlock = (items: DesignNode[], W: number, depth: number): Group & { y0: number; x0: number } => {
  const b = bbox(items);
  if (items.length === 1) {
    const f = fit(move(items[0], 0, 0), W);
    return { ch: [f], w: f.w, h: f.h, x0: b.x0, y0: b.y0 };
  }
  return { ...group(items, W, depth + 1), x0: b.x0, y0: b.y0 };
};

// Rows one under another, with tall gaps shortened.
function stack(bands: DesignNode[][], W: number, depth: number): Group {
  const ch: DesignNode[] = [];
  let y = 0;
  let w = 0;
  let prevEnd: number | null = null;
  for (const band of bands) {
    const b = bbox(band);
    const g = asBlock(band, W, depth);
    if (prevEnd !== null) y += Math.min(MAX_GAP_Y, Math.max(0, b.y0 - prevEnd));
    ch.push(g.ch.length === 1 ? move(g.ch[0], g.ch[0].x, y) : synth(g.ch, 0, y, g.w, g.h));
    y += g.h;
    w = Math.max(w, g.w);
    prevEnd = b.y1;
  }
  return { ch, w, h: y };
}

// Side-by-side columns flow left to right and wrap onto new lines when they run out of room.
function wrap(cols: DesignNode[][], W: number, depth: number): Group {
  const ch: DesignNode[] = [];
  let lineTop = 0;
  let x = 0;
  let lineY = 0;
  let lineH = 0;
  let w = 0;
  let prevX1: number | null = null;
  for (const col of cols) {
    const b = bbox(col);
    const g = asBlock(col, W, depth);
    const gap = prevX1 === null ? 0 : Math.min(GAP_X, Math.max(4, b.x0 - prevX1));
    if (x > 0 && x + gap + g.w > W + 0.5) {
      lineY += lineH + LINE_GAP;
      x = 0;
      lineH = 0;
    } else x += gap;
    if (x === 0) lineTop = b.y0;
    const y = lineY + Math.max(0, b.y0 - lineTop);
    ch.push(g.ch.length === 1 ? move(g.ch[0], x, y) : synth(g.ch, x, y, g.w, g.h));
    x += g.w;
    w = Math.max(w, x);
    lineH = Math.max(lineH, y - lineY + g.h);
    prevX1 = b.x1;
  }
  return { ch, w, h: lineY + lineH };
}

const cache = new WeakMap<DesignNode, Map<number, DesignNode>>();
/** The phone layout of a whole screen or pop-up. */
export function reflow(doc: DesignNode, W: number): DesignNode {
  if (doc.w <= W + 0.5) return doc;
  let byW = cache.get(doc);
  if (!byW) cache.set(doc, (byW = new Map()));
  let out = byW.get(W);
  if (!out) {
    out = fit({ ...doc, x: 0, y: 0 }, W);
    byW.set(W, out);
  }
  return out;
}
