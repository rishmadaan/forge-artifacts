// The deploy: uploads one folder (an export of a pushed commit's public/,
// made by bin/forge) through the host's adapter (lib/hosts/), and reads the
// live marker back. Everything it prints goes to stderr: stdout carries only
// a command's results, printed after the deploy was confirmed live.
//
// The token is read by the NAME in config.json host.tokenSecret: the
// environment first, then the user's secretCommand (lib/secrets.js).
// FORGE_DEPLOY=0 makes every deploy a dry run: bin/forge prints what it would
// upload, and nothing here touches the network; every test sets it, or runs
// the real path against a fake host (test/fakehost.js).
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { readSecret } = require("./secrets.js");
const core = require("./core.js");
const hosts = require("./hosts/index.js");
const settings = require("./settings.js");

// The marker every deploy carries; each adapter makes its host serve it uncached.
const MARKER = "_forge/revision.json";

// What a link site shows is a pair: the public tree and the site, the host
// setting it was uploaded for (kind, project, account id, address). A host
// change moves the site and leaves the tree alone, so a tree alone proves
// nothing about which site answered. The marker is a public file, so it
// carries a hash of the setting, never the values.
function siteOf(config) {
  const h = config.host;
  if (!h) return null;
  return crypto.createHash("sha256").update(JSON.stringify([h.kind, h.project, h.accountId || "", config.baseUrl])).digest("hex").slice(0, 32);
}
// The one comparison of { tree, site } pairs. b is always a pair forge
// computed for a set host, so a side with no site (a marker or record an
// older forge wrote) never matches: nothing old is trusted.
const sameSite = (a, b) => a.site === b.site;
const sameDeploy = (a, b) => a.tree === b.tree && sameSite(a, b);

// Returns true when the host accepted the upload, false on a failed upload
// (which may have sent some or all of the files: the caller never assumes
// either way, it reads the marker back).
function upload(ws, dir) {
  const h = ws.config.host;
  const adapter = hosts.get(h.kind);
  if (!adapter) {
    console.error("deploy FAILED: no adapter for host kind " + JSON.stringify(h.kind));
    return false;
  }
  const secret = readSecret(h.tokenSecret);
  const token = secret.value;
  if (!token) {
    console.error("deploy FAILED: no secret named " + h.tokenSecret + " in the environment" + (secret.why ? ", and the secretCommand " + secret.why : " (and no secretCommand is set in " + settings.file() + ")"));
    return false;
  }
  console.error("deploying " + core.listFiles(dir).length + " files to " + adapter.name + " project " + h.project + " ...");
  adapter.headers(dir);
  const c = adapter.command(dir, h, token);
  const res = spawnSync("npx", ["--yes", c.pkg + "@latest", ...c.args], {
    stdio: ["ignore", 2, 2],
    env: { ...process.env, ...c.env },
  });
  if (res.status !== 0) {
    console.error("deploy FAILED (" + c.pkg + " exit " + res.status + "). Check the token " + h.tokenSecret + " and the project in config.json (SETUP.md says what each host needs).");
    return false;
  }
  return true;
}

// Read <baseUrl>/_forge/revision.json now, past every cache. Returns
// { ok: true, commit, tree, site, time } (site null when the marker has none) or { ok: false, error, missing }. A marker
// served without Cache-Control: no-store is not a read of the site now (a
// cache may have answered, or the host ignored the header file), so it is
// { ok: false }: the change is then not confirmed live. missing
// is true when the host answered that there is no marker (HTTP 404): a read
// that worked and showed the site lacks it, unlike an unreachable site, an
// error status or a body that is not a marker. Never throws.
const FETCH = `
const [url, ms] = process.argv.slice(1);
fetch(url, { cache: "no-store", headers: { "cache-control": "no-cache", pragma: "no-cache" }, signal: AbortSignal.timeout(Number(ms)) })
  .then(async (r) => { const t = await r.text(); process.stdout.write(JSON.stringify(r.ok ? { body: t, cacheControl: r.headers.get("cache-control") } : { error: "HTTP " + r.status })); })
  .catch((e) => process.stdout.write(JSON.stringify({ error: String(e && (e.cause && e.cause.code || e.message) || e) })));
`;
function readLive(ws, timeoutMs = 5000) {
  if (process.env.FORGE_DEPLOY === "0") return { ok: false, error: "dry run (FORGE_DEPLOY=0): the link site is not read" };
  const url = ws.config.baseUrl + "/" + MARKER + "?r=" + Date.now() + Math.random().toString(36).slice(2);
  const r = spawnSync(process.execPath, ["-e", FETCH, url, String(timeoutMs)], { encoding: "utf8", timeout: timeoutMs + 3000 });
  let res;
  try {
    res = JSON.parse(r.stdout);
  } catch {
    return { ok: false, error: "could not read " + url + (r.error ? ": " + r.error.message : "") };
  }
  if (res.error) return { ok: false, error: res.error, missing: res.error === "HTTP 404" };
  let m = null;
  try {
    m = JSON.parse(res.body);
  } catch { /* not a marker */ }
  if (!m || typeof m.commit !== "string" || typeof m.tree !== "string") return { ok: false, error: "the link site's marker is not readable" };
  if (!/(^|,)\s*no-store\s*(,|$)/i.test(res.cacheControl || "")) {
    return { ok: false, error: "the link site serves its marker " + (res.cacheControl ? "with Cache-Control: " + res.cacheControl : "with no Cache-Control header") + ", not no-store, so the read may be a cached copy (check that the host applies the header file forge uploads)" };
  }
  return { ok: true, commit: m.commit, tree: m.tree, site: typeof m.site === "string" ? m.site : null, time: m.time || null };
}

module.exports = { upload, readLive, MARKER, siteOf, sameSite, sameDeploy };
