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
