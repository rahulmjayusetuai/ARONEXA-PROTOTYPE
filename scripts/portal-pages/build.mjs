// Builds the clinic and lab pages that the Figma file does not have yet (Billing, Visits,
// Orders & referrals and Settings for reception; Billing and Settings for the lab).
// Each page reuses its portal's own top bar and tabs, and the body of the matching pharmacy
// page, so it looks like the rest of the product. Run from the repo root:
//   node scripts/portal-pages/build.mjs
// It rewrites the six screens in public/design/screens and their rows in src/design/manifest.json.
import fs from "node:fs";

const MANIFEST = "src/design/manifest.json";
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const byName = (name) => {
  const s = manifest.screens.find((x) => x.name === name);
  if (!s) throw new Error(`No screen named ${name}`);
  return JSON.parse(fs.readFileSync(`public/design/screens/${s.file}.json`, "utf8"));
};
const clone = (n) => JSON.parse(JSON.stringify(n));
const find = (n, test) => {
  if (test(n)) return n;
  for (const c of n.ch ?? []) {
    const f = find(c, test);
    if (f) return f;
  }
  return undefined;
};
const all = (n, test, out = []) => {
  if (test(n)) out.push(n);
  (n.ch ?? []).forEach((c) => all(c, test, out));
  return out;
};
const NAVY = "rgb(3,28,84)";
const SLATE = "rgb(51,65,85)";

// Icons drawn white for the selected tab, and grey for the others.
const ICON_ON = { "Icon/chart": "ddabc0d78009dd4a", "Icon/doc": "bb5a60e1d1f4fcf0", "Icon/swap": "510b2277a5551fb2", "Icon/box": "b1ea8e38698f66bf", "Icon/camera": "01e2af765ad86949", "Icon/wallet": "c0719819edc4ad9c", "Icon/gear": "9f3b5fde6700cf2f" };
const ICON_OFF = { "Icon/doc": "768c50d3d4d7876a", "Icon/box": "2f8afa9ad5ff1569", "Icon/swap": "db1117b96864df04", "Icon/camera": "4fa903c02db22063", "Icon/wallet": "436cbe5baa306b56", "Icon/chart": "8afc1619b835698c", "Icon/gear": "9551de588cf9bf99" };

function styleTab(tab, on) {
  if (on) tab.p = [{ k: "s", c: NAVY }];
  else delete tab.p;
  tab.a = on ? undefined : tab.a;
  if (on) delete tab.a;
  for (const c of tab.ch ?? []) {
    if (/^Icon\//.test(c.n ?? "") && c.g) {
      const g = (on ? ICON_ON : ICON_OFF)[c.n];
      if (g) c.g = g;
      // The white icons are component instances in the design; either kind draws the same.
    }
    if (c.t === "T") {
      c.p = [{ k: "s", c: on ? "rgb(255,255,255)" : SLATE }];
      c.tx = { ...c.tx, w: on ? 700 : 600 };
    }
  }
}

// Sets a text. Values that sit at the right edge of a row grow to the left.
function setText(node, v, { right = false, size } = {}) {
  if (!node?.tx) throw new Error(`No text node for "${v}"`);
  const per = (size ?? node.tx.s ?? 14) * 0.56;
  const want = Math.ceil(v.length * per) + 4;
  if (right) {
    const edge = node.x + node.w;
    node.w = Math.max(node.w, want);
    node.x = edge - node.w;
    node.tx = { ...node.tx, v, a: "RIGHT", r: "NONE" };
  } else {
    // Text that wraps inside a fixed width keeps its width.
    if (node.tx.r !== "HEIGHT") node.w = Math.max(node.w, want);
    node.tx = { ...node.tx, v };
  }
}
const textAt = (root, id) => find(root, (n) => n.id === id);
const set = (root, id, v, opts) => setText(textAt(root, id), v, opts);
const say = (text) => [{ on: "click", acts: [{ k: "fx", fx: "say", arg: text }] }];

function prefixIds(node, tag) {
  node.id = `${tag}${node.id}`;
  (node.ch ?? []).forEach((c) => prefixIds(c, tag));
}

// The page frame: the portal's top bar and tabs, with `active` as the selected tab.
function frame(baseName, activeInBase, active, tabPrefix) {
  const base = byName(baseName);
  const root = clone(base);
  root.ch = root.ch.filter((c) => c.n === "Top bar" || c.n === "Section nav");
  const nav = root.ch.find((c) => c.n === "Section nav");
  for (const tab of nav.ch) {
    const label = tab.n?.replace(`${tabPrefix} / `, "");
    if (label === activeInBase) styleTab(tab, false);
    if (label === active) styleTab(tab, true);
  }
  // The tab that was selected in the base page has no link; give it its own page.
  const was = nav.ch.find((t) => t.n === `${tabPrefix} / ${activeInBase}`);
  if (was && !was.a) was.a = [{ on: "click", acts: [{ k: "nav", to: manifest.screens.find((s) => s.name === baseName).id, tr: { t: "d", ms: 180 } }] }];
  return root;
}

