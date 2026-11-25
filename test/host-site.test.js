// Runnable test: node test/host-site.test.js
// What the link site shows is a pair: the public tree and the site (the host
// setting: kind, project, account id, address). A host change moves the site
// and leaves the tree alone, so every comparison (before an upload, at the
// read-back, the cached read) takes both. Each check observes the boundary:
// the stand-in host's per-project logs (attempts: every call of the upload
// tool; uploads: the files that landed) say which project got what, never
// only forge's own output. The cells are the host state table in the build's
// proof; one check per cell.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, run, git, tmp, makeSrc, manifest, start, twoMachines } = require("./helpers.js");
const { startFakeHost } = require("./fakehost.js");

const fresh = () => {
  const store = path.join(tmp("fresh"), "store");
  const r = run(store, ["init", store]);
  assert.strictEqual(r.status, 0, r.all);
  return store;
};
const configOf = (store) => JSON.parse(fs.readFileSync(path.join(store, "config.json"), "utf8"));
const head = (repo) => git(repo, ["rev-parse", "HEAD"]);
const OLD_PROJECT = "if forge deployed pages to that project, every page shared until then stays public there, out of unshare's reach; delete it there when nothing should stay public. If that project is used for something else, forge's upload replaced what it served there: redeploy it from its own source.";

