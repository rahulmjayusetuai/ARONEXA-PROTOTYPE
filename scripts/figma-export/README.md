# Figma export

The screens in `public/design` are exported from the AroNexa Figma file. This folder holds the tools that add new frames.

## 1. Export from Figma (read-only)

Someone with a Full or Dev seat on the file runs this once in the Figma desktop app:

1. Plugins → Development → Import plugin from manifest… and pick `plugin/manifest.json`.
2. Open the page with the frames and run **AroNexa screen export**.
3. Keep the default name filter (all the portals that aren't built yet) or type your own, then press **Export**.
4. It saves `aronexa-export.json`. The plugin only reads the file; it changes nothing.

## 2. Add it to the prototype

```bash
node scripts/figma-export/integrate.mjs ~/Downloads/aronexa-export.json
```

Screens that already exist are kept; add `--update` to replace them with the newer export.

## Pages made in code, not in Figma

Some portal pages and pop-ups are not in the Figma file yet, so they are built from the other portals' pages by `scripts/portal-pages/build.mjs`:

- Reception: Billing, Visits, Orders & referrals, Settings
- Lab: Billing, Settings
- The top-bar pop-ups of the reception, clinic admin, lab and pathologist portals: Profile, Notifications, Switch branch and On duty (`RcModal`, `CaModal`, `LbModal`, `PaModal`)

Each one uses its portal's own top bar and tabs and the body of the matching pharmacy page, with the clinic's or lab's own text. To change their text, edit the script and run `node scripts/portal-pages/build.mjs`. When these pages are designed in Figma, export them with the plugin under the same names (for example `Reception web / Billing`); then delete the built ones and the matching link in `PORTAL_POPUPS` in `src/design/live/actions.ts` if it is a pop-up: their rows in `src/design/manifest.json` have IDs starting with `900:`, and their files are `public/design/screens/900-*.json`. After that the script is no longer needed.