// The body of a pharmacy page, placed under the frame.
function body(pharmacyName) {
  const src = byName(pharmacyName);
  return clone(src.ch.filter((c) => c.n !== "Top bar" && c.n !== "Section nav"));
}

// Adds rows to a list by repeating its last row; rows below and the list grow to fit.
function growList(list, rowPrefix, count) {
  const rows = list.ch.filter((c) => c.n?.startsWith(rowPrefix)).sort((a, b) => a.y - b.y);
  const step = rows[1].y - rows[0].y;
  const last = rows.at(-1);
  const extra = count - rows.length;
  for (let i = 1; i <= extra; i++) {
    const copy = clone(last);
    prefixIds(copy, `r${i}-`);
    copy.y = last.y + step * i;
    list.ch.push(copy);
  }
  if (extra > 0) list.h += step * extra;
  return extra > 0 ? step * extra : 0;
}

function fitHeight(root) {
  const bottom = Math.max(...root.ch.map((c) => c.y + c.h));
  root.h = Math.max(900, Math.ceil(bottom + 40));
}

// Fills a pharmacy-billing style list: [code, name, detail, method, amount] per row.
function fillRows(list, rowPrefix, rows) {
  const items = list.ch.filter((c) => c.n?.startsWith(rowPrefix)).sort((a, b) => a.y - b.y);
  items.forEach((row, i) => {
    const r = rows[i];
    const texts = all(row, (n) => n.t === "T");
    // code, name, detail, method, amount
    setText(texts[0], r[0]);
    setText(texts[1], r[1]);
    setText(texts[2], r[2]);
    setText(texts[3], r[3], { right: true });
    setText(texts[4], r[4], { right: true });
    // The method column sits just left of the amount column.
    texts[3].x = Math.min(texts[3].x, texts[4].x - texts[3].w - 14);
    row.n = `${rowPrefix}${r[0]}`;
    if (r[5]) row.a = r[5];
  });
}

// Fills "label · value" lines in a side card.
function fillLines(card, lines) {
  const items = card.ch.filter((c) => c.n?.startsWith("Line /")).sort((a, b) => a.y - b.y);
  items.forEach((line, i) => {
    const [label, value] = lines[i];
    const [l, v] = all(line, (n) => n.t === "T");
    setText(l, label);
    setText(v, value, { right: true });
    line.n = `Line / ${label}`;
  });
}

const pages = [];
function page(id, name, root) {
  fitHeight(root);
  prefixIds(root, `${id.replace(":", "-")}~`);
  root.id = id;
  const slug = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = id.replace(":", "-");
  fs.writeFileSync(`public/design/screens/${file}.json`, JSON.stringify(root));
  pages.push({ id, name, slug, w: root.w, h: root.h, file, module: name.startsWith("Lab web") ? "lab" : "clinic" });
}

// ---------- Billing pages (reception and lab) ----------
function billingPage({ id, name, base, activeInBase, prefix, title, sub, buttons, totals, listTitle, rows, fees, bank, bankNote }) {
  const root = frame(base, activeInBase, name.split(" / ")[1], prefix);
  const parts = body("Pharmacy web / Billing");
  root.ch.push(...parts);
  set(root, "512:14529", title);
  set(root, "512:14530", sub);
  const [b1, b2] = buttons;
  set(root, "512:14524", b1);
  set(root, "512:14526", b2);
  textAt(root, "512:14523").a = say(`${b1.replace(/^Download /, "").replace(/^./, (c) => c.toUpperCase())} for May 2025 downloaded.`);
  textAt(root, "512:14525").a = say(`${b2.replace(/^Download /, "").replace(/^./, (c) => c.toUpperCase())} for today downloaded.`);
  const ids = [["512:14534", "512:14535", "512:14536"], ["512:14538", "512:14539", "512:14540"], ["512:14542", "512:14543", "512:14544"], ["512:14546", "512:14547", "512:14548"]];
  totals.forEach((t, i) => ids[i].forEach((tid, k) => set(root, tid, t[k])));
  set(root, "512:14552", listTitle);
  const list = textAt(root, "512:14550");
  const grew = growList(list, "Txn /", rows.length);
  textAt(root, "512:14549").h += grew;
  fillRows(list, "Txn / ", rows);
  set(root, "512:14584", fees.title);
  fillLines(textAt(root, "512:14582"), fees.lines);
  set(root, "512:14598", bank);
  set(root, "512:14599", bankNote);
  page(id, name, root);
}

