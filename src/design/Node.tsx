"use client";

import { memo, useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { BINDINGS } from "./bindings";
import { acceptUpload } from "./live/actions";
import { DateField, isDateText, optionsFor, SelectField } from "./live/Fields";
import { useLive } from "./live/state";
import { LiveWidget } from "./live/Widgets";
import { loaded, manifest, runActions, screensById, useDesign, warmActions } from "./store";
import type { DesignNode, InstanceRef, Paint, TextRun } from "./types";

// The browser fits one more word per line than the design on these layers, so they are narrowed by half a pixel.
const NARROWER_TEXT = new Set(["248:6093", "248:6182", "248:6268", "248:6407", "248:6515", "248:6600"]);

// Characters missing from a font fall back to Noto.
const FONT: Record<string, string> = {
  Manrope: "var(--font-manrope), var(--font-noto-malayalam)",
  "Anek Malayalam": "var(--font-anek-malayalam), var(--font-noto-malayalam), var(--font-manrope)",
};

// Shown as confirmed at registration, so the editing screen keeps them locked.
const REGISTRATION_LOCKED = new Set(["321:6524", "321:6531", "321:6539", "321:6547"]);

function backgroundOf(paints: Paint[] | undefined, style: CSSProperties) {
  if (!paints?.length) return;
  const layers: string[] = [];
  const sizes: string[] = [];
  const positions: string[] = [];
  const repeats: string[] = [];
  // Layers list paints bottom first; CSS lists backgrounds top first.
  for (const p of [...paints].reverse()) {
    if (p.k === "s") {
      if (paints.length === 1) {
        style.backgroundColor = p.c;
        return;
      }
      layers.push(`linear-gradient(${p.c},${p.c})`);
      sizes.push("100% 100%");
      positions.push("0 0");
      repeats.push("no-repeat");
    } else if (p.k === "g") {
      layers.push(p.v);
      sizes.push("100% 100%");
      positions.push("0 0");
      repeats.push("no-repeat");
    } else if (p.k === "u") {
      layers.push(`url(${p.url})`);
      sizes.push("cover");
      positions.push("center");
      repeats.push("no-repeat");
    } else {
      const file = manifest.images[p.r];
      if (!file) continue;
      layers.push(`url(/design/images/${file})`);
      const x = p.x;
      if (p.m === "FIT") {
        sizes.push("contain");
        positions.push("center");
        repeats.push("no-repeat");
      } else if (p.m === "TILE") {
        sizes.push("auto");
        positions.push("0 0");
        repeats.push("repeat");
      } else if (x && (x[0] !== 1 || x[4] !== 1 || x[2] !== 0 || x[5] !== 0)) {
        const pos = (t: number, a: number) => (a === 1 ? 0 : (t / (1 - a)) * 100);
        sizes.push(`${100 / x[0]}% ${100 / x[4]}%`);
        positions.push(`${pos(x[2], x[0])}% ${pos(x[5], x[4])}%`);
        repeats.push("no-repeat");
      } else {
        sizes.push(p.m === "STRETCH" ? "100% 100%" : "cover");
        positions.push("center");
        repeats.push("no-repeat");
      }
    }
  }
  style.backgroundImage = layers.join(",");
  style.backgroundSize = sizes.join(",");
  style.backgroundPosition = positions.join(",");
  style.backgroundRepeat = repeats.join(",");
}

function paintColor(p?: Paint) {
  if (!p) return undefined;
  return p.k === "s" ? p.c : undefined;
}

function radius(r?: number | number[], grow = 0) {
  if (r === undefined) return undefined;
  if (Array.isArray(r)) return r.map((v) => `${v + (v ? grow : 0)}px`).join(" ");
  return r + (r ? grow : 0);
}

function runStyle(t: TextRun): CSSProperties {
  const out: CSSProperties = {};
  if (t.f) out.fontFamily = FONT[t.f] ?? t.f;
  if (t.s) out.fontSize = t.s;
  if (t.w) out.fontWeight = t.w;
  if (t.lh) out.lineHeight = `${t.lh}px`;
  if (t.ls) out.letterSpacing = t.ls;
  if (t.i) out.fontStyle = "italic";
  if (t.d === "UNDERLINE") out.textDecoration = "underline";
  if (t.d === "STRIKETHROUGH") out.textDecoration = "line-through";
  if (t.c === "UPPER") out.textTransform = "uppercase";
  if (t.c === "LOWER") out.textTransform = "lowercase";
  if (t.c === "TITLE") out.textTransform = "capitalize";
  const c = paintColor(t.p?.[0]);
  if (c) out.color = c;
  return out;
}

function TextBody({ node }: { node: DesignNode }) {
  const tx = node.tx!;
  const reveal = useLive((s) => s.filters.reveal);
  const edited = useLive((s) => s.texts[node.id]);
  const bound = useDesign((s) => {
    if (tx.vb && s.vars[tx.vb] !== undefined) return s.vars[tx.vb];
    return BINDINGS[node.id] ? s.values[BINDINGS[node.id]] : undefined;
  });
  if (edited !== undefined) return <>{edited}</>;
  if (node.n === "Action" && tx.v === "Show" && reveal) return <>Hide</>;
  if (bound !== undefined) return <>{bound}</>;
  if (!tx.o?.length) return <>{tx.v}</>;
  const chars = Array.from(tx.v);
  const runs: ReactNode[] = [];
  let i = 0;
  while (i < chars.length) {
    const id = tx.o[i] ?? 0;
    let j = i + 1;
    while (j < chars.length && (tx.o[j] ?? 0) === id) j++;
    const piece = chars.slice(i, j).join("");
    const run = id ? tx.t?.[String(id)] : undefined;
    runs.push(run ? <span key={i} style={runStyle(run)}>{piece}</span> : piece);
    i = j;
  }
  return <>{runs}</>;
}

function textStyle(node: DesignNode): CSSProperties {
  const tx = node.tx!;
  const s: CSSProperties = { ...runStyle(tx) };
  s.color = paintColor(node.p?.[0]);
  s.whiteSpace = tx.r === "WIDTH_AND_HEIGHT" ? "pre" : "pre-wrap";
  s.textAlign = (tx.a?.toLowerCase() ?? "left") as CSSProperties["textAlign"];
  return s;
}

// Text fields in the design become real inputs.
function FieldText({ node, parent, multiline }: { node: DesignNode; parent: DesignNode; multiline: boolean }) {
  const value = useDesign((s) => s.values[node.id]);
  const setValue = useDesign((s) => s.setValue);
  const placeholder = node.n === "Placeholder";
  const secret = /^•+$/.test(node.tx!.v);
  const reveal = useLive((s) => s.filters.reveal);
  const setFilter = useLive((s) => s.setFilter);
  const screen = useDesign((s) => screensById.get(s.screen)?.name ?? "");
  const tx = node.tx!;
  const original = tx.v.replace(/\|$/, "");
  const shown = value ?? (placeholder ? "" : secret ? "password" : original);
  const width = Math.max(node.w, parent.w - node.x - 12);
  const style: CSSProperties = {
    ...textStyle(node),
    position: "absolute",
    left: node.x,
    top: node.y,
    width,
    height: multiline ? Math.max(node.h, parent.h - node.y - 8) : node.h,
    background: "transparent",
    border: 0,
    outline: 0,
    padding: 0,
    margin: 0,
    resize: "none",
    whiteSpace: multiline ? "pre-wrap" : "pre",
    ["--ph" as string]: paintColor(node.p?.[0]),
  };
  const viewOnly = screen === "Doctor settings / Profile" || REGISTRATION_LOCKED.has(node.id);
  const searchKey = placeholder && parent.n === "Search" ? "home" : undefined;
  const common = {
    "aria-label": placeholder ? tx.v : tx.v,
    className: "fg-field",
    style,
    value: shown,
    readOnly: viewOnly,
    placeholder: placeholder ? tx.v : undefined,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onFocus: () => setFilter("lastField", node.id),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValue(node.id, e.target.value);
      if (searchKey) setFilter(searchKey, e.target.value);
      if (node.id === "188:4890") setFilter("search", e.target.value);
    },
  };
  if (!viewOnly && !placeholder && !secret && !multiline) {
    const clean = shown.replace(/\s*▾\s*$/, "");
    const options = optionsFor(original);
    if (options) {
      return <SelectField value={clean} options={options} style={style} label={clean} onChange={(v) => setValue(node.id, v)} />;
    }
    if (isDateText(original) && !/\(same day\)/.test(original)) {
      return <DateField value={clean} style={style} label={clean} withDay={/^[A-Z][a-z]{2},/.test(original)} onChange={(v) => setValue(node.id, v)} />;
    }
  }
  return multiline ? <textarea {...common} /> : <input {...common} type={secret && !reveal ? "password" : "text"} />;
}

