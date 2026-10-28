# About Me — Godspeed Guinto

One-screen WebGL portfolio: cases ride a bending ribbon over a reflective sea. Scroll, drag or use the arrow keys.
Scrolling also moves through a day (sunrise, noon, sunset, stars and moon). "Featured / Full" switches to a name index.

Built from the "afloat" build prompt (Vite + React 19 + TypeScript + three.js 0.186.1). Case media are original
motion loops generated from Godspeed's resume (see `tools/gen_media.py`).

## Run locally
```bash
npm install
npm run dev
```

## Publish on GitHub Pages
1. Create a new **public** repo on GitHub (any name).
2. Upload everything in this folder (not `node_modules`) to the `main` branch. Dragging the unzipped folder's
   contents into "uploading an existing file" works. Make sure the `.github` folder goes up too.
3. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main`.
   The site appears at `https://<your-username>.github.io/<repo-name>/` after about a minute.

All asset URLs are relative, so it works under any repo name.

## Make it yours
- Name, links: `src/components/Chrome.tsx`, `src/components/Loader.tsx`, `index.html`.
- Cases: `src/data/projects.ts` (array order = ribbon order) plus, per case, `public/media/case-<slug>.mp4`
  (16:10 loop, 1440×900, H.264, no audio) and `case-<slug>-1440.webp` / `case-<slug>-960.webp` posters
  (the loop's frame at `start` seconds).
- Regenerate or edit the generated loops: `python3 tools/gen_media.py all public/media` (needs numpy, opencv-python, pillow, ffmpeg).
- Time of day: `START_PHASE` in `src/scene/carousel.ts`, palette `KEYS` in `src/scene/sky.ts`.

Water simulation adapted from WebGL Water by Evan Wallace (MIT).