billingPage({
  id: "900:1001",
  name: "Reception web / Billing",
  base: "Reception web / Appointments",
  activeInBase: "Appointments",
  prefix: "RcTab",
  title: "Billing and payments",
  sub: "Thursday, 15 May 2025 · Thanal Heart Clinic",
  buttons: ["Download GST report", "Download day report"],
  totals: [
    ["Collected today", "₹1,700", "3 bills paid"],
    ["Paid in the app", "₹500", "1 bill · paid online"],
    ["Pending", "₹700", "James Heatfield · consult + ECG"],
    ["Expected today", "₹4,600", "All 9 patients"],
  ],
  listTitle: "Today’s bills",
  rows: [
    ["TH-0511", "Priya Sharma", "Chest pain review · Dr. Arjun Mehta", "UPI · AroNexa", "₹500"],
    ["TH-0512", "Rahul Verma", "ECG follow-up · consult + ECG", "Cash at desk", "₹600"],
    ["TH-0514", "Anita Joseph", "New consultation · consult + ECG", "Card", "₹600"],
    ["TH-0518", "James Heatfield", "Follow-up consultation + ECG", "Pending · sent to app", "₹700", say("Payment link sent to James Heatfield on WhatsApp.")],
  ],
  fees: {
    title: "Fees and payouts",
    lines: [
      ["Consultation", "₹500"],
      ["ECG", "₹100"],
      ["AroNexa booking fee", "₹20 · paid by patient"],
      ["Payout to clinic account", "Next working day"],
    ],
  },
  bank: "South Indian Bank •••• 4410 · Thanal Heart Clinic",
  bankNote: "GSTIN 32AAKFT5521K1Z8 · HFR IN3210012345",
});

billingPage({
  id: "900:1005",
  name: "Lab web / Billing",
  base: "Lab web / Samples",
  activeInBase: "Samples",
  prefix: "LbTab",
  title: "Billing and payouts",
  sub: "Thursday, 15 May 2025 · Thejus Clinical Lab",
  buttons: ["Download GST report", "Download statement"],
  totals: [
    ["Collected today", "₹14,860", "38 tests"],
    ["From AroNexa orders", "₹4,725", "9 orders · paid online"],
    ["Payout tomorrow", "₹4,680", "AroNexa orders, after fees"],
    ["Waiting for payment", "₹1,105", "2 home collections"],
  ],
  listTitle: "Today’s orders",
  rows: [
    ["LT-551", "James Heatfield", "Kidney panel + urine albumin · Dr. K. Rao", "UPI · AroNexa", "₹785"],
    ["LT-556", "Arun Kumar", "Lipid panel · Dr. Arjun Mehta", "UPI · AroNexa", "₹525"],
    ["LT-549", "Meera Krishnan", "Thyroid profile · walk-in", "Cash at counter", "₹450"],
    ["LT-553", "Faisal Rahman", "HbA1c + fasting sugar · Dr. Saji Varghese", "Card", "₹620"],
  ],
  fees: {
    title: "How AroNexa fees work",
    lines: [
      ["App order (paid by patient)", "₹5 per order"],
      ["Home collection", "Free for patients"],
      ["Your test price", "Kept in full"],
      ["Payout to your bank", "Next working day"],
    ],
  },
  bank: "HDFC Bank •••• 3091 · Thejus Clinical Lab",
  bankNote: "GSTIN 32AAGFT7812Q1Z3 · NABL MC-4417 · HFR IN3210098765",
});

// ---------- Reception visits, and orders and referrals ----------
billingPage({
  id: "900:1002",
  name: "Reception web / Visits",
  base: "Reception web / Appointments",
  activeInBase: "Appointments",
  prefix: "RcTab",
  title: "Visits",
  sub: "Thursday, 15 May 2025 · Dr. Arjun Mehta · Room 4",
  buttons: ["Download visit list", "Download summaries"],
  totals: [
    ["Seen today", "3", "9:00 to 10:20"],
    ["With the doctor", "1", "James Heatfield · T-04"],
    ["Waiting", "1", "Mohammed Ali · since 10:42"],
    ["Still to come", "4", "Last at 2:30 PM"],
  ],
  listTitle: "Today’s visits",
  rows: [
    ["T-01", "Priya Sharma", "Chest pain review · AroNexa app", "Seen", "9:05 to 9:20"],
    ["T-02", "Rahul Verma", "ECG follow-up · phone booking", "Seen", "9:30 to 9:48"],
    ["T-03", "Anita Joseph", "New consultation · walk-in", "Seen", "10:02 to 10:20"],
    ["T-04", "James Heatfield", "Cardiology follow-up · ECG to discuss", "With the doctor", "Since 10:21"],
    ["T-05", "Mohammed Ali", "Blood pressure check · WhatsApp", "Waiting", "Arrived 10:42"],
    ["T-06", "Kavya Reddy", "Lipid report to explain · AroNexa app", "On the way", "Expected 11:20"],
  ],
  fees: {
    title: "After each visit",
    lines: [
      ["Visit summaries sent", "3 of 3"],
      ["Bills paid", "3 of 4"],
      ["Follow-ups booked", "2"],
      ["No-shows today", "None"],
    ],
  },
  bank: "A visit closes when the doctor saves the note",
  bankNote: "and the bill is paid. Summaries go to the patient on WhatsApp.",
});

