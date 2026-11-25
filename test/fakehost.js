// A fake link site for tests: the real deploy path runs against it, with no
// test mode inside the engine (so nothing in a store's config can select it).
//
// - A fake `npx` (put first on PATH) stands in for each host's CLI (wrangler,
//   vercel, netlify-cli), reading the arguments and environment that CLI's
//   documentation names (lib/hosts/*.js cite them) and refusing a call that
//   lacks its token or a required flag. It copies the folder it is asked to
//   deploy into <root>/<project>/site, replacing what was there (as a host
//   deployment does), notes which CLI uploaded in <root>/<project>/cli, and
//   appends one JSON line per upload to <root>/<project>/uploads.log, and one
//   per call (before any failure) to <root>/<project>/attempts.log.
// - A small HTTP server (its own process, so a test blocked in spawnSync does
//   not block it) serves <root>/<project>/site at http://127.0.0.1:<port>/<project>,
//   with the response headers that host's own header file asks for: _headers
//   for Cloudflare Pages and Netlify, vercel.json for Vercel. It is a stand-in,
//   not the host: it shows that forge writes the header file each host reads.
// - <root>/<project>/mode makes the host misbehave:
//     fail-before    the upload fails and nothing is sent
//     fail-after     the files land, then the upload reports failure
//     stale          the files land, but the old /_forge/ marker keeps being served
//     readback-fail  the files land, but every /_forge/ request fails
//     cache:<value>  /_forge/ is served with Cache-Control: <value> instead of
//                    what the header file says (cache:none sends none), as a
//                    host that ignores the header file or a cache in front
//
// Usage: const host = await startFakeHost(); host.store() makes a store wired
// to it; host.env(store) is the env for bin/forge; host.stop() at the end
// (also done on exit).
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const h = require("./helpers.js");

