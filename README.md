# 🚀 Ant — Space Portfolio

An interactive, space-themed portfolio website built with **Svelte 5**, **TypeScript**, and **Vite**. It features a dynamic starfield, a parallax moon, orbital project cards, and a fully animated rocket launch contact form.

## ✨ Features

- **Animated Starfield** — Procedural canvas rendering with twinkling stars and occasional shooting stars
- **Parallax Moon** — A glowing moon that follows mouse movement and scroll position
- **Project Showcase** — 5 featured projects displayed in orbital-themed cards with hover animations
- **Rocket Launch Form** — The contact form triggers an animated rocket launch sequence (SRB flames, smoke particles, countdown, and a flying shuttle) on valid input
- **Single-File Build** — Uses `vite-plugin-singlefile` to compile everything into a single standalone `index.html`

## 🧰 Tech Stack

| Tool | Purpose |
|---|---|
| [Svelte 5](https://svelte.dev/) | Reactive UI framework |
| [TypeScript](https://www.typescriptlang.org/) | Type-safe JavaScript |
| [Vite](https://vitejs.dev/) | Build tool & dev server |
| [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) | Inlines all assets into a single HTML file |
| Canvas 2D | Starfield, rocket flames & smoke effects |

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Type-check
pnpm check

# Production build (single index.html)
pnpm build

# Preview production build
pnpm preview
```

## 🚀 Featured Projects

The portfolio showcases the following projects:

| Project | Type |
|---|---|
| **Pixel8** | Mobile App — pixel-art scanner with edge detection |
| **Evanescence** | Laravel Package — ephemeral, single-use hashed tokens |
| **Take a Deeks** | Interactive Learning — deep-dive resource with quizzes |
| **Flock** | Game — pixel-art shepherd simulator |
| **Otto** | Local AI — Rust-based LLM orchestrator |

## 📦 Build Output

The production build outputs a single `docs/index.html` file with all CSS, JavaScript, and SVG assets inlined — no external dependencies required at runtime. This is configured for GitHub Pages: set your Pages source to serve from the `/docs` folder on the main branch.

## 📄 License

MIT