billingPage({
  id: "900:1003",
  name: "Reception web / Orders & referrals",
  base: "Reception web / Appointments",
  activeInBase: "Appointments",
  prefix: "RcTab",
  title: "Orders and referrals",
  sub: "Tests, scans and referrals Dr. Arjun Mehta asked for",
  buttons: ["Download list", "Download letters"],
  totals: [
    ["Ordered today", "4", "2 tests · 1 scan · 1 referral"],
    ["Booked", "2", "Holter and echo referral"],
    ["Waiting to book", "1", "Lipid profile · James Heatfield"],
    ["Results back", "1", "Kidney panel · Thejus Lab"],
  ],
  listTitle: "Today’s orders and referrals",
  rows: [
    ["OR-301", "James Heatfield", "24-hour Holter test · Sahya Heart Care", "22 May, 9:00 AM", "Booked"],
    ["OR-302", "James Heatfield", "Lipid profile (fasting) · before 29 May", "Patient picks a lab", "Not booked yet", say("Reminder sent to James Heatfield to book the lipid profile.")],
    ["OR-298", "Arun Kumar", "Lipid panel · Thejus Clinical Lab", "Sample taken today", "Result pending"],
    ["RF-114", "Priya Sharma", "Referral: echocardiogram · Sahya Heart Care", "Letter sent on WhatsApp", "Booked 17 May"],
  ],
  fees: {
    title: "How orders work",
    lines: [
      ["Lab tests", "Patient picks a lab"],
      ["Scans and Holter", "Booked by reception"],
      ["Referral letters", "Sent on WhatsApp"],
      ["Results", "Back in the record"],
    ],
  },
  bank: "Partners: Thejus Clinical Lab · Nila Diagnostics · Sahya Heart Care",
  bankNote: "Results from partners reach the doctor and the patient’s record by themselves.",
});

// ---------- Settings pages (reception and lab) ----------
function settingsPage({ id, name, base, activeInBase, prefix, title, sub, profileTitle, profile, staffTitle, staff, deliveryTitle, delivery, alerts, signOut }) {
  const root = frame(base, activeInBase, name.split(" / ")[1], prefix);
  root.ch.push(...body("Pharmacy web / Settings"));
  const texts = all(root, (n) => n.t === "T");
  const byText = (v) => {
    const n = texts.find((t) => t.tx.v === v && !t.__used);
    if (!n) throw new Error(`Settings text not found: ${v}`);
    n.__used = true;
    return n;
  };
  setText(byText("Pharmacy settings"), title);
  setText(byText("Profile, licences, staff, delivery and alerts"), sub);
  setText(byText("Pharmacy profile"), profileTitle);
  const profileLabels = ["Name", "Address", "Drug licence", "GSTIN", "Opening hours", "Phone"];
  const profileValues = ["Periyar Medicals", "Seaport–Airport Road, Kakkanad, Kochi 682030", null, "32ABCPV1234M1Z5", "8:00 AM to 10:00 PM · all days", "+91 484 2 42 6611"];
  profileLabels.forEach((l, i) => {
    const [label, value] = profile[i];
    setText(byText(l), label);
    const v = profileValues[i] ? byText(profileValues[i]) : texts.find((t) => /^20B\/21B/.test(t.tx.v));
    setText(v, value, { right: true });
  });
  setText(byText("Staff and roles"), staffTitle);
  const staffTexts = [
    ["Shibu Varghese · Owner · admin", "Everything, including payouts"],
    ["Anitha Joseph · Pharmacist · KSPC Reg. 18822", "Reads prescriptions, approves substitutes"],
    ["Neethu P · Pharmacy staff", "Quotes, packing, stock"],
    ["Rahul K, Vinod S · Delivery riders", "Their deliveries only"],
  ];
  staffTexts.forEach(([a, b], i) => {
    setText(byText(a), staff[i][0]);
    setText(byText(b), staff[i][1]);
  });
  setText(byText("Delivery"), deliveryTitle);
  [["Delivery area", "Up to 6 km"], ["Delivery fee", "₹30 under 3 km · ₹50 up to 6 km"], ["Usual delivery time", "About 2 hours"]].forEach(([a, b], i) => {
    setText(byText(a), delivery[i][0]);
    setText(byText(b), delivery[i][1], { right: true });
  });
  ["New request (sound)", "Comparison request (urgent)", "Doctor replied on a substitute", "Low stock and expiry", "Daily sales summary at 10 PM"].forEach((a, i) => setText(byText(a), alerts[i]));
  const sign = texts.find((t) => t.tx.v === "Sign out");
  const signRow = sign && find(root, (n) => n.ch?.includes(sign)) ;
  const signBox = signRow && (signRow.a ? signRow : find(root, (n) => n.ch?.includes(signRow)));
  if (signBox) signBox.a = [{ on: "click", acts: [{ k: "nav", to: signOut, tr: { t: "d", ms: 200 } }] }];
  // Edit links and "+ Add staff" open a small editor or say what happens.
  for (const t of texts) {
    if (t.tx.v === "Edit") t.a = say(`${profileTitle} saved. Changes to the registration number are checked by the AroNexa team.`);
    if (t.tx.v === "+ Add staff") t.a = say("Invite sent. The new staff member joins after accepting it on WhatsApp.");
    delete t.__used;
  }
  page(id, name, root);
}

