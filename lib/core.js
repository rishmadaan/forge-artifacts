// Core of Forge: manifest, slugs, version writes, the two trees
// (public/ is what gets deployed, private/ never is), generated pages, share
// and take-down moves, import, and the consistency check. Pure functions over
// a loaded workspace ({ root, config, manifest, brand }) so tests run against
// a temp store; git, the lock and deploys live in bin/forge, not here.
//
// The slug, URL scheme, hash rule and generated pages are the same as the
// earlier site layout `forge import` reads, so every existing link keeps
// working after an import.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pages = require("./pages.js");
const cmd = require("./command.js");

const MAX_FILE_BYTES = 25 * 1024 * 1024; // the host's per-file limit
const MAX_FILES = 1000;
const VERSION_DIR = /^v\d+$/;

class PublishError extends Error {}

// Test hook: FORGE_TEST_PAUSE=<point>:<ms> holds the command once at that point
// and says so on stderr, so a test can kill it after it has really written.
// FORGE_TEST_THROW=<point> instead makes the command fail there, so a test can
// check what a failure at each step is reported as.
let paused = false;
function testPause(point) {
  if (process.env.FORGE_TEST_THROW === point) throw new Error("forge-test: injected failure at " + point);
  const [p, ms] = (process.env.FORGE_TEST_PAUSE || "").split(":");
  if (p !== point || paused) return;
  paused = true;
  process.stderr.write("forge-test: paused at " + point + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(ms) || 0);
}

// Relative files a page points at (src or href) that exist beside it: a
// single-file publish leaves them behind.
function besideRefs(file, html = fs.readFileSync(file, "utf8")) {
  const found = new Set();
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#?]+)/gi)) {
    const ref = m[1].trim();
    if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("/")) continue;
    const p = path.resolve(path.dirname(file), ref);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) found.add(ref);
  }
  return [...found];
}

function manifestPath(root) {
  return path.join(root, "manifest.json");
}

// A plain write: bin/forge only ever writes the manifest inside its temporary
// worktree, which nothing else reads, so a write cut short there is thrown
// away with the worktree. The live copy's manifest.json is written only by
// git's fast-forward.
function saveManifest(ws) {
  fs.writeFileSync(manifestPath(ws.root), JSON.stringify(ws.manifest, null, 2) + "\n");
  testPause("manifest");
}

// A path or name inside a command line we suggest, quoted for the shell.
// The one question before a shared page changes, word for word in the engine's
// refusals, USAGE, docs/reference.md and the skill.
function askLive(name, link) {
  return 'Ask the owner first: "' + name + " is public at " + link + '; update the public page now?" ' +
    "Skip the question only if the owner's own request already named that public page or its link " +
    '(for example "update the public ' + name + '", or the link pasted): then the request is the yes. ' +
    'Never infer it from "update" alone. Naming the page without calling it the public or sent one (for example "update the plan") is not a yes: ask. On yes, add --live. ' +
    "On no, or if you cannot ask, keep it private with --name '<new-name>' and say a new private page was made.";
}

// The question when a different file would take over a page's name, by a
// derived name or by --name.
// Not the same-page question: a yes to that would put an unrelated file on the
// page, so this question names both files.
function replaceQuestion(ws, sourceArg, name, other, key) {
  const shared = other.visibility === "shared";
  return "Usually this is a new page: publish it with --name '<new-name>', and tell the owner a new private page was made, not an update of " + name + ":\n" +
    "  " + cmd() + " publish " + q(sourceArg) + " --name '<new-name>'\n" +
    "Only if the owner wants this file to REPLACE that page, ask the owner, even if the request named that page " +
    "(that is not a yes to replacing it with a different file): \"" + name +
    (shared ? " is public at " + ws.config.baseUrl + "/d/" + other.slug + "/, made from " : " is a private page made from ") + other.source +
    "; replace it with " + key + "?\" On yes:\n" +
    "  " + cmd() + " publish " + q(sourceArg) + " --name " + q(name) + (shared ? " --live" : "") + "\n" +
    "Nothing was changed.";
}

