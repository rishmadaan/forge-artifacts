// Builds the README's pictures: node docs/assets/build.js
// Each picture comes in a light and a dark version (the README picks one with
// <picture> and prefers-color-scheme). Plain SVG, system fonts, no external
// resources, so GitHub can show them as images.
const fs = require("node:fs");
const path = require("node:path");

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const THEMES = {
  light: { ink: "#1f2430", muted: "#5b6478", line: "#d8dbe3", card: "#ffffff", soft: "#f4f6fb", accent: "#3451b2", accentSoft: "#e8ecfa", ok: "#1f7a4d", okSoft: "#e4f4ec" },
  dark: { ink: "#e6e8ee", muted: "#9aa3b5", line: "#2f3646", card: "#161b26", soft: "#11151e", accent: "#8ea4ff", accentSoft: "#1d2540", ok: "#5fd39a", okSoft: "#132a20" },
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.mono ? MONO : SANS}" font-size="${o.size || 16}" font-weight="${o.weight || 400}" fill="${o.fill}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.spacing ? ` letter-spacing="${o.spacing}"` : ""}>${esc(s)}</text>`;
const svg = (w, h, body, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">\n<title>${esc(label)}</title>\n${body}\n</svg>\n`;

// A small padlock and a globe, drawn with lines only.
const lock = (x, y, c) => `<g fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"><rect x="${x}" y="${y + 8}" width="18" height="13" rx="3"/><path d="M${x + 4} ${y + 8}v-3a5 5 0 0 1 10 0v3"/></g>`;
const globe = (x, y, c) => `<g fill="none" stroke="${c}" stroke-width="2.2"><circle cx="${x + 10}" cy="${y + 13}" r="10"/><ellipse cx="${x + 10}" cy="${y + 13}" rx="4.5" ry="10"/><path d="M${x} ${y + 13}h20"/></g>`;
const fileIcon = (x, y, c) => `<g fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"><path d="M${x} ${y}h12l6 6v17h-18z"/><path d="M${x + 12} ${y}v6h6"/></g>`;

// Three page versions stacked, the newest on top, and the link they share.
function stack(t) {
  const page = (x, y, label, top) => [
    `<rect x="${x}" y="${y}" width="158" height="112" rx="10" fill="${t.card}" stroke="${top ? t.accent : t.line}" stroke-width="${top ? 2 : 1}"/>`,
    `<rect x="${x + 16}" y="${y + 18}" width="96" height="10" rx="5" fill="${top ? t.accent : t.line}"/>`,
    ...[42, 58, 74, 90].map((dy, i) => `<rect x="${x + 16}" y="${y + dy}" width="${[120, 104, 126, 84][i]}" height="7" rx="3.5" fill="${t.line}"/>`),
    text(x + 144, y + 28, label, { size: 13, weight: 700, mono: true, fill: top ? t.accent : t.muted, anchor: "end" }),
  ].join("\n");
  return [
    page(732, 32, "v1", false), page(750, 50, "v2", false), page(768, 68, "v3", true),
    `<rect x="704" y="208" width="244" height="36" rx="18" fill="${t.card}" stroke="${t.line}"/>`,
    globe(716, 215, t.accent),
    text(748, 231, "your.site/d/k3Jq9xW2aB7c/", { size: 12, mono: true, fill: t.ink }),
  ].join("\n");
}

function hero(t) {
  const pills = ["Private until you share", "Every version frozen", "Your files, your host"];
  let px = 48;
  const pill = pills.map((p) => {
    const w = p.length * 8.4 + 28;
    // Centred, so the padding is even whatever font the viewer has.
    const g = `<rect x="${px}" y="214" width="${w}" height="34" rx="17" fill="${t.accentSoft}"/>` + text(px + w / 2, 236, p, { size: 15, weight: 600, fill: t.accent, anchor: "middle" });
    px += w + 12;
    return g;
  }).join("\n");
  return svg(960, 280, [
    `<rect x="0.5" y="0.5" width="959" height="279" rx="18" fill="${t.soft}" stroke="${t.line}"/>`,
    text(48, 108, "Forge", { size: 72, weight: 800, fill: t.ink, spacing: "-1.5" }),
    text(50, 152, "Your agents' pages, on a link site you own.", { size: 26, weight: 600, fill: t.ink }),
    text(50, 186, "One command publishes an HTML page privately. One more shares it.", { size: 17, fill: t.muted }),
    pill,
    stack(t),
  ].join("\n"), "Forge: your agents' pages, on a link site you own. Private until you share, every version frozen, your files on your host.");
}