settingsPage({
  id: "900:1004",
  name: "Reception web / Settings",
  base: "Reception web / Appointments",
  activeInBase: "Appointments",
  prefix: "RcTab",
  title: "Clinic settings",
  sub: "Profile, registration, staff, booking and alerts",
  profileTitle: "Clinic profile",
  profile: [
    ["Name", "Thanal Heart Clinic"],
    ["Address", "2nd floor, Infopark Road, Kakkanad, Kochi 682030"],
    ["HFR registration", "IN3210012345 · ✓ verified"],
    ["GSTIN", "32AAKFT5521K1Z8"],
    ["Opening hours", "Mon to Sat · 9:00 AM to 8:00 PM"],
    ["Phone", "+91 484 2 41 5520"],
  ],
  staffTitle: "Staff and roles",
  staff: [
    ["Dr. Arjun Mehta · Cardiologist · owner", "Consultations, notes, prescriptions"],
    ["Rajan Pillai · Clinic admin", "Staff, clinic setup, billing and reports"],
    ["Sneha Mohan · Receptionist", "Queue, appointments, walk-ins and bills"],
    ["Dr. P. Nair · Visiting consultant", "Invite sent · joins after accepting"],
  ],
  deliveryTitle: "Booking",
  delivery: [
    ["Appointment length", "15 minutes"],
    ["Walk-ins", "Allowed · token at the desk"],
    ["Visit reminder", "Morning of the visit"],
  ],
  alerts: ["Patient running late", "Slot at risk (no reply)", "Doctor running late", "Bill still pending", "Daily summary at 8 PM"],
  signOut: "669:14544",
});

settingsPage({
  id: "900:1006",
  name: "Lab web / Settings",
  base: "Lab web / Samples",
  activeInBase: "Samples",
  prefix: "LbTab",
  title: "Lab settings",
  sub: "Profile, accreditation, staff, collection and alerts",
  profileTitle: "Lab profile",
  profile: [
    ["Name", "Thejus Clinical Lab"],
    ["Address", "Round North, Thrissur 680001"],
    ["NABL accreditation", "MC-4417 · valid till 2027 · ✓ verified"],
    ["GSTIN", "32AAGFT7812Q1Z3"],
    ["Opening hours", "6:30 AM to 6:00 PM · all days"],
    ["Phone", "+91 487 2 33 1180"],
  ],
  staffTitle: "Staff and roles",
  staff: [
    ["Joby Thomas · Lab admin · owner", "Everything, including payouts"],
    ["Dr. Meera Iyer · Pathologist · TCMC Reg. 41287", "Reviews and signs reports"],
    ["Bijoy K · Lab technician", "Runs tests, enters results"],
    ["Anu, Rakesh · Sample collectors", "Home collections only"],
  ],
  deliveryTitle: "Home collection",
  delivery: [
    ["Collection area", "Up to 8 km"],
    ["Collection fee", "Free for AroNexa orders"],
    ["Usual report time", "6 to 8 hours"],
  ],
  alerts: ["New request (sound)", "Urgent request", "Critical result found", "Analyser down", "Daily summary at 6 PM"],
  signOut: "669:14616",
});

// ---------- Top-bar pop-ups: profile, notifications, branch, staff on duty ----------
// The clinic and lab top bars were copied from the pharmacy, so their buttons opened the
// pharmacy's pop-ups or went straight to sign-in. Each portal gets its own versions of them.
const screenId = (name) => {
  const s = manifest.screens.find((x) => x.name === name) ?? pages.find((x) => x.name === name);
  if (!s) throw new Error(`No screen named ${name}`);
  return s.id;
};
const go = (name) => [{ on: "click", acts: [{ k: "nav", to: screenId(name), tr: { t: "d", ms: 200 } }] }];

function modal(id, name, root, module) {
  prefixIds(root, `${id.replace(":", "-")}~`);
  root.id = id;
  const slug = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = id.replace(":", "-");
  fs.writeFileSync(`public/design/screens/${file}.json`, JSON.stringify(root));
  pages.push({ id, name, slug, w: root.w, h: root.h, file, module });
}

// Replaces texts by their current wording, once each.
function retext(root, pairs) {
  const texts = all(root, (n) => n.t === "T");
  for (const [from, to, opts] of pairs) {
    const n = texts.find((t) => t.tx.v === from && !t.__done);
    if (!n) throw new Error(`Text not found: ${from}`);
    setText(n, to, opts);
    n.__done = true;
  }
  texts.forEach((t) => delete t.__done);
}
const byNodeName = (root, n) => {
  const f = find(root, (x) => x.n === n);
  if (!f) throw new Error(`No node named ${n}`);
  return f;
};

