// Runnable test: node test/config-rules.test.js
// config.json is shared state, so it follows the page rules: every decision
// about the host is made inside the write (the worktree at the remote's head)
// or from the commit being reported, never from this machine's older copy.
// Two machines (two clones of one bare remote) race on the host:
// - a publish whose page another machine shared meanwhile reports from the
//   commit it reports, and prints no public line until that site was read;
// - a stale copy cannot replace another machine's host, even when the other
//   host lands between two attempts of the same write;
// - a stale copy shares and deploys on a host another machine set.
// forge host proves the setup: it ends with a deploy and a read-back of the
// link site (exit 3 when not confirmed). Changing the host needs --replace,
// and the new site is deployed and read back.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, run, git, tmp, makeSrc, manifest, start, twoMachines } = require("./helpers.js");
const { startFakeHost } = require("./fakehost.js");

// A private-only store made by the real forge init.
const fresh = () => {
  const store = path.join(tmp("fresh"), "store");
  const r = run(store, ["init", store]);
  assert.strictEqual(r.status, 0, r.all);
  return store;
};
const at = (repo, rev, file) => JSON.parse(git(repo, ["show", rev + ":" + file]));
const remoteConfig = (bare) => at(bare, "main", "config.json");
const DRY = { T: "a-token-value" };

