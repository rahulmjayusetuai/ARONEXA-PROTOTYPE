"use client";

import { loaded, manifest, screensById, useDesign } from "../store";
import type { DesignNode } from "../types";
import { useLive } from "./state";
import { billingTable, plainDate, TODAY } from "./schedule";
import { liveDoc } from "./transform";

// Reads a screen back into rows of text, then writes those rows as PDF, CSV or a print page.
type Cell = { x: number; y: number; w: number; text: string; size: number; weight: number };
type Picture = { x: number; y: number; w: number; h: number; src: string };
export type Block = { width: number; rows: Cell[][]; pictures: Picture[] };

const BUTTON_TEXT = /^(download.*|print.*|view|open|back|view all.*|order test|add clinical note|explain to patient|zoom|measure intervals|compare with.*|upload.*|order scan|add .*|prescribe medicine|billing settings|receipt|collect|edit)$/i;

function textOf(n: DesignNode) {
  const fig = useDesign.getState();
  const typed = fig.values[n.id];
  const live = useLive.getState().texts[n.id];
  if (live !== undefined) return live;
  if (typed !== undefined) return typed;
  if (n.tx?.vb && fig.vars[n.tx.vb] !== undefined) return fig.vars[n.tx.vb];
  return (n.tx?.v ?? "").replace(/\|$/, "");
}

function variantOf(n: DesignNode) {
  const swapped = useDesign.getState().over[n.id];
  const doc = swapped ? loaded.get(swapped) : undefined;
  return doc ? { ...doc, id: n.id, x: n.x, y: n.y } : n;
}

function isButton(n: DesignNode) {
  return Boolean(n.a?.some((i) => i.on === "click")) && n.h <= 48 && n.w <= 320;
}

function read(root: DesignNode, width: number): Block {
  const cells: Cell[] = [];
  const pictures: Picture[] = [];
  const walk = (raw: DesignNode, ox: number, oy: number) => {
    const n = variantOf(raw);
    const x = ox + n.x;
    const y = oy + n.y;
    if (n.live === "billing") {
      const table = billingTable(n.props?.range as "today" | "week" | "month", useLive.getState().collected, n.props?.clinic as "thanal" | "sahya");
      table.forEach((row, r) => {
        row.forEach((text, c) => {
          if (text) cells.push({ x: x + 21 + (c * (n.w - 42)) / row.length, y: y + r * 40, w: (n.w - 42) / row.length, text, size: 13, weight: r === 0 || r === table.length - 1 ? 600 : 400 });
        });
      });
      return;
    }
    if (n.live === "row") {
      const p = n.props as { title?: string; detail?: string; meta?: string; badge?: string };
      [p.title, p.detail, p.meta].filter(Boolean).forEach((text, i) => {
        cells.push({ x, y: y + i * 20, w: n.w, text: text as string, size: 13, weight: i ? 400 : 600 });
      });
      return;
    }
    if (n.t === "T") {
      const text = textOf(n).trim();
      if (n.a?.some((i) => i.on === "click")) return;
      if (text && !BUTTON_TEXT.test(text) && n.n !== "Placeholder") {
        cells.push({ x, y, w: n.w, text, size: n.tx?.s ?? 12, weight: n.tx?.w ?? 400 });
      }
      return;
    }
    if (isButton(n)) return;
    const image = n.p?.find((p) => p.k === "i");
    if (image?.k === "i" && n.w >= 90 && n.h >= 70 && manifest.images[image.r]) {
      pictures.push({ x, y, w: n.w, h: n.h, src: `/design/images/${manifest.images[image.r]}` });
    } else if (n.g && n.w >= 240 && n.h >= 80) {
      pictures.push({ x, y, w: n.w, h: n.h, src: `/design/vectors/${n.g}.svg` });
    }
    n.ch?.forEach((c) => walk(c, x, y));
  };
  // A column can itself be a live table, which has no design children to read.
  if (root.live) walk({ ...root, x: 0, y: 0 }, 0, 0);
  else root.ch?.forEach((c) => walk(c, 0, 0));
  cells.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Cell[][] = [];
  for (const c of cells) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - c.y) <= 10) row.push(c);
    else rows.push([c]);
  }
  rows.forEach((r) => r.sort((a, b) => a.x - b.x));
  return { width, rows, pictures };
}