function profileModal({ id, name, module, person, role, branch, myProfile, signOut }) {
  const root = clone(byName("PhModal / Profile"));
  retext(root, [["Anitha Joseph", person], ["Pharmacist · KSPC Reg. 18822 · Periyar Medicals", role], ["Switch branch · Kakkanad", `Switch branch · ${branch}`], ["Hand over shift", "Who is on duty"]]);
  const prefix = name.split(" / ")[0];
  byNodeName(root, "PhMenu / Switch branch").a = [{ on: "click", acts: [{ k: "swap", to: `${prefix}:branch`, tr: { t: "d", ms: 180 } }] }];
  byNodeName(root, "PhMenu / Hand over shift").a = [{ on: "click", acts: [{ k: "swap", to: `${prefix}:duty`, tr: { t: "d", ms: 180 } }] }];
  byNodeName(root, "PhMenu / My profile").a = go(myProfile);
  byNodeName(root, "PhMenu / Sign out").a = [{ on: "click", acts: [{ k: "nav", to: signOut, tr: { t: "d", ms: 200 } }] }];
  modal(id, name, root, module);
}

function branchModal({ id, name, module, sub, rows, sectionTitle, item, counts, button, buttonSays, note }) {
  const root = clone(byName("PhModal / Switch branch"));
  retext(root, [
    ["Periyar Medicals · 3 branches you can manage", sub],
    ["Kakkanad", rows[0][0]],
    ["Open till 10 PM · 1,284 medicines · 6 new requests", rows[0][1]],
    ["Edappally", rows[1][0]],
    ["Open till 11 PM · 1,102 medicines · 2 low stock", rows[1][1]],
    ["Vyttila", rows[2][0]],
    ["Open 24 hours · 968 medicines · 1 order to pack", rows[2][1]],
    ["STOCK ACROSS BRANCHES", sectionTitle],
    ["D-Rise 1000 IU tablet (vitamin D3)", item],
    ["Kakkanad 0  ·  Edappally 40  ·  Vyttila 12", counts],
    ["Move 30 from Edappally", button],
    ["Each branch keeps its own requests, stock and bills. Owners see all branches in Reports.", note],
  ]);
  byNodeName(root, "Row / Edappally").a = say(`Switched to ${rows[1][0]}.`);
  byNodeName(root, "Row / Vyttila").a = say(`Switched to ${rows[2][0]}.`);
  const b = byNodeName(root, "Button / Move 30 from Edappally");
  b.a = say(buttonSays);
  b.w = Math.max(b.w, button.length * 8 + 40);
  modal(id, name, root, module);
}

function dutyModal({ id, name, module, title, sub, now, nowLine, section, next, nextLine, none, noneLine, note, staffPage }) {
  const root = clone(byName("PhModal / Pharmacist on duty"));
  retext(root, [
    ["Pharmacist on duty", title],
    ["Rx and Schedule H medicines can be sold only while a registered pharmacist is on duty", sub],
    ["Anitha Joseph · on duty now", now],
    ["KSPC 18822 · 9:00 AM – 5:00 PM · signed in at counter 1", nowLine],
    ["HAND OVER AT END OF SHIFT", section],
    ["Deepa R · from 5:00 PM", next],
    ["KSPC 20311 · 5:00 PM – 10:00 PM", nextLine],
    ["No pharmacist", none],
    ["Rx sales pause · only over-the-counter items can be billed", noneLine],
    ["Every Rx bill, substitute approval and Schedule H1 entry is saved with the pharmacist’s name and registration number.", note],
  ]);
  byNodeName(root, "Option / Deepa R · from 5:00 PM").a = say(`Hand-over set: ${next.split(" · ")[0]} takes over ${next.split(" · ")[1] ?? ""}.`.replace(/ \.$/, "."));
  byNodeName(root, "Option / No pharmacist").a = say(`${none}: saved. ${noneLine.split(" · ")[0]}.`);
  byNodeName(root, "Button / Staff and roles").a = go(staffPage);
  modal(id, name, root, module);
}

function notificationsModal({ id, name, module, count, items }) {
  const root = clone(byName("PhModal / Notifications"));
  retext(root, [["3 new", count]]);
  const rows = root.ch.find((c) => c.n === "Body").ch.filter((c) => c.n?.startsWith("PhNotification /")).sort((a, b) => a.y - b.y);
  rows.forEach((row, i) => {
    const [title, line, screen] = items[i];
    const [t1, t2] = all(row, (n) => n.t === "T");
    setText(t1, title);
    setText(t2, line);
    row.a = go(screen);
    row.n = `Notification / ${title}`;
  });
  modal(id, name, root, module);
}

