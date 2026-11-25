// Runnable test: node test/core.test.js
// The publisher core, in-process, against the two trees (a new document is
// private, so it lands in private/).
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, makeStore, makeSrc, treeState } = require("./helpers.js");
const core = require("../lib/core.js");
const pages = require("../lib/pages.js");
const workspace = require("../lib/workspace.js");

function setup(html) {
  const store = makeStore();
  const ws = workspace.load(store);
  const src = makeSrc();
  const file = src.file("fixture-v2.html", html || "<html><head><title>Fixture Doc</title></head><body>one</body></html>");
  return { store, ws, src, file };
}
const priv = (ws, slug, ...rest) => path.join(ws.root, "private", "d", slug, ...rest);
const pub = (ws, slug, ...rest) => path.join(ws.root, "public", "d", slug, ...rest);
const TWO = "<html><head><title>Fixture Doc</title></head><body>two</body></html>";

(async () => {
  await check("deriveName strips extension and -vN suffix; folders use their name", () => {
    assert.strictEqual(core.deriveName("~/a/notes-v10.html"), "notes");
    assert.strictEqual(core.deriveName("~/a/plain.html"), "plain");
    assert.strictEqual(core.deriveName("~/a/deck-v3/"), "deck");
  });

  await check("newSlug is 12 URL-safe chars and random", () => {
    const a = core.newSlug();
    assert.match(a, /^[A-Za-z0-9_-]{12}$/);
    assert.notStrictEqual(a, core.newSlug());
  });

  await check("sources are stored with the home folder written as ~", () => {
    const os = require("node:os");
    assert.strictEqual(core.toSourceKey(path.join(os.homedir(), "x", "plan.html")), "~/x/plan.html");
    assert.strictEqual(core.fromSourceKey("~/x/plan.html"), path.join(os.homedir(), "x", "plan.html"));
    assert.strictEqual(core.toSourceKey("/srv/plan.html"), "/srv/plan.html");
  });

  await check("first publish: private, slug, v1, stable copy, manifest", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    assert.strictEqual(r.name, "fixture");
    assert.strictEqual(r.version, 1);
    assert.strictEqual(r.visibility, "private");
    const d = workspace.load(ws.root).manifest.deliverables.fixture;
    assert.strictEqual(d.slug, r.slug);
    assert.strictEqual(d.visibility, "private");
    assert.deepStrictEqual(d.versions.map((v) => v.n), [1]);
    assert.strictEqual(d.source, core.toSourceKey(file));
    const stable = fs.readFileSync(priv(ws, r.slug, "index.html"), "utf8");
    assert.strictEqual(stable, fs.readFileSync(priv(ws, r.slug, "v1", "index.html"), "utf8"));
    assert.ok(stable.includes("one"));
    assert.ok(!fs.existsSync(pub(ws, r.slug)), "nothing about it in public/");
    assert.deepStrictEqual(core.check(ws), []);
  });

  await check("identical republish is a no-op; changed content makes v2 and moves the stable copy", () => {
    const { ws, file } = setup();
    const r1 = core.publish(ws, file);
    assert.strictEqual(core.publish(ws, file).unchanged, true);
    fs.writeFileSync(file, TWO);
    const r2 = core.publish(ws, file);
    assert.strictEqual(r2.version, 2);
    assert.strictEqual(r2.slug, r1.slug, "slug is stable across versions");
    assert.ok(fs.readFileSync(priv(ws, r1.slug, "v1", "index.html"), "utf8").includes("one"), "v1 frozen");
    assert.ok(fs.readFileSync(priv(ws, r1.slug, "index.html"), "utf8").includes("two"), "stable is latest");
  });

  await check("--name override and missing source throws", () => {
    const { ws, file, src } = setup();
    assert.strictEqual(core.publish(ws, file, { name: "my-doc" }).name, "my-doc");
    assert.throws(() => core.publish(ws, path.join(src.dir, "nope.html")), /source not found: .*nope\.html/);
  });

  await check("htmlTitle reads the title tag with fallback", () => {
    assert.strictEqual(core.htmlTitle("<title> My Doc </title>", "x"), "My Doc");
    assert.strictEqual(core.htmlTitle("<html>no title</html>", "fallback-name"), "fallback-name");
    assert.strictEqual(core.htmlTitle("<title></title>", "fb"), "fb");
    assert.strictEqual(core.htmlTitle("<title>Acme &middot; Engine &amp; Co &#8217;26</title>", "x"), "Acme · Engine & Co ’26");
  });

  await check("history page lists every version of a private doc, in private/", () => {
    const { ws, file } = setup();
    const r1 = core.publish(ws, file);
    fs.writeFileSync(file, TWO);
    core.publish(ws, file);
    const page = fs.readFileSync(priv(ws, r1.slug, "versions", "index.html"), "utf8");
    assert.ok(page.includes("Fixture Doc"));
    assert.ok(page.includes('href="../v1/"') && page.includes('href="../v2/"'));
    assert.ok(page.includes("latest"));
  });

  await check("the public master index lists shared documents only", () => {
    const { ws, file, src } = setup();
    const a = core.publish(ws, file);
    const b = core.publish(ws, src.page("other.html", "Other Doc", "x"));
    let idx = fs.readFileSync(pub(ws, ws.manifest.indexSlug, "index.html"), "utf8");
    assert.ok(!idx.includes(a.slug) && !idx.includes("Fixture Doc"), "private doc not on the index");
    core.share(ws, "other", "");
    idx = fs.readFileSync(pub(ws, ws.manifest.indexSlug, "index.html"), "utf8");
    assert.ok(idx.includes("/d/" + b.slug + "/") && idx.includes("Other Doc"), "shared doc on the index");
    assert.ok(!idx.includes(a.slug), "still not the private one");
    assert.deepStrictEqual(core.check(ws), []);
  });

  await check("check names a missing version and a drifted stable copy", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    fs.writeFileSync(priv(ws, r.slug, "index.html"), "tampered");
    let p = core.check(ws);
    assert.deepStrictEqual(p, ["fixture: stable copy of index.html does not match latest version v1"]);
    fs.rmSync(priv(ws, r.slug, "v1", "index.html"));
    p = core.check(ws);
    assert.deepStrictEqual(p, ["fixture: version v1 missing: private/d/" + r.slug + "/v1/index.html"]);
  });

  await check("check catches orphan folders in either tree and orphan version folders", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    fs.mkdirSync(path.join(ws.root, "public", "d", "ghostSlug1234"), { recursive: true });
    fs.mkdirSync(path.join(ws.root, "private", "d", "ghostSlug5678"), { recursive: true });
    fs.mkdirSync(priv(ws, r.slug, "v9"));
    assert.deepStrictEqual(core.check(ws).sort(), [
      "fixture: orphan version folder with no manifest entry: private/d/" + r.slug + "/v9",
      "orphan folder with no manifest entry: private/d/ghostSlug5678",
      "orphan folder with no manifest entry: public/d/ghostSlug1234",
    ]);
  });

  await check("check ignores a stray file in d/ (Finder .DS_Store)", () => {
    const { ws, file } = setup();
    core.publish(ws, file);
    fs.writeFileSync(path.join(ws.root, "private", "d", ".DS_Store"), "junk");
    assert.deepStrictEqual(core.check(ws), []);
  });

  await check("a source missing on this machine is not a check failure, only information", () => {
    const { ws, file } = setup();
    core.publish(ws, file);
    fs.rmSync(file);
    assert.deepStrictEqual(core.check(ws), []);
    assert.deepStrictEqual(core.missingSources(ws), [{ name: "fixture", source: core.toSourceKey(file) }]);
  });

  await check("check: a doc in the wrong tree, and a slug in both trees, are named", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    fs.cpSync(priv(ws, r.slug), pub(ws, r.slug), { recursive: true });
    const p = core.check(ws);
    assert.ok(p.includes("fixture: is private but public/d/" + r.slug + "/index.html exists"), p.join("\n"));
    assert.ok(p.includes("fixture: v1 is in both trees"), p.join("\n"));
  });

  await check("share moves a private doc to public/ and records the share; history page keeps no note", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    const NOTE = "QX7-private-note-sent-before-the-renewal-call";
    const s = core.share(ws, "fixture", NOTE);
    assert.strictEqual(s.wasPrivate, true);
    assert.strictEqual(s.latestAtShare, 1);
    const d = workspace.load(ws.root).manifest.deliverables.fixture;
    assert.strictEqual(d.visibility, "shared");
    assert.strictEqual(d.shared[0].note, NOTE);
    assert.ok(!fs.existsSync(priv(ws, r.slug)), "nothing left in private/");
    const page = fs.readFileSync(pub(ws, r.slug, "versions", "index.html"), "utf8");
    assert.ok(!page.includes(NOTE), "share note absent");
    assert.ok(!page.includes("fixture-v2"), "no source file name");
    assert.ok(!page.includes(ws.manifest.indexSlug), "no index slug");
    const hrefs = [...page.matchAll(/href="([^"]*)"/g)].map((x) => x[1]).filter((h) => !h.startsWith("https://fonts."));
    assert.deepStrictEqual(hrefs.sort(), ["../", "../v1/"], "links only to its own document");
    // Sharing again only records.
    const again = core.share(ws, "fixture", "second");
    assert.strictEqual(again.wasPrivate, false);
    assert.deepStrictEqual(workspace.load(ws.root).manifest.deliverables.fixture.shared.map((x) => x.note), [NOTE, "second"]);
    assert.throws(() => core.share(ws, "nope", "x"), /unknown document: nope/);
  });

  await check("a new version of a shared doc is refused without live (nothing written); with live it stays shared and lands in public/", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    core.share(ws, "fixture", "");
    fs.writeFileSync(file, TWO);
    const before = treeState(ws.root);
    assert.throws(() => core.publish(ws, file), /fixture is SHARED at https:\/\/pub\.example\.org\/d\/[^/]+\/: this would put the file on the public site now/);
    assert.deepStrictEqual(treeState(ws.root), before, "nothing written");
    const r2 = core.publish(ws, file, { live: true });
    assert.strictEqual(r2.visibility, "shared");
    assert.ok(fs.readFileSync(pub(ws, r.slug, "v2", "index.html"), "utf8").includes("two"));
    assert.ok(fs.readFileSync(pub(ws, r.slug, "index.html"), "utf8").includes("two"));
  });

  await check("unshare one version: moves only it to private/, off the history page; latest refused", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    fs.writeFileSync(file, TWO);
    core.publish(ws, file);
    core.share(ws, "fixture", "");
    assert.throws(() => core.unshare(ws, "fixture", { version: 2 }), /v2 is the latest version of fixture[\s\S]*Publish a new version first, or take the whole document down/);
    core.unshare(ws, "fixture", { version: 1 });
    assert.ok(fs.existsSync(priv(ws, r.slug, "v1", "index.html")), "v1 now private");
    assert.ok(!fs.existsSync(pub(ws, r.slug, "v1")), "v1 gone from public");
    assert.ok(fs.existsSync(pub(ws, r.slug, "v2", "index.html")), "v2 still public");
    const page = fs.readFileSync(pub(ws, r.slug, "versions", "index.html"), "utf8");
    assert.ok(!page.includes('href="../v1/"') && page.includes('href="../v2/"'));
    const d = workspace.load(ws.root).manifest.deliverables.fixture;
    assert.match(d.versions[0].takenDown, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepStrictEqual(d.takedowns.map((t) => t.version), [1]);
    assert.deepStrictEqual(core.check(ws), []);
    // A goal already met changes nothing and says so (a re-run of an interrupted take-down finishes it).
    assert.deepStrictEqual(core.unshare(ws, "fixture", { version: 1 }), { name: "fixture", slug: r.slug, version: 1, before: "shared", already: true });
    assert.deepStrictEqual(workspace.load(ws.root).manifest.deliverables.fixture.takedowns.map((t) => t.version), [1], "no second take-down record");
    assert.throws(() => core.unshare(ws, "fixture", { version: 7 }), /has no version 7/);
  });

  await check("unshare the whole doc moves everything back; re-share keeps taken-down versions private", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    fs.writeFileSync(file, TWO);
    core.publish(ws, file);
    core.share(ws, "fixture", "");
    core.unshare(ws, "fixture", { version: 1 });
    core.unshare(ws, "fixture");
    assert.ok(!fs.existsSync(pub(ws, r.slug)), "nothing left in public/");
    assert.deepStrictEqual(fs.readdirSync(priv(ws, r.slug)).sort(), ["index.html", "v1", "v2", "versions"]);
    assert.deepStrictEqual(core.check(ws), []);
    const takedowns = workspace.load(ws.root).manifest.deliverables.fixture.takedowns.length;
    assert.strictEqual(core.unshare(ws, "fixture").already, true);
    assert.strictEqual(workspace.load(ws.root).manifest.deliverables.fixture.takedowns.length, takedowns, "no second take-down record");
    core.share(ws, "fixture", "again");
    assert.deepStrictEqual(fs.readdirSync(pub(ws, r.slug)).sort(), ["index.html", "v2", "versions"]);
    assert.deepStrictEqual(fs.readdirSync(priv(ws, r.slug)), ["v1"], "the taken-down v1 stayed private");
    assert.deepStrictEqual(core.check(ws), []);
    assert.deepStrictEqual(workspace.load(ws.root).manifest.deliverables.fixture.takedowns.map((t) => t.version), [1, "all"]);
  });

  await check("no --name republishes to the link its source already feeds; refuses when it feeds two", () => {
    const { ws, file } = setup();
    const first = core.publish(ws, file, { name: "custom-name" });
    fs.writeFileSync(file, TWO);
    const r = core.publish(ws, file);
    assert.strictEqual(r.name, "custom-name");
    assert.strictEqual(r.slug, first.slug);
    assert.deepStrictEqual(Object.keys(ws.manifest.deliverables), ["custom-name"]);
    core.publish(ws, file, { name: "b" });
    assert.throws(() => core.publish(ws, file), /feeds 2 links \(custom-name, b\); pass --name/);
  });

  await check("publish refuses to write a version folder that already exists (frozen stays frozen)", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    fs.mkdirSync(priv(ws, r.slug, "v2"));
    fs.writeFileSync(priv(ws, r.slug, "v2", "index.html"), "frozen bytes");
    fs.writeFileSync(file, TWO);
    assert.throws(() => core.publish(ws, file), /private\/d\/[^/]+\/v2 already exists; a frozen version is never rewritten/);
    assert.strictEqual(fs.readFileSync(priv(ws, r.slug, "v2", "index.html"), "utf8"), "frozen bytes");
  });

  await check("no --name: a different file with the same derived name is refused; a -vN sibling in the same folder continues the page", () => {
    const { ws, src, file } = setup(); // file is fixture-v2.html
    const r = core.publish(ws, file);
    const v3 = src.file("fixture-v3.html", TWO);
    assert.strictEqual(core.publish(ws, v3).slug, r.slug, "same folder -v3 continues fixture");
    const plain = src.file("fixture.html", "<html><head><title>Plain</title></head><body>p</body></html>");
    assert.strictEqual(core.publish(ws, plain).version, 3, "same folder, no suffix, recorded source is -v3: a sibling");
    const elsewhere = src.file("other/fixture-v4.html", TWO + "x");
    assert.throws(() => core.publish(ws, elsewhere), /the name fixture already belongs to a private page published from a different file: .*fixture\.html\nUsually this is a new page: publish it with --name '<new-name>', and tell the owner a new private page was made, not an update of fixture:\n {2}forge publish '.*' --name '<new-name>'\nOnly if the owner wants this file to REPLACE that page, ask the owner, even if the request named that page \(that is not a yes to replacing it with a different file\): "fixture is a private page made from .*fixture\.html; replace it with .*other\/fixture-v4\.html\?" On yes:\n {2}forge publish '.*' --name 'fixture'\n/);
    const folder = path.join(src.dir, "deck");
    src.page("deck/index.html", "Deck", "a");
    core.publish(ws, folder);
    src.page("b/deck/index.html", "Deck B", "b");
    assert.throws(() => core.publish(ws, path.join(src.dir, "b", "deck")), /the name deck already belongs/);
    assert.deepStrictEqual(ws.manifest.deliverables.fixture.versions.map((v) => v.n), [1, 2, 3]);
  });

  await check("folder: copies files, stamps only index.html, one changed image is a new version", () => {
    const { ws, src } = setup();
    const dir = path.join(src.dir, "deck");
    src.page("deck/index.html", "Deck", '<img src="img/a.png">');
    src.file("deck/img/a.png", "PNG-1");
    src.file("deck/notes.html", "<html><body>notes</body></html>");
    src.file("deck/.secret", "dotfile");
    src.file("deck/.git/config", "dotfolder");
    const r1 = core.publish(ws, dir);
    assert.strictEqual(r1.name, "deck");
    for (const t of [priv(ws, r1.slug), priv(ws, r1.slug, "v1")]) {
      assert.deepStrictEqual(core.listFiles(t, { skipTop: (n) => n === "versions" || /^v\d+$/.test(n) }), ["img/a.png", "index.html", "notes.html"]);
      assert.strictEqual(fs.readFileSync(path.join(t, "img", "a.png"), "utf8"), "PNG-1");
      assert.ok(fs.readFileSync(path.join(t, "index.html"), "utf8").includes('id="forge-dark-toggle"'), "index stamped");
      assert.strictEqual(fs.readFileSync(path.join(t, "notes.html"), "utf8"), "<html><body>notes</body></html>", "other html untouched");
    }
    assert.strictEqual(core.publish(ws, dir).unchanged, true, "unchanged folder is a no-op");
    src.file("deck/img/a.png", "PNG-2");
    const r2 = core.publish(ws, dir);
    assert.strictEqual(r2.version, 2);
    assert.strictEqual(fs.readFileSync(priv(ws, r1.slug, "v1", "img", "a.png"), "utf8"), "PNG-1", "v1 frozen");
    assert.strictEqual(fs.readFileSync(priv(ws, r1.slug, "img", "a.png"), "utf8"), "PNG-2", "stable is latest");
    fs.rmSync(path.join(dir, "notes.html"));
    core.publish(ws, dir);
    assert.ok(!fs.existsSync(priv(ws, r1.slug, "notes.html")), "a dropped file drops off the stable link");
    assert.ok(fs.existsSync(priv(ws, r1.slug, "v2", "notes.html")), "and stays in its frozen version");
    assert.deepStrictEqual(core.check(ws), []);
  });

  await check("a hand-placed file in a stable folder is named unless import recorded it; a recorded one survives a republish", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    core.share(ws, "fixture", "");
    fs.writeFileSync(pub(ws, r.slug, "preview.jpg"), "JPEG");
    assert.deepStrictEqual(core.check(ws), ["fixture: stable copy has a file that is in no version and was not recorded at import: preview.jpg; it is not in latest version v1"]);
    ws.manifest.deliverables.fixture.stableExtras = ["preview.jpg"];
    assert.deepStrictEqual(core.check(ws), [], "recorded at import: allowed, as the imported site had it");
    fs.writeFileSync(file, TWO);
    core.publish(ws, file, { live: true });
    assert.strictEqual(fs.readFileSync(pub(ws, r.slug, "preview.jpg"), "utf8"), "JPEG", "kept across the republish");
    assert.ok(fs.readFileSync(pub(ws, r.slug, "index.html"), "utf8").includes("two"));
    assert.deepStrictEqual(core.check(ws), []);
    fs.writeFileSync(pub(ws, r.slug, "v2", "extra.txt"), "x");
    assert.deepStrictEqual(core.check(ws), ["fixture: stable copy is missing extra.txt from latest version v2"]);
  });

  await check("folder refusals: no index.html, a top-level v1 folder; the store is untouched", () => {
    const { ws, src } = setup();
    src.file("noindex/page.html", "x");
    assert.throws(() => core.publish(ws, path.join(src.dir, "noindex")), /needs index\.html at its top/);
    src.page("clash/index.html", "Clash", "x");
    src.file("clash/v1/a.png", "x");
    assert.throws(() => core.publish(ws, path.join(src.dir, "clash")), /"v1" would collide/);
    assert.deepStrictEqual(ws.manifest.deliverables, {});
    assert.ok(!fs.existsSync(path.join(ws.root, "private", "d")));
  });

  await check("the Markdown export's frozen link is always the public address, even for a private doc", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    const v1 = fs.readFileSync(priv(ws, r.slug, "v1", "index.html"), "utf8");
    assert.ok(v1.includes('data-url="https://pub.example.org/d/' + r.slug + '/v1/"'), "public frozen url");
    assert.ok(!v1.includes("127.0.0.1"), "no private-base address in the page");
  });

  await check("hash trap: unchanged republish on a later day is a no-op; a change bumps exactly once", () => {
    const { ws, file } = setup();
    const r1 = core.publish(ws, file);
    const v1Before = fs.readFileSync(priv(ws, r1.slug, "v1", "index.html"));
    const realIso = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2099-01-02T00:00:00.000Z";
    try {
      assert.strictEqual(core.publish(ws, file).unchanged, true, "a new day alone is not a new version");
      fs.writeFileSync(file, TWO);
      assert.strictEqual(core.publish(ws, file).version, 2);
      assert.strictEqual(core.publish(ws, file).unchanged, true, "and only once");
    } finally {
      Date.prototype.toISOString = realIso;
    }
    assert.deepStrictEqual(ws.manifest.deliverables.fixture.versions.map((v) => [v.n, v.date.slice(0, 4)]), [[1, realIso.call(new Date()).slice(0, 4)], [2, "2099"]]);
    assert.ok(v1Before.equals(fs.readFileSync(priv(ws, r1.slug, "v1", "index.html"))), "v1 bytes untouched");
  });

  await check("a single file's hash is of the stamped page with empty export metadata", () => {
    const { ws, file } = setup();
    core.publish(ws, file);
    const old = require("node:crypto").createHash("sha256")
      .update(pages.injectMarkdownExport(pages.injectDarkToggle(fs.readFileSync(file, "utf8")), null)).digest("hex");
    assert.strictEqual(ws.manifest.deliverables.fixture.versions[0].sha256, old);
  });

  await check("regenerate adds no version and leaves versions byte-identical", () => {
    const { ws, file } = setup();
    const r = core.publish(ws, file);
    core.share(ws, "fixture", "");
    const before = fs.readFileSync(pub(ws, r.slug, "v1", "index.html"));
    const manifestBefore = fs.readFileSync(path.join(ws.root, "manifest.json"), "utf8");
    fs.rmSync(pub(ws, r.slug, "versions", "index.html"));
    const written = core.regenerate(ws);
    assert.deepStrictEqual(written.sort(), ["public/d/" + ws.manifest.indexSlug + "/index.html", "public/d/" + r.slug + "/versions/index.html"].sort());
    assert.ok(before.equals(fs.readFileSync(pub(ws, r.slug, "v1", "index.html"))));
    assert.strictEqual(fs.readFileSync(path.join(ws.root, "manifest.json"), "utf8"), manifestBefore, "manifest untouched");
    assert.throws(() => core.regenerate(workspace.load(makeStore())), /nothing published yet/);
  });

  await check("privacy check: a public page carrying a private doc's slug or title is named", () => {
    const { ws, file, src } = setup();
    const secret = core.publish(ws, src.page("secret.html", "Secret Plan &amp; Budget", "x"));
    core.publish(ws, file);
    core.share(ws, "fixture", "");
    assert.deepStrictEqual(core.check(ws), []);
    const stable = pub(ws, ws.manifest.deliverables.fixture.slug, "index.html");
    const orig = fs.readFileSync(stable, "utf8");
    fs.writeFileSync(stable, orig.replace("one", "see /d/" + secret.slug + "/"));
    fs.writeFileSync(pub(ws, ws.manifest.deliverables.fixture.slug, "v1", "index.html"), fs.readFileSync(stable));
    assert.deepStrictEqual(core.check(ws), [
      "privacy: public/d/" + ws.manifest.deliverables.fixture.slug + "/index.html contains the slug of private document secret",
      "privacy: public/d/" + ws.manifest.deliverables.fixture.slug + "/v1/index.html contains the slug of private document secret",
    ]);
    for (const f of [stable, pub(ws, ws.manifest.deliverables.fixture.slug, "v1", "index.html")]) fs.writeFileSync(f, orig.replace("one", "<h1>Secret Plan &amp; Budget</h1>"));
    assert.strictEqual(core.check(ws).filter((p) => p.includes("has the title of private document secret")).length, 2, core.check(ws).join("\n"));
  });

  await check("privacy check skips a private title that a shared doc already shows (clean copy under a new name)", () => {
    const { ws, file } = setup();
    core.publish(ws, file, { name: "old" });
    core.share(ws, "old", "");
    fs.writeFileSync(file, TWO);
    core.publish(ws, file, { name: "clean-copy" });
    assert.deepStrictEqual(core.check(ws), []);
  });

  await check("privacy check: a private title counts only as a public page's whole <title> or first <h1>; a short title counts", () => {
    const { ws, src, file } = setup();
    const r = core.publish(ws, src.page("x.html", "X", "x"));
    assert.deepStrictEqual(core.check(ws), [], "X-Robots-Tag in public/_headers is not a leak (not HTML)");
    fs.appendFileSync(path.join(ws.root, "public", "_headers"), "# /d/" + r.slug + "/\n");
    assert.deepStrictEqual(core.check(ws), ["privacy: public/_headers contains the slug of private document x"]);
    fs.writeFileSync(path.join(ws.root, "public", "_headers"), fs.readFileSync(path.join(ws.root, "public", "_headers"), "utf8").replace("# /d/" + r.slug + "/\n", ""));
    core.publish(ws, src.page("budget.html", "Budget", "the private numbers"));
    const shared = core.publish(ws, file);
    core.share(ws, "fixture", "");
    assert.deepStrictEqual(core.check(ws), []);
    const stable = pub(ws, shared.slug, "index.html");
    const orig = fs.readFileSync(stable, "utf8");
    const put = (s) => { for (const f of [stable, pub(ws, shared.slug, "v1", "index.html")]) fs.writeFileSync(f, s); };
    const named = ["index.html", "v1/index.html"].map((f) => "privacy: public/d/" + shared.slug + "/" + f + " has the title of private document budget");
    const found = () => core.check(ws).map((p) => p.split(" (if")[0]);
    // the word in body text, a longer title, a later <h1>: not the page's title
    put(orig.replace("one", "<h2>Budget</h2><p>the <b>Budget</b> is attached</p>").replace("<title>Fixture Doc</title>", "<title>Budget for the offsite</title>"));
    assert.deepStrictEqual(core.check(ws), [], "a shared page mentioning a short private title in its text passes");
    put(orig.replace("one", "<h1>Team offsite</h1><h1>Budget</h1>"));
    assert.deepStrictEqual(core.check(ws), [], "only the first <h1> is the page's heading");
    // the first <h1>, ignoring case and spacing, with tags inside it; an <h1>
    // in a script or a comment is not the page's
    put(orig.replace("one", "<h1>\n  BUDGET </h1>"));
    assert.deepStrictEqual(found(), named);
    put(orig.replace("one", '<script>var s = "<h1>x</h1>";</script><!-- <h1>Old</h1> --><h1 class="t"><b>Budget</b></h1>'));
    assert.deepStrictEqual(found(), named);
    put(orig);
    // the whole <title> of another page in a shared folder (the shared
    // document's own title is skipped: that is a title it uses itself)
    src.page("deck/index.html", "Offsite Deck", "x");
    src.page("deck/notes.html", "\n  BUDGET ", "notes");
    const deck = core.publish(ws, path.join(src.dir, "deck"));
    core.share(ws, "deck", "");
    assert.deepStrictEqual(found(), ["notes.html", "v1/notes.html"].map((f) => "privacy: public/d/" + deck.slug + "/" + f + " has the title of private document budget"));
  });

  await check("privacy check: a private page's pages copied into a shared page are named, even under a shared title", () => {
    const { ws, src } = setup();
    // A private folder page with a second page and a logo, and a private
    // single page whose title a shared page also uses (so the title check is
    // skipped for it).
    src.page("secret/index.html", "Secret Deck", "x");
    src.page("secret/notes.html", "Speaker notes", "the private notes");
    src.file("secret/logo.png", "HOUSE-LOGO-BYTES");
    core.publish(ws, path.join(src.dir, "secret"));
    const budgetSrc = src.page("budget.html", "Quarterly Budget", "the private numbers");
    core.publish(ws, budgetSrc);
    src.page("pubdeck/index.html", "Quarterly Budget", "public deck");
    src.file("pubdeck/logo.png", "HOUSE-LOGO-BYTES");
    core.publish(ws, path.join(src.dir, "pubdeck"));
    core.share(ws, "pubdeck", "");
    assert.deepStrictEqual(core.check(ws), [], "a logo used by a private and a shared page is not a leak");
    fs.copyFileSync(path.join(src.dir, "secret", "notes.html"), path.join(src.dir, "pubdeck", "notes.html"));
    fs.copyFileSync(budgetSrc, path.join(src.dir, "pubdeck", "budget-copy.html"));
    const v2 = core.publish(ws, path.join(src.dir, "pubdeck"), { live: true });
    const at = "public/d/" + v2.slug + "/";
    assert.deepStrictEqual(core.check(ws).sort(), [
      "privacy: " + at + "budget-copy.html is a copy of the source of private document budget",
      "privacy: " + at + "notes.html is a byte-for-byte copy of a page of private document secret",
      "privacy: " + at + "v2/budget-copy.html is a copy of the source of private document budget",
      "privacy: " + at + "v2/notes.html is a byte-for-byte copy of a page of private document secret",
    ]);
  });

  await check("generated pages carry the workspace brand, and the engine names none", () => {
    const { ws, file } = setup();
    core.publish(ws, file);
    core.share(ws, "fixture", "");
    const idx = fs.readFileSync(pub(ws, ws.manifest.indexSlug, "index.html"), "utf8");
    assert.ok(idx.includes("Acme &middot; Internal") && idx.includes('<p class="mark">Acme</p>'));
    const p = pages.displayTitle("Acme · Mike page", { name: "Acme" });
    assert.strictEqual(p, "Mike page");
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