// Side-by-side columns print one after the other, or their rows would run together.
function columns(n: DesignNode): DesignNode[] {
  const frames = (n.ch ?? []).filter((c) => c.t !== "T");
  const tall = frames.filter((c) => c.h >= 140 && c.w >= 200);
  const sideBySide = tall.length >= 2 && tall.every((a) => tall.every((b) => a === b || a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1));
  if (sideBySide) return tall.flatMap(columns);
  if (frames.length && frames.length === (n.ch ?? []).length) {
    const stacked = frames.filter((c) => c.w >= n.w * 0.6);
    if (stacked.length === frames.length && stacked.some((c) => columns(c).length > 1)) return stacked.flatMap(columns);
  }
  return [n];
}

const hasClick = (n: DesignNode): boolean => Boolean(n.a?.some((x) => x.on === "click")) || (n.ch ?? []).some(hasClick);

// The header, tab bar, breadcrumbs and report tabs are for moving around, not part of a report.
const isChrome = (n: DesignNode, i: number) => {
  const labels: string[] = [];
  const walk = (x: DesignNode) => {
    if (x.t === "T") labels.push(x.tx?.v ?? "");
    x.ch?.forEach(walk);
  };
  walk(n);
  return (i === 0 && n.h <= 90) || (n.h <= 100 && hasClick(n) && (labels.includes("Body map") || /scans and reports|Back to /i.test(labels.join(" "))));
};

// Filter panels hold only buttons, so they are left out of a report.
const isFilterPanel = (n: DesignNode) => {
  const text: string[] = [];
  const walk = (x: DesignNode) => {
    if (x.t === "T") text.push(x.tx?.v ?? "");
    x.ch?.forEach(walk);
  };
  walk(n);
  return n.w <= 270 && /^(Show|Folders)/.test(text[0] ?? "");
};

export function blocksFrom(root: DesignNode): Block[] {
  const top = (root.ch ?? []).filter((c, i) => !isChrome(c, i));
  const parts = top.flatMap((c) => (c.h >= 300 ? columns(c) : [c])).filter((c) => !isFilterPanel(c));
  return parts
    .map((part) => read({ ...part, ch: part.ch ?? [] }, part.w))
    .map((b) => ({ ...b, rows: b.rows }))
    .filter((b) => b.rows.length || b.pictures.length);
}

const WIN = new Map<string, string>([
  ["₹", "Rs "], ["₂", "2"], ["‰", " per mille"], ["→", "->"], ["✓", ""], ["✕", ""], ["⏳", ""], ["▾", ""], ["▶", ""], ["°", "°"], ["≥", ">="], ["≤", "<="], ["’", "'"], ["‘", "'"], ["“", '"'], ["”", '"'], ["–", "-"], ["—", "-"], ["•", "*"], ["·", "-"], ["…", "..."],
]);

// The built-in PDF fonts only cover Western characters.
function pdfText(s: string) {
  let out = "";
  for (const ch of s) {
    const mapped = WIN.get(ch);
    if (mapped !== undefined) out += mapped;
    else if (ch.charCodeAt(0) < 256) out += ch;
  }
  return out.trim();
}

async function asDataUrl(src: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const img = new window.Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1400 / (img.naturalWidth || 1400)) * (src.endsWith(".svg") ? 2 : 1);
    canvas.width = (img.naturalWidth || 800) * scale;
    canvas.height = (img.naturalHeight || 400) * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL("image/jpeg", 0.85), w: canvas.width, h: canvas.height };
  } catch {
    return null;
  }
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const fileSafe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
export const fileName = (title: string, ext: string) => `AroNexa_${fileSafe(title)}_15May2025.${ext}`;

