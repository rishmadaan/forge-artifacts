// Runnable test: node test/cli.test.js
// Every command and every guard through the real launch command (bin/forge in a
// child process), against scratch stores. FORGE_DEPLOY=0 throughout.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, tmp, run, runAsync, git, makeStore, makeSrc, manifest, treeState, CONFIG, start, twoMachines } = require("./helpers.js");
const { startFakeHost } = require("./fakehost.js");

// The identity of a store's whole state: its commit, its working tree's
// status, and every file's bytes.
// Every file's text under a folder, joined (to look for a string anywhere in it).
function treeStateText(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : out.push(fs.readFileSync(path.join(d, e.name), "utf8")); };
  walk(dir);
  return out.join("\n");
}

function identity(store) {
  return { head: git(store, ["rev-parse", "HEAD"]), status: git(store, ["status", "--porcelain", "--untracked-files=all"]), tree: treeState(store) };
}

(async () => {
  const host = await startFakeHost();
  const H = host.env();
  await check("--help and an unknown command print the usage", () => {
    const h = run(tmp("x"), ["--help"]);
    assert.strictEqual(h.status, 0);
    assert.match(h.out, /^usage: forge <command>/);
    const u = run(tmp("x"), ["frobnicate"]);
    assert.strictEqual(u.status, 1);
    assert.match(u.err, /unknown command: frobnicate\n\nusage: forge <command>/);
  });

  await check("publish a file from a folder outside any store: private, lines in order", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("plan.html", "Plan Doc", "one");
    const r = run(store, ["publish", "plan.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 0, r.all);
    const slug = manifest(store).deliverables.plan.slug;
    const lines = r.out.trim().split("\n");
    assert.deepStrictEqual(lines.slice(0, 3), [
      "published plan v1 (private)",
      "private: http://127.0.0.1:8080/forge/d/" + slug + "/",
      "share it with: forge share plan",
    ]);
    assert.ok(!r.out.includes("public: "), "no public line for a private page");
    assert.strictEqual(manifest(store).deliverables.plan.source, require("../lib/core.js").toSourceKey(path.join(src.dir, "plan.html")));
    assert.strictEqual(git(store, ["log", "-1", "--format=%s"]), "publish: plan v1 (private)");
    assert.strictEqual(git(store, ["status", "--porcelain"]), "", "committed, clean");
  });

  await check("folder with an image: publish, update, share, unshare a version, unshare the whole, list --json", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("deck/index.html", "Deck", '<img src="img/a.png">');
    src.file("deck/img/a.png", "PNG-1");
    let r = run(store, ["publish", "deck"], { cwd: src.dir });
    assert.strictEqual(r.status, 0, r.all);
    const slug = manifest(store).deliverables.deck.slug;
    assert.ok(fs.existsSync(path.join(store, "private", "d", slug, "img", "a.png")));
    src.file("deck/img/a.png", "PNG-2");
    r = run(store, ["publish", "deck"], { cwd: src.dir });
    assert.match(r.out, /^published deck v2 \(private\)\n/);
    r = run(store, ["publish", "deck"], { cwd: src.dir });
    assert.match(r.out, /^unchanged deck is already at v2 \(private\), nothing published\n/);
    r = run(store, ["share", "deck", "sent to the team"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(r.out, "shared deck (latest v2)\nprivate: http://127.0.0.1:8080/forge/d/" + slug + "/\ndry run (FORGE_DEPLOY=0): nothing was uploaded and the link site was not read\n", "stdout is the result only, printed after the deploy");
    assert.match(r.err, /deploy dry run \(FORGE_DEPLOY=0\): would upload \d+ files/);
    assert.deepStrictEqual(fs.readdirSync(path.join(store, "public", "d", slug)).sort(), ["img", "index.html", "v1", "v2", "versions"]);
    src.file("deck/img/a.png", "PNG-3");
    r = run(store, ["publish", "deck"], { cwd: src.dir });
    assert.strictEqual(r.status, 1, "a shared page is not updated without --live");
    r = run(store, ["publish", "deck", "--live"], { cwd: src.dir });
    assert.deepStrictEqual(r.out.split("\n").slice(0, 3), ["published deck v3 (shared)", "private: http://127.0.0.1:8080/forge/d/" + slug + "/", "dry run (FORGE_DEPLOY=0): nothing was uploaded and the link site was not read"], "a dry run prints no public: line");
    r = run(store, ["unshare", "deck", "--version", "3"]);
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /v3 is the latest version of deck/);
    r = run(store, ["unshare", "deck", "--version", "1"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.deepStrictEqual(fs.readdirSync(path.join(store, "private", "d", slug)), ["v1"]);
    let j = JSON.parse(run(store, ["list", "--json"]).out);
    assert.deepStrictEqual(Object.keys(j), ["schema", "workspace", "baseUrl", "privateBaseUrl", "index", "linkSite", "documents"]);
    assert.deepStrictEqual([j.schema, j.linkSite.state, j.linkSite.basis, j.linkSite.storeCommit], [2, "unknown", "no live read on this machine", git(store, ["rev-parse", "HEAD"])], "a dry run never reads the link site, so nothing is claimed about it");
    assert.deepStrictEqual(j.documents.map((d) => [d.name, d.visibility, d.latest.n, d.versions, d.takenDown, d.publicUrl, d.title]), [
      ["deck", "shared", 3, 3, [1], "https://pub.example.org/d/" + slug + "/", "Deck"],
    ]);
    r = run(store, ["unshare", "deck"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(!fs.existsSync(path.join(store, "public", "d", slug)));
    j = JSON.parse(run(store, ["list", "--json"]).out);
    assert.deepStrictEqual([j.documents[0].visibility, j.documents[0].publicUrl], ["private", null]);
    assert.strictEqual(run(store, ["check"]).out, "dry run (FORGE_DEPLOY=0): the link site was not read\nforge check OK\n");
    assert.deepStrictEqual(git(store, ["log", "--format=%s"]).split("\n").slice(0, 7), [
      "unshare: deck (whole document)", "unshare: deck v1", "publish: deck v3 (shared)", "share: deck (latest v2)",
      "publish: deck v2 (private)", "publish: deck v1 (private)", "configure",
    ]);
  });

  await check("unshare --version N on a private page marks it, so sharing keeps that version off the link site", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("report.html", "Report", "PRIVATE-FIGURE-V1");
    assert.strictEqual(run(store, ["publish", "report.html"], { cwd: src.dir }).status, 0);
    src.page("report.html", "Report", "clean v2");
    assert.strictEqual(run(store, ["publish", "report.html"], { cwd: src.dir }).status, 0);
    const slug = manifest(store).deliverables.report.slug;
    const v1 = path.join(store, "private", "d", slug, "v1");
    const v1Bytes = treeState(v1);
    let r = run(store, ["unshare", "report", "--version", "2"]);
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /v2 is the latest version of report/);
    r = run(store, ["unshare", "report", "--version", "1"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.deepStrictEqual(r.out.split("\n").slice(0, 2), ["v1 will stay off the link site when report is shared", "private: http://127.0.0.1:8080/forge/d/" + slug + "/"]);
    const d = manifest(store).deliverables.report;
    assert.deepStrictEqual([d.visibility, d.versions.map((v) => !!v.takenDown), d.takedowns.map((t) => t.version)], ["private", [true, false], [1]]);
    r = run(store, ["unshare", "report", "--version", "1"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(r.out.split("\n")[0], "report v1 already stays off the link site when report is shared");
    r = run(store, ["share", "report"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.deepStrictEqual(fs.readdirSync(path.join(store, "public", "d", slug)).sort(), ["index.html", "v2", "versions"], "v1 is not in public/");
    assert.deepStrictEqual(treeState(v1), v1Bytes, "v1 stays in private/, byte for byte");
    const hist = fs.readFileSync(path.join(store, "public", "d", slug, "versions", "index.html"), "utf8");
    assert.ok(!hist.includes('href="../v1/"') && hist.includes('href="../v2/"'), "the public history page lists v2 and not v1");
    assert.ok(!treeStateText(path.join(store, "public")).includes("PRIVATE-FIGURE-V1"), "v1's text is nowhere under public/");
    assert.strictEqual(run(store, ["check"]).out, "dry run (FORGE_DEPLOY=0): the link site was not read\nforge check OK\n");
  });

  await check("refused: a different file named plan.html never joins the shared page plan; --name chooses", () => {
    const store = makeStore();
    const a = makeSrc();
    const b = makeSrc();
    a.page("plan.html", "Plan A", "public plan");
    b.page("plan.html", "Plan B", "PRIVATE-B-TEXT");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: a.dir }).status, 0);
    assert.strictEqual(run(store, ["share", "plan"]).status, 0);
    const before = identity(store);
    let r = run(store, ["publish", "plan.html"], { cwd: b.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.strictEqual(r.out, "");
    assert.ok(r.err.includes("refusing: the name plan already belongs to a SHARED page (on the public link site) published from a different file: " + require("../lib/core.js").toSourceKey(path.join(a.dir, "plan.html"))), r.err);
    assert.match(r.err, /--name '<new-name>'/);
    assert.deepStrictEqual(identity(store), before);
    r = run(store, ["publish", "plan.html", "--name", "plan-b"], { cwd: b.dir });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^published plan-b v1 \(private\)/);
    const m = manifest(store);
    assert.deepStrictEqual([m.deliverables.plan.versions.length, m.deliverables.plan.visibility], [1, "shared"]);
    const pub = fs.readdirSync(path.join(store, "public", "d", m.deliverables.plan.slug));
    for (const f of pub.filter((f) => f.endsWith(".html"))) assert.ok(!fs.readFileSync(path.join(store, "public", "d", m.deliverables.plan.slug, f), "utf8").includes("PRIVATE-B-TEXT"));
  });

  await check("a single file that points at files beside it publishes with a warning to publish the folder", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("report/report.html", "Report", '<img src="img/chart.png"><a href="https://x.example.org/a.png">x</a><img src="missing.png">');
    src.file("report/img/chart.png", "PNG");
    const r = run(store, ["publish", "report/report.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(r.out.split("\n")[0], "published report v1 (private)");
    assert.match(r.out, /\nwarning: report\/report\.html points at files beside it \(img\/chart\.png\), and a single file publishes without them: publish the folder instead/);
    src.page("plain.html", "Plain", '<img src="https://x.example.org/a.png">');
    assert.ok(!run(store, ["publish", "plain.html"], { cwd: src.dir }).out.includes("warning"));
  });

  await check("a change whose store no longer loads afterwards changes nothing (import with a bad slug)", () => {
    const store = makeStore();
    const old = tmp("old");
    const site = path.join(old, "site");
    fs.mkdirSync(path.join(site, "d", "bad"), { recursive: true });
    for (const f of ["_headers", "index.html", "404.html"]) fs.copyFileSync(path.join(store, "public", f), path.join(site, f));
    fs.writeFileSync(path.join(site, "d", "bad", "index.html"), "x");
    fs.writeFileSync(path.join(old, "m.json"), JSON.stringify({ indexSlug: null, deliverables: { bad: { slug: "bad", source: "x.html", versions: [{ n: 1, date: "2026-01-01", source: "x.html", sha256: "h" }], shared: [] } } }));
    const before = identity(store);
    const r = run(store, ["import", site, path.join(old, "m.json"), "--source-root", old]);
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /bad: slug must be 12 URL-safe characters/);
    assert.deepStrictEqual(identity(store), before, "put back: same commit, clean tree, same bytes");
  });

  await check("refused: a symlink inside a folder; the store is untouched", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("site/index.html", "Site", "x");
    fs.symlinkSync("/etc/hostname", path.join(src.dir, "site", "link.txt"));
    const before = identity(store);
    const r = run(store, ["publish", "site"], { cwd: src.dir });
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /refusing: .*link\.txt is a symlink/);
    assert.deepStrictEqual(identity(store), before);
  });

  await check("refused: a file over 25 MiB, alone or in a folder; the store is untouched", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("big/index.html", "Big", "x");
    const big = path.join(src.dir, "big", "video.mp4");
    fs.writeFileSync(big, "");
    fs.truncateSync(big, 25 * 1024 * 1024 + 1);
    const lone = path.join(src.dir, "lone.html");
    fs.writeFileSync(lone, "");
    fs.truncateSync(lone, 25 * 1024 * 1024 + 1);
    const before = identity(store);
    let r = run(store, ["publish", "big"], { cwd: src.dir });
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /video\.mp4 is 26214401 bytes, over the 25 MiB per-file limit/);
    r = run(store, ["publish", "lone.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /lone\.html is 26214401 bytes, over the 25 MiB per-file limit/);
    assert.deepStrictEqual(identity(store), before);
    // Exactly 25 MiB passes the source check, but the stamps push it over.
    fs.truncateSync(lone, 25 * 1024 * 1024);
    r = run(store, ["publish", "lone.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /lone\.html is 262\d{5} bytes once stamped \(dark switch and Markdown export\), over the 25 MiB per-file limit/);
    assert.deepStrictEqual(identity(store), before);
  });

  await check("refused: more than 1,000 files; exactly 1,000 is accepted", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("many/index.html", "Many", "x");
    for (let i = 0; i < 1000; i++) src.file("many/f/" + i + ".txt", String(i));
    const before = identity(store);
    let r = run(store, ["publish", "many"], { cwd: src.dir });
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /many has more than 1000 files/);
    assert.deepStrictEqual(identity(store), before);
    fs.rmSync(path.join(src.dir, "many", "f", "999.txt"));
    r = run(store, ["publish", "many"], { cwd: src.dir });
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(fs.readdirSync(path.join(store, "private", "d", manifest(store).deliverables.many.slug, "v1", "f")).length, 999);
  });

  await check("refused: a store with hand edits; nothing changed", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("plan.html", "Plan", "x");
    fs.writeFileSync(path.join(store, "stray.txt"), "hand edit");
    const before = identity(store);
    const r = run(store, ["publish", "plan.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /refusing: this machine's copy of the store has changes no forge command made, so nothing was changed:\n {2}\?\? stray\.txt\nforge never edits this machine's copy of the store by hand and never discards hand edits; tell the owner\./);
    assert.ok(!/\bgit (add|commit|reset|checkout|stash|pull|push)\b/.test(r.err), "never tells anyone to run git: " + r.err);
    assert.deepStrictEqual(identity(store), before);
  });

  await check("a change that fails the check changes nothing (a shared page headed with a private title)", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("secret.html", "Secret Plan Alpha", "private stuff");
    src.page("public.html", "Public Page", "harmless");
    assert.strictEqual(run(store, ["publish", "secret.html"], { cwd: src.dir }).status, 0);
    assert.strictEqual(run(store, ["publish", "public.html"], { cwd: src.dir }).status, 0);
    assert.strictEqual(run(store, ["share", "public"]).status, 0);
    const before = identity(store);
    src.page("public.html", "Public Page", "<h1>Secret Plan Alpha</h1>");
    const r = run(store, ["publish", "public.html", "--live"], { cwd: src.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /refused: the change failed the store check, so nothing was changed/);
    assert.match(r.err, /privacy: public\/d\/[^/]+\/index\.html has the title of private document secret/);
    assert.deepStrictEqual(identity(store), before, "same commit, clean tree, every file's bytes as before");
    assert.deepStrictEqual(manifest(store).deliverables.public.versions.map((v) => v.n), [1], "no v2 recorded");
  });

  await check("lock: two publishes started together serialize; both documents land, each at v1", async () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    src.page("bravo.html", "Bravo", "b");
    const opts = { cwd: src.dir, env: { FORGE_TEST_DELAY_MS: "1500" } };
    const [a, b] = await Promise.all([runAsync(store, ["publish", "alpha.html"], opts), runAsync(store, ["publish", "bravo.html"], opts)]);
    assert.strictEqual(a.status, 0, a.all);
    assert.strictEqual(b.status, 0, b.all);
    assert.ok((a.err + b.err).includes("forge: waiting for another forge command on this store to finish"), "the second one waited");
    const m = manifest(store);
    assert.deepStrictEqual(Object.keys(m.deliverables).sort(), ["alpha", "bravo"]);
    assert.deepStrictEqual([m.deliverables.alpha.versions.map((v) => v.n), m.deliverables.bravo.versions.map((v) => v.n)], [[1], [1]]);
    assert.deepStrictEqual(git(store, ["log", "--format=%s", "-2"]).split("\n").sort(), ["publish: alpha v1 (private)", "publish: bravo v1 (private)"]);
    assert.strictEqual(run(store, ["check"]).status, 0);
    assert.strictEqual(git(store, ["status", "--porcelain"]), "");
  });

  await check("lock: a command that cannot get the lock in time is refused and changes nothing", async () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    src.page("bravo.html", "Bravo", "b");
    const slow = runAsync(store, ["publish", "alpha.html"], { cwd: src.dir, env: { FORGE_TEST_DELAY_MS: "2500" } });
    await new Promise((r) => setTimeout(r, 900));
    const r = run(store, ["publish", "bravo.html"], { cwd: src.dir, env: { FORGE_LOCK_WAIT: "0" } });
    assert.strictEqual(r.status, 75, r.all);
    assert.match(r.err, /refused: another forge command has held the store lock for 0 seconds; nothing was changed; run the same command again/);
    assert.strictEqual((await slow).status, 0);
    assert.deepStrictEqual(Object.keys(manifest(store).deliverables), ["alpha"]);
  });

  await check("lock: a command claiming to hold the lock when nobody does is refused", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    const before = identity(store);
    const r = run(store, ["publish", "alpha.html"], { cwd: src.dir, env: { FORGE_LOCK_HELD: path.join(store, ".git", "forge.lock") } });
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /the store lock is not held/);
    assert.deepStrictEqual(identity(store), before);
  });

  const docs = (store) => Object.fromEntries(Object.entries(manifest(store).deliverables).map(([n, d]) => [n, d.versions.map((v) => v.n)]));

  await check("lock: the writer holds the lock itself; killing it before it writes frees the store, and a competitor lands alone", async () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    src.page("bravo.html", "Bravo", "b");
    const before = identity(store);
    const a = start(store, ["publish", "alpha.html"], { cwd: src.dir, env: { FORGE_TEST_PAUSE: "before:8000" } });
    await a.waitFor(/forge-test: paused at before/);
    const holder = a.holder();
    assert.match(require("node:child_process").execFileSync("ps", ["-o", "args=", "-p", String(holder)], { encoding: "utf8" }), /bin\/forge publish alpha\.html/, "the lock holder is the writer itself");
    process.kill(holder, "SIGKILL");
    const b = run(store, ["publish", "bravo.html"], { cwd: src.dir, env: { FORGE_LOCK_WAIT: "5" } });
    assert.strictEqual(b.status, 0, b.all);
    await a.closed;
    await new Promise((r) => setTimeout(r, 300)); // anything the killed writer could still do
    assert.deepStrictEqual(docs(store), { bravo: [1] }, "the killed command wrote nothing, the competitor landed");
    assert.strictEqual(git(store, ["rev-list", "--count", before.head + "..HEAD"]), "1");
    assert.strictEqual(run(store, ["check"]).status, 0);
    assert.strictEqual(git(store, ["status", "--porcelain"]), "");
  });

  await check("lock: killing the forge process that launched the writer does not unlock; a competitor waits, told who holds the lock", async () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    src.page("bravo.html", "Bravo", "b");
    const a = start(store, ["publish", "alpha.html"], { cwd: src.dir, env: { FORGE_TEST_PAUSE: "before:2500" } });
    await a.waitFor(/forge-test: paused at before/);
    const holder = a.holder();
    process.kill(a.c.pid, "SIGKILL");
    const refused = run(store, ["publish", "bravo.html"], { cwd: src.dir, env: { FORGE_LOCK_WAIT: "0" } });
    assert.strictEqual(refused.status, 75, refused.all);
    assert.ok(refused.err.includes("processes with the store lock file open: pid " + holder + ": node"), refused.err);
    assert.ok(!/bin\/forge publish alpha\.html/.test(refused.err), "the program only, never the command line:\n" + refused.err);
    const b = run(store, ["publish", "bravo.html"], { cwd: src.dir });
    assert.strictEqual(b.status, 0, b.all);
    assert.ok(b.err.includes("forge: waiting for another forge command on this store to finish\nprocesses with the store lock file open: pid " + holder + ": node\n"), b.err);
    assert.deepStrictEqual(docs(store), { alpha: [1], bravo: [1] });
    assert.strictEqual(run(store, ["check"]).status, 0);
    assert.strictEqual(git(store, ["status", "--porcelain"]), "");
  });

  await check("lock: Ctrl-C while waiting changes nothing and releases the lock", async () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    const before = identity(store);
    const { spawn } = require("node:child_process");
    const c = spawn(process.execPath, [require("./helpers.js").FORGE, "publish", "alpha.html"], {
      cwd: src.dir, env: require("./helpers.js").env(store, { FORGE_TEST_DELAY_MS: "3000" }), detached: true, stdio: "ignore",
    });
    const closed = new Promise((r) => c.on("close", r));
    await new Promise((r) => setTimeout(r, 700));
    process.kill(-c.pid, "SIGINT"); // the whole process group, as a terminal's Ctrl-C does
    await closed;
    await new Promise((r) => setTimeout(r, 300));
    assert.deepStrictEqual(identity(store), before);
    const r = run(store, ["publish", "alpha.html"], { cwd: src.dir, env: { FORGE_LOCK_WAIT: "0" } });
    assert.strictEqual(r.status, 0, "lock released: " + r.all);
  });

  await check("remote: a publish pushes; a local commit the remote lacks (the remote moved on too) is never lost: writes refuse naming the push and the rebase; once on the remote, writes work", () => {
    const { a: store, bare } = twoMachines();
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    let r = run(store, ["publish", "alpha.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(git(bare, ["rev-parse", "HEAD"]), git(store, ["rev-parse", "HEAD"]), "pushed");
    const other = path.join(tmp("clone"), "other");
    git(path.dirname(other), ["clone", "-q", bare, other]);
    fs.writeFileSync(path.join(other, "README.md"), "changed elsewhere\n");
    git(other, ["commit", "-qam", "other machine"]);
    git(other, ["push", "-q"]);
    const theirs = git(bare, ["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(store, "schema.md"), "changed here\n");
    git(store, ["commit", "-qam", "this machine"]);
    const mine = git(store, ["rev-parse", "HEAD"]);
    src.page("bravo.html", "Bravo", "b");
    r = run(store, ["publish", "bravo.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes("git -C " + store + " push") && r.err.includes("git -C " + store + " pull --rebase"), r.err);
    assert.strictEqual(git(store, ["rev-parse", "HEAD"]), mine, "this copy's own commit is kept, untouched");
    assert.strictEqual(git(bare, ["rev-parse", "HEAD"]), theirs, "the remote is unchanged");
    git(store, ["pull", "-q", "--rebase"]);
    git(store, ["push", "-q"]);
    r = run(store, ["publish", "bravo.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 0, r.all);
    const log = git(bare, ["log", "--format=%s", "HEAD"]).split("\n");
    assert.ok(log.includes("this machine") && log.includes("other machine"), "both machines' commits are on the remote: " + log);
  });

  await check("remote: a local commit made while a write runs is never lost: the write is saved, this copy keeps its commit and says it could not catch up", async () => {
    const { a: store, bare } = twoMachines();
    const src = makeSrc();
    src.page("bravo.html", "Bravo", "b");
    const p = start(store, ["publish", "bravo.html"], { cwd: src.dir, env: { FORGE_TEST_PAUSE: "fast-forward:4000" } });
    await p.waitFor(/paused at fast-forward/);
    fs.writeFileSync(path.join(store, "schema.md"), "changed here\n");
    git(store, ["commit", "-qam", "this machine"]);
    const mine = git(store, ["rev-parse", "HEAD"]);
    const r = await p.closed;
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^published bravo v1 \(private\)\n/);
    assert.match(r.all, /could not catch up: this machine's copy of the store has saved changes that are not on the remote \(1 commit\(s\)\)\nNothing is lost/);
    assert.ok(JSON.parse(git(bare, ["show", "HEAD:manifest.json"])).deliverables.bravo, "bravo is on the remote");
    assert.strictEqual(git(store, ["rev-parse", "HEAD"]), mine, "this copy's own commit is kept, untouched");
  });

  await check("remote unreachable: the write is refused as 'try again when online', not as divergence; nothing changes", () => {
    const store = makeStore();
    const bare = path.join(tmp("remote"), "store.git");
    git(path.dirname(bare), ["init", "-q", "--bare", bare]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]); // the store's branch, whatever git's default
    git(store, ["remote", "add", "origin", bare]);
    git(store, ["push", "-q", "-u", "origin", "HEAD"]);
    fs.renameSync(bare, bare + ".away");
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    const before = identity(store);
    const r = run(store, ["publish", "alpha.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /^refusing: the store's remote could not be reached, so nothing changed; try again when online:\n/);
    assert.deepStrictEqual(identity(store), before);
  });

  const slugIn = (upload, slug) => upload.files.some((f) => f.includes(slug));

  await check("deploy uploads the remote's committed state, not this machine's stale copy: a page taken down elsewhere is not uploaded again", () => {
    const { a, b } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    assert.strictEqual(run(a, ["share", "plan"], { env: H }).status, 0);
    assert.strictEqual(run(b, ["sync"], { env: H }).status, 0);
    const slug = manifest(a).deliverables.plan.slug;
    assert.ok(fs.existsSync(path.join(b, "public", "d", slug)), "machine B has the shared page");
    host.mode(a, "fail-before");
    const down = run(a, ["unshare", "plan"], { env: H });
    assert.strictEqual(down.status, 3, down.all);
    host.mode(a, null);
    const r = run(b, ["deploy"], { env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^deployed: the link site shows the store at commit [0-9a-f]{12} \(read back live\)\n$/);
    assert.ok(!slugIn(host.uploads(a).pop(), slug), "the taken-down page is not in what B uploaded");
    assert.ok(fs.existsSync(path.join(b, "public", "d", slug)), "B's own copy was not touched");
    assert.strictEqual(host.marker(a).commit, git(a, ["rev-parse", "HEAD"]));
    const again = run(b, ["deploy"], { env: H });
    assert.match(again.out, /already shows the store at commit [0-9a-f]{12} \(read back live\); nothing uploaded/);
  });

  await check("deploy never uploads hand edits in this copy, and refuses a commit that fails the check; nothing is uploaded then", () => {
    const store = host.store();
    fs.writeFileSync(path.join(store, "public", "stray.html"), "x");
    let r = run(store, ["deploy"], { env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(!host.uploads(store).pop().files.includes("stray.html"), "the hand edit is not uploaded");
    fs.rmSync(path.join(store, "public", "stray.html"));
    const n = host.uploads(store).length;
    fs.writeFileSync(path.join(store, "public", "_headers"), "/*\n");
    git(store, ["commit", "-qam", "lose noindex"]);
    r = run(store, ["deploy"], { env: H });
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /refusing to deploy: the store at commit [0-9a-f]{12} fails the check, so it was not deployed:\n {2}public\/_headers does not send X-Robots-Tag: noindex/);
    assert.strictEqual(host.uploads(store).length, n, "nothing uploaded");
  });

  await check("a deploy that finishes after the remote moved on uploads again, so the newest state is what is confirmed live", async () => {
    const { a, b } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    src.page("other.html", "Other", "o");
    for (const args of [["publish", "other.html"], ["share", "other"], ["publish", "plan.html"]]) assert.strictEqual(run(a, args, { cwd: src.dir, env: H }).status, 0);
    const s = start(a, ["share", "plan"], { env: { ...H, FORGE_TEST_PAUSE: "deployed:8000" } });
    await s.waitFor(/forge-test: paused at deployed/);
    host.mode(a, "fail-before"); // B takes a page down, and its own deploy fails
    assert.strictEqual(run(b, ["unshare", "other"], { env: H }).status, 3);
    host.mode(a, null);
    const r = await s.closed;
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.all, /the store's remote moved on during the deploy; deploying its newer state/);
    assert.strictEqual(host.marker(a).tree, git(b, ["rev-parse", "HEAD:public"]), "the live site is the newest state");
    assert.ok(!slugIn(host.uploads(a).pop(), manifest(b).deliverables.other.slug), "A's last upload lacks the page B took down");
    assert.strictEqual(JSON.parse(run(a, ["list", "--json"], { env: H }).out).linkSite.state, "current");
  });

  await check("sync fast-forwards from the remote", () => {
    const store = makeStore();
    const bare = path.join(tmp("remote"), "store.git");
    git(path.dirname(bare), ["init", "-q", "--bare", bare]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]); // the store's branch, whatever git's default
    git(store, ["remote", "add", "origin", bare]);
    git(store, ["push", "-q", "-u", "origin", "HEAD"]);
    assert.strictEqual(run(store, ["sync"]).status, 0);
    const other = path.join(tmp("clone"), "other");
    git(path.dirname(other), ["clone", "-q", bare, other]);
    fs.writeFileSync(path.join(other, "README.md"), "changed elsewhere\n");
    git(other, ["commit", "-qam", "other machine"]);
    git(other, ["push", "-q"]);
    let r = run(store, ["sync"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(git(store, ["rev-parse", "HEAD"]), git(other, ["rev-parse", "HEAD"]));
    fs.writeFileSync(path.join(store, "public", "stray.html"), "x");
    r = run(store, ["sync"]);
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /changes no forge command made(.|\n)*never discards hand edits/);
    assert.strictEqual(run(makeStore(), ["sync"]).out, "the store has no remote; nothing to sync\n");
  });

  await check("a failed deploy is loud, keeps the commit, prints its results and private link, and names what did not finish", () => {
    const store = host.store();
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    const r = run(store, ["publish", "alpha.html"], { cwd: src.dir, env: { ...H, FORGE_FAKE_HOST_TOKEN: "" } });
    assert.strictEqual(r.status, 3, r.all);
    const priv = "http://127.0.0.1:8080/forge/d/" + manifest(store).deliverables.alpha.slug + "/";
    assert.strictEqual(r.out, "published alpha v1 (private)\nprivate: " + priv + "\nshare it with: forge share alpha\n", "results are printed on exit 3");
    assert.match(r.err, /deploy FAILED: no secret named FORGE_FAKE_HOST_TOKEN/);
    assert.ok(r.err.endsWith("NOT FINISHED: updating the link site\n  done: publish: alpha v1 (private) (saved, commit " + git(store, ["rev-parse", "--short=12", "HEAD"]) + ")\n" +
      "  saved; its private link works: " + priv + "\n  separately, the link site is not confirmed: the upload failed\nfinish with: forge deploy\n"), r.err);
    assert.ok(!/BEHIND|behind/.test(run(store, ["list"], { env: H }).out), "no read showed it behind");
    assert.strictEqual(git(store, ["log", "-1", "--format=%s"]), "publish: alpha v1 (private)");
    assert.strictEqual(git(store, ["status", "--porcelain"]), "");
    const d = run(store, ["deploy"], { env: H });
    assert.strictEqual(d.status, 0, d.all);
  });

  await check("check: loud on a broken store; --sources lists sources not on this machine as information", () => {
    const store = makeStore();
    const src = makeSrc();
    const p = src.page("alpha.html", "Alpha", "a");
    run(store, ["publish", "alpha.html"], { cwd: src.dir });
    fs.rmSync(p);
    let r = run(store, ["check", "--sources"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /source not on this machine \(information, not a failure\): alpha: .*alpha\.html\ndry run \(FORGE_DEPLOY=0\): the link site was not read\nforge check OK/);
    const slug = manifest(store).deliverables.alpha.slug;
    fs.writeFileSync(path.join(store, "private", "d", slug, "index.html"), "tampered");
    r = run(store, ["check"]);
    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.err, "forge check FAIL: alpha: stable copy of index.html does not match latest version v1\n");
  });

  await check("regenerate: no-op when current; rebuilds a removed history page and commits it", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    run(store, ["publish", "alpha.html"], { cwd: src.dir });
    let r = run(store, ["regenerate"]);
    assert.match(r.out, /all already current, nothing to commit/);
    const slug = manifest(store).deliverables.alpha.slug;
    const page = path.join(store, "private", "d", slug, "versions", "index.html");
    const bytes = fs.readFileSync(page);
    git(store, ["rm", "-q", page]);
    git(store, ["commit", "-qm", "lose the history page"]);
    r = run(store, ["regenerate"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(fs.readFileSync(page).equals(bytes), "rebuilt byte-identical");
    assert.strictEqual(git(store, ["log", "-1", "--format=%s"]), "regenerate: history pages and master index");
  });

  void CONFIG;
  host.stop();
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
