// Runnable test: node test/workspace.test.js
// The loader stops loudly on a missing or invalid store file, naming the
// problem, and never falls back to a default. Driven through bin/forge (the
// real path every command takes) and checked for which problem it names.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { check, done, tmp, run, git, env, makeStore, CONFIG, FORGE } = require("./helpers.js");

function edit(store, file, fn) {
  const p = path.join(store, file);
  fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8")));
}
function expectRefused(store, problem) {
  const r = run(store, ["list"]);
  assert.strictEqual(r.status, 1, "list should refuse: " + r.all);
  assert.match(r.err, /^store .* is not usable:/);
  assert.ok(r.err.includes(problem), "names the problem " + JSON.stringify(problem) + ", got:\n" + r.err);
  assert.strictEqual(r.out, "", "printed nothing as if it worked");
}

(async () => {
  await check("a healthy store loads", () => {
    const r = run(makeStore(), ["list"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(r.out, "nothing published yet\nlink site: not known (no live read on this machine); run: forge list --live\n");
  });

  await check("loads: version gaps, and a wordmark file inside the store", () => {
    const s = makeStore();
    fs.writeFileSync(path.join(s, "mark.svg"), "<svg></svg>");
    edit(s, "config.json", (t) => JSON.stringify({ ...JSON.parse(t), brand: { ...CONFIG.brand, wordmarkFile: "mark.svg" } }));
    fs.writeFileSync(path.join(s, "manifest.json"), JSON.stringify({ indexSlug: null, deliverables: { a: { slug: "abcdefghijkl", source: "~/a.html", visibility: "private", versions: [1, 3, 7].map((n) => ({ n, date: "2026-01-01", sha256: "x" })), shared: [], takedowns: [] } } }));
    assert.strictEqual(require("../lib/workspace.js").load(s).brand.wordmarkSvg, "<svg></svg>");
  });

  await check("no store at all: says how to create one", () => {
    const r = run(path.join(tmp("none"), "nope"), ["list"]);
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /^no store at .*nope \(from FORGE_WORKSPACE\)\n  make one there: +forge init .*nope\n  or use a store that exists: +forge store <path>/);
  });

  await check("a fresh forge init store loads as it is (private-only); a CHANGE-ME value someone writes still refuses", () => {
    const store = path.join(tmp("init"), "store");
    assert.strictEqual(run(store, ["init", store]).status, 0);
    const r = run(store, ["list"]);
    assert.strictEqual(r.status, 0, r.all);
    edit(store, "config.json", (t) => JSON.stringify({ ...JSON.parse(t), brand: { ...JSON.parse(t).brand, name: "CHANGE-ME" } }));
    expectRefused(store, "config.json still has CHANGE-ME placeholders");
  });

  const cases = [
    ["missing manifest.json", (s) => fs.rmSync(path.join(s, "manifest.json")), "missing file: manifest.json"],
    ["manifest.json not JSON", (s) => fs.writeFileSync(path.join(s, "manifest.json"), "{ nope"), "manifest.json is not valid JSON"],
    ["manifest.json without deliverables", (s) => fs.writeFileSync(path.join(s, "manifest.json"), '{"indexSlug":null}'), "manifest.json: deliverables must be an object"],
    ["a document with a bad visibility", (s) => fs.writeFileSync(path.join(s, "manifest.json"), JSON.stringify({ indexSlug: null, deliverables: { a: { slug: "abcdefghijkl", source: "~/a.html", visibility: "public", versions: [{ n: 1, date: "2026-01-01", sha256: "x" }], shared: [], takedowns: [] } } })), 'manifest.json: a: visibility must be "private" or "shared"'],
    ...[["versions out of order", [1, 3, 2]], ["a repeated version", [1, 1]], ["a version 0", [0, 1]]].map(([what, ns]) => [what, (s) => fs.writeFileSync(path.join(s, "manifest.json"), JSON.stringify({ indexSlug: null, deliverables: { a: { slug: "abcdefghijkl", source: "~/a.html", visibility: "private", versions: ns.map((n) => ({ n, date: "2026-01-01", sha256: "x" })), shared: [], takedowns: [] } } })), "manifest.json: a: version numbers must be positive and increasing"]),
    ["an indexSlug that is a path", (s) => fs.writeFileSync(path.join(s, "manifest.json"), JSON.stringify({ indexSlug: "../../elsewhere", deliverables: {} })), "manifest.json: indexSlug must be 12 URL-safe characters, or null"],
    ["a wordmark file outside the store", (s) => { fs.writeFileSync(path.join(s, "..", "outside.svg"), "<svg></svg>"); edit(s, "config.json", (t) => JSON.stringify({ ...JSON.parse(t), brand: { ...CONFIG.brand, wordmarkFile: "../outside.svg" } })); }, "config.json: brand.wordmarkFile must be inside the store (symlinks followed): ../outside.svg"],
    ["a wordmark symlink that points outside the store", (s) => { fs.writeFileSync(path.join(s, "..", "outside.svg"), "<svg></svg>"); fs.symlinkSync(path.join(s, "..", "outside.svg"), path.join(s, "mark.svg")); edit(s, "config.json", (t) => JSON.stringify({ ...JSON.parse(t), brand: { ...CONFIG.brand, wordmarkFile: "mark.svg" } })); }, "config.json: brand.wordmarkFile must be inside the store (symlinks followed): mark.svg"],
    ["missing config.json", (s) => fs.rmSync(path.join(s, "config.json")), "missing file: config.json"],
    ["config.json not JSON", (s) => fs.writeFileSync(path.join(s, "config.json"), "nope"), "config.json is not valid JSON"],
    ["config.json without baseUrl", (s) => edit(s, "config.json", (t) => JSON.stringify({ ...JSON.parse(t), baseUrl: undefined })), "config.json: baseUrl and host are set together (forge host sets both), or neither for a private-only store"],
    ["baseUrl with a trailing slash", (s) => edit(s, "config.json", (t) => JSON.stringify({ ...JSON.parse(t), baseUrl: "https://x.example.org/" })), "config.json: baseUrl must be an http(s) address with no trailing slash"],
    ["host without tokenSecret", (s) => edit(s, "config.json", (t) => JSON.stringify({ ...JSON.parse(t), host: { ...CONFIG.host, tokenSecret: "" } })), "config.json: host.tokenSecret is required"],
    ["an unknown host kind", (s) => edit(s, "config.json", (t) => JSON.stringify({ ...JSON.parse(t), host: { ...CONFIG.host, kind: "github-pages" } })), 'config.json: host.kind must be one of "cloudflare-pages", "vercel", "netlify"'],
    ["a wordmark file that is not there", (s) => edit(s, "config.json", (t) => JSON.stringify({ ...JSON.parse(t), brand: { ...CONFIG.brand, wordmarkFile: "brand/mark.svg" } })), "config.json: brand.wordmarkFile not found in the store: brand/mark.svg"],
    ["no brand", (s) => edit(s, "config.json", (t) => JSON.stringify({ ...JSON.parse(t), brand: undefined })), "config.json: brand is required"],
    ["missing TEMPLATE_VERSION", (s) => fs.rmSync(path.join(s, "TEMPLATE_VERSION")), "missing file: TEMPLATE_VERSION"],
    ["a TEMPLATE_VERSION this engine does not read", (s) => fs.writeFileSync(path.join(s, "TEMPLATE_VERSION"), "2\n"), 'TEMPLATE_VERSION is "2"; this engine reads version 1'],
    ["missing public/", (s) => fs.rmSync(path.join(s, "public"), { recursive: true }), "missing folder: public"],
    ["missing private/", (s) => fs.rmSync(path.join(s, "private"), { recursive: true }), "missing folder: private"],
    ["missing public/_headers", (s) => fs.rmSync(path.join(s, "public", "_headers")), "missing file: public/_headers"],
    ["not a git repo", (s) => fs.rmSync(path.join(s, ".git"), { recursive: true }), "missing folder: .git (the store must be its own git repo)"],
  ];
  for (const [what, breakIt, problem] of cases) {
    await check("refused, naming it: " + what, () => {
      const store = makeStore();
      breakIt(store);
      expectRefused(store, problem);
    });
  }

  await check("init refuses a folder that exists and is not empty, and leaves it alone", () => {
    const dir = tmp("full");
    fs.writeFileSync(path.join(dir, "keep.txt"), "mine");
    const r = run(dir, ["init", dir]);
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /refusing: .* exists and is not empty/);
    assert.deepStrictEqual(fs.readdirSync(dir), ["keep.txt"]);
  });

  await check("init with no git identity refuses before writing anything and prints the two git config lines", () => {
    const parent = tmp("noident");
    const store = path.join(parent, "pages", "store");
    // No identity from the environment, and git may not guess one from the host name.
    const e = { ...env(store), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.useConfigOnly", GIT_CONFIG_VALUE_0: "true" };
    for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "FORGE_WORKSPACE"]) delete e[k];
    const r = spawnSync(process.execPath, [FORGE, "init", store], { cwd: parent, env: e, encoding: "utf8" });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.includes('git config --global user.name "Your Name"') && r.stderr.includes('git config --global user.email "you@example.com"'), r.stderr);
    assert.match(r.stderr, /^refusing: git does not know your name and email, and every change to the store is a git commit, so nothing was created/, "forge's own refusal, before git is asked to commit");
    assert.ok(!/failed while making the store/.test(r.stderr), "no commit was attempted: " + r.stderr);
    assert.deepStrictEqual(fs.readdirSync(parent), [], "nothing made, not even the parent folder");
    assert.ok(!fs.existsSync(path.join(e.XDG_CONFIG_HOME, "forge")), "no setting recorded");
  });

  await check("init that fails part way leaves nothing behind, so the same init can run again", () => {
    const parent = tmp("initfail");
    const store = path.join(parent, "store");
    const r = run(store, ["init", store], { env: { FORGE_TEST_THROW: "init" } });
    assert.strictEqual(r.status, 1, r.all);
    assert.deepStrictEqual(fs.readdirSync(parent), [], "no store and no temporary folder");
    const again = run(store, ["init", store]);
    assert.strictEqual(again.status, 0, again.all);
  });

  await check("init makes a git store from the template with one commit, on branch main", () => {
    const store = path.join(tmp("init"), "store");
    const r = run(store, ["init", store]);
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(git(store, ["symbolic-ref", "--short", "HEAD"]), "main");
    assert.strictEqual(git(store, ["log", "--format=%s"]), "init: store from template v1");
    assert.deepStrictEqual(git(store, ["ls-files"]).split("\n").sort(), [
      ".gitignore", "README.md", "TEMPLATE_VERSION", "config.example.json", "config.json", "manifest.json",
      "private/.gitkeep", "public/404.html", "public/_headers", "public/index.html", "schema.md",
    ]);
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