export async function writePdf(title: string, subtitle: string, blocks: Block[], name = fileName(title, "pdf")) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 36;
  const page = () => {
    pdf.setFillColor(3, 28, 84);
    pdf.rect(0, 0, W, 58, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text(pdfText(title).slice(0, 62), M, 26);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.text(pdfText(subtitle).slice(0, 110), M, 42);
    pdf.text("AroNexa", W - M, 26, { align: "right" });
    pdf.setTextColor(15, 23, 42);
    return 78;
  };
  let y = page();
  const room = (need: number) => {
    if (y + need > H - 40) {
      pdf.addPage();
      y = page();
    }
  };
  const avail = W - M * 2;
  for (const b of blocks) {
    const scale = avail / b.width;
    const items: ({ at: number; row: Cell[] } | { at: number; pic: Picture })[] = [
      ...b.rows.map((row) => ({ at: row[0].y, row })),
      ...b.pictures.map((pic) => ({ at: pic.y, pic })),
    ].sort((p, q) => p.at - q.at);
    for (const item of items) {
      if ("pic" in item) {
        const got = await asDataUrl(item.pic.src);
        if (!got) continue;
        const w = Math.min(item.pic.w * scale, avail);
        const h = Math.min((w * got.h) / got.w, 300);
        const fitted = (h * got.w) / got.h;
        room(h + 10);
        pdf.addImage(got.data, "JPEG", M + item.pic.x * scale, y, Math.min(w, fitted), h);
        y += h + 10;
        continue;
      }
      const row = item.row;
      const size = Math.max(...row.map((c) => c.size));
      const fs = size >= 22 ? 14 : size >= 16 ? 11.5 : 9;
      const lh = fs * 1.32;
      const laid = row.map((c, i) => {
        const left = M + c.x * scale;
        const next = row[i + 1];
        const right = next ? M + next.x * scale - 8 : W - M;
        const wrap = Math.max(right - left, 42);
        pdf.setFont("helvetica", c.weight >= 600 || size >= 16 ? "bold" : "normal");
        pdf.setFontSize(fs);
        return { left, bold: c.weight >= 600 || size >= 16, lines: pdf.splitTextToSize(pdfText(c.text), wrap) as string[] };
      });
      const lines = Math.max(...laid.map((l) => l.lines.length));
      room(lines * lh + 4);
      y += size >= 16 ? 6 : 0;
      for (const l of laid) {
        pdf.setFont("helvetica", l.bold ? "bold" : "normal");
        pdf.setFontSize(fs);
        pdf.text(l.lines, l.left, y + fs);
      }
      y += lines * lh + 3;
    }
    pdf.setDrawColor(226, 232, 240);
    room(12);
    y += 5;
    pdf.line(M, y, W - M, y);
    y += 9;
  }
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`AroNexa demo data. Generated ${plainDate(TODAY)}. Page ${p} of ${total}`, W / 2, H - 20, { align: "center" });
  }
  saveBlob(pdf.output("blob"), name);
  return name;
}

export function writeCsv(title: string, blocks: Block[]) {
  const quote = (s: string) => `"${s.replace(/"/g, '""').replace(/\s*\n\s*/g, " ")}"`;
  const lines: string[] = [];
  blocks.forEach((b, i) => {
    if (i) lines.push("");
    b.rows.forEach((row) => lines.push(row.map((c) => quote(c.text)).join(",")));
  });
  const name = fileName(title, "csv");
  // The byte-order mark makes Excel read ₹ and Malayalam correctly.
  saveBlob(new Blob([`﻿${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }), name);
  return name;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export function printBlocks(title: string, subtitle: string, blocks: Block[]) {
  const frame = document.createElement("iframe");
  frame.title = "Print preview";
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;left:-9999px";
  document.body.appendChild(frame);
  const body = blocks
    .map((b) => {
      const items = [
        ...b.rows.map((row) => ({
          at: row[0].y,
          html: `<div class="r" style="grid-template-columns:${row.map((c, i) => `${(((row[i + 1]?.x ?? b.width) - c.x) / b.width) * 100}%`).join(" ")};margin-left:${(row[0].x / b.width) * 100}%">${row
            .map((c) => `<div style="font-size:${c.size >= 22 ? 18 : c.size >= 16 ? 14 : 11}px;font-weight:${c.weight}">${esc(c.text)}</div>`)
            .join("")}</div>`,
        })),
        ...b.pictures.map((p) => ({ at: p.y, html: `<img src="${p.src}" style="width:${(p.w / b.width) * 100}%;max-height:340px;object-fit:contain" alt="">` })),
      ].sort((p, q) => p.at - q.at);
      return `<section>${items.map((i) => i.html).join("")}</section>`;
    })
    .join("");
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:"Noto Sans Malayalam",system-ui,Arial,sans-serif;color:#0f172a;margin:24px}
    header{background:#031c54;color:#fff;padding:14px 18px;border-radius:8px;margin-bottom:16px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    h1{margin:0;font-size:18px}header p{margin:4px 0 0;font-size:11px}
    section{border-bottom:1px solid #e2e8f0;padding:8px 0}
    .r{display:grid;gap:8px;margin:3px 0}
    img{display:block;margin:6px 0}
  </style></head><body><header><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></header>${body}</body></html>`);
  doc.close();
  const go = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60000);
  };
  const images = Array.from(doc.images);
  void Promise.all(images.map((i) => i.decode().catch(() => undefined))).then(go);
}

