// Adds frames exported from Figma to the prototype.
// Usage: node scripts/figma-export/integrate.mjs <export.json> [--update]
//   export.json comes from the Figma plugin in ./plugin (see README.md).
//   --update also replaces screens that already exist.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const [file, flag] = process.argv.slice(2);
if (!file) throw new Error("Pass the exported JSON file.");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const update = flag === "--update";

let decompress = (s) => s;
if (data.compressed) decompress = (await import("lz-string")).default.decompressFromBase64;

const mPath = path.join(root, "src/design/manifest.json");
const m = JSON.parse(fs.readFileSync(mPath, "utf8"));
const slug = (n) => n.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const MODULES = [
  [/^(Login · Pharmacy|Pharmacy web|Pharmacy register|PhModal|PhToast)/, "pharmacy"],
  [/^(Login · Clinic staff|Reception web|Rc(Modal|Toast)|ClinicAdmin web|Ca(Modal|Toast))/, "clinic"],
  [/^(Login · Lab|Lab web|Lb(Modal|Toast)|Pathologist web|Pa(Modal|Toast))/, "lab"],
  [/^Rider/, "rider"],
  [/^(Login · AroNexa team|Platform web|Pl(Modal|Toast)|Support web|Sp(Modal|Toast))/, "team"],
  [/^(Login · (Insurer|Dealer|Seller)|(Insurer|Dealer|Seller) web|(In|Dl|Sl)(Modal|Toast))/, "partner"],
  [/^(Patient web|Patient mobile|Patient sign up|Login · Patient|PModal|PToast)/, "patient"],
];
// Where each area starts (its sign-in) and the page its Back button falls back to.
const AREAS = {
  pharmacy: { start: "509:14058", home: "509:14219" },
  clinic: { start: "669:14544", home: "636:14461" },
  lab: { start: "669:14616", home: "658:14483" },
  rider: { start: "677:14550", home: "677:14550" },
  team: { start: "681:14750", home: "679:14550" },
  partner: { start: "686:14816", home: "684:14573" },
};
const out = (p) => path.join(root, "public/design", p);
let added = 0, replaced = 0, skipped = 0;
for (const [id, kind, name, w, h, body] of Object.values(data.items)) {
  const json = decompress(body);
  JSON.parse(json);
  const fileName = id.replace(/[:;]/g, "-");
  if (kind === "n") {
    fs.writeFileSync(out(`nodes/${fileName}.json`), json);
    if (!m.nodes.includes(id)) m.nodes.push(id);
    continue;
  }
  const at = m.screens.findIndex((s) => s.id === id);
  if (at >= 0 && !update) { skipped++; continue; }
  fs.writeFileSync(out(`screens/${fileName}.json`), json);
  const entry = { id, name, slug: slug(name), w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10, file: fileName };
  const mod = MODULES.find(([re]) => re.test(name));
  if (mod) entry.module = mod[1];
  if (at >= 0) { m.screens[at] = entry; replaced++; } else { m.screens.push(entry); added++; }
}
for (const [h, svg] of Object.entries(data.svgs ?? {})) fs.writeFileSync(out(`vectors/${h}.svg`), decompress(svg));
for (const [h, b64] of Object.entries(data.images ?? {})) {
  if (m.images[h] || typeof b64 !== "string") continue;
  const bytes = Buffer.from(b64, "base64");
  const ext = bytes[0] === 0xff ? "jpg" : "png";
  fs.writeFileSync(out(`images/${h}.${ext}`), bytes);
  m.images[h] = `${h}.${ext}`;
}
Object.assign(m.compSets, data.compSets ?? {});
delete m.pharmacyStart;
m.areas = { ...(m.areas ?? {}), ...AREAS };
fs.writeFileSync(mPath, JSON.stringify(m));
const waiting = (data.vars ?? []).filter((v) => !m.nodes.includes(v) && !m.screens.some((s) => s.id === v));
const noImage = Object.values(data.items).length && Array.isArray(data.images) ? data.images.filter((h) => !m.images[h]) : [];
console.log(`Added ${added}, replaced ${replaced}, skipped ${skipped} existing.`);
if (waiting.length) console.log("Component states still to export:", waiting.join(", "));
if (noImage.length) console.log("Images still missing:", noImage.join(", "));
if (data.errors?.length) console.log("Errors:", data.errors);
