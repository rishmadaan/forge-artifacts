// Runnable test: node test/import.test.js
// forge import: an existing site of the same layout (a site tree plus a manifest
// with sources relative to one folder) moves into an empty store, byte for byte.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { HOME, check, done, tmp, run, git, makeStore, makeSrc, manifest, treeState } = require("./helpers.js");

// An old-shaped publisher state: two documents, one with a recorded share and
// a version taken down the old way (removed), plus the master index.
function oldPublisher(baseUrl = "https://pub.example.org") {
  const dir = tmp("old");
  const site = path.join(dir, "site");
  const w = (rel, s) => {
    fs.mkdirSync(path.dirname(path.join(site, rel)), { recursive: true });
    fs.writeFileSync(path.join(site, rel), s);
  };
  const tpl = path.join(__dirname, "..", "workspace-template", "public");
  for (const f of ["_headers", "index.html", "404.html"]) w(f, fs.readFileSync(path.join(tpl, f)));
  w("d/AAAAAAAAAAAA/index.html", "<html><head><title>Old One</title></head><body>v2</body></html>");
  w("d/AAAAAAAAAAAA/v1/index.html", "<html><head><title>Old One</title></head><body>v1</body></html>");
  w("d/AAAAAAAAAAAA/v2/index.html", "<html><head><title>Old One</title></head><body>v2</body></html>");
  w("d/AAAAAAAAAAAA/versions/index.html", "history");
  w("d/BBBBBBBBBBBB/index.html", "<html><head><title>Old Two</title></head><body>v3</body></html>");
  w("d/BBBBBBBBBBBB/v3/index.html", "<html><head><title>Old Two</title></head><body>v3</body></html>");
  w("d/BBBBBBBBBBBB/versions/index.html", "history");
  w("d/IIIIIIIIIIII/index.html", "index");
  const man = path.join(dir, "publish-manifest.json");
  fs.writeFileSync(man, JSON.stringify({
    indexSlug: "IIIIIIIIIIII",
    baseUrl,
    deliverables: {
      one: { slug: "AAAAAAAAAAAA", source: "outputs/one-v2.html", versions: [
        { n: 1, date: "2026-07-21", source: "outputs/one.html", sha256: "h1" },
        { n: 2, date: "2026-07-22", source: "outputs/one-v2.html", sha256: "h2" }],
      shared: [{ date: "2026-07-21", note: "sent", latestAtShare: 1 }] },
      two: { slug: "BBBBBBBBBBBB", source: "outputs/two.html", versions: [{ n: 3, date: "2026-10-30", source: "outputs/two.html", sha256: "h3" }], shared: [] },
    },
  }, null, 2));
  return { dir, site, man };
}

(async () => {
  await check("import copies the site byte for byte, makes every document shared, writes sources with ~", () => {
    const store = makeStore();
    const old = oldPublisher();
    const oldBefore = treeState(old.dir);
    const srcRoot = path.join(HOME, "some", "repo"); // the test-owned home bin/forge runs with; never created: import only resolves paths
    const r = run(store, ["import", old.site, old.man, "--source-root", srcRoot]);
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^imported 2 documents, 3 versions, 11 files; public\/ is byte-identical to /);
    assert.deepStrictEqual(treeState(path.join(store, "public")), treeState(old.site), "public/ is the old site, byte for byte");
    assert.deepStrictEqual(treeState(old.dir), oldBefore, "the old site and manifest were only read");
    const m = manifest(store);
    assert.strictEqual(m.indexSlug, "IIIIIIIIIIII");
    assert.deepStrictEqual(Object.keys(m), ["indexSlug", "deliverables"], "baseUrl lives in config.json only");
    assert.deepStrictEqual(m.deliverables.one, {
      slug: "AAAAAAAAAAAA", source: "~/some/repo/outputs/one-v2.html", visibility: "shared",
      versions: [
        { n: 1, date: "2026-07-21", source: "~/some/repo/outputs/one.html", sha256: "h1" },
        { n: 2, date: "2026-07-22", source: "~/some/repo/outputs/one-v2.html", sha256: "h2" }],
      shared: [{ date: "2026-07-21", note: "sent", latestAtShare: 1 }], takedowns: [],
    });
    assert.deepStrictEqual(m.deliverables.two.versions.map((v) => v.n), [3], "a version removed the old way stays absent");
    assert.strictEqual(run(store, ["check"]).out, "dry run (FORGE_DEPLOY=0): the link site was not read\nforge check OK\n");
    assert.strictEqual(git(store, ["log", "-1", "--format=%s"]), "import: 2 documents, 3 versions, 11 files");
  });

  await check("after import, a republish of an unchanged source is a no-op (same hash rule)", () => {
    const store = makeStore();
    const src = makeSrc();
    const p = src.page("one.html", "Old One", "v2");
    const old = oldPublisher();
    // Give "one" the hash this engine computes for this source (the old
    // publisher's rule; real imported hashes differ by one converter comment).
    const pages = require("../lib/pages.js");
    const hash = require("node:crypto").createHash("sha256").update(pages.injectMarkdownExport(pages.injectDarkToggle(fs.readFileSync(p, "utf8")), null)).digest("hex");
    const m = JSON.parse(fs.readFileSync(old.man, "utf8"));
    m.deliverables.one.source = "one.html";
    m.deliverables.one.versions[1].sha256 = hash;
    fs.writeFileSync(old.man, JSON.stringify(m));
    assert.strictEqual(run(store, ["import", old.site, old.man, "--source-root", src.dir]).status, 0);
    const r = run(store, ["publish", p]);
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^unchanged one is already at v2 \(shared\), nothing published/);
  });

  await check("import records a file hand-placed in a stable folder; check then names any other", () => {
    const store = makeStore();
    const old = oldPublisher();
    fs.writeFileSync(path.join(old.site, "d", "BBBBBBBBBBBB", "preview.jpg"), "JPEG");
    const r = run(store, ["import", old.site, old.man, "--source-root", tmp("src")]);
    assert.strictEqual(r.status, 0, r.all);
    const m = manifest(store);
    assert.deepStrictEqual([m.deliverables.one.stableExtras, m.deliverables.two.stableExtras], [undefined, ["preview.jpg"]]);
    assert.strictEqual(run(store, ["check"]).out, "dry run (FORGE_DEPLOY=0): the link site was not read\nforge check OK\n");
    fs.writeFileSync(path.join(store, "public", "d", "BBBBBBBBBBBB", "other.jpg"), "JPEG2");
    const c = run(store, ["check"]);
    assert.strictEqual(c.status, 1);
    assert.match(c.err, /two: stable copy has a file that is in no version and was not recorded at import: other\.jpg/);
  });

  await check("import refuses a store that already has documents, and changes nothing", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("x.html", "X", "x");
    run(store, ["publish", "x.html"], { cwd: src.dir });
    const before = treeState(store);
    const old = oldPublisher();
    const r = run(store, ["import", old.site, old.man, "--source-root", old.dir]);
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /import needs an empty store/);
    assert.deepStrictEqual(treeState(store), before);
  });

  await check("import refuses when the old address differs from config.json baseUrl", () => {
    const store = makeStore();
    const before = treeState(store);
    const old = oldPublisher("https://old.example.org");
    const r = run(store, ["import", old.site, old.man, "--source-root", old.dir]);
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /old manifest's baseUrl is https:\/\/old\.example\.org but config\.json says https:\/\/pub\.example\.org/);
    assert.deepStrictEqual(treeState(store), before);
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