// What a Download or Print button refers to: the pop-up it sits in, its table row, or the whole screen.
export function exportSource(row: DesignNode | undefined, overlayKey: number | undefined) {
  const fig = useDesign.getState();
  const overlay = overlayKey !== undefined ? fig.overlays.find((o) => o.key === overlayKey) : undefined;
  const overlayDoc = overlay ? loaded.get(overlay.id) : undefined;
  const screenInfo = screensById.get(overlay?.id ?? fig.screen);
  const label = screenInfo?.name ?? "Report";
  const clean = label.replace(/^(Modal \/ (doc|lab) ?|Modal \/ |Scan detail \/ |Patient \/ |Patient web \/ |PModal \/ |Doctor view \/ |Doctor billing · )/, "");
  if (row) {
    const texts = row.ch?.flatMap(function flat(c): DesignNode[] {
      return c.t === "T" ? [c] : (c.ch ?? []).flatMap(flat);
    });
    const name = (texts?.find((c) => c.n === "Name") ?? texts?.find((c) => (c.tx?.v.length ?? 0) > 4 && !/^\d{1,2} [A-Z][a-z]{2}$/.test(c.tx?.v ?? "")))?.tx?.v;
    return {
      title: name ?? clean,
      blocks: [read(row, row.w)],
      subtitle: "James Heatfield - Male, 34 - ANX-78291",
    };
  }
  if (overlayDoc) {
    const title = clean === "doc" || clean === "lab" || !clean ? firstText(overlayDoc) : clean;
    // The pop-up's coloured header repeats in the page header, so it is skipped.
    const body = (overlayDoc.ch ?? []).filter((c) => !(c.y <= 2 && c.h <= 110));
    return { title: firstText(overlayDoc) || title, blocks: [read({ ...overlayDoc, ch: body }, overlayDoc.w)], subtitle: "James Heatfield - Male, 34 - ANX-78291" };
  }
  const base = loaded.get(fig.screen);
  // Drawn from the live screen, so the file includes what the doctor added or filtered.
  const doc = base ? liveDoc(base, label, useLive.getState()) : undefined;
  const billing = /billing/i.test(label);
  const range = useLive.getState().billingRange;
  if (billing && range !== "today") return { title: `${clean} ${range === "week" ? "this week" : "this month"}`, blocks: doc ? blocksFrom(doc) : [], subtitle: "Dr. Arjun Mehta - statement" };
  return {
    title: clean,
    blocks: doc ? blocksFrom(doc) : [],
    subtitle: billing ? "Dr. Arjun Mehta - Thursday, 15 May 2025" : "James Heatfield - Male, 34 - ANX-78291",
  };
}

function firstText(n: DesignNode): string {
  if (n.t === "T") return n.tx?.v ?? "";
  for (const c of n.ch ?? []) {
    const t = firstText(c);
    if (t) return t;
  }
  return "";
}