function card(x, y, w, h, t, title, sub, icon) {
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${t.card}" stroke="${t.line}"/>`,
    icon(x + 18, y + 18, t.accent),
    text(x + 50, y + 37, title, { size: 17, weight: 700, fill: t.ink }),
    ...sub.map((s, i) => text(x + 18, y + 70 + i * 22, s, { size: 14, fill: t.muted })),
  ].join("\n");
}
function arrow(x1, x2, y, label, t) {
  return [
    `<path d="M${x1 + 6} ${y}H${x2 - 10}" stroke="${t.accent}" stroke-width="2.5"/>`,
    `<path d="M${x2 - 14} ${y - 6}L${x2 - 6} ${y}L${x2 - 14} ${y + 6}" fill="none" stroke="${t.accent}" stroke-width="2.5" stroke-linejoin="round"/>`,
    text((x1 + x2) / 2, y - 12, label, { size: 12.5, weight: 600, mono: true, fill: t.accent, anchor: "middle" }),
  ].join("\n");
}

function howItWorks(t) {
  const y = 28, h = 150, w = 232;
  return svg(960, 300, [
    `<rect x="0.5" y="0.5" width="959" height="299" rx="18" fill="${t.soft}" stroke="${t.line}"/>`,
    card(28, y, w, h, t, "Your page", ["An HTML file, or a folder", "with its images. Made by", "any agent, or by you."], fileIcon),
    arrow(260, 364, y + 75, "forge publish", t),
    card(364, y, w, h, t, "Private", ["Saved in your store, a git", "repository you own. Only", "your machines open it."], lock),
    arrow(596, 700, y + 75, "forge share", t),
    card(700, y, w, h, t, "Shared", ["On your link site: Cloudflare", "Pages, Vercel or Netlify.", "forge unshare takes it down."], globe),
    `<rect x="28" y="198" width="904" height="74" rx="14" fill="${t.okSoft}"/>`,
    text(48, 226, "Every version keeps its own frozen link", { size: 15, weight: 700, fill: t.ok }),
    text(48, 254, "…/d/k3Jq9xW2aB7c/", { size: 14, mono: true, weight: 600, fill: t.ink }),
    text(206, 254, "always the newest version", { size: 14, fill: t.muted }),
    text(470, 254, "…/v1/  …/v2/  …/v3/", { size: 14, mono: true, weight: 600, fill: t.ink }),
    text(642, 254, "each one exactly as it was published", { size: 14, fill: t.muted }),
  ].join("\n"), "How Forge works: forge publish saves your page privately in your own store; forge share puts it on your own link site; every version keeps its own frozen link.");
}

function terminal() {
  const bg = "#0f131b", ink = "#e6e8ee", dim = "#7f8aa3", prompt = "#8ea4ff", ok = "#5fd39a";
  const lines = [
    ["", "# a store with a host set (forge host)", dim],
    ["$ ", "forge publish report.html"],
    ["", "published report v1 (private)", ok],
    ["", "private: file:///home/you/.forge/private/d/k3Jq9xW2aB7c/index.html"],
    ["", "share it with: forge share report", dim],
    ["", ""],
    ["$ ", "forge share report"],
    ["", "# forge uploads to your host, then reads the site back", dim],
    ["", "shared report (latest v1)", ok],
    ["", "private: file:///home/you/.forge/public/d/k3Jq9xW2aB7c/index.html"],
    ["", "public: https://pages.example.org/d/k3Jq9xW2aB7c/"],
    ["", ""],
    ["$ ", "forge publish report.html --live"],
    ["", "published report v2 (shared)", ok],
    ["", "private: file:///home/you/.forge/public/d/k3Jq9xW2aB7c/index.html"],
    ["", "public: https://pages.example.org/d/k3Jq9xW2aB7c/"],
  ];
  const body = lines.map(([p, s, c], i) => {
    const y = 78 + i * 24;
    return (p ? text(28, y, p, { size: 15, mono: true, fill: prompt }) : "") + text(p ? 46 : 28, y, s, { size: 15, mono: true, fill: c || ink });
  }).join("\n");
  // The frame fits the lines: the last baseline plus the same margin as the top.
  const h = 78 + (lines.length - 1) * 24 + 44;
  return svg(960, h, [
    `<rect x="0.5" y="0.5" width="959" height="${h - 1}" rx="14" fill="${bg}" stroke="#2f3646"/>`,
    `<circle cx="28" cy="26" r="6" fill="#ff5f57"/><circle cx="48" cy="26" r="6" fill="#febc2e"/><circle cx="68" cy="26" r="6" fill="#28c840"/>`,
    text(480, 31, "a terminal, or your agent", { size: 13, fill: dim, anchor: "middle" }),
    body,
  ].join("\n"), "A terminal, on a store with a host set: forge publish report.html prints published report v1 (private) and a private link; forge share report prints the private link and a public link; forge publish --live updates the shared page to v2.");
}

const out = __dirname;
for (const [name, t] of Object.entries(THEMES)) {
  fs.writeFileSync(path.join(out, `hero-${name}.svg`), hero(t));
  fs.writeFileSync(path.join(out, `how-it-works-${name}.svg`), howItWorks(t));
}
fs.writeFileSync(path.join(out, "terminal.svg"), terminal());
console.log("wrote hero, how-it-works (light and dark) and terminal.svg in " + path.relative(process.cwd(), out) || ".");
