# Ship It: Learn Docker by Typing

A hands-on course for people who'd rather type commands than read docs.
Docker → Compose → deploying to a server → Kubernetes, as **58 missions** in a practice terminal.

- **Locked progression**: modules, lessons and missions unlock in order.
- **Practice terminal**: a browser simulator of `docker`, `docker compose`, `kubectl`, `kind` and `ssh`. It keeps state (run a container and it shows up in `docker ps`) and prints realistic output and errors.
- **Checks the result, not the text**: `docker run -d -p 8080:80 --name web nginx` and `docker run --name=web -dp 8080:80 nginx` both pass.
- **Revisit anything**: finished lessons stay open; "Replay missions" re-runs them in a throwaway sandbox without touching progress.
- **Hint / Show answer** on every mission. The answer must still be typed.
- Light (default) and dark themes, mobile friendly, clean URL, progress saved in `localStorage`.

Plain HTML/CSS/JS: no build step, no dependencies.

## Files

| File | What it is |
|---|---|
| `index.html` | Page shell |
| `styles.css` | Theme + layout |
| `sim.js` | The fake Docker / kubectl engine |
| `course.js` | Modules, lessons, missions and their checks |
| `app.js` | UI: yard (home), module overview, lesson + terminal |

## Run locally

```bash
python3 -m http.server 5500
```

Open http://localhost:5500

## Add or edit a mission

In `course.js`, each mission is:

```js
{
  goal: "Start nginx ... named <code>web</code>.",
  hint: "docker run -d -p HOST:CONTAINER --name NAME nginx",
  answer: "docker run -d -p 8080:80 --name web nginx",
  check: (r, S) => !!running(S, "web"),   // r = last command result, S = simulator state
}
```

A lesson can have `setup(S)` to prepare the sandbox (e.g. make sure an image exists).

## Deploy on Vercel

1. Push this repo to GitHub.
2. Vercel → **Add New → Project → Import Git Repository**, pick this repo.
3. Framework preset: **Other**. No build command. Output directory: the repo root.
4. Deploy. Every push to `main` redeploys.