type Props = {
  node: DesignNode;
  parent?: DesignNode;
  ancestors: InstanceRef[];
  overlay?: number;
};

// When an instance switches state, it keeps only the labels and icons it changed from its component.
function keepOverrides(variant: DesignNode, original: DesignNode): DesignNode {
  const texts = new Map<string, string[]>();
  const icons: DesignNode[] = [];
  const read = (n: DesignNode) => {
    if (n.tx && n.n) texts.set(n.n, [...(texts.get(n.n) ?? []), n.tx.ov ? n.tx.v : ""]);
    if (n.g) icons.push(n);
    n.ch?.forEach(read);
  };
  read(original);
  let iconIndex = 0;
  const seen = new Map<string, number>();
  const apply = (n: DesignNode): DesignNode => {
    const out = { ...n };
    if (n.tx && n.n && texts.has(n.n)) {
      const at = seen.get(n.n) ?? 0;
      seen.set(n.n, at + 1);
      const v = texts.get(n.n)?.[at];
      if (v) out.tx = { ...n.tx, v };
    }
    if (n.g) {
      const before = icons[iconIndex++];
      if (before?.sw && before.n && n.n && before.n !== n.n) {
        out.g = before.g;
        out.n = before.n;
      }
    }
    if (n.ch) out.ch = n.ch.map(apply);
    return out;
  };
  return apply(variant);
}

