// AroNexa Figma export plugin (read-only).
// Run in Figma desktop: Plugins → Development → Import plugin from manifest… → pick manifest.json in this folder.
// It exports every top-level frame whose name matches the pattern you type, plus the vector icons and images
// they use, into one JSON file. Then run: node scripts/figma-export/integrate.mjs <that file>
figma.showUI(__html__, { width: 420, height: 300 });
figma.ui.onmessage = async (msg) => {
  if (msg.type !== "export") return;
  try {
    const out = await run(new RegExp(msg.pattern), new Set(msg.skip || []));
    figma.ui.postMessage({ type: "done", json: JSON.stringify(out), count: out.items.length });
  } catch (e) {
    figma.ui.postMessage({ type: "error", message: String(e) });
  }
};
async function run(PATTERN, SKIP) {
  const page = figma.currentPage;
  const r2 = (v) => Math.round(v * 100) / 100;
  const hx = (v) => Math.round(v * 255);
  function col(c, o) {
    const a = (c.a === undefined ? 1 : c.a) * (o === undefined ? 1 : o);
    return a >= 0.999 ? `rgb(${hx(c.r)},${hx(c.g)},${hx(c.b)})` : `rgba(${hx(c.r)},${hx(c.g)},${hx(c.b)},${r2(a)})`;
  }
  function fnv(s) {
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822507) >>> 0;
    }
    return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 16);
  }
  function gradient(p) {
    const t = p.gradientTransform;
    // angle of the gradient axis from the transform
    const a = Math.atan2(t[1][0], t[0][0]);
    const deg = Math.round((a * 180) / Math.PI + 90);
    const stops = p.gradientStops.map((s) => `${col(s.color, p.opacity)} ${Math.round(s.position * 100)}%`).join(",");
    if (p.type === "GRADIENT_RADIAL") return `radial-gradient(${stops})`;
    return `linear-gradient(${deg}deg,${stops})`;
  }
  const images = new Set();
  function paints(list) {
    if (!list || list === figma.mixed) return undefined;
    const out = [];
    for (const p of list) {
      if (p.visible === false) continue;
      if (p.type === "SOLID") out.push({ k: "s", c: col(p.color, p.opacity) });
      else if (p.type.startsWith("GRADIENT")) out.push({ k: "g", v: gradient(p) });
      else if (p.type === "IMAGE" && p.imageHash) {
        images.add(p.imageHash);
        const o = { k: "i", r: p.imageHash, m: p.scaleMode };
        if (p.opacity !== undefined && p.opacity < 1) o.o = r2(p.opacity);
        if (p.scaleMode === "CROP" && p.imageTransform) {
          const m = p.imageTransform;
          o.x = [r2(m[0][0]), r2(m[0][1]), r2(m[0][2]), r2(m[1][0]), r2(m[1][1]), r2(m[1][2])];
        }
        out.push(o);
      }
    }
    return out.length ? out : undefined;
  }
  function shadow(n) {
    if (!("effects" in n) || !n.effects.length) return {};
    const sh = [];
    let bl;
    for (const e of n.effects) {
      if (e.visible === false) continue;
      if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW")
        sh.push(`${e.type === "INNER_SHADOW" ? "inset " : ""}${r2(e.offset.x)}px ${r2(e.offset.y)}px ${r2(e.radius)}px ${r2(e.spread || 0)}px ${col(e.color)}`);
      if (e.type === "LAYER_BLUR") bl = r2(e.radius);
    }
    const o = {};
    if (sh.length) o.sh = sh.join(",");
    if (bl) o.bl = bl;
    return o;
  }
  const TRIG = { ON_CLICK: "click", MOUSE_ENTER: "enter", MOUSE_LEAVE: "leave", ON_HOVER: "hover", AFTER_TIMEOUT: "timeout", ON_PRESS: "click" };
  const varTargets = new Set();
  const compSets = {};
  function trans(t) {
    if (!t) return undefined;
    const ms = Math.round((t.duration || 0) * 1000);
    if (t.type === "DISSOLVE") return { t: "d", ms };
    if (t.type === "SMART_ANIMATE") return { t: "s", ms };
    if (/MOVE|SLIDE|PUSH/.test(t.type)) return { t: "m", ms, dir: t.direction };
    return undefined;
  }
  function reactions(n) {
    if (!("reactions" in n) || !n.reactions.length) return undefined;
    const out = [];
    for (const r of n.reactions) {
      const on = r.trigger && TRIG[r.trigger.type];
      if (!on) continue;
      const acts = [];
      for (const a of r.actions || (r.action ? [r.action] : [])) {
        if (!a) continue;
        if (a.type === "BACK") acts.push({ k: "back" });
        else if (a.type === "CLOSE") acts.push({ k: "close" });
        else if (a.type === "URL") acts.push({ k: "url", to: a.url });
        else if (a.type === "SET_VARIABLE") acts.push({ k: "set", v: a.variableId });
        else if (a.type === "NODE" && a.destinationId) {
          const k = { NAVIGATE: "nav", OVERLAY: "ov", SWAP: "swap", CHANGE_TO: "var" }[a.navigation];
          if (!k) continue;
          const o = { k, to: a.destinationId };
          const tr = trans(a.transition);
          if (tr) o.tr = tr;
          if (k === "var") varTargets.add(a.destinationId);
          acts.push(o);
        }
      }
      if (!acts.length) continue;
      const it = { on, acts };
      if (on === "timeout") it.ms = Math.round((r.trigger.timeout || 0) * 1000);
      out.push(it);
    }
    return out.length ? out : undefined;
  }
  const VEC = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE"]);
  function vectorOnly(n) {
    if (n.visible === false) return true;
    if (VEC.has(n.type)) return true;
    if (n.type === "TEXT") return false;
    if (n.type === "RECTANGLE" || n.type === "ELLIPSE") {
      const p = paints(n.fills);
      return !(p && p.some((x) => x.k === "i"));
    }
    if ("children" in n) {
      if ("fills" in n && n !== undefined) {
        const p = paints(n.fills);
        if (p && p.some((x) => x.k === "i")) return false;
      }
      return n.children.length > 0 && n.children.every(vectorOnly);
    }
    return false;
  }
  function hasVecLeaf(n) {
    if (n.visible === false) return false;
    if (VEC.has(n.type)) return true;
    return "children" in n && n.children.some(hasVecLeaf);
  }
  function plain(n) {
    // container with no own visible paint/stroke/effect
    const f = "fills" in n ? paints(n.fills) : undefined;
    const s = "strokes" in n ? paints(n.strokes) : undefined;
    return !f && !s && !("effects" in n && n.effects.some((e) => e.visible !== false));
  }
  const svgJobs = [];
  async function textStyle(n) {
    const segs = n.getStyledTextSegments(["fontName", "fontSize", "fontWeight", "fills", "textDecoration", "lineHeight", "letterSpacing", "textCase"]);
    const run = (s) => {
      const o = { f: s.fontName.family, s: s.fontSize, w: s.fontWeight };
      if (s.lineHeight.unit === "PIXELS") o.lh = r2(s.lineHeight.value);
      else if (s.lineHeight.unit === "PERCENT") o.lh = r2((s.fontSize * s.lineHeight.value) / 100);
      const ls = s.letterSpacing.unit === "PIXELS" ? s.letterSpacing.value : (s.fontSize * s.letterSpacing.value) / 100;
      if (Math.abs(ls) > 0.001) o.ls = r2(ls);
      if (s.textDecoration !== "NONE") o.d = s.textDecoration;
      if (s.textCase !== "ORIGINAL") o.c = s.textCase;
      if (/italic/i.test(s.fontName.style)) o.i = true;
      const p = paints(s.fills);
      if (p) o.p = p;
      return o;
    };
    if (!segs.length) {
      const fn = n.fontName === figma.mixed ? { family: "Manrope", style: "Regular" } : n.fontName;
      return { tx: { v: "", f: fn.family, s: n.fontSize === figma.mixed ? 14 : n.fontSize, w: n.fontWeight === figma.mixed ? 400 : n.fontWeight, a: n.textAlignHorizontal, va: n.textAlignVertical, r: n.textAutoResize }, fill: paints(n.fills) };
    }
    const base = run(segs[0]);
    const tx = { v: n.characters, ...base };
    delete tx.p;
    if (segs.length > 1) {
      const table = {};
      const keyOf = {};
      let next = 1;
      const o = [];
      const bk = JSON.stringify(base);
      for (const s of segs) {
        const r = run(s);
        const k = JSON.stringify(r);
        let id = 0;
        if (k !== bk) {
          if (!keyOf[k]) {
            keyOf[k] = next++;
            table[keyOf[k]] = r;
          }
          id = keyOf[k];
        }
        const len = Array.from(n.characters.slice(s.start, s.end)).length;
        for (let i = 0; i < len; i++) o.push(id);
      }
      if (next > 1) {
        tx.o = o;
        tx.t = table;
      }
    }
    tx.a = n.textAlignHorizontal;
    tx.va = n.textAlignVertical;
    tx.r = n.textAutoResize;
    if (n.id.startsWith("I")) {
      const src = await figma.getNodeByIdAsync(n.id.split(";").pop());
      if (src && src.type === "TEXT" && src.characters !== n.characters) tx.ov = 1;
    }
    if (n.boundVariables && n.boundVariables.characters) tx.vb = n.boundVariables.characters.id;
    return { tx, fill: segs.length === 1 ? paints(n.fills) : paints(segs[0].fills) };
  }
  async function ser(n, ox, oy, root) {
    if (n.visible === false) return null;
    const o = { id: n.id, x: root ? 0 : r2(n.x - ox), y: root ? 0 : r2(n.y - oy), w: r2(n.width), h: r2(n.height) };
    let t = "F";
    if (n.type === "INSTANCE") t = "I";
    else if (n.type === "COMPONENT") t = "C";
    else if (n.type === "ELLIPSE") t = "E";
    else if (n.type === "TEXT") t = "T";
    o.t = t;
    if (!root) o.n = n.name;
    if ("opacity" in n && n.opacity < 1) o.o = r2(n.opacity);
    if ("rotation" in n && Math.abs(n.rotation) > 0.01) o.ro = r2(-n.rotation);
    if ("blendMode" in n && !["NORMAL", "PASS_THROUGH"].includes(n.blendMode)) o.b = n.blendMode.toLowerCase().replace(/_/g, "-");
    if (n.type === "INSTANCE") {
      const mc = await n.getMainComponentAsync();
      if (mc) {
        o.cid = mc.id;
        if (mc.parent && mc.parent.type === "COMPONENT_SET") compSets[mc.id] = mc.parent.id;
      }
    }
    if (n.type === "COMPONENT" && n.parent && n.parent.type === "COMPONENT_SET") compSets[n.id] = n.parent.id;
    const a = reactions(n);
    if (a) o.a = a;
    // vector graphic → svg
    if (!root && n.type !== "TEXT" && hasVecLeaf(n) && vectorOnly(n) && (VEC.has(n.type) || plain(n))) {
      const rb = n.absoluteRenderBounds;
      const bb = n.absoluteBoundingBox;
      if (rb && bb) {
        o.rb = [r2(rb.x - bb.x), r2(rb.y - bb.y), r2(rb.width), r2(rb.height)];
        o.sv = [r2(rb.width), r2(rb.height)];
      }
      svgJobs.push({ node: n, out: o });
      return o;
    }
    if (t === "T") {
      const { tx, fill } = await textStyle(n);
      if (fill) o.p = fill;
      o.tx = tx;
      return o;
    }
    const p = "fills" in n ? paints(n.fills) : undefined;
    if (p) o.p = p;
    if ("strokes" in n && n.strokes.length) {
      const sp = paints(n.strokes);
      if (sp) {
        const k = { p: sp[0], w: n.strokeWeight === figma.mixed ? 1 : r2(n.strokeWeight), a: n.strokeAlign };
        if ("strokeTopWeight" in n) {
          const s = [n.strokeTopWeight, n.strokeRightWeight, n.strokeBottomWeight, n.strokeLeftWeight];
          if (n.strokeWeight === figma.mixed || s.some((v) => v !== s[0])) {
            k.s = s.map(r2);
            k.w = Math.max(...s);
          }
        }
        if (n.dashPattern && n.dashPattern.length) k.d = n.dashPattern.map(r2);
        o.k = k;
      }
    }
    if ("cornerRadius" in n) {
      if (n.cornerRadius === figma.mixed) o.r = [n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius].map(r2);
      else if (n.cornerRadius) o.r = r2(n.cornerRadius);
    }
    Object.assign(o, shadow(n));
    if ("clipsContent" in n && n.clipsContent) o.c = 1;
    if ("overflowDirection" in n && n.overflowDirection && n.overflowDirection !== "NONE")
      o.sc = { VERTICAL: "V", HORIZONTAL: "H", BOTH: "B" }[n.overflowDirection];
    if ("children" in n && n.children.length) {
      // group children are positioned relative to the group's parent
      const gx = n.type === "GROUP" || n.type === "BOOLEAN_OPERATION" ? n.x : 0;
      const gy = n.type === "GROUP" || n.type === "BOOLEAN_OPERATION" ? n.y : 0;
      const base = root ? { x: n.type === "GROUP" ? n.x : 0, y: n.type === "GROUP" ? n.y : 0 } : { x: gx, y: gy };
      const ch = [];
      for (const c of n.children) {
        const s = await ser(c, base.x, base.y, false);
        if (s) ch.push(s);
      }
      if (ch.length) o.ch = ch;
    }
    return o;
  }
  const out = { items: [], svgs: {}, images: {}, vars: [], compSets: {}, errors: [] };
  const queue = page.children.filter((n) => PATTERN.test(n.name) && !SKIP.has(n.id)).map((n) => [n.id, "s"]);
  const done = new Set();
  for (let i = 0; i < queue.length; i++) {
    const [id, kind] = queue[i];
    if (done.has(id)) continue;
    done.add(id);
    svgJobs.length = 0;
    try {
      const n = await figma.getNodeByIdAsync(id);
      if (!n) { out.errors.push(id + ":missing"); continue; }
      figma.ui.postMessage({ type: "progress", text: `${i + 1}/${queue.length} ${n.name}` });
      const doc = await ser(n, 0, 0, true);
      for (const j of svgJobs) {
        let svg = null;
        try { svg = await j.node.exportAsync({ format: "SVG_STRING", useAbsoluteBounds: false }); } catch (e) {}
        if (!svg) continue;
        const h = fnv(svg);
        j.out.g = h;
        out.svgs[h] = svg;
      }
      out.items.push([id, kind, n.name, r2(n.width), r2(n.height), JSON.stringify(doc)]);
      // component states that prototype links switch to
      for (const v of varTargets) if (!done.has(v) && !queue.some((q) => q[0] === v)) queue.push([v, "n"]);
    } catch (e) {
      out.errors.push(id + ":" + String(e).slice(0, 160));
    }
  }
  for (const h of images) {
    try {
      const img = figma.getImageByHash(h);
      const bytes = img && (await img.getBytesAsync());
      if (bytes) out.images[h] = figma.base64Encode(bytes);
    } catch (e) { out.errors.push("image " + h); }
  }
  out.vars = [...varTargets];
  out.compSets = compSets;
  return out;
}
