// Runnable test: node test/private-start.test.js
// A private-only start: forge init makes a store that works at once for
// private pages, with no host, no public address and no brand to fill in.
// publish, list, open's link, rename and check work and read no link site.
// share, unshare and deploy refuse until a host is set, naming the step.
// forge host writes the host block and the public address through the normal
// write path, deploys and reads the link site back; then sharing works.
// forge list --json of a private-only store carries the documented values.
// The default look is neutral and makes no outside request; brand.accent and
// brand.fontStylesheet give a store its own.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, run, git, tmp, makeSrc, manifest, treeState, ENGINE } = require("./helpers.js");
const { startFakeHost } = require("./fakehost.js");

const fresh = () => {
  const store = path.join(tmp("fresh"), "store");
  const r = run(store, ["init", store]);
  assert.strictEqual(r.status, 0, r.all);
  return store;
};
const identity = (store) => ({ head: git(store, ["rev-parse", "HEAD"]), tree: treeState(store) });
// Every file a store holds, as one string, to search for outside requests.
const allText = (store) => Object.keys(treeState(store)).map((f) => fs.readFileSync(path.join(store, f), "utf8")).join("\n");

(async () => {
  const host = await startFakeHost();

  await check("a fresh store publishes private pages at once: no host, nothing to fill in, no link site read", () => {
    const store = fresh();
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    // FORGE_DEPLOY=1: were anything uploaded or read, it would have to go somewhere.
    const live = { FORGE_DEPLOY: "1", PATH: "/nonexistent:" + process.env.PATH };
    let r = run(store, ["publish", "hello.html"], { cwd: src.dir, env: live });
    assert.strictEqual(r.status, 0, r.all);
    const slug = manifest(store).deliverables.hello.slug;
    assert.deepStrictEqual(r.out.trim().split("\n"), [
      "published hello v1 (private)",
      "private: file://" + path.join(store, "private", "d", slug, "index.html"),
      "to share it: set a host first with forge host (SETUP.md step 5), then run forge share hello",
    ]);
    assert.ok(!/deploy|upload/i.test(r.err), "nothing deployed: " + r.err);
    r = run(store, ["list"], { env: live });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^link site: none \(no host is set; private pages need none; to share pages, set one: forge host, see SETUP\.md\)$/m);
    assert.ok(!/master index/.test(r.out), "no public address, so no index link");
    const j = JSON.parse(run(store, ["list", "--json", "--live"], { env: live }).out);
    assert.strictEqual(j.schema, 2);
    assert.strictEqual(j.baseUrl, null);
    assert.strictEqual(j.linkSite.state, "none");
    assert.strictEqual(j.documents[0].publicUrl, null);
    r = run(store, ["rename", "hello", "hello-world"], { env: live });
    assert.strictEqual(r.status, 0, r.all);
    r = run(store, ["check"], { env: live });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /forge check OK/);
    // The Markdown export carries no public address: the store has none yet.
    assert.match(fs.readFileSync(path.join(store, "private", "d", slug, "v1", "index.html"), "utf8"), / data-url=""/);
  });

  await check("share, unshare and deploy refuse with no host, naming forge host and SETUP.md; nothing changes", () => {
    const store = fresh();
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    assert.strictEqual(run(store, ["publish", "hello.html"], { cwd: src.dir }).status, 0);
    const before = identity(store);
    for (const a of [["share", "hello"], ["unshare", "hello"], ["deploy"]]) {
      const r = run(store, a);
      assert.strictEqual(r.status, 1, a.join(" ") + ": " + r.all);
      assert.match(r.err, /^refusing: this store has no host yet, so there is no link site to /, a.join(" "));
      assert.ok(r.err.includes("forge host <cloudflare-pages|vercel|netlify>") && r.err.includes("SETUP.md step 5"), r.err);
      assert.strictEqual(r.out, "");
    }
    assert.deepStrictEqual(identity(store), before);
  });

  await check("forge host writes the host and public address in one commit, deploys and reads the site back; then share goes live", () => {
    const store = fresh();
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    assert.strictEqual(run(store, ["publish", "hello.html"], { cwd: src.dir }).status, 0);
    const project = "pfresh";
    const H = host.env();
    const r = run(store, ["host", "cloudflare-pages", "--project", project, "--account", "acct", "--url", host.baseUrl(project), "--token-name", "FORGE_FAKE_HOST_TOKEN"], { env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^host set: Cloudflare Pages, project pfresh, link site http:\/\/127\.0\.0\.1:\d+\/pfresh, token read by the name FORGE_FAKE_HOST_TOKEN$/m);
    assert.ok(!r.out.includes("###"), "no slice of SETUP.md is printed: " + r.out);
    const c = JSON.parse(fs.readFileSync(path.join(store, "config.json"), "utf8"));
    assert.deepStrictEqual(c.host, { kind: "cloudflare-pages", project, accountId: "acct", tokenSecret: "FORGE_FAKE_HOST_TOKEN" });
    assert.strictEqual(c.baseUrl, host.baseUrl(project));
    assert.strictEqual(git(store, ["log", "-1", "--format=%s"]), "host: cloudflare-pages pfresh at " + host.baseUrl(project));
    assert.deepStrictEqual(git(store, ["show", "--name-only", "--format=", "HEAD"]).split("\n"), ["config.json"]);
    assert.strictEqual(git(store, ["status", "--porcelain"]), "");
    assert.deepStrictEqual(host.uploads(store).map((u) => u.marker.commit), [git(store, ["rev-parse", "HEAD"])], "setting the host deployed the commit that set it");
    const s = run(store, ["share", "hello"], { env: H });
    assert.strictEqual(s.status, 0, s.all);
    assert.match(s.out, /^public: http:\/\/127\.0\.0\.1:\d+\/pfresh\/d\//m);
  });

  await check("forge host refuses bad values and a store that already has a host; nothing changes", () => {
    const store = fresh();
    const before = identity(store);
    const tries = [
      [["host", "github-pages", "--project", "p", "--url", "https://x.example", "--token-name", "T"], /the host must be one of cloudflare-pages, vercel, netlify/],
      [["host", "cloudflare-pages", "--project", "p", "--url", "https://x.example", "--token-name", "T"], /--account is required for Cloudflare Pages/],
      [["host", "netlify", "--project", "p", "--account", "a", "--url", "https://x.example", "--token-name", "T"], /Netlify takes no --account/],
      [["host", "netlify", "--project", "p", "--url", "https://x.example/", "--token-name", "T"], /--url must be the link site's http\(s\) address with no trailing slash/],
      [["host", "netlify", "--project", "p", "--url", "https://x.example", "--token-name", "nfp_abc-123.secret"], /--token-name must be the NAME the token is kept under/],
      [["host", "netlify", "--project", "p", "--url", "https://x.example"], /the token name FORGE_NETLIFY_TOKEN \(the default for Netlify\) resolves to no secret/],
    ];
    for (const [a, re] of tries) {
      const r = run(store, a);
      assert.strictEqual(r.status, 1, a.join(" ") + ": " + r.all);
      assert.match(r.err, re, a.join(" "));
    }
    assert.deepStrictEqual(identity(store), before);
    assert.strictEqual(run(store, ["host", "netlify", "--project", "p", "--url", "https://x.example", "--token-name", "T"], { env: { T: "x" } }).status, 0);
    const set = identity(store);
    const r = run(store, ["host", "vercel", "--project", "q", "--account", "a", "--url", "https://y.example", "--token-name", "T"], { env: { T: "x" } });
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /this store already has a host \(Netlify project p at https:\/\/x\.example\); to change it, add --replace/);
    assert.deepStrictEqual(identity(store), set);
  });

  await check("forge list --json of a private-only store: baseUrl, index and every publicUrl null, linkSite.state none, each documented in the reference", () => {
    const store = fresh();
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    assert.strictEqual(run(store, ["publish", "hello.html"], { cwd: src.dir }).status, 0);
    const j = JSON.parse(run(store, ["list", "--json"]).out);
    assert.deepStrictEqual([j.schema, j.baseUrl, j.index, j.linkSite.state, j.linkSite.basis, j.documents[0].publicUrl], [2, null, null, "none", "no host is set", null]);
    const ref = fs.readFileSync(path.join(ENGINE, "docs", "reference.md"), "utf8").replace(/\s+/g, " ");
    for (const x of ["`baseUrl` is `null`", "`index` is `null`", "`linkSite.state` is `none`", "`basis` `no host is set`", "every `publicUrl` is `null`"]) assert.ok(ref.includes(x), "the reference lacks: " + x);
    const example = ref.slice(ref.indexOf("## `forge list --json`"));
    assert.ok(/"state": "current \| behind \| unknown \| none"/.test(example), "the schema example lists none");
  });

  await check("a store with shared pages and no host is refused by the loader, naming forge host", () => {
    const store = fresh();
    const m = manifest(store);
    m.deliverables.x = { slug: "abcdefghijkl", source: "~/x.html", visibility: "shared", versions: [{ n: 1, date: "2026-01-01", sha256: "x" }], shared: [], takedowns: [] };
    fs.writeFileSync(path.join(store, "manifest.json"), JSON.stringify(m));
    const r = run(store, ["list"]);
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /config\.json has no host, but 1 page\(s\) are shared \(x\); set the host back with forge host/);
  });

  await check("the default look is neutral with no outside request; brand.accent and brand.fontStylesheet give a store its own", () => {
    const store = fresh();
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    assert.strictEqual(run(store, ["publish", "hello.html"], { cwd: src.dir }).status, 0);
    let text = allText(store);
    assert.ok(!/fonts\.googleapis|fonts\.gstatic|<link[^>]+stylesheet/i.test(text), "no outside font request");
    // #603200 is the dark-mode override, which renders gold whatever the accent.
    assert.ok(!/--forge-accent:(?!#3451b2|#603200)/.test(text), "no accent but the neutral default");
    assert.ok(text.includes("#3451b2"), "the neutral accent");
    const c = JSON.parse(fs.readFileSync(path.join(store, "config.json"), "utf8"));
    c.brand.accent = "#aa3300";
    c.brand.fontStylesheet = "https://fonts.example.org/house.css";
    fs.writeFileSync(path.join(store, "config.json"), JSON.stringify(c));
    git(store, ["commit", "-qam", "own look"]);
    assert.strictEqual(run(store, ["regenerate"]).status, 0);
    src.page("other.html", "Other", "o");
    assert.strictEqual(run(store, ["publish", "other.html"], { cwd: src.dir }).status, 0);
    const slug = manifest(store).deliverables.other.slug;
    const page = fs.readFileSync(path.join(store, "private", "d", slug, "index.html"), "utf8");
    assert.ok(page.includes("color:#aa3300") && !page.includes("#3451b2"), "the stamped controls take the accent");
    const history = fs.readFileSync(path.join(store, "private", "d", slug, "versions", "index.html"), "utf8");
    assert.ok(history.includes('<link rel="stylesheet" href="https://fonts.example.org/house.css">') && history.includes("--forge-accent:#aa3300"), "the generated pages take both");
    for (const [k, v] of [["accent", "purple"], ["fontStylesheet", "http://fonts.example.org/x.css"]]) {
      const bad = { ...c, brand: { ...c.brand, [k]: v } };
      fs.writeFileSync(path.join(store, "config.json"), JSON.stringify(bad));
      const r = run(store, ["list"]);
      assert.strictEqual(r.status, 1, k + ": " + r.all);
      assert.match(r.err, new RegExp("brand\\." + k + ", when set, must be"), k);
    }
    git(store, ["checkout", "config.json"]);
  });

  host.stop();
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