function InstanceNode({ node, parent, ancestors, overlay }: Props) {
  const swapped = useDesign((s) => s.over[node.id]);
  const smartMs = useDesign((s) => s.overMs[node.id]);
  const effective = useMemo(() => {
    const variant = swapped ? loaded.get(swapped) : undefined;
    if (!variant) return node;
    // Keeps the instance's own width, which fits its label, so a chip can't clip its text.
    return { ...keepOverrides(variant, node), id: node.id, x: node.x, y: node.y, w: node.w, t: node.t, cid: swapped };
  }, [node, swapped]);
  const smart = swapped && smartMs ? smartMs : undefined;
  const chain = useMemo(
    () => [...ancestors, { id: node.id, cid: effective.cid ?? (node.t === "C" ? node.id : undefined) }],
    [ancestors, node.id, node.t, effective.cid],
  );
  return <Box node={effective} parent={parent} ancestors={chain} overlay={overlay} smartMs={smart} />;
}

// Dashes can't be matched with a CSS border, so these strokes are drawn with the design's own pattern.
function DashedStroke({ node, k }: { node: DesignNode; k: NonNullable<DesignNode["k"]> }) {
  const shift = k.a === "INSIDE" ? k.w / 2 : k.a === "OUTSIDE" ? -k.w / 2 : 0;
  const w = node.w - shift * 2;
  const h = node.h - shift * 2;
  const given = node.r ?? 0;
  const [tl, tr, br, bl] = (Array.isArray(given) ? given : [given, given, given, given]).map((r) =>
    node.t === "E" ? Math.min(w, h) / 2 : Math.min(Math.max(r - shift, 0), w / 2, h / 2),
  );
  const d = `M${shift + tl} ${shift}h${w - tl - tr}a${tr} ${tr} 0 0 1 ${tr} ${tr}v${h - tr - br}a${br} ${br} 0 0 1 ${-br} ${br}h${-(w - br - bl)}a${bl} ${bl} 0 0 1 ${-bl} ${-bl}v${-(h - bl - tl)}a${tl} ${tl} 0 0 1 ${tl} ${-tl}z`;
  return (
    <svg width={node.w} height={node.h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
      <path d={d} fill="none" stroke={paintColor(k.p)} strokeWidth={k.w} strokeDasharray={k.d?.join(" ")} />
    </svg>
  );
}

function Box({ node, parent, ancestors, overlay, smartMs }: Props & { smartMs?: number }) {
  const interactions = node.a;
  const timeouts = useMemo(() => interactions?.filter((i) => i.on === "timeout"), [interactions]);

  useEffect(() => {
    if (!timeouts?.length) return;
    const timers = timeouts.map((i) => window.setTimeout(() => runActions(i.acts, ancestors, overlay), i.ms ?? 0));
    return () => timers.forEach(clearTimeout);
  }, [timeouts, ancestors, overlay]);

  const style: CSSProperties = {
    position: "absolute",
    left: node.x,
    top: node.y,
    width: node.w,
    height: node.h,
  };
  if (node.o !== undefined) style.opacity = node.o;
  if (node.ro) style.transform = `rotate(${node.ro}deg)`;
  if (node.b) style.mixBlendMode = node.b as CSSProperties["mixBlendMode"];

  if (node.live) return <LiveWidget node={node} style={style} />;

  const handlers: React.HTMLAttributes<HTMLDivElement> & { "data-nid"?: string; "data-anim"?: string; "data-press"?: boolean } = { "data-nid": node.id, "data-anim": node.anim };
  const click = interactions?.find((i) => i.on === "click");
  if (click) {
    style.cursor = "pointer";
    handlers.onPointerEnter = () => warmActions(click.acts);
    // Whole rows and cards would visibly shrink, so only small controls dip when pressed.
    if (node.w <= 320 && node.h <= 72) handlers["data-press"] = true;
    handlers.onClick = (e) => {
      e.stopPropagation();
      runActions(click.acts, ancestors, overlay, { node, parent });
    };
    handlers.role = node.role ?? "button";
    handlers.tabIndex = 0;
    if (node.role === "checkbox") handlers["aria-checked"] = Boolean(node.pressed);
    handlers.onKeyDown = (e) => {
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      runActions(click.acts, ancestors, overlay, { node, parent });
    };
  }
  if (node.drop) {
    handlers.onDragOver = (e) => e.preventDefault();
    handlers.onDrop = (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) acceptUpload(f);
    };
  }
  const enter = interactions?.find((i) => i.on === "enter" || i.on === "hover");
  if (enter) handlers.onMouseEnter = () => runActions(enter.acts, ancestors, overlay, { node, parent });
  const leave = interactions?.find((i) => i.on === "leave");
  if (leave) handlers.onMouseLeave = () => runActions(leave.acts, ancestors, overlay, { node, parent });

  if (node.g) {
    const rb = node.rb;
    return (
      <div style={style} {...handlers}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/design/vectors/${node.g}.svg`}
          alt=""
          // A graphic that hasn't been exported yet shouldn't show as a broken image.
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          draggable={false}
          style={{
            position: "absolute",
            left: rb ? Math.min(rb[0], 0) : 0,
            top: rb ? Math.min(rb[1], 0) : 0,
            width: node.sv?.[0] ?? (rb ? Math.max(rb[2], node.w) : node.w),
            height: node.sv?.[1] ?? (rb ? Math.max(rb[3], node.h) : node.h),
            maxWidth: "none",
            pointerEvents: "none",
          }}
        />
      </div>
    );
  }

  if (node.t === "T") {
    const tx = node.tx!;
    const inputParent = parent?.n === "Input" && node.n === "Value";
    const searchParent = parent?.n === "Search" && node.n === "Placeholder" && !parent.a?.length;
    if ((inputParent || searchParent) && parent && !parent.a?.length) {
      return <FieldText node={node} parent={parent} multiline={tx.r === "HEIGHT" && parent.h > 60} />;
    }
    const s: CSSProperties = { ...style, ...textStyle(node) };
    if (NARROWER_TEXT.has(node.id)) s.width = node.w - 0.5;
    if (tx.va === "CENTER" || tx.va === "BOTTOM") {
      s.display = "flex";
      s.flexDirection = "column";
      s.justifyContent = tx.va === "CENTER" ? "center" : "flex-end";
    }
    if (tx.r === "WIDTH_AND_HEIGHT" && tx.a === "CENTER") {
      s.display = "flex";
      s.justifyContent = "center";
    }
    return (
      <div style={s} {...handlers}>
        {s.display ? <span><TextBody node={node} /></span> : <TextBody node={node} />}
      </div>
    );
  }

  backgroundOf(node.p, style);
  if (node.t === "E") style.borderRadius = "50%";
  else {
    const r = radius(node.r);
    if (r !== undefined) style.borderRadius = r;
  }
  if (node.sh) style.boxShadow = node.sh;
  if (node.bl) style.filter = `blur(${node.bl}px)`;
  if (node.c) style.overflow = "hidden";
  if (node.sc) {
    style.overflowY = node.sc === "V" || node.sc === "B" ? "auto" : "hidden";
    style.overflowX = node.sc === "H" || node.sc === "B" ? "auto" : "hidden";
    style.scrollbarWidth = "none";
  }

  let strokeEl: ReactNode = null;
  if (node.k) {
    const k = node.k;
    const color = paintColor(k.p) ?? "transparent";
    const inset = k.a === "OUTSIDE" ? -k.w : k.a === "CENTER" ? -k.w / 2 : 0;
    const grow = k.a === "OUTSIDE" ? k.w : k.a === "CENTER" ? k.w / 2 : 0;
    const line = k.d && k.s ? "dashed" : "solid";
    const sides = k.s;
    const stroke: CSSProperties = {
      position: "absolute",
      left: inset,
      top: inset,
      right: inset,
      bottom: inset,
      pointerEvents: "none",
      borderRadius: node.t === "E" ? "50%" : radius(node.r, grow),
      boxSizing: "border-box",
      ...(sides
        ? {
            borderTop: `${sides[0]}px ${line} ${color}`,
            borderRight: `${sides[1]}px ${line} ${color}`,
            borderBottom: `${sides[2]}px ${line} ${color}`,
            borderLeft: `${sides[3]}px ${line} ${color}`,
          }
        : { border: `${k.w}px ${line} ${color}` }),
    };
    strokeEl = k.d && !sides ? <DashedStroke node={node} k={k} /> : <div style={stroke} />;
  }

  // Smart Animate matches layers across states, so children are keyed by position.
  const smartProps = smartMs ? { className: "fg-smart", style: { ...style, ["--fg-smart-ms" as string]: `${smartMs}ms` } } : { style };
  return (
    <div {...smartProps} {...handlers}>
      {/* A frame's stroke is drawn beneath its children. */}
      {strokeEl}
      {node.ch?.map((c, i) => <NodeView key={`${i}-${c.t}`} node={c} parent={node} ancestors={ancestors} overlay={overlay} />)}
    </div>
  );
}

export const NodeView = memo(function NodeView(props: Props) {
  const t = props.node.t;
  return t === "I" || t === "C" ? <InstanceNode {...props} /> : <Box {...props} />;
});
