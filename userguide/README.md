# ClassQuest User Guide — static site

A self-contained static website that presents the ClassQuest end-user guide
online. It is a plain HTML/CSS/JS site (no build step), ready to deploy to
[Vercel](https://vercel.com) or any static host.

## Contents

```
userguide/
├── index.html        The guide (single page, sidebar navigation)
├── styles.css        Styling (responsive, light theme, print styles)
├── script.js         Mobile menu + scroll-spy sidebar highlighting
├── vercel.json       Vercel config (clean URLs, caching, security headers)
├── USER_GUIDE.pdf    Downloadable PDF (linked from the page)
└── assets/
    ├── classquest-logo.png
    └── favicon.png
```

The page content mirrors [`../docs/USER_GUIDE.md`](../docs/USER_GUIDE.md). If you
update the guide, update both.

## Preview locally

No build step is needed. Serve the folder with any static server, for example:

```bash
# Python
python -m http.server 3000

# or Node (npx)
npx serve .
```

Then open <http://localhost:3000>.

> Open it through a local server rather than double-clicking `index.html`:
> the page uses root-relative paths (e.g. `/styles.css`), which resolve
> correctly when served from a web root.

## Deploy to Vercel

This folder is the deployment root. There is no framework and no build command.

### Option A — Vercel dashboard

1. Push the repository to GitHub/GitLab/Bitbucket.
2. In Vercel, **Add New → Project** and import the repository.
3. Set the **Root Directory** to `userguide`.
4. Framework preset: **Other**. Build command: *(leave empty)*.
   Output directory: *(leave empty — it serves the root)*.
5. **Deploy.**

### Option B — Vercel CLI

```bash
npm i -g vercel
cd userguide
vercel          # follow the prompts; deploys this folder
vercel --prod   # promote to production
```

## Notes

- `vercel.json` enables clean URLs, adds basic security headers, and sets
  long-lived caching for `/assets`.
- Everything is static — no server, no secrets, no environment variables.