const NPX = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const a = process.argv.slice(2);
const val = (flag) => (a.includes(flag) ? a[a.indexOf(flag) + 1] : undefined);
const need = (ok, why) => { if (!ok) { console.error("fake host: " + why); process.exit(1); } };
need(a[0] === "--yes", "npx needs --yes to run without a prompt");
const cli = String(a[1]).replace(/@latest$/, "");
const e = process.env;
let dir, project;
if (cli === "wrangler") {
  need(a[2] === "pages" && a[3] === "deploy", "wrangler pages deploy <dir>");
  dir = a[4];
  project = val("--project-name");
  need(e.CLOUDFLARE_API_TOKEN, "no token (CLOUDFLARE_API_TOKEN)");
  need(e.CLOUDFLARE_ACCOUNT_ID, "no CLOUDFLARE_ACCOUNT_ID");
} else if (cli === "vercel") {
  need(a[2] === "deploy", "vercel deploy <dir>");
  dir = a[3];
  project = e.VERCEL_PROJECT_ID;
  need(e.VERCEL_TOKEN, "no token (VERCEL_TOKEN)");
  need(e.VERCEL_ORG_ID && project, "VERCEL_ORG_ID and VERCEL_PROJECT_ID are both needed");
  need(a.includes("--prod") && a.includes("--yes"), "vercel deploy needs --prod and --yes");
} else if (cli === "netlify-cli") {
  need(a[2] === "deploy", "netlify deploy");
  dir = val("--dir");
  project = val("--site");
  need(e.NETLIFY_AUTH_TOKEN, "no token (NETLIFY_AUTH_TOKEN)");
  need(a.includes("--prod") && a.includes("--no-build"), "netlify deploy needs --prod and --no-build");
} else need(false, "unknown CLI " + a[1]);
need(dir && project, "no folder or project");
const home = path.join(process.env.FAKE_HOST_ROOT, project);
fs.mkdirSync(home, { recursive: true });
const mode = fs.existsSync(path.join(home, "mode")) ? fs.readFileSync(path.join(home, "mode"), "utf8").trim() : "";
const mfIn = path.join(dir, "_forge", "revision.json");
// Every call, before it can fail: which project was tried, with which marker.
fs.appendFileSync(path.join(home, "attempts.log"), JSON.stringify({ cli, marker: fs.existsSync(mfIn) ? JSON.parse(fs.readFileSync(mfIn, "utf8")) : null }) + "\\n");
if (mode === "fail-before") { console.error("fake host: upload failed before sending anything"); process.exit(1); }
const files = [];
const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + "/" + e.name : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else files.push(r); } };
walk(dir, "");
files.sort();
const site = path.join(home, "site");
const markerFile = path.join(site, "_forge", "revision.json");
const oldMarker = fs.existsSync(markerFile) ? fs.readFileSync(markerFile) : null;
fs.rmSync(site, { recursive: true, force: true });
fs.cpSync(dir, site, { recursive: true });
if (mode === "stale") {
  if (oldMarker) fs.writeFileSync(markerFile, oldMarker); else fs.rmSync(markerFile, { force: true });
}
const mf = path.join(dir, "_forge", "revision.json");
fs.writeFileSync(path.join(home, "cli"), cli);
fs.appendFileSync(path.join(home, "uploads.log"), JSON.stringify({ cli, args: a.slice(2), files, marker: fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, "utf8")) : null }) + "\\n");
console.error("fake host: uploaded " + files.length + " files to " + project);
if (mode === "fail-after") { console.error("fake host: upload reported failure after sending"); process.exit(1); }
`;

const SERVER = `
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const root = process.argv[1];
const s = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const [, project, ...rest] = u.pathname.split("/");
  const home = path.join(root, project || "-");
  const mode = fs.existsSync(path.join(home, "mode")) ? fs.readFileSync(path.join(home, "mode"), "utf8").trim() : "";
  if (mode === "readback-fail" && rest[0] === "_forge") { res.writeHead(503); return res.end("unavailable"); }
  let f = path.join(home, "site", ...rest.map(decodeURIComponent));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!f.startsWith(path.join(home, "site")) || !fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  const hs = headersFor(home, "/" + rest.join("/"));
  if (mode.startsWith("cache:") && rest[0] === "_forge") {
    delete hs["cache-control"];
    if (mode !== "cache:none") hs["cache-control"] = mode.slice(6);
  }
  res.writeHead(200, hs);
  res.end(fs.readFileSync(f));
});
// The headers the uploading CLI's host would add, from that host's header file.
// (Inside a template string: no backslashes here.) One splat per pattern, as
// Cloudflare Pages allows; Vercel's "(.*)" is read as that splat.
function matches(pat, p) {
  const i = pat.indexOf("*");
  if (i === -1) return pat === p;
  const pre = pat.slice(0, i);
  const post = pat.slice(i + 1);
  return p.startsWith(pre) && p.endsWith(post) && p.length >= pre.length + post.length;
}
function headersFor(home, p) {
  const out = {};
  const cli = fs.existsSync(path.join(home, "cli")) ? fs.readFileSync(path.join(home, "cli"), "utf8") : "";
  const add = (k, v) => { k = k.toLowerCase(); out[k] = out[k] ? out[k] + ", " + v : v; };
  if (cli === "wrangler" || cli === "netlify-cli") {
    const f = path.join(home, "site", "_headers");
    if (!fs.existsSync(f)) return out;
    let on = false;
    for (const line of fs.readFileSync(f, "utf8").split(String.fromCharCode(10))) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      if (line[0] !== " " && line[0] !== String.fromCharCode(9)) on = matches(line.trim(), p);
      else if (on) {
        const i = line.indexOf(":");
        add(line.slice(0, i).trim(), line.slice(i + 1).trim());
      }
    }
  } else if (cli === "vercel") {
    const f = path.join(home, "site", "vercel.json");
    if (!fs.existsSync(f)) return out;
    for (const rule of JSON.parse(fs.readFileSync(f, "utf8")).headers || []) {
      if (matches(rule.source.split("(.*)").join("*"), p)) for (const h of rule.headers) add(h.key, h.value);
    }
  }
  return out;
}
s.listen(0, "127.0.0.1", () => console.log(s.address().port));
`;

let n = 0;
async function startFakeHost() {
  const root = h.tmp("host");
  const bin = path.join(root, ".bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "npx"), NPX, { mode: 0o755 });
  const server = spawn(process.execPath, ["-e", SERVER, root], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((ok, bad) => {
    server.stdout.once("data", (d) => ok(Number(String(d).trim())));
    server.once("exit", (c) => bad(new Error("fake host server exited " + c)));
  });
  const stop = () => { try { server.kill("SIGKILL"); } catch { /* already gone */ } };
  process.on("exit", stop);
  const dirOf = (project) => path.join(root, project);
  const host = {
    root, port, stop,
    baseUrl: (project) => "http://127.0.0.1:" + port + "/" + project,
    // A store wired to its own project on this host, deployed through the
    // CLI of the given host kind (Cloudflare Pages unless named).
    store(kind = "cloudflare-pages") {
      const project = "p" + ++n;
      const hc = { kind, project, accountId: "test-account", tokenSecret: "FORGE_FAKE_HOST_TOKEN" };
      if (kind === "netlify") delete hc.accountId;
      const store = h.makeStore({ ...h.CONFIG, baseUrl: host.baseUrl(project), host: hc });
      return store;
    },
    // GET a path on a store's link site: { status, headers, body }.
    get(store, p) {
      const r = require("node:child_process").spawnSync(process.execPath, ["-e", "fetch(process.argv[1]).then(async (r) => process.stdout.write(JSON.stringify({ status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() })))", host.baseUrl(host.projectOf(store)) + p], { encoding: "utf8" });
      return JSON.parse(r.stdout);
    },
    projectOf: (store) => JSON.parse(fs.readFileSync(path.join(store, "config.json"), "utf8")).host.project,
    env: (extra = {}) => ({ FORGE_DEPLOY: "1", FORGE_FAKE_HOST_TOKEN: "fake", FAKE_HOST_ROOT: root, PATH: bin + path.delimiter + process.env.PATH, FORGE_READBACK_SECONDS: "2", ...extra }),
    mode(store, m) {
      const f = path.join(dirOf(host.projectOf(store)), "mode");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      if (m) fs.writeFileSync(f, m);
      else fs.rmSync(f, { force: true });
    },
    uploads(store) {
      return host.log(host.projectOf(store), "uploads");
    },
    // One project's log by name: "uploads" (files that landed) or "attempts"
    // (every call of the upload tool, before it could fail).
    log(project, which) {
      const f = path.join(dirOf(project), which + ".log");
      return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    },
    // What the link site serves right now (files under site/).
    live(store) {
      const site = path.join(dirOf(host.projectOf(store)), "site");
      return fs.existsSync(site) ? h.treeState(site) : {};
    },
    marker(store) {
      const f = path.join(dirOf(host.projectOf(store)), "site", "_forge", "revision.json");
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
    },
  };
  return host;
}

module.exports = { startFakeHost };