const PORTALS = [
  {
    prefix: "RcModal", module: "clinic", base: 2001,
    profile: { person: "Sneha Mohan", role: "Receptionist · Thanal Heart Clinic", branch: "Kakkanad", myProfile: "Reception web / Settings", signOut: "669:14544" },
    branch: {
      sub: "Thanal Heart Clinic · 3 branches you can manage",
      rows: [["Kakkanad · main", "Open till 8 PM · 21 appointments today · 3 at risk"], ["Edappally", "Open till 6 PM · 12 appointments today · Dr. P. Nair"], ["Aluva", "Saturdays only · no appointments today"]],
      sectionTitle: "TODAY ACROSS BRANCHES", item: "Dr. Arjun Mehta · Kakkanad till 4:30 PM", counts: "Kakkanad 21  ·  Edappally 12  ·  Aluva 0",
      button: "Offer 2 patients Edappally", buttonSays: "Two waiting patients were offered an earlier slot at Edappally.",
      note: "Each branch keeps its own queue, appointments and bills. The clinic admin sees all branches in Reports.",
    },
    duty: {
      title: "Doctor in clinic", sub: "Patients see this on the waiting-room screen and in the app",
      now: "Dr. Arjun Mehta · in clinic now", nowLine: "Cardiology · 9:00 AM – 4:30 PM · Room 4",
      section: "NEXT IN THIS ROOM", next: "Dr. P. Nair · from 5:00 PM", nextLine: "Orthopaedics · 5:00 PM – 8:00 PM",
      none: "Doctor stepped out", noneLine: "Queue pauses · patients get a short delay message",
      note: "When the doctor steps out or runs late, waiting patients are told by WhatsApp and in the app, so no one waits without knowing.",
      staffPage: "Reception web / Settings",
    },
    notifications: {
      count: "5 new",
      items: [
        ["Mohammed Ali checked in · T-05", "Arrived 10:42 · waiting", "Reception web / Live queue"],
        ["Biju Varghese hasn’t confirmed", "12:15 slot · at risk", "Reception web / At risk"],
        ["James Heatfield’s bill is pending", "₹700 · consult + ECG", "Reception web / Billing"],
        ["Lab result in: Arun Kumar", "Lipid panel · Thejus Clinical Lab", "Reception web / Orders & referrals"],
        ["Fatima Beevi is running late", "About 15 minutes · 12:30 slot", "Reception web / Appointments"],
      ],
    },
  },
  {
    prefix: "CaModal", module: "clinic", base: 2011,
    profile: { person: "Rajan Pillai", role: "Clinic Admin · Thanal Heart Clinic", branch: "Kakkanad", myProfile: "ClinicAdmin web / Clinic setup", signOut: "669:14544" },
    branch: {
      sub: "Thanal Heart Clinic · 3 branches you manage",
      rows: [["Kakkanad · main", "Open till 8 PM · 6 staff · plan renews 29 May"], ["Edappally", "Open till 6 PM · 3 staff · 1 invite waiting"], ["Aluva", "Saturdays only · 2 staff"]],
      sectionTitle: "THIS MONTH ACROSS BRANCHES", item: "Completed visits", counts: "Kakkanad 888  ·  Edappally 312  ·  Aluva 64",
      button: "Open the full report", buttonSays: "The branch report is in Reports. Pick “All branches” at the top.",
      note: "Staff, setup and billing are set per branch. Reports can show one branch or all of them.",
    },
    duty: {
      title: "Doctors in clinic", sub: "Who is seeing patients now, across Thanal Heart Clinic",
      now: "Dr. Arjun Mehta · in clinic now", nowLine: "Kakkanad · Cardiology · 9:00 AM – 4:30 PM",
      section: "LATER TODAY", next: "Dr. P. Nair · from 5:00 PM", nextLine: "Edappally · Orthopaedics · 5:00 PM – 8:00 PM",
      none: "Mark a doctor away", noneLine: "Their queue pauses · patients are told",
      note: "Doctors’ hours come from Clinic setup. Leave marked by a doctor shows here and blocks those slots for patients.",
      staffPage: "ClinicAdmin web / Staff & roles",
    },
    notifications: {
      count: "5 new",
      items: [
        ["2 staff invites are waiting", "Dr. P. Nair and Anil Kumar", "ClinicAdmin web / Staff & roles"],
        ["Plan renews in 14 days", "29 May 2025 · ₹4,999", "ClinicAdmin web / Subscription"],
        ["Downtime reported: ECG machine", "Room 4 · since 9:40 AM", "ClinicAdmin web / Downtime"],
        ["Weekly report is ready", "888 visits · average wait 18 min", "ClinicAdmin web / Reports"],
        ["₹71,400 still pending", "12 bills · oldest 9 days", "ClinicAdmin web / Billing"],
      ],
    },
  },
  {
    prefix: "LbModal", module: "lab", base: 2021,
    profile: { person: "Joby Thomas", role: "Lab Admin · Thejus Clinical Lab", branch: "Thrissur", myProfile: "Lab web / Settings", signOut: "669:14616" },
    branch: {
      sub: "Thejus Clinical Lab · 3 branches you can manage",
      rows: [["Thrissur · Round North", "Open till 6 PM · 38 tests today · 5 new requests"], ["Kunnamkulam", "Open till 5 PM · 14 tests today · 2 samples to send"], ["Chalakudy collection centre", "Samples only · 9 collected today"]],
      sectionTitle: "SAMPLES ACROSS BRANCHES", item: "Kidney panel · 3 samples waiting to be tested", counts: "Thrissur 0  ·  Kunnamkulam 2  ·  Chalakudy 1",
      button: "Send courier to Kunnamkulam", buttonSays: "Courier booked. The 2 samples reach Thrissur by 2:30 PM.",
      note: "Each branch keeps its own requests, samples and bills. All tests are run and signed at Thrissur.",
    },
    duty: {
      title: "Pathologist on duty", sub: "Reports can be signed only while a pathologist is on duty",
      now: "Dr. Meera Iyer · on duty now", nowLine: "TCMC 41287 · 8:00 AM – 4:00 PM · signed in",
      section: "HAND OVER AT END OF SHIFT", next: "Dr. S. Menon · from 4:00 PM", nextLine: "TCMC 39876 · 4:00 PM – 6:00 PM",
      none: "No pathologist", noneLine: "Reports wait · results are not released",
      note: "Every report is signed with the pathologist’s name and registration number before the patient and doctor see it.",
      staffPage: "Lab web / Settings",
    },
    notifications: {
      count: "5 new",
      items: [
        ["New request: lipid profile", "James Heatfield · Dr. Arjun Mehta", "Lab web / Requests"],
        ["Urgent: troponin I", "Rahul Verma · result needed in 1 hour", "Lab web / Requests"],
        ["Sample collected by Anu", "LT-556 · Arun Kumar · 7:40 AM", "Lab web / Samples"],
        ["Report signed: kidney panel", "LT-551 · sent to James Heatfield", "Lab web / Reports"],
        ["Analyser maintenance at 5 PM", "Biochemistry · about 30 minutes", "Lab web / Schedule"],
      ],
    },
  },
  {
    prefix: "PaModal", module: "lab", base: 2031,
    profile: { person: "Dr. Meera Iyer", role: "Lab Doctor · TCMC Reg. 41287 · Thejus Clinical Lab", branch: "Thrissur", myProfile: "Lab web / Settings", signOut: "669:14616" },
    branch: {
      sub: "Thejus Clinical Lab · reports from 3 branches",
      rows: [["Thrissur · Round North", "4 reports to review · 1 urgent"], ["Kunnamkulam", "Samples tested at Thrissur · 2 on the way"], ["Chalakudy collection centre", "Samples only · 1 on the way"]],
      sectionTitle: "TO REVIEW BY BRANCH", item: "Reports waiting for your signature", counts: "Thrissur 4  ·  Kunnamkulam 0  ·  Chalakudy 0",
      button: "Review the urgent one", buttonSays: "Opening the urgent troponin report for Rahul Verma first.",
      note: "You sign reports for every branch. Each report shows where the sample was collected.",
    },
    duty: {
      title: "Lab admin on duty", sub: "Walk-in tests and payments need a lab admin signed in",
      now: "Joby Thomas · on duty now", nowLine: "Lab admin · 7:00 AM – 6:00 PM · front desk",
      section: "AFTER 6 PM", next: "Bijoy K · from 6:00 PM", nextLine: "Lab technician · night samples only",
      none: "No admin on duty", noneLine: "New walk-in tests pause · reports can still be signed",
      note: "Reports you sign are released to the patient and doctor straight away, whoever is on the front desk.",
      staffPage: "Lab web / Settings",
    },
    notifications: {
      count: "5 new",
      items: [
        ["4 reports to review", "1 urgent · oldest 40 minutes", "Pathologist web / To review"],
        ["Urgent: troponin I for Rahul Verma", "Result in · needs your signature", "Pathologist web / To review"],
        ["Analyser B calibrated", "Biochemistry · ready for the afternoon run", "Pathologist web / Analysers"],
        ["Report published: kidney panel", "LT-551 · James Heatfield", "Pathologist web / Published"],
        ["Lab admin changed shift", "Joby Thomas until 6 PM", "Pathologist web / To review"],
      ],
    },
  },
];