function q(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// One rule for every page name, however it is chosen (publish --name, a name
// derived from the file name, rename): it is a word in commands and file names
// on every machine, so lowercase, no spaces, no leading dot or dash. Not
// digits only: JavaScript lists integer-like keys first, so such a page would
// jump to the top of the list.
const NAME_RULE = /^[a-z0-9][a-z0-9._-]*$/;
const NAME_MAX = 100;
function nameProblem(name) {
  if (NAME_RULE.test(name) && !/^[0-9]+$/.test(name) && name.length <= NAME_MAX) return null;
  return "the name " + JSON.stringify(name) + " does not fit the name rule " + NAME_RULE.source +
    " (lowercase letters, digits, dot, underscore and dash, starting with a letter or digit, not digits only, at most " + NAME_MAX + " characters)";
}

// The nearest name that fits the rule ("Q3 Report" -> q3-report), or null
// when nothing fits. fittedName quotes it for the shell, to suggest in a
// refusal, with a placeholder when nothing fits.
function fitName(name) {
  let n = String(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+/, "").slice(0, NAME_MAX).replace(/-+$/, "");
  if (/^[0-9]+$/.test(n)) n = "page-" + n;
  return n && !nameProblem(n) ? n : null;
}
function fittedName(name) {
  const n = fitName(name);
  return n ? q(n) : "'<new-name>'";
}

function newSlug() {
  return crypto.randomBytes(9).toString("base64url");
}

function deriveName(source) {
  return path
    .basename(source.replace(/\/+$/, ""))
    .replace(/\.html?$/i, "")
    .replace(/-v\d+$/i, "");
}

// Same folder, same derived name, and at least one carries a -vN suffix.
function versionSibling(a, b) {
  const vn = /-v\d+(\.html?)?\/*$/i;
  return path.dirname(a) === path.dirname(b) && deriveName(a) === deriveName(b) && (vn.test(a) || vn.test(b));
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Sources are stored with the home folder written as "~", so the same file on
// either machine is the same source (home folders differ between machines).
function toSourceKey(abs) {
  const home = os.homedir();
  if (abs === home) return "~";
  if (abs.startsWith(home + path.sep)) return "~/" + abs.slice(home.length + 1).split(path.sep).join("/");
  return abs;
}

function fromSourceKey(key) {
  if (key === "~") return os.homedir();
  if (key.startsWith("~/")) return path.join(os.homedir(), key.slice(2));
  return key;
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·",
  ndash: "–", mdash: "\u2014", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”",
};

// Titles come out of raw <title> markup, so entities must be decoded to text
// before the templates re-escape them (otherwise "&middot;" renders literally).
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] || m);
}

function htmlTitle(html, fallback) {
  const m = String(html).match(/<title[^>]*>([^<]*)<\/title>/i);
  const t = m && m[1].trim();
  return t ? decodeEntities(t) : fallback;
}

function treeDir(root, visibility) {
  return path.join(root, visibility === "shared" ? "public" : "private");
}

function docDir(root, d) {
  return path.join(treeDir(root, d.visibility), "d", d.slug);
}

function titleOf(root, d, name) {
  const stable = path.join(docDir(root, d), "index.html");
  if (!fs.existsSync(stable)) return name;
  return htmlTitle(fs.readFileSync(stable, "utf8"), name);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Every regular file under dir, as sorted "/"-separated relative paths.
// A symlink anywhere is an error: it could point outside the store.
function listFiles(dir, opts = {}) {
  const out = [];
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (!rel && opts.skipTop && opts.skipTop(e.name)) continue;
      const p = path.join(abs, e.name);
      if (e.isSymbolicLink()) throw new PublishError("refusing: " + p + " is a symlink");
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile()) out.push(r);
      else throw new PublishError("refusing: " + p + " is not a regular file or folder");
    }
  };
  walk(dir, "");
  return out.sort();
}

function sameTrees(a, b, opts = {}) {
  const fa = listFiles(a, opts.a || {});
  const fb = listFiles(b, opts.b || {});
  if (fa.join("\n") !== fb.join("\n")) return false;
  return fa.every((f) => fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
}

const stableOnly = { skipTop: (n) => n === "versions" || VERSION_DIR.test(n) };

// The stable folder holds every file of the latest version, byte for byte. It
// may also hold files a site's owner put there by hand before an import (a
// link-preview image an og:image tag points at): import records those per
// document as stableExtras, and they are kept across republishes. Any other
// extra file is a problem. Returns the first problem, or null.
function stableProblem(stable, snap, allowed = []) {
  const inSnap = new Set(listFiles(snap));
  for (const f of inSnap) {
    const a = path.join(stable, ...f.split("/"));
    if (!fs.existsSync(a)) return "stable copy is missing " + f + " from";
    if (!fs.readFileSync(a).equals(fs.readFileSync(path.join(snap, ...f.split("/"))))) return "stable copy of " + f + " does not match";
  }
  const extra = listFiles(stable, stableOnly).find((f) => !inSnap.has(f) && !allowed.includes(f));
  return extra ? "stable copy has a file that is in no version and was not recorded at import: " + extra + "; it is not in" : null;
}

// Reads what a publish will write. A file is one page. A folder must have
// index.html at its top; its regular files are taken recursively, dot-files
// and dot-folders skipped. Refused: a symlink anywhere inside, a file over the
// host's 25 MiB limit, more than 1,000 files, and a top-level entry named like
// the store's own version folders (it would collide with them).
function readSource(abs) {
  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (st.size > MAX_FILE_BYTES) throw new PublishError("refusing: " + abs + " is " + st.size + " bytes, over the 25 MiB per-file limit");
    const raw = fs.readFileSync(abs);
    return { kind: "file", indexRaw: raw, indexHtml: raw.toString("utf8"), others: [] };
  }
  if (!st.isDirectory()) throw new PublishError("refusing: " + abs + " is not a file or a folder");
  const files = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isSymbolicLink()) throw new PublishError("refusing: " + p + " is a symlink (copy the real file into the folder instead)");
      if (!rel && (e.name === "versions" || VERSION_DIR.test(e.name))) {
        throw new PublishError("refusing: the top-level entry " + JSON.stringify(e.name) + " would collide with the store's own version folders; rename it");
      }
      if (e.isDirectory()) { walk(p, r); continue; }
      if (!e.isFile()) throw new PublishError("refusing: " + p + " is not a regular file");
      const size = fs.statSync(p).size;
      if (size > MAX_FILE_BYTES) throw new PublishError("refusing: " + p + " is " + size + " bytes, over the 25 MiB per-file limit");
      files.push({ rel: r, abs: p });
      if (files.length > MAX_FILES) throw new PublishError("refusing: " + abs + " has more than " + MAX_FILES + " files");
    }
  };
  walk(abs, "");
  if (!files.some((f) => f.rel === "index.html")) throw new PublishError("refusing: a folder needs index.html at its top: " + abs);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  // One read of the index: its raw bytes are fingerprinted, its text is stamped.
  const raw = fs.readFileSync(path.join(abs, "index.html"));
  return {
    kind: "folder",
    indexRaw: raw,
    indexHtml: raw.toString("utf8"),
    others: files.filter((f) => f.rel !== "index.html"),
  };
}

// Rewrites the two generated page kinds from the manifest: every document's
// history page (in the document's own tree) and the master index (public,
// shared documents only). Never touches a stable copy or a frozen version.
// The history page is handed only the title and each version's number and
// date: share notes and source paths never reach its template, so they cannot
// leak onto the public page. A shared document's history page leaves out
// versions that were taken down.
function regeneratePages(ws) {
  const { root, manifest, brand } = ws;
  let versionsTotal = 0;
  const written = [];
  const items = [];
  for (const [name, d] of Object.entries(manifest.deliverables)) {
    const title = titleOf(root, d, name);
    const visible = d.visibility === "shared" ? d.versions.filter((v) => !v.takenDown) : d.versions;
    const dir = path.join(docDir(root, d), "versions");
    fs.mkdirSync(dir, { recursive: true });
    const versionsFile = path.join(dir, "index.html");
    fs.writeFileSync(versionsFile, pages.renderVersionsPage({ title, brand, versions: visible.map((v) => ({ n: v.n, date: v.date })) }));
    written.push(versionsFile);
    if (d.visibility !== "shared") continue;
    versionsTotal += visible.length;
    const latest = visible[visible.length - 1];
    items.push({ slug: d.slug, name, title, latestN: latest ? latest.n : 0, latestDate: latest ? latest.date : "" });
  }
  if (manifest.indexSlug) {
    const indexDir = path.join(root, "public", "d", manifest.indexSlug);
    fs.mkdirSync(indexDir, { recursive: true });
    const indexFile = path.join(indexDir, "index.html");
    fs.writeFileSync(indexFile, pages.renderIndexPage({ items, versionsTotal, brand }));
    written.push(indexFile);
  }
  return written;
}

// Rebuild only the generated pages, e.g. after a template change. No document
// is republished, no version is added, the manifest is not rewritten.
function regenerate(ws) {
  if (!ws.manifest.indexSlug) throw new PublishError("nothing published yet: no master index to regenerate");
  return regeneratePages(ws).map((f) => path.relative(ws.root, f));
}

// Everything a publish decides before it writes. The dark toggle and the
// Markdown export are stamped in at publish time. The hash is over those
// stamped bytes with the export's metadata left as empty placeholders: the
// version number, date and frozen URL would otherwise differ on every publish
// and turn each unchanged republish into a new version. So a toggle or
// converter change counts as a real new version, and true no-ops stay no-ops.
// A folder's hash also covers every other file's path and content, so
// changing one image is a new version and an unchanged folder is a no-op. A
// single file's hash follows the same rule as the imported layout's; this
// engine's stamps differ from an imported page's, so each imported document
// gets one new version on its next republish, and is a no-op after that.
function prepare(ws, sourceArg, opts = {}) {
  const abs = path.resolve(sourceArg);
  if (!fs.existsSync(abs)) throw new PublishError("source not found: " + sourceArg);
  const key = toSourceKey(abs);
  const manifest = ws.manifest;
  // No --name: a source that already feeds exactly one link republishes there.
  // Deriving a name from the filename minted a second link for a page first
  // published under a custom name (two links for one page).
  // An explicit --name, even an empty one, is checked by the rule; only an
  // omitted one is derived.
  let name = opts.name;
  let fittedFrom = null;
  if (name === undefined) {
    const feeding = Object.keys(manifest.deliverables).filter((n) => manifest.deliverables[n].source === key);
    if (feeding.length > 1) throw new PublishError(key + " feeds " + feeding.length + " links (" + feeding.join(", ") + "); pass --name to pick one");
    name = feeding[0] || deriveName(key);
    // A name taken from the file name is fitted to the rule (My Plan.html ->
    // my-plan), and the output says so; a name the owner typed never is.
    if (!feeding.length && nameProblem(name) && fitName(name)) {
      fittedFrom = name;
      name = fitName(name);
    }
    // A name taken from the filename alone must not join a page fed by an
    // unrelated file: sessions in every repo publish plan.html or index.html,
    // and the other page may be shared. Only a -vN sibling in the same folder
    // (plan-v2.html after plan.html) continues the same page without --name.
    const other = !feeding.length && own(manifest.deliverables, name);
    if (other && !versionSibling(other.source, key)) {
      throw new PublishError(
        "refusing: the name " + name + " already belongs to a " + (other.visibility === "shared" ? "SHARED page (on the public link site)" : "private page") + " published from a different file: " + other.source + "\n" +
        replaceQuestion(ws, sourceArg, name, other, key),
      );
    }
  }
  if (!Object.hasOwn(manifest.deliverables, name)) {
    const bad = nameProblem(name);
    if (bad) {
      throw new PublishError("refusing: " + bad + (opts.name !== undefined ? "" : ", taken from the file name") + ". Nothing was changed. Pick a name that fits:\n" +
        "  " + cmd() + " publish " + q(sourceArg) + " --name " + fittedName(name));
    }
  }
  const src = readSource(abs);
  const base = pages.injectDarkToggle(src.indexHtml, ws.brand.accent);
  const indexHash = sha256(pages.injectMarkdownExport(base, null, ws.brand.accent));
  const hash = src.kind === "file"
    ? indexHash
    : sha256(JSON.stringify([["index.html", indexHash], ...src.others.map((f) => [f.rel, sha256(fs.readFileSync(f.abs))])]));
  // The plain hash of every source HTML file, recorded with the version, so the
  // privacy check can recognise a copy of a private page's source anywhere.
  // The raw bytes, before decoding: a page that is not UTF-8 decodes lossily.
  const sourceHashes = [...new Set([sha256(src.indexRaw), ...src.others.filter((f) => /\.html?$/i.test(f.rel)).map((f) => sha256(fs.readFileSync(f.abs)))])];
  const d = own(manifest.deliverables, name);
  const last = d && d.versions[d.versions.length - 1];
  return {
    name, fittedFrom, d, key, abs, src, base, hash, last, sourceHashes,
    unchanged: !!(last && sameSource(ws.root, d, last, src, sourceHashes, hash)),
    n: last ? last.n + 1 : 1,
    title: htmlTitle(src.indexHtml, name),
  };
}

// Unchanged means the same source bytes as the last version, so a change in
// what forge stamps into pages never makes a new version. A version recorded
// with sourceHashes (the plain hashes of the source's HTML files, the index
// first) is compared on those and, for a folder, on every other file's bytes
// against that version's frozen copy. One recorded without them (an imported
// version) is compared on the stamped-page hash, as before.
function sameSource(root, d, last, src, sourceHashes, hash) {
  if (!last.sourceHashes) return last.sha256 === hash;
  if (JSON.stringify(last.sourceHashes) !== JSON.stringify(sourceHashes)) return false;
  const vdir = path.join(docDir(root, d), "v" + last.n);
  if (!fs.existsSync(vdir)) return false;
  const kept = listFiles(vdir).filter((f) => f !== "index.html");
  if (kept.join("\n") !== src.others.map((f) => f.rel).join("\n")) return false;
  return src.others.every((f) => fs.readFileSync(f.abs).equals(fs.readFileSync(path.join(vdir, ...f.rel.split("/")))));
}

// The frozen link stamped into the Markdown export is always the public one,
// so no private address ever ends up inside a page that later goes public.
// A store with no host yet has no public address: none is stamped, and the
// export names the address the page is read at.
function frozenUrl(config, slug, n) {
  if (!config.baseUrl) return null;
  return config.baseUrl + "/d/" + slug + "/v" + n + "/";
}

function pruneEmptyDirs(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || stableOnly.skipTop(e.name)) continue;
    const p = path.join(dir, e.name);
    const walk = (d) => {
      for (const x of fs.readdirSync(d, { withFileTypes: true })) if (x.isDirectory()) walk(path.join(d, x.name));
      if (!fs.readdirSync(d).length) fs.rmdirSync(d);
    };
    walk(p);
  }
}

function writeVersion(dir, html, others) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  for (const f of others) {
    const to = path.join(dir, ...f.rel.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f.abs, to);
    testPause("copy");
  }
}

// A new document is private. An update keeps the document's visibility.
// The one guard on what reaches the public site from a publish: a new version
// of a SHARED document is written only with opts.live, whatever chose the name
// (derived, --name, a -vN sibling, the same file with new content).
function publish(ws, sourceArg, opts = {}) {
  const p = prepare(ws, sourceArg, opts);
  const { name } = p;
  const manifest = ws.manifest;
  const before = p.d ? p.d.visibility : null;
  const warnings = [...(p.fittedFrom ? ["note: the name " + name + " was made from the file name " + p.fittedFrom + " to fit the name rule; " + cmd() + " rename changes it"] : []), ...publishWarnings(sourceArg, p)];
  if (p.unchanged) return { name, slug: p.d.slug, version: p.last.n, visibility: p.d.visibility, unchanged: true, before, warnings };
  if (before === "shared" && !opts.live) {
    // --name onto a shared page from a different file: naming the page is not
    // a yes to a different file either, so the replace question.
    if (p.d.source !== p.key && !versionSibling(p.d.source, p.key)) {
      throw new PublishError(
        "refusing: " + name + " is SHARED at " + ws.config.baseUrl + "/d/" + p.d.slug + "/: this would put the file on the public site now.\n" +
        "It was published from a different file: " + p.d.source + "\n" +
        replaceQuestion(ws, sourceArg, name, p.d, p.key),
      );
    }
    throw new PublishError(
      "refusing: " + name + " is SHARED at " + ws.config.baseUrl + "/d/" + p.d.slug + "/: this would put the file on the public site now.\n" +
      askLive(name, ws.config.baseUrl + "/d/" + p.d.slug + "/") + "\n" +
      "  on yes:  " + cmd() + " publish " + q(sourceArg) + (opts.name ? " --name " + q(opts.name) : "") + " --live\n" +
      "  on no:   " + cmd() + " publish " + q(sourceArg) + " --name '<new-name>'\n" +
      "Nothing was changed.",
    );
  }
  const sourceChanged = p.d && p.d.source !== p.key ? { from: p.d.source, to: p.key } : null;
  const taken = new Set(Object.values(manifest.deliverables).map((x) => x.slug).concat(manifest.indexSlug || []));
  const freshSlug = () => { let s; do s = newSlug(); while (taken.has(s)); taken.add(s); return s; };
  if (!manifest.indexSlug) manifest.indexSlug = freshSlug();
  const d = p.d || (manifest.deliverables[name] = { slug: freshSlug(), source: p.key, visibility: "private", versions: [], shared: [], takedowns: [] });
  const n = p.n;
  const date = today();
  const html = pages.injectMarkdownExport(p.base, { title: p.title, version: n, date, url: frozenUrl(ws.config, d.slug, n), slug: d.slug, name }, ws.brand.accent);
  // Both refusals come before anything is written. The limit is on the bytes
  // the host receives: the stamps add about 13 KB to the source.
  const size = Buffer.byteLength(html);
  if (size > MAX_FILE_BYTES) throw new PublishError("refusing: " + sourceArg + " is " + size + " bytes once stamped (dark switch and Markdown export), over the 25 MiB per-file limit");
  for (const t of ["public", "private"]) {
    if (fs.existsSync(path.join(ws.root, t, "d", d.slug, "v" + n))) throw new PublishError("refusing: " + t + "/d/" + d.slug + "/v" + n + " already exists; a frozen version is never rewritten");
  }
  d.source = p.key;
  // sha256 is of the stamped page with placeholder export metadata (see prepare), not of the written bytes.
  d.versions.push({ n, date, source: p.key, sha256: p.hash, sourceHashes: p.sourceHashes });
  const dir = docDir(ws.root, d);
  fs.mkdirSync(dir, { recursive: true });
  // Files the previous version put in the stable copy are removed first, so a
  // file dropped from a folder source drops off the stable link too (it stays
  // in its frozen version and in git). Files put there by hand are kept.
  if (p.last) {
    const prev = path.join(dir, "v" + p.last.n);
    if (fs.existsSync(prev)) {
      for (const f of listFiles(prev)) fs.rmSync(path.join(dir, ...f.split("/")), { force: true });
      pruneEmptyDirs(dir);
    }
  }
  writeVersion(path.join(dir, "v" + n), html, p.src.others);
  writeVersion(dir, html, p.src.others);
  regeneratePages(ws);
  saveManifest(ws);
  return { name, slug: d.slug, version: n, visibility: d.visibility, unchanged: false, before, sourceChanged, warnings };
}

// Warnings, never blocks, worked out from the bytes publish already read and
// before anything is saved: the source may be gone by the time the command
// prints its result.
function publishWarnings(sourceArg, p) {
  const w = [];
  if (pages.unlabelledDiagrams(p.src.indexHtml)) {
    w.push("warning: " + sourceArg + " has a diagram without a text description: the Markdown copy will only link to it (add aria-label or a <title> to the svg)");
  }
  const beside = p.src.kind === "file" ? besideRefs(p.abs, p.src.indexHtml) : [];
  if (beside.length) {
    w.push("warning: " + sourceArg + " points at files beside it (" + beside.join(", ") + "), and a single file publishes without them: publish the folder instead (a folder with this page as its index.html)");
  }
  return w;
}

// Move every entry of fromDir into toDir (merging), except those `keep` names.
function moveEntries(fromDir, toDir, keep = () => false) {
  if (!fs.existsSync(fromDir)) return;
  fs.mkdirSync(toDir, { recursive: true });
  for (const e of fs.readdirSync(fromDir)) {
    if (keep(e)) continue;
    const to = path.join(toDir, e);
    if (fs.existsSync(to)) throw new PublishError("refusing to move " + path.join(fromDir, e) + ": " + to + " already exists");
    fs.renameSync(path.join(fromDir, e), to);
    testPause("move");
  }
  if (!fs.readdirSync(fromDir).length) fs.rmdirSync(fromDir);
}

// A page by name, own keys only: "constructor" or "toString" is no page,
// whatever the object inherits. Every lookup by name goes through it.
function own(deliverables, name) {
  return Object.hasOwn(deliverables, name) ? deliverables[name] : null;
}

function getDoc(ws, name) {
  const d = own(ws.manifest.deliverables, name);
  if (!d) throw new PublishError("unknown document: " + name + " (" + cmd() + " list shows every name)");
  return d;
}

function recordShareEntry(d, note) {
  const latest = d.versions[d.versions.length - 1];
  const latestAtShare = latest ? latest.n : 0;
  const entry = { date: today(), note: note || "", latestAtShare };
  d.shared.push(entry);
  return latestAtShare;
}

// Private document: move it from private/ to public/ (taken-down versions stay
// private), mark it shared, record the share. Already shared: record the share.
function share(ws, name, note) {
  const d = getDoc(ws, name);
  const before = d.visibility;
  const wasPrivate = d.visibility === "private";
  if (wasPrivate) {
    const down = new Set(d.versions.filter((v) => v.takenDown).map((v) => "v" + v.n));
    const from = path.join(ws.root, "private", "d", d.slug);
    d.visibility = "shared";
    moveEntries(from, path.join(ws.root, "public", "d", d.slug), (e) => down.has(e));
  }
  const latestAtShare = recordShareEntry(d, note);
  regeneratePages(ws);
  saveManifest(ws);
  return { name, slug: d.slug, wasPrivate, latestAtShare, before };
}

// Whole document: move it back to private/. One version: move only that
// frozen version and leave it off the public history page; on a page not yet
// shared, mark it the same way, so share keeps it in private/. Nothing is
// ever deleted; the store's git history keeps everything.
// A goal, not a transition: when the store already has the page (or the
// version) off the link site, it changes nothing and says so (already: true),
// so a take-down interrupted after it was saved can be run again to finish.
function unshare(ws, name, opts = {}) {
  const d = getDoc(ws, name);
  const before = d.visibility;
  const version = opts.version != null ? Number(opts.version) : null;
  const latest = d.versions[d.versions.length - 1];
  const v = version != null && d.versions.find((x) => x.n === version);
  if (version != null && !v) throw new PublishError(name + " has no version " + opts.version);
  if ((version == null && d.visibility !== "shared") || (v && v.takenDown)) return { name, slug: d.slug, version, before, already: true };
  if (version != null) {
    const n = version;
    if (n === latest.n) {
      throw new PublishError(
        "refusing: v" + n + " is the latest version of " + name + ", which the stable link shows.\n" +
        (d.visibility === "shared" ? "Publish a new version first, or take the whole document down with: " + cmd() + " unshare " + name : "Publish a new version first, or publish a clean copy under a new --name"),
      );
    }
    if (d.visibility === "shared") {
      const from = path.join(ws.root, "public", "d", d.slug, "v" + n);
      const to = path.join(ws.root, "private", "d", d.slug, "v" + n);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(to)) throw new PublishError("refusing: " + to + " already exists");
      fs.renameSync(from, to);
    }
    v.takenDown = today();
    d.takedowns.push({ date: v.takenDown, version: n });
  } else {
    moveEntries(path.join(ws.root, "public", "d", d.slug), path.join(ws.root, "private", "d", d.slug));
    d.visibility = "private";
    d.takedowns.push({ date: today(), version: "all" });
  }
  regeneratePages(ws);
  saveManifest(ws);
  return { name, slug: d.slug, version: opts.version != null ? Number(opts.version) : null, before };
}

// Give a page a new name: its key in the manifest, and nothing else. The entry
// itself (slug, so every link; versions; visibility; shares; take-downs;
// sources) is moved over untouched and keeps its place in the list. Generated
// pages are rebuilt, since a page with no <title> shows its name there and the
// master index carries shared pages' names for its search.
function rename(ws, from, to) {
  const d = getDoc(ws, from);
  const m = ws.manifest;
  if (!to) throw new PublishError("refusing: the new name is empty; a page needs a name. Nothing was changed. Run: " + cmd() + " rename " + q(from) + " '<new-name>'");
  if (to === from) throw new PublishError("refusing: " + from + " already has that name, so there is nothing to rename. Nothing was changed.");
  const bad = nameProblem(to);
  if (bad) throw new PublishError("refusing: " + bad + ". Nothing was changed. Run: " + cmd() + " rename " + q(from) + " " + fittedName(to));
  if (Object.hasOwn(m.deliverables, to)) {
    throw new PublishError("refusing: " + to + " is already a page (" + cmd() + " list shows it); pick another new name. Nothing was changed. Run: " + cmd() + " rename " + q(from) + " '<new-name>'");
  }
  // fromEntries makes own keys, so any name (even "__proto__") is stored as given.
  m.deliverables = Object.fromEntries(Object.entries(m.deliverables).map(([n, x]) => [n === from ? to : n, x]));
  regeneratePages(ws);
  saveManifest(ws);
  return { name: from, to, slug: d.slug, visibility: d.visibility };
}

const TEMPLATE_PUBLIC = ["404.html", "_headers", "index.html"];

// One-time migration of an existing site of the same layout (a site tree plus
// a manifest whose sources are relative to one folder) into an empty store.
// The site tree is copied as-is: public/ must come out byte-identical to it.
function importSite(ws, oldSite, oldManifestFile, sourceRoot) {
  const { root, manifest, config } = ws;
  if (manifest.indexSlug || Object.keys(manifest.deliverables).length) {
    throw new PublishError("refusing: import needs an empty store; this one already has documents");
  }
  const pub = fs.readdirSync(path.join(root, "public"));
  if (pub.some((e) => !TEMPLATE_PUBLIC.includes(e))) {
    throw new PublishError("refusing: public/ holds more than the template's files: " + pub.filter((e) => !TEMPLATE_PUBLIC.includes(e)).join(", "));
  }
  if (fs.readdirSync(path.join(root, "private")).some((e) => e !== ".gitkeep")) throw new PublishError("refusing: private/ is not empty");
  const old = JSON.parse(fs.readFileSync(oldManifestFile, "utf8"));
  if (!old || typeof old.deliverables !== "object") throw new PublishError("not a publisher manifest (no deliverables): " + oldManifestFile);
  if (old.baseUrl && old.baseUrl !== config.baseUrl) {
    throw new PublishError(
      "refusing: the old manifest's baseUrl is " + old.baseUrl + " but config.json says " + (config.baseUrl || "none (no host is set)") + ".\n" +
      "Pages carry their address in their Markdown export; set config.json baseUrl to the old address first.",
    );
  }
  const files = listFiles(oldSite);
  for (const f of files) {
    const to = path.join(root, "public", ...f.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(oldSite, ...f.split("/")), to);
  }
  const srcRoot = path.resolve(sourceRoot);
  const key = (rel) => toSourceKey(path.resolve(srcRoot, rel));
  const out = {};
  for (const [name, d] of Object.entries(old.deliverables)) {
    out[name] = {
      slug: d.slug,
      source: key(d.source),
      visibility: "shared",
      versions: d.versions.map((v) => ({ ...v, source: key(v.source) })),
      shared: d.shared || [],
      takedowns: [],
    };
  }
  // Files the old site's owner put in a stable folder by hand are recorded, so
  // the check allows exactly those and names any other.
  for (const d of Object.values(out)) {
    const stable = path.join(root, "public", "d", d.slug);
    const snap = path.join(stable, "v" + d.versions[d.versions.length - 1].n);
    if (!fs.existsSync(snap) || !fs.existsSync(stable)) continue;
    const inSnap = new Set(listFiles(snap));
    const extras = listFiles(stable, stableOnly).filter((f) => !inSnap.has(f));
    if (extras.length) d.stableExtras = extras;
  }
  manifest.indexSlug = old.indexSlug || null;
  manifest.deliverables = out;
  saveManifest(ws);
  if (!sameTrees(oldSite, path.join(root, "public"))) {
    throw new PublishError("import check failed: public/ is not byte-identical to " + oldSite);
  }
  return { documents: Object.keys(out).length, versions: Object.values(out).reduce((a, d) => a + d.versions.length, 0), files: files.length };
}

// Every problem with the store, one line each; [] means healthy. Sources that
// are missing on this machine are NOT problems (they live in many repos on
// several machines); missingSources() lists them as information.
function check(ws) {
  const { root, manifest } = ws;
  const problems = [];
  const docs = Object.entries(manifest.deliverables);
  const slugOwner = new Map(docs.map(([n, d]) => [d.slug, n]));
  if (manifest.indexSlug) {
    if (slugOwner.has(manifest.indexSlug)) problems.push("the index slug is also a document's slug: " + manifest.indexSlug);
    if (!fs.existsSync(path.join(root, "public", "d", manifest.indexSlug, "index.html"))) problems.push("master index missing: public/d/" + manifest.indexSlug + "/index.html");
    if (fs.existsSync(path.join(root, "private", "d", manifest.indexSlug))) problems.push("master index slug found in private/: private/d/" + manifest.indexSlug);
  }
  const headers = path.join(root, "public", "_headers");
  if (!fs.existsSync(headers) || !/X-Robots-Tag:\s*noindex/i.test(fs.readFileSync(headers, "utf8"))) {
    problems.push("public/_headers does not send X-Robots-Tag: noindex");
  }
  const seen = new Set();
  for (const [name, d] of docs) {
    if (seen.has(d.slug)) problems.push(name + ": slug used by two documents: " + d.slug);
    seen.add(d.slug);
    const shared = d.visibility === "shared";
    const home = docDir(root, d);
    const away = path.join(treeDir(root, shared ? "private" : "shared"), "d", d.slug);
    const homeTree = shared ? "public" : "private";
    const awayTree = shared ? "private" : "public";
    if (!fs.existsSync(path.join(home, "index.html"))) problems.push(name + ": stable copy missing: " + homeTree + "/d/" + d.slug + "/index.html");
    if (!fs.existsSync(path.join(home, "versions", "index.html"))) problems.push(name + ": history page missing: " + homeTree + "/d/" + d.slug + "/versions/index.html");
    const down = new Set(d.versions.filter((v) => v.takenDown).map((v) => "v" + v.n));
    // The one thing allowed in the other tree: a shared document's taken-down
    // versions, which wait in private/ under the same slug.
    if (fs.existsSync(away)) {
      for (const e of fs.readdirSync(away)) {
        if (!(shared && down.has(e))) problems.push(name + ": is " + d.visibility + " but " + awayTree + "/d/" + d.slug + "/" + e + " exists");
      }
    }
    const known = new Set(d.versions.map((v) => "v" + v.n));
    if (fs.existsSync(home)) {
      for (const e of fs.readdirSync(home)) {
        if (VERSION_DIR.test(e) && !known.has(e)) problems.push(name + ": orphan version folder with no manifest entry: " + homeTree + "/d/" + d.slug + "/" + e);
      }
    }
    const latest = d.versions[d.versions.length - 1];
    if (latest && latest.takenDown) problems.push(name + ": the latest version v" + latest.n + " is taken down, but the stable link still shows it");
    for (const v of d.versions) {
      const where = shared && v.takenDown ? "private" : homeTree;
      const notWhere = where === "public" ? "private" : "public";
      const snap = path.join(root, where, "d", d.slug, "v" + v.n);
      if (!fs.existsSync(path.join(snap, "index.html"))) {
        problems.push(name + ": version v" + v.n + " missing: " + where + "/d/" + d.slug + "/v" + v.n + "/index.html");
        continue;
      }
      if (fs.existsSync(path.join(root, notWhere, "d", d.slug, "v" + v.n))) problems.push(name + ": v" + v.n + " is in both trees");
      if (latest && v.n === latest.n && fs.existsSync(path.join(home, "index.html"))) {
        try {
          const sp = stableProblem(home, snap, d.stableExtras);
          if (sp) problems.push(name + ": " + sp + " latest version v" + v.n);
        } catch (e) {
          problems.push(name + ": " + e.message);
        }
      }
    }
    if (shared && down.size) {
      const vp = path.join(home, "versions", "index.html");
      if (fs.existsSync(vp)) {
        const html = fs.readFileSync(vp, "utf8");
        for (const v of down) if (html.includes('href="../' + v + '/"')) problems.push(name + ": the public history page still links taken-down " + v);
      }
    }
  }
  // Reverse walk: a d/ folder with no manifest entry is an orphan the forward
  // checks above would stay silent on.
  for (const tree of ["public", "private"]) {
    const dDir = path.join(root, tree, "d");
    if (!fs.existsSync(dDir)) continue;
    for (const e of fs.readdirSync(dDir, { withFileTypes: true })) {
      // stray files (.DS_Store, logs) are not orphans; slugs are directories
      if (!e.isDirectory()) continue;
      if (!slugOwner.has(e.name) && e.name !== manifest.indexSlug) problems.push("orphan folder with no manifest entry: " + tree + "/d/" + e.name);
    }
  }
  try {
    problems.push(...privacyProblems(ws));
  } catch (e) {
    problems.push("privacy check could not read public/: " + e.message);
  }
  return problems;
}

// The content check, over the bytes of every file under public/ (not a label,
// so a link written into a shared page by hand is caught as surely as a
// generated one). A public file fails when it:
//   1. carries a private document's slug;
//   2. is an HTML file byte-identical to an HTML file in one of a private
//      document's version folders, or to one of the source HTML files a
//      private version was published from (their plain hashes are recorded at
//      publish, so this holds for single files and folders alike, whatever
//      the converter). Versions recorded before that field existed (imported
//      ones) are covered by their stored page bytes only. Pages only: images,
//      fonts, scripts and styles shared between documents are normal, so a
//      private document's other files copied into a shared one are not
//      detected;
//   3. is HTML whose whole title is a private document's title: its <title>
//      or its first <h1> (outside scripts, styles and comments) equals it,
//      ignoring case and spacing. The word in body text is no match, so a
//      private page called "Budget" does not block shared pages using the
//      word. A private title that a shared document itself uses is skipped:
//      that text is already public, and a clean copy published under a new
//      name shares it.
// Limit: a private document's images and other files, and content copied in
// another form (retyped, reformatted, a screenshot), cannot be detected. The
// guarantee is that nothing on the link site references a private page and no
// private page is uploaded as it is.
const titleKey = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
// The page's own titles: the text of its <title> and of its first <h1>.
function pageTitles(html) {
  const h = String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  return [/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i, /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i]
    .map((re) => h.match(re))
    .filter(Boolean)
    .map((m) => titleKey(decodeEntities(m[1].replace(/<[^>]*>/g, " "))));
}

function privacyProblems(ws) {
  const { root, manifest } = ws;
  const docs = Object.entries(manifest.deliverables);
  const sharedTitles = new Set(docs.filter(([, d]) => d.visibility === "shared").map(([n, d]) => titleKey(titleOf(root, d, n))));
  const slugs = [];
  const titles = [];
  const copies = new Map(); // sha256 of a private version's file -> document name
  const sources = new Map(); // plain hash of a source HTML file of a private version -> document name
  for (const [name, d] of docs) {
    if (d.visibility !== "private") continue;
    slugs.push({ name, buf: Buffer.from(d.slug) });
    const key = titleKey(titleOf(root, d, name));
    if (!sharedTitles.has(key) && key) titles.push({ name, key });
    for (const v of d.versions) {
      for (const h of v.sourceHashes || []) sources.set(h, name);
      const vdir = path.join(root, "private", "d", d.slug, "v" + v.n);
      if (!fs.existsSync(vdir)) continue;
      for (const f of listFiles(vdir)) {
        if (!/\.html?$/i.test(f)) continue; // pages only: a logo or font shared with a shared page is normal
        const b = fs.readFileSync(path.join(vdir, ...f.split("/")));
        if (b.length) copies.set(sha256(b), name);
      }
    }
  }
  if (!slugs.length) return [];
  const problems = [];
  const pub = path.join(root, "public");
  for (const f of listFiles(pub)) {
    const bytes = fs.readFileSync(path.join(pub, ...f.split("/")));
    for (const n of slugs) {
      if (bytes.includes(n.buf)) problems.push("privacy: public/" + f + " contains the slug of private document " + n.name);
    }
    if (!/\.html?$/i.test(f)) continue;
    const h = sha256(bytes);
    const copyOf = copies.get(h);
    if (copyOf) problems.push("privacy: public/" + f + " is a byte-for-byte copy of a page of private document " + copyOf);
    const srcOf = sources.get(h);
    if (srcOf && srcOf !== copyOf) problems.push("privacy: public/" + f + " is a copy of the source of private document " + srcOf);
    const html = bytes.toString("utf8");
    const own = pageTitles(html);
    for (const t of titles) {
      if (own.includes(t.key)) problems.push("privacy: public/" + f + " has the title of private document " + t.name + " (if the two pages are unrelated, give one of them a different title and republish it)");
    }
  }
  return problems;
}

function missingSources(ws) {
  return Object.entries(ws.manifest.deliverables)
    .filter(([, d]) => !fs.existsSync(fromSourceKey(d.source)))
    .map(([name, d]) => ({ name, source: d.source }));
}

module.exports = {
  PublishError, NAME_RULE, NAME_MAX, nameProblem, MAX_FILE_BYTES, MAX_FILES, testPause, besideRefs, askLive,
  newSlug, deriveName, sha256, htmlTitle, toSourceKey, fromSourceKey, titleOf, docDir,
  listFiles, sameTrees, readSource, regeneratePages, regenerate, prepare, frozenUrl,
  own, getDoc, publish, share, unshare, rename, importSite, check, missingSources, saveManifest,
};
