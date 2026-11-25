// The one loader every command goes through. It finds the workspace (the
// store), checks it against the schema in workspace-template/schema.md, and
// stops loudly naming every problem. It never fills in a default: a missing or
// wrong value is an error, not a guess.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const settings = require("./settings.js");
const hosts = require("./hosts/index.js");
const cmd = require("./command.js");

const ENGINE = path.resolve(__dirname, "..");
const TEMPLATE_DIR = path.join(ENGINE, "workspace-template");
const SUPPORTED_TEMPLATE_VERSION = "1";
const PLACEHOLDER = "CHANGE-ME";

class WorkspaceError extends Error {}

// Where the store is, and why: FORGE_WORKSPACE, then the user setting file's
// "store", then ~/.forge. Never the engine's own folder: the engine can be
// replaced or deleted without touching the pages. An unreadable setting file
// is an error (WorkspaceError), never a quiet step to the next source.
function defaultStore() {
  return path.join(os.homedir(), ".forge");
}
function whereStore() {
  if (process.env.FORGE_WORKSPACE) return { root: path.resolve(process.env.FORGE_WORKSPACE), from: "FORGE_WORKSPACE" };
  let s;
  try {
    s = settings.read();
  } catch (e) {
    throw new WorkspaceError(e.message);
  }
  if (s.store) return { root: s.store, from: "the setting in " + settings.file() };
  return { root: defaultStore(), from: "the default (FORGE_WORKSPACE is not set and " + settings.file() + " names no store)" };
}
function resolveWorkspace() {
  return whereStore().root;
}

// The loud stop when there is no store where forge looks, with both ways on.
function noStore(where) {
  return "no store at " + where.root + " (from " + where.from + ")\n" +
    "  make one there:                " + cmd() + " init" + (where.from.startsWith("the default") ? "" : " " + cmd.shq(where.root)) + "\n" +
    "  or use a store that exists:    " + cmd() + " store <path>";
}

// Does this folder hold a store (made by forge init, configured or not)?
function holdsStore(dir) {
  return ["TEMPLATE_VERSION", "manifest.json", ".git"].every((f) => fs.existsSync(path.join(dir, f)));
}

function readJson(file, problems) {
  if (!fs.existsSync(file)) {
    problems.push("missing file: " + path.basename(file));
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    problems.push(path.basename(file) + " is not valid JSON: " + e.message);
    return null;
  }
}

const SLUG = /^[A-Za-z0-9_-]{12}$/;
const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isUrl = (v) => isStr(v) && /^https?:\/\/[^\s]+[^/\s]$/.test(v);