for (const p of PORTALS) {
  const ids = { profile: `900:${p.base}`, notifications: `900:${p.base + 1}`, branch: `900:${p.base + 2}`, duty: `900:${p.base + 3}` };
  profileModal({ id: ids.profile, name: `${p.prefix} / Profile`, module: p.module, ...p.profile });
  notificationsModal({ id: ids.notifications, name: `${p.prefix} / Notifications`, module: p.module, ...p.notifications });
  branchModal({ id: ids.branch, name: `${p.prefix} / Switch branch`, module: p.module, ...p.branch });
  dutyModal({ id: ids.duty, name: `${p.prefix} / On duty`, module: p.module, ...p.duty });
  // The profile menu's own links to the branch and duty pop-ups.
  const file = `public/design/screens/${ids.profile.replace(":", "-")}.json`;
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const fix = (n) => {
    for (const a of n.a ?? []) for (const act of a.acts) if (act.to === `${p.prefix}:branch`) act.to = ids.branch; else if (act.to === `${p.prefix}:duty`) act.to = ids.duty;
    (n.ch ?? []).forEach(fix);
  };
  fix(doc);
  fs.writeFileSync(file, JSON.stringify(doc));
}

// ---------- Manifest ----------
const ids = new Set(pages.map((p) => p.id));
manifest.screens = manifest.screens.filter((s) => !ids.has(s.id)).concat(pages);
fs.writeFileSync(MANIFEST, JSON.stringify(manifest));
for (const p of pages) console.log(`${p.id}  ${p.name}  ${p.w}x${p.h}  /${p.module}/${p.slug}`);