(async () => {
  const host = await startFakeHost();
  const H = host.env();
  const setMode = (project, m) => {
    fs.mkdirSync(path.join(host.root, project), { recursive: true });
    fs.writeFileSync(path.join(host.root, project, "mode"), m);
  };
  const cf = (project, extra = []) => ["host", "cloudflare-pages", "--project", project, "--account", "acct", "--url", host.baseUrl(project), "--token-name", "FORGE_FAKE_HOST_TOKEN", ...extra];

  await check("another machine set a host and shared the page while this publish ran: the result comes from the commit it reports, with no public line until that site is read back", async () => {
    const { a, b, bare } = twoMachines(fresh);
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    const A = start(a, ["publish", "hello.html"], { cwd: src.dir, env: { ...H, FORGE_TEST_PAUSE: "fast-forward:12000" } });
    await A.waitFor(/paused at fast-forward/);
    setMode("prace", "fail-before"); // the other machine's uploads fail: its site never shows the page
    const hb = run(b, cf("prace"), { env: H });
    assert.ok([0, 3].includes(hb.status), hb.all);
    const sb = run(b, ["share", "hello"], { env: H });
    assert.strictEqual(sb.status, 3, sb.all);
    assert.strictEqual(at(bare, "main", "manifest.json").deliverables.hello.visibility, "shared", "the other machine shared it on the remote");
    const r = await A.closed;
    assert.strictEqual(r.status, 3, "the link site of the commit reported is not confirmed:\n" + r.all);
    assert.ok(!/^public:/m.test(r.out), "no public line for a site never read back:\n" + r.out);
    assert.ok(!r.out.includes("null"), "no line built from a config without the host:\n" + r.out);
  });

  await check("another machine set a host and shared the page while this publish ran, and its site shows it: the public line is built from the config of the commit reported", async () => {
    const { a, b } = twoMachines(fresh);
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    const A = start(a, ["publish", "hello.html"], { cwd: src.dir, env: { ...H, FORGE_TEST_PAUSE: "fast-forward:12000" } });
    await A.waitFor(/paused at fast-forward/);
    const hb = run(b, cf("pboth"), { env: H });
    assert.strictEqual(hb.status, 0, hb.all);
    const sb = run(b, ["share", "hello"], { env: H });
    assert.strictEqual(sb.status, 0, sb.all);
    const r = await A.closed;
    assert.strictEqual(r.status, 0, r.all);
    const slug = manifest(b).deliverables.hello.slug;
    assert.ok(r.out.includes("public: " + host.baseUrl("pboth") + "/d/" + slug + "/"), "the public line, at the other machine's host:\n" + r.out);
    assert.ok(!r.out.includes("null"), r.out);
  });

  await check("a stale copy cannot replace the host another machine set; the remote keeps that machine's host", () => {
    const { a, b, bare } = twoMachines(fresh);
    const nb = run(b, ["host", "netlify", "--project", "nb", "--url", "https://nb.example", "--token-name", "T"], { env: DRY });
    assert.strictEqual(nb.status, 0, nb.all);
    const ra = run(a, ["host", "vercel", "--project", "va", "--account", "team", "--url", "https://va.example", "--token-name", "T"], { env: DRY });
    assert.strictEqual(ra.status, 1, ra.all);
    const c = remoteConfig(bare);
    assert.deepStrictEqual([c.host.kind, c.host.project, c.baseUrl], ["netlify", "nb", "https://nb.example"]);
  });

  await check("a stale copy cannot replace the host another machine set between two attempts of the same write", async () => {
    const { a, b, bare } = twoMachines(fresh);
    const A = start(a, ["host", "vercel", "--project", "va", "--account", "team", "--url", "https://va.example", "--token-name", "T"], { env: { ...DRY, FORGE_TEST_PAUSE: "before:5000" } });
    await A.waitFor(/paused at before/);
    const nb = run(b, ["host", "netlify", "--project", "nb", "--url", "https://nb.example", "--token-name", "T"], { env: DRY });
    assert.strictEqual(nb.status, 0, nb.all);
    const r = await A.closed;
    assert.strictEqual(r.status, 1, r.all);
    const c = remoteConfig(bare);
    assert.deepStrictEqual([c.host.kind, c.host.project, c.baseUrl], ["netlify", "nb", "https://nb.example"]);
  });

  await check("a stale copy shares and deploys on the host another machine set, not refused as having no host", () => {
    const { a, b } = twoMachines(fresh);
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    assert.strictEqual(run(a, ["publish", "hello.html"], { cwd: src.dir }).status, 0);
    const hb = run(b, cf("pstale"), { env: H });
    assert.strictEqual(hb.status, 0, hb.all);
    const s = run(a, ["share", "hello"], { env: H });
    assert.strictEqual(s.status, 0, s.all);
    assert.ok(s.out.includes("public: " + host.baseUrl("pstale") + "/d/" + manifest(a).deliverables.hello.slug + "/"), s.out);
    const d = run(a, ["deploy"], { env: H });
    assert.strictEqual(d.status, 0, d.all);
  });

  await check("forge host proves the setup: it deploys and reads the link site back, and says what to try next", () => {
    const store = fresh();
    const r = run(store, cf("pproof"), { env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^host set: Cloudflare Pages, project pproof, link site http:\/\/127\.0\.0\.1:\d+\/pproof, token read by the name FORGE_FAKE_HOST_TOKEN$/m);
    assert.match(r.out, /^try: forge share <name>$/m);
    const marker = JSON.parse(fs.readFileSync(path.join(host.root, "pproof", "site", "_forge", "revision.json"), "utf8"));
    assert.strictEqual(marker.commit, git(store, ["rev-parse", "HEAD"]), "the site shows the commit that set the host");
  });

  await check("forge host with a project or token the host refuses: the host is saved, not proven, exit 3, and the last line names both fixes", () => {
    const store = fresh();
    setMode("pbad", "fail-before");
    const r = run(store, cf("pbad"), { env: H });
    assert.strictEqual(r.status, 3, r.all);
    assert.strictEqual(at(store, "HEAD", "config.json").host.project, "pbad", "the host is saved");
    assert.match(r.err, /^NOT FINISHED/m);
    assert.match(r.out, /^host saved, not proven: Cloudflare Pages, project pbad, /m);
    assert.ok(!/^finish with: forge deploy$/m.test(r.err), "a bare deploy cannot fix a wrong project:\n" + r.err);
    assert.match(r.err, /^finish with: a wrong project or address: run the same forge host line with the right values and --replace; a token problem: fix the token, then forge deploy; the site not answering yet, or a network failure: forge deploy again in a minute$/m);
  });

  await check("forge host on a new site that cannot be read yet still uploads to it, then says it is not confirmed", () => {
    const store = fresh();
    setMode("punread", "readback-fail");
    const r = run(store, cf("punread"), { env: H });
    assert.strictEqual(r.status, 3, r.all);
    const log = path.join(host.root, "punread", "uploads.log");
    assert.ok(fs.existsSync(log), "nothing was uploaded:\n" + r.all);
    assert.strictEqual(JSON.parse(fs.readFileSync(log, "utf8").trim().split("\n").pop()).marker.commit, git(store, ["rev-parse", "HEAD"]));
  });

  await check("changing the host: refused without --replace, naming it and what it does; with it the new site is deployed and read back", () => {
    const store = host.store();
    const oldBase = JSON.parse(fs.readFileSync(path.join(store, "config.json"), "utf8")).baseUrl;
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    assert.strictEqual(run(store, ["publish", "hello.html"], { cwd: src.dir, env: H }).status, 0);
    assert.strictEqual(run(store, ["share", "hello"], { env: H }).status, 0);
    const head = git(store, ["rev-parse", "HEAD"]);
    let r = run(store, cf("pnew"), { env: H });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes("--replace"), "names the flag: " + r.err);
    assert.match(r.err, /every public link moves to the new address/);
    assert.strictEqual(git(store, ["rev-parse", "HEAD"]), head, "nothing changed");
    r = run(store, cf("pnew", ["--replace"]), { env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(r.out.includes(oldBase), "says where the old links pointed: " + r.out);
    assert.match(r.out, /frozen versions keep the old address in their Markdown export/);
    assert.match(r.out, /the old address keeps serving what was deployed to it/);
    const slug = manifest(store).deliverables.hello.slug;
    const marker = JSON.parse(fs.readFileSync(path.join(host.root, "pnew", "site", "_forge", "revision.json"), "utf8"));
    assert.strictEqual(marker.commit, git(store, ["rev-parse", "HEAD"]), "the new site shows the commit that moved it");
    assert.ok(fs.existsSync(path.join(host.root, "pnew", "site", "d", slug, "index.html")), "the shared page is on the new site");
    const j = JSON.parse(run(store, ["list", "--json"], { env: H }).out);
    assert.strictEqual(j.baseUrl, host.baseUrl("pnew"));
    assert.strictEqual(j.documents[0].publicUrl, host.baseUrl("pnew") + "/d/" + slug + "/");
    setMode("pnew2", "fail-before");
    r = run(store, cf("pnew2", ["--replace"]), { env: H });
    assert.strictEqual(r.status, 3, "the new site was not read back:\n" + r.all);
    assert.strictEqual(at(store, "HEAD", "config.json").host.project, "pnew2");
  });

  host.stop();
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