function checkConfig(c, ws, problems) {
  if (!c || typeof c !== "object") return;
  const need = (ok, msg) => { if (!ok) problems.push("config.json: " + msg); };
  // A store starts private-only: no host and no public address. forge host
  // sets the two together, and sharing needs them.
  const unset = (v) => v === undefined || v === null;
  need(unset(c.baseUrl) || isUrl(c.baseUrl), "baseUrl must be an http(s) address with no trailing slash");
  need(unset(c.baseUrl) === unset(c.host), "baseUrl and host are set together (" + cmd() + " host sets both), or neither for a private-only store");
  // Optional: with no private address, a private link is the page's file in the store.
  need(unset(c.privateBaseUrl) || isUrl(c.privateBaseUrl), "privateBaseUrl, when set, must be an http(s) address with no trailing slash");
  const h = c.host;
  need(unset(h) || typeof h === "object", "host, when set, is { kind, project, accountId, tokenSecret } (" + cmd() + " host writes it)");
  if (h && typeof h === "object") {
    const adapter = hosts.get(h.kind);
    need(adapter, "host.kind must be one of " + hosts.kinds.map((k) => JSON.stringify(k)).join(", "));
    need(isStr(h.project), "host.project is required");
    if (adapter && adapter.needsAccount) need(isStr(h.accountId), "host.accountId is required for " + adapter.name);
    need(isStr(h.tokenSecret), "host.tokenSecret is required (the NAME of the secret, never its value)");
  }
  const b = c.brand;
  need(b && typeof b === "object", "brand is required ({ name, wordmarkFile, indexTagHtml, historyFooterHtml })");
  if (b && typeof b === "object") {
    need(isStr(b.name), "brand.name is required");
    need(b.wordmarkFile === null || isStr(b.wordmarkFile), "brand.wordmarkFile must be a path inside the store, or null for a text mark");
    // Read at a commit (configAt) there is no folder: the file is checked by the full load.
    if (isStr(b.wordmarkFile) && ws) {
      const f = path.join(ws, b.wordmarkFile);
      if (!fs.existsSync(f)) problems.push("config.json: brand.wordmarkFile not found in the store: " + b.wordmarkFile);
      // Its bytes go into public pages, so it must really be the store's own
      // file: the real path, symlinks followed, inside the store.
      else if (!fs.realpathSync(f).startsWith(fs.realpathSync(ws) + path.sep)) {
        problems.push("config.json: brand.wordmarkFile must be inside the store (symlinks followed): " + b.wordmarkFile);
      }
    }
    need(isStr(b.indexTagHtml), "brand.indexTagHtml is required");
    need(isStr(b.historyFooterHtml), "brand.historyFooterHtml is required");
    // Optional, for a store's own look: one colour, and a stylesheet for its fonts.
    need(b.accent === undefined || /^#[0-9a-fA-F]{6}$/.test(b.accent), "brand.accent, when set, must be a colour like #3451b2");
    need(b.fontStylesheet === undefined || (isStr(b.fontStylesheet) && /^https:\/\/\S+$/.test(b.fontStylesheet)), "brand.fontStylesheet, when set, must be an https address of a stylesheet");
  }
  if (JSON.stringify(c).includes(PLACEHOLDER)) {
    problems.push("config.json still has " + PLACEHOLDER + " placeholders: fill in your own values, then commit config.json");
  }
}

function checkManifest(m, problems) {
  if (!m || typeof m !== "object") return;
  const bad = (msg) => problems.push("manifest.json: " + msg);
  if (!(m.indexSlug === null || SLUG.test(m.indexSlug))) bad("indexSlug must be 12 URL-safe characters, or null");
  if (!m.deliverables || typeof m.deliverables !== "object" || Array.isArray(m.deliverables)) {
    bad("deliverables must be an object");
    return;
  }
  for (const [name, d] of Object.entries(m.deliverables)) {
    if (!d || typeof d !== "object") { bad(name + " is not an object"); continue; }
    if (!SLUG.test(d.slug || "")) bad(name + ": slug must be 12 URL-safe characters");
    if (!isStr(d.source)) bad(name + ": source is required");
    if (d.visibility !== "private" && d.visibility !== "shared") bad(name + ': visibility must be "private" or "shared"');
    if (!Array.isArray(d.versions) || !d.versions.length) bad(name + ": versions must be a non-empty list");
    else if (d.versions.some((v) => !v || !Number.isInteger(v.n) || !isStr(v.date) || !isStr(v.sha256))) bad(name + ": every version needs n, date and sha256");
    // Gaps are allowed (an imported site may have removed versions); a repeat or a step
    // back is not: the next publish writes last + 1, which must be a new folder.
    else if (d.versions.some((v, i) => v.n < 1 || (i > 0 && v.n <= d.versions[i - 1].n))) bad(name + ": version numbers must be positive and increasing");
    else if (d.versions.some((v) => v.sourceHashes !== undefined && !(Array.isArray(v.sourceHashes) && v.sourceHashes.every((x) => /^[0-9a-f]{64}$/.test(x))))) bad(name + ": a version's sourceHashes must be a list of sha256 hashes");
    if (!Array.isArray(d.shared)) bad(name + ": shared must be a list");
    if (!Array.isArray(d.takedowns)) bad(name + ": takedowns must be a list");
    if (d.stableExtras !== undefined && !(Array.isArray(d.stableExtras) && d.stableExtras.every(isStr))) bad(name + ": stableExtras must be a list of paths");
  }
}

// config.json as committed at some commit (its text), checked by the same
// rules as the loader; throws WorkspaceError naming every problem.
function parseConfig(text, where) {
  const problems = [];
  let c = null;
  try {
    c = JSON.parse(text);
  } catch (e) {
    problems.push("config.json is not valid JSON: " + e.message);
  }
  if (!problems.length && (!c || typeof c !== "object" || Array.isArray(c))) problems.push("config.json must hold one JSON object");
  checkConfig(c, null, problems);
  if (problems.length) throw new WorkspaceError("config.json at " + where + " is not usable:\n  " + problems.join("\n  "));
  return c;
}

// Returns { root, config, manifest, brand }. Throws WorkspaceError listing
// every problem found, not just the first.
function load(root) {
  const where = root ? { root, from: "the caller" } : whereStore();
  root = where.root;
  const problems = [];
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new WorkspaceError(noStore(where));
  const tv = path.join(root, "TEMPLATE_VERSION");
  if (!fs.existsSync(tv)) problems.push("missing file: TEMPLATE_VERSION");
  else {
    const v = fs.readFileSync(tv, "utf8").trim();
    if (v !== SUPPORTED_TEMPLATE_VERSION) {
      problems.push("TEMPLATE_VERSION is " + JSON.stringify(v) + "; this engine reads version " + SUPPORTED_TEMPLATE_VERSION + " (see workspace-template/schema.md for what changed)");
    }
  }
  for (const dir of ["public", "private"]) {
    const p = path.join(root, dir);
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) problems.push("missing folder: " + dir);
  }
  // A folder in the store itself; a file in the temporary worktrees forge writes in.
  if (!fs.existsSync(path.join(root, ".git"))) problems.push("missing folder: .git (the store must be its own git repo)");
  if (!fs.existsSync(path.join(root, "public", "_headers"))) problems.push("missing file: public/_headers");
  const config = readJson(path.join(root, "config.json"), problems);
  if (!fs.existsSync(path.join(root, "config.json")) && fs.existsSync(path.join(root, "config.example.json"))) {
    problems.push("(copy config.example.json to config.json, fill it in, and commit it)");
  }
  checkConfig(config, root, problems);
  const manifest = readJson(path.join(root, "manifest.json"), problems);
  checkManifest(manifest, problems);
  if (config && !config.host && manifest && manifest.deliverables && typeof manifest.deliverables === "object") {
    const shared = Object.keys(manifest.deliverables).filter((n) => manifest.deliverables[n] && manifest.deliverables[n].visibility === "shared");
    if (shared.length) problems.push("config.json has no host, but " + shared.length + " page(s) are shared (" + shared.slice(0, 3).join(", ") + (shared.length > 3 ? ", ..." : "") + "); set the host back with " + cmd() + " host");
  }
  if (problems.length) {
    throw new WorkspaceError("store " + root + " is not usable:\n  " + problems.join("\n  "));
  }
  const b = config.brand;
  const brand = {
    name: b.name,
    wordmarkSvg: b.wordmarkFile ? fs.readFileSync(path.join(root, b.wordmarkFile), "utf8").trim() : null,
    indexTagHtml: b.indexTagHtml,
    historyFooterHtml: b.historyFooterHtml,
    accent: b.accent,
    fontStylesheet: b.fontStylesheet,
  };
  return { root, config, manifest, brand };
}

module.exports = { load, parseConfig, resolveWorkspace, whereStore, defaultStore, noStore, holdsStore, WorkspaceError, ENGINE, TEMPLATE_DIR, SUPPORTED_TEMPLATE_VERSION, PLACEHOLDER };