(async () => {
  const host = await startFakeHost();
  const H = host.env();
  const setMode = (project, m) => {
    fs.mkdirSync(path.join(host.root, project), { recursive: true });
    fs.writeFileSync(path.join(host.root, project, "mode"), m);
  };
  const cf = (project, url, extra = []) => ["host", "cloudflare-pages", "--project", project, "--account", "test-account", "--url", url, "--token-name", "FORGE_FAKE_HOST_TOKEN", ...extra];
  // A hosted store whose link site shows one shared page.
  const live = () => {
    const store = host.store();
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    let r = run(store, ["publish", "hello.html"], { cwd: src.dir, env: H });
    assert.strictEqual(r.status, 0, r.all);
    r = run(store, ["share", "hello"], { env: H });
    assert.strictEqual(r.status, 0, r.all);
    return { store, project: host.projectOf(store), url: configOf(store).baseUrl, src };
  };

  await check("host --replace with the same values uploads again (the token is used, not assumed) and prints no links-moved note", () => {
    const { store, project, url } = live();
    const before = host.log(project, "uploads").length;
    const r = run(store, cf(project, url, ["--replace"]), { env: H });
    assert.strictEqual(r.status, 0, r.all);
    const ups = host.log(project, "uploads");
    assert.strictEqual(ups.length, before + 1, "an upload to " + project + " was made:\n" + r.all);
    assert.strictEqual(ups[ups.length - 1].marker.commit, head(store), "the upload carries the store's commit");
    assert.ok(!/links moved/.test(r.out), "the address did not change, so no links moved:\n" + r.out);
  });

  await check("host --replace with the same values and a token the host refuses: the upload is attempted, exit 3, and the pending line says how to fix a token", () => {
    const { store, project, url } = live();
    setMode(project, "fail-before");
    const before = host.log(project, "attempts").length;
    const r = run(store, cf(project, url, ["--replace"]), { env: H });
    assert.strictEqual(r.status, 3, r.all);
    assert.strictEqual(host.log(project, "attempts").length, before + 1, "the upload was attempted:\n" + r.all);
    assert.match(r.err, /a token problem: fix the token, then forge deploy/);
    assert.match(r.err, /a wrong project or address: run the same forge host line with the right values and --replace/);
  });

  await check("host --replace to another project: the note names the old host, project and address, and says, conditionally, that pages shared there stay public", () => {
    const { store, project, url } = live();
    let r = run(store, cf("p4moved", host.baseUrl("p4moved")), { env: H });
    assert.strictEqual(r.status, 1, r.all);
    const old = "Cloudflare Pages project " + project + " at " + url;
    assert.ok(r.err.includes(old), "the refusal names the old host:\n" + r.err);
    assert.ok(r.err.includes(OLD_PROJECT), "the refusal says what stays there:\n" + r.err);
    r = run(store, cf("p4moved", host.baseUrl("p4moved"), ["--replace"]), { env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(r.out.includes("the public links moved from " + url + " to " + host.baseUrl("p4moved")), r.out);
    assert.ok(r.out.includes("note: the old host was " + old + ": " + OLD_PROJECT), "the note names the old host:\n" + r.out);
    assert.match(r.out, /the old address keeps serving what was deployed to it/);
    assert.strictEqual(host.log("p4moved", "uploads").pop().marker.commit, head(store));
  });

  await check("host --replace with the same project at a new address: no advice to delete anything, in the refusal or the result (forge still deploys to that project)", () => {
    const { store, project, url } = live();
    const moved = "http://localhost:" + host.port + "/" + project;
    let r = run(store, cf(project, moved), { env: H });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(!/delete/.test(r.all), "the refusal advises deleting the project in use:\n" + r.all);
    assert.ok(!r.all.includes(OLD_PROJECT), r.all);
    r = run(store, cf(project, moved, ["--replace"]), { env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(r.out.includes("the public links moved from " + url + " to " + moved), r.out);
    assert.ok(!/delete/.test(r.all), "the result advises deleting the project in use:\n" + r.all);
    assert.ok(!/note: the old host was/.test(r.out), r.out);
    assert.strictEqual(host.log(project, "uploads").pop().marker.commit, head(store), "the same project got the upload");
  });

  await check("the refusal without --replace: the links-moved sentence only when the typed address differs; the project note is about the host in use, once replaced", () => {
    const { store, project, url } = live();
    const head0 = head(store);
    const MOVES_START = "Changing the host: every public link moves to the new address";
    // The same project at a new address: links move, no project note.
    let r = run(store, cf(project, "http://localhost:" + host.port + "/" + project), { env: H });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes(MOVES_START), "the address changes, so links move:\n" + r.err);
    assert.ok(!r.err.includes(OLD_PROJECT) && !/Once replaced/.test(r.err), "no project note for the same project:\n" + r.err);
    // Another project at the same address: a project note about the host in use, no links-moved sentence.
    r = run(store, cf("p4other", url), { env: H });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(!r.err.includes(MOVES_START) && !/keeps serving/.test(r.err), "the address does not change, yet the refusal says links move:\n" + r.err);
    assert.ok(r.err.includes("Once replaced, about the host in use now, Cloudflare Pages project " + project + " at " + url + ": " + OLD_PROJECT), "the project note:\n" + r.err);
    assert.ok(!/the old host/.test(r.err), "the host in use is called old before anything changed:\n" + r.err);
    assert.strictEqual(head(store), head0, "nothing was changed");
    assert.strictEqual(host.log("p4other", "attempts").length, 0, "nothing was uploaded");
  });

  await check("host --replace to another project at the old address: the new project gets the upload, the address answers with the old setting, exit 3 naming it", () => {
    const { store, url } = live();
    const r = run(store, cf("p4wrong", url, ["--replace"]), { env: H });
    assert.strictEqual(r.status, 3, r.all);
    const ups = host.log("p4wrong", "uploads");
    assert.strictEqual(ups.length, 1, "p4wrong got the upload:\n" + r.all);
    assert.strictEqual(ups[0].marker.commit, head(store));
    assert.match(r.err, /the address answers with a site uploaded for another host setting: wrong address, or it does not point at project p4wrong yet/);
    assert.ok(!/^public:/m.test(r.out), r.out);
    // Not proven reads as not proven: no "host set", no "try: share", and the
    // last line names both fixes, never a bare deploy.
    assert.match(r.out, /^host saved, not proven: Cloudflare Pages, project p4wrong, /m);
    assert.ok(!/^host set/m.test(r.out), r.out);
    assert.ok(!/^try:/m.test(r.out), r.out);
    // The "separately, the link site is not confirmed" line already says it.
    assert.ok(!r.err.includes("is not confirmed to work yet"), "a repeated pending line:\n" + r.err);
    const last = r.err.trim().split("\n").pop();
    assert.strictEqual(last, "finish with: a wrong project or address: run the same forge host line with the right values and --replace; a token problem: fix the token, then forge deploy; the site not answering yet, or a network failure: forge deploy again in a minute", r.err);
    const j = JSON.parse(run(store, ["list", "--json", "--live"], { env: H }).out);
    assert.strictEqual(j.linkSite.state, "unknown", "a live read of the old setting's marker is not current: " + JSON.stringify(j.linkSite));
    assert.match(j.linkSite.error, /another host setting/);
  });

  await check("after a replace whose upload failed, list never reports the new, empty site as current (the cached read belongs to the old setting)", () => {
    const { store } = live();
    let j = JSON.parse(run(store, ["list", "--json", "--live"], { env: H }).out);
    assert.strictEqual(j.linkSite.state, "current", "the old site was current");
    setMode("p4empty", "fail-before");
    const r = run(store, cf("p4empty", host.baseUrl("p4empty"), ["--replace"]), { env: H });
    assert.strictEqual(r.status, 3, r.all);
    assert.strictEqual(host.log("p4empty", "uploads").length, 0, "nothing landed on p4empty");
    j = JSON.parse(run(store, ["list", "--json"], { env: H }).out);
    assert.strictEqual(j.baseUrl, host.baseUrl("p4empty"));
    assert.strictEqual(j.linkSite.state, "unknown", JSON.stringify(j.linkSite));
  });

  await check("a cached read and a live marker from an older forge (no site recorded) never match: the record reads unknown, deploy uploads once, then the live read is current", () => {
    const { store, project } = live();
    const tree = git(store, ["rev-parse", "HEAD:public"]);
    fs.writeFileSync(path.join(store, ".git", "forge-linksite.json"), JSON.stringify({ readAt: new Date().toISOString(), liveCommit: head(store), liveTree: tree, storeTreeAtRead: tree }) + "\n");
    let j = JSON.parse(run(store, ["list", "--json"], { env: H }).out);
    assert.strictEqual(j.linkSite.state, "unknown", "an old record: " + JSON.stringify(j.linkSite));
    const mf = path.join(host.root, project, "site", "_forge", "revision.json");
    const m = JSON.parse(fs.readFileSync(mf, "utf8"));
    delete m.site;
    fs.writeFileSync(mf, JSON.stringify(m) + "\n");
    const before = host.log(project, "uploads").length;
    const d = run(store, ["deploy"], { env: H });
    assert.strictEqual(d.status, 0, d.all);
    assert.strictEqual(host.log(project, "uploads").length, before + 1, "an old marker is not trusted: deploy uploaded:\n" + d.all);
    assert.ok(typeof host.marker(store).site === "string" && host.marker(store).site.length > 0, "the new marker records the site");
    assert.ok(!JSON.stringify(host.marker(store)).includes(project), "the marker never prints the setting's values: " + JSON.stringify(host.marker(store)));
    j = JSON.parse(run(store, ["list", "--json", "--live"], { env: H }).out);
    assert.strictEqual(j.linkSite.state, "current", JSON.stringify(j.linkSite));
    assert.deepStrictEqual(Object.keys(j.linkSite).sort(), ["basis", "error", "liveCommit", "liveTree", "readAt", "state", "storeCommit", "storeTree"], "linkSite gains no field");
  });

  await check("a private publish on a machine without the token, link site level: no upload and no secret read, exit 0", () => {
    const { store, project, src } = live();
    const xdg = tmp("xdg");
    const rec = path.join(tmp("rec"), "args");
    const cmd = path.join(path.dirname(rec), "secret.sh");
    fs.writeFileSync(cmd, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '" + rec + "'\n", { mode: 0o755 });
    fs.mkdirSync(path.join(xdg, "forge"));
    fs.writeFileSync(path.join(xdg, "forge", "settings.json"), JSON.stringify({ secretCommand: cmd + " {name}" }));
    src.page("other.html", "Other", "o");
    const before = host.log(project, "attempts").length;
    const r = run(store, ["publish", "other.html"], { cwd: src.dir, env: { ...H, FORGE_FAKE_HOST_TOKEN: "", XDG_CONFIG_HOME: xdg } });
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(host.log(project, "attempts").length, before, "no upload was tried");
    assert.ok(!fs.existsSync(rec), "the secret command never ran");
  });

  await check("two machines: a host change lands while this share reads its upload back; the old site never confirms the new setting", async () => {
    const { a, b } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    assert.strictEqual(run(a, ["publish", "hello.html"], { cwd: src.dir, env: H }).status, 0);
    const A = start(a, ["share", "hello"], { env: { ...H, FORGE_TEST_PAUSE: "deployed:15000" } });
    await A.waitFor(/paused at deployed/);
    setMode("p4race", "fail-before");
    const hb = run(b, cf("p4race", host.baseUrl("p4race"), ["--replace"]), { env: H });
    assert.strictEqual(hb.status, 3, hb.all);
    const tried = host.log("p4race", "attempts").length;
    const r = await A.closed;
    assert.notStrictEqual(r.status, 0, "the new site was never read:\n" + r.all);
    assert.ok(!r.out.includes("public: " + host.baseUrl("p4race")), "no public line at the new address:\n" + r.out);
    assert.strictEqual(host.log("p4race", "uploads").length, 0, "nothing ever landed on p4race");
    const mine = host.log("p4race", "attempts").slice(tried);
    assert.strictEqual(mine.length, 1, "this share went on to try the new site:\n" + r.all);
    assert.strictEqual(mine[0].marker.commit, git(b, ["rev-parse", "HEAD"]), "with the commit that set it");
  });

  await check("two machines: another machine replaces the host this run just set; the result names the host of the commit it reports, with a note", async () => {
    const { a, b } = twoMachines(fresh);
    const A = start(a, cf("p4first", host.baseUrl("p4first")), { env: { ...H, FORGE_TEST_PAUSE: "fast-forward:15000" } });
    await A.waitFor(/paused at fast-forward/);
    const hb = run(b, cf("p4second", host.baseUrl("p4second"), ["--replace"]), { env: H });
    assert.strictEqual(hb.status, 0, hb.all);
    const r = await A.closed;
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(r.out.includes("host set: Cloudflare Pages, project p4second, link site " + host.baseUrl("p4second")), r.out);
    assert.match(r.out, /another machine has since set the host/);
    assert.ok(!r.out.includes("project p4first,"), "never the host this run wrote as the one in use:\n" + r.out);
  });

  await check("two machines: this run moves the host from H0 to H1, another machine moves it back to H0 before this run reports; nothing tells the person to delete H0, and no links-moved note", async () => {
    const { a, b } = twoMachines(() => host.store());
    const h0 = configOf(a);
    const A = start(a, cf("p5one", host.baseUrl("p5one"), ["--replace"]), { env: { ...H, FORGE_TEST_PAUSE: "fast-forward:15000" } });
    await A.waitFor(/paused at fast-forward/);
    const hb = run(b, cf(h0.host.project, h0.baseUrl, ["--replace"]), { env: H });
    assert.strictEqual(hb.status, 0, hb.all);
    const r = await A.closed;
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(r.out.includes("project " + h0.host.project + ", link site " + h0.baseUrl), "names the host in use, H0:\n" + r.out);
    assert.match(r.out, /another machine has since set the host/);
    assert.ok(!/delete/.test(r.all), "advises deleting the project in use:\n" + r.all);
    assert.ok(!/links moved/.test(r.out), "no link moved from H0:\n" + r.out);
  });

  await check("two machines: another machine replaces the host this run just set, and that host's upload fails; the result still names the host the remote now selects, with a note, exit 3", async () => {
    const { a, b } = twoMachines(fresh);
    const A = start(a, cf("p5first", host.baseUrl("p5first")), { env: { ...H, FORGE_TEST_PAUSE: "fast-forward:15000" } });
    await A.waitFor(/paused at fast-forward/);
    setMode("p5second", "fail-before");
    const hb = run(b, cf("p5second", host.baseUrl("p5second"), ["--replace"]), { env: H });
    assert.strictEqual(hb.status, 3, hb.all);
    const r = await A.closed;
    assert.strictEqual(r.status, 3, r.all);
    assert.ok(r.out.includes("project p5second, link site " + host.baseUrl("p5second")), "names the host the remote selects:\n" + r.out);
    assert.match(r.out, /another machine has since set the host/);
    assert.ok(!r.out.includes("project p5first,"), "never the host this run wrote as the one in use:\n" + r.out);
    assert.ok(!/^public:/m.test(r.out), r.out);
    // Replacing the host another machine set would undo that machine's change.
    const last = r.err.trim().split("\n").pop();
    assert.strictEqual(last, "finish with: the store now uses Cloudflare Pages project p5second at " + host.baseUrl("p5second") + ", which another machine set: a token problem: make the token named FORGE_FAKE_HOST_TOKEN readable here, then forge deploy; the site not answering yet, or a network failure: forge deploy again in a minute; a wrong project or address there: ask the owner, since replacing it would undo that machine's change", r.err);
    assert.ok(!/--replace/.test(r.err), "offers --replace over another machine's host:\n" + r.err);
  });

  await check("two machines, file links: A publishes a page, B shares it while A is paused, and both uploads fail; A's private link names a file in A's copy, or A says it is not in this copy yet", async () => {
    // No privateBaseUrl: the private link is a file in this machine's copy.
    const { a, b } = twoMachines(() => {
      const s = host.store();
      const c = configOf(s);
      delete c.privateBaseUrl;
      fs.writeFileSync(path.join(s, "config.json"), JSON.stringify(c, null, 2) + "\n");
      git(s, ["commit", "-qam", "file links"]);
      return s;
    });
    const project = host.projectOf(a);
    const src = makeSrc();
    src.page("filelink.html", "File link", "filelink-distinctive-body");
    const A = start(a, ["publish", "filelink.html"], { cwd: src.dir, env: { ...H, FORGE_TEST_PAUSE: "fast-forward:15000" } });
    await A.waitFor(/paused at fast-forward/);
    setMode(project, "fail-before");
    const hb = run(b, ["share", "filelink"], { env: H });
    assert.strictEqual(hb.status, 3, hb.all);
    const r = await A.closed;
    assert.strictEqual(r.status, 3, r.all);
    const works = r.err.match(/saved; its private link works: (\S+)/);
    const notYet = r.err.match(/saved; not in this machine's copy of the store until it catches up: (\S+)/);
    assert.ok(works || notYet, r.all);
    const link = (works || notYet)[1];
    assert.ok(r.out.split("\n").includes("private: " + link), "the private: line is the same link:\n" + r.out);
    if (works) {
      const f = require("node:url").fileURLToPath(link);
      assert.ok(fs.existsSync(f), "A says its private link works, but A's copy has no " + f + ":\n" + r.all);
      assert.ok(fs.readFileSync(f, "utf8").includes("filelink-distinctive-body"), "the file is not this page:\n" + f);
    }
  });

  await check("two machines, file links: after A pushes, another writer pushes a commit that fails the store check; A never catches up onto it, keeps its page's exact bytes, and never calls the link working", async () => {
    const { a, b } = twoMachines(() => {
      const s = host.store();
      const c = configOf(s);
      delete c.privateBaseUrl;
      fs.writeFileSync(path.join(s, "config.json"), JSON.stringify(c, null, 2) + "\n");
      git(s, ["commit", "-qam", "file links"]);
      return s;
    });
    const src = makeSrc();
    src.page("keepme.html", "Keep me", "keepme-distinctive-body");
    const A = start(a, ["publish", "keepme.html"], { cwd: src.dir, env: { ...H, FORGE_TEST_PAUSE: "fast-forward:15000" } });
    await A.waitFor(/paused at fast-forward/);
    // A faulty writer: the page's file deleted, its manifest entry kept.
    git(b, ["pull", "-q", "--ff-only"]);
    const pushed = head(b);
    const slug = manifest(b).deliverables.keepme.slug;
    const rel = path.join("private", "d", slug, "index.html");
    const bytes = fs.readFileSync(path.join(b, rel));
    git(b, ["rm", "-q", rel]);
    git(b, ["commit", "-qm", "a faulty writer"]);
    git(b, ["push", "-q", "origin", "HEAD"]);
    const r = await A.closed;
    assert.strictEqual(r.status, 3, r.all);
    assert.match(r.err, /fails the check/, r.all);
    assert.strictEqual(head(a), pushed, "A moved onto the commit the check rejected:\n" + r.all);
    assert.ok(fs.readFileSync(path.join(a, rel)).equals(bytes), "A's copy lost its page's bytes");
    assert.ok(!/its private link works/.test(r.err), "a link called working in a copy that does not match it:\n" + r.err);
  });

  await check("two machines: another machine changed the host's address; this stale copy's list --live and check say to sync and check again before any --replace", () => {
    const { a, b } = twoMachines(() => host.store());
    const h0 = configOf(a);
    const moved = "http://localhost:" + host.port + "/" + h0.host.project;
    const hb = run(b, cf(h0.host.project, moved, ["--replace"]), { env: H });
    assert.strictEqual(hb.status, 0, hb.all);
    const j = JSON.parse(run(a, ["list", "--json", "--live"], { env: H }).out);
    assert.strictEqual(j.linkSite.state, "unknown", JSON.stringify(j.linkSite));
    const e = j.linkSite.error;
    // The observation first, then the two branches.
    assert.ok(e.startsWith("the address answers with a site uploaded for another host setting. If another machine changed the host, this copy may be behind: run forge sync, then check again. Otherwise: wrong address, or it does not point at project " + h0.host.project + " yet"), e);
    assert.ok(e.indexOf("forge sync") < e.indexOf("--replace"), e);
    const c = run(a, ["check"], { env: H });
    assert.match(c.out, /^note: link site: not known: the address answers with a site uploaded for another host setting\. If another machine changed the host, this copy may be behind: run forge sync, then check again\. Otherwise: /m);
  });

  host.stop();
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
