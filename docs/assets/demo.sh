#!/usr/bin/env bash
# Remakes docs/assets/demo.gif: bash docs/assets/demo.sh
# Needs vhs (with ttyd), ffmpeg and Python Playwright with Chromium. Everything
# runs in a scratch folder under the OS temp folder, removed at the end: a
# scratch home folder, a store made with forge init, and the stand-in host the
# tests use (test/fakehost.js), so nothing is deployed anywhere and the public
# link it prints is that local host's address. The terminal part is
# demo.tape; the last frames are the shared page, opened in a browser.
set -euo pipefail
assets="$(cd "$(dirname "$0")" && pwd -P)"
engine="$(cd "$assets/../.." && pwd -P)"
for t in vhs ttyd ffmpeg python3; do command -v "$t" >/dev/null || { echo "demo.sh needs $t on PATH" >&2; exit 1; }; done

work="$(mktemp -d "${TMPDIR:-/tmp}/demo.XXXXXX")"
host_pid=""
cleanup() { [ -z "$host_pid" ] || kill "$host_pid" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT
# Python Playwright is found through the real home folder; only that step uses it.
real_home="$HOME"
export HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" TMPDIR="$work/tmp"
mkdir -p "$HOME" "$TMPDIR" "$work/page"
git config --global user.name "Demo"
git config --global user.email "demo@example.org"

# The stand-in host: a fake npx (the host's CLI) and a local server, kept
# running while the tape plays; it writes the settings bin/forge needs.
node -e '
const { startFakeHost } = require(process.argv[1]);
startFakeHost().then((h) => {
  const bin = h.env().PATH.split(":")[0];
  require("fs").writeFileSync(process.argv[2], [
    "export FAKE_HOST_ROOT=" + h.root, "export FORGE_CLOUDFLARE_TOKEN=stand-in", "export FORGE_READBACK_SECONDS=5",
    "export DEMO_NPX_BIN=" + bin, "export DEMO_SITE=" + h.baseUrl("site"),
  ].join("\n") + "\n");
  setInterval(() => {}, 1 << 30);
});' "$engine/test/fakehost.js" "$work/host.env" &
host_pid=$!
for _ in $(seq 50); do [ -s "$work/host.env" ] && break; sleep 0.1; done
# shellcheck disable=SC1091
source "$work/host.env"
export PATH="$DEMO_NPX_BIN:$HOME/.local/bin:$PATH"

"$engine/bin/install" --no-skill >/dev/null
forge init >/dev/null
forge host cloudflare-pages --project site --account demo --url "$DEMO_SITE" >/dev/null

cat > "$work/page/report.html" <<'HTML'
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quarterly report</title>
<style>body{font:17px/1.6 system-ui,sans-serif;color:#1f2430;background:#fff;max-width:720px;margin:48px auto;padding:0 24px}h1{margin-bottom:4px}.k{display:flex;gap:16px;margin:24px 0}.k div{flex:1;border:1px solid #8884;border-radius:10px;padding:14px}.k b{display:block;font-size:28px}</style>
</head><body>
<h1>Quarterly report</h1>
<p>What shipped this quarter, what it cost, and what comes next.</p>
<div class="k"><div><b>14</b>features shipped</div><div><b>3</b>incidents</div><div><b>92%</b>on time</div></div>
<h2>Highlights</h2>
<ul><li>The new onboarding flow went live in week 3.</li><li>Support replies now average under two hours.</li><li>Two older services were retired.</li></ul>
</body></html>
HTML

export FORGE_DEMO_WORK="$work/page"
(cd "$work" && vhs "$assets/demo.tape")

# The shared page, as a reader opens it: dark mode, the page's own switch and Markdown buttons in view.
url="$(forge list --json | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const d=JSON.parse(s).documents.find((x)=>x.name==="report");process.stdout.write((d && d.publicUrl)||"")})')"
[ -n "$url" ] || { echo "demo.sh: the shared page has no public link" >&2; exit 1; }
HOME="$real_home" python3 - "$url" "$work/page.png" <<'PY'
import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1200, "height": 640}, color_scheme="dark")
    pg.goto(sys.argv[1])
    pg.wait_for_timeout(500)
    pg.screenshot(path=sys.argv[2])
    b.close()
PY

# Terminal, then four seconds of the page; 12 frames a second, one palette.
ffmpeg -loglevel error -y -i "$work/demo-terminal.mp4" -loop 1 -t 4 -i "$work/page.png" \
  -filter_complex "[0:v]fps=12,scale=960:-1:flags=lanczos,setsar=1[a];[1:v]fps=12,scale=960:-1:flags=lanczos,setsar=1,format=yuv420p[b];[a][b]concat=n=2:v=1[v];[v]split[x][y];[x]palettegen=max_colors=96[p];[y][p]paletteuse=dither=bayer:bayer_scale=4" \
  "$assets/demo.gif"
ls -l "$assets/demo.gif"
