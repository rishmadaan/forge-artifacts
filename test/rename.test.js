// Runnable test: node test/rename.test.js
// forge rename <old> <new> through the real launch command: only the page's
// name changes (the manifest entry is the same object under a new key), its
// links keep serving, each refusal changes nothing, and an interrupted rename
// recovers like every other write. FORGE_DEPLOY=0, or the fake link site.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { check, done, run, runAsync, git, makeStore, makeSrc, manifest, treeState, start, twoMachines } = require("./helpers.js");
const { startFakeHost } = require("./fakehost.js");

const identity = (store) => ({ head: git(store, ["rev-parse", "HEAD"]), status: git(store, ["status", "--porcelain", "--untracked-files=all"]), tree: treeState(store) });
const worktrees = (store) => git(store, ["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9)).filter((p) => fs.realpathSync.native(p) !== fs.realpathSync.native(store));
const sub = (state, prefix) => Object.fromEntries(Object.entries(state).filter(([k]) => k.startsWith(prefix)));
const PRIV = "http://127.0.0.1:8080/forge";
const get = (url) => new Promise((ok, bad) => http.get(url, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => ok({ status: res.statusCode, body: b })); }).on("error", bad));

// Three pages: alpha (private), plan (the one renamed), zulu (private), in that order.
function seed(store, env) {
  const src = makeSrc();
  for (const [f, t] of [["alpha.html", "Alpha"], ["plan.html", "Plan Doc"], ["zulu.html", "Zulu"]]) {
    src.page(f, t, f);
    const r = run(store, ["publish", f], { cwd: src.dir, env });
    assert.strictEqual(r.status, 0, r.all);
  }
  return src;
}

(async () => {
  const host = await startFakeHost();
  const H = host.env();

  await check("rename a private page: same entry under the new key, same place, links unchanged, nothing deployed, check clean", () => {
    const store = host.store();
    const src = seed(store, H);
    src.page("plan.html", "Plan Doc", "second");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    const before = manifest(store);
    const entry = before.deliverables.plan;
    const files = treeState(store);
    const uploads = host.uploads(store).length;
    const r = run(store, ["rename", "plan", "year-one-plan"], { env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.deepStrictEqual(r.out.trim().split("\n"), [
      "renamed plan to year-one-plan",
      "private: " + PRIV + "/d/" + entry.slug + "/",
      "note: notes or scripts that name plan must be updated by hand; forge now knows this page only as year-one-plan",
    ]);
    const after = manifest(store);
    assert.deepStrictEqual(after.deliverables["year-one-plan"], entry, "the whole entry, byte for byte as JSON, under the new key");
    assert.strictEqual(JSON.stringify(after.deliverables["year-one-plan"]), JSON.stringify(entry));
    assert.ok(!Object.hasOwn(after.deliverables, "plan"), "the old name is gone");
    assert.deepStrictEqual(Object.keys(after.deliverables), ["alpha", "year-one-plan", "zulu"], "it keeps its place in the list");
    assert.strictEqual(after.indexSlug, before.indexSlug);
    const rest = (m) => { const c = JSON.parse(JSON.stringify(m)); delete c.deliverables.plan; delete c.deliverables["year-one-plan"]; return c; };
    assert.deepStrictEqual(rest(after), rest(before), "every other page and field is unchanged");
    const now = treeState(store);
    delete now["manifest.json"];
    delete files["manifest.json"];
    assert.deepStrictEqual(now, files, "a titled private page: no generated file names it, so no file but the manifest changed");
    assert.deepStrictEqual(git(store, ["show", "--name-only", "--format=", "HEAD"]).split("\n"), ["manifest.json"]);
    assert.strictEqual(git(store, ["log", "-1", "--format=%s"]), "rename: plan to year-one-plan");
    assert.strictEqual(host.uploads(store).length, uploads, "nothing public changed, so nothing was deployed");
    const c = run(store, ["check"], { env: H });
    assert.strictEqual(c.status, 0, c.all);
    assert.match(c.out, /forge check OK/);
    const list = JSON.parse(run(store, ["list", "--json"], { env: H }).out);
    assert.strictEqual(list.schema, 2);
    const doc = list.documents.find((d) => d.name === "year-one-plan");
    assert.strictEqual(doc.privateUrl, PRIV + "/d/" + entry.slug + "/");
    assert.strictEqual(doc.title, "Plan Doc");
    assert.ok(!list.documents.some((d) => d.name === "plan"));
    // The new name works everywhere a name is taken; the old one is no page.
    assert.match(run(store, ["share", "plan"], { env: H }).err, /unknown document: plan \(forge list shows every name\)/);
    const s = run(store, ["share", "year-one-plan"], { env: H });
    assert.strictEqual(s.status, 0, s.all);
  });

  await check("rename a shared page: same entry, its public link still serves the same page, the master index is redeployed with the new name", async () => {
    const store = host.store();
    seed(store, H);
    const sh = run(store, ["share", "plan", "for the team"], { env: H });
    assert.strictEqual(sh.status, 0, sh.all);
    const entry = manifest(store).deliverables.plan;
    const indexSlug = manifest(store).indexSlug;
    const pub = host.baseUrl(host.projectOf(store)) + "/d/" + entry.slug + "/";
    const page = await get(pub);
    assert.strictEqual(page.status, 200);
    const pageFiles = sub(host.live(store), "d/" + entry.slug + "/");
    assert.ok(Object.keys(pageFiles).length >= 3, "the page, its version and its history page are live");
    const uploads = host.uploads(store).length;
    const r = run(store, ["rename", "plan", "team-plan"], { env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.deepStrictEqual(r.out.trim().split("\n"), [
      "renamed plan to team-plan",
      "private: " + PRIV + "/d/" + entry.slug + "/",
      "public: " + pub,
      "note: notes or scripts that name plan must be updated by hand; forge now knows this page only as team-plan",
    ]);
    const after = manifest(store).deliverables;
    assert.deepStrictEqual(after["team-plan"], entry);
    assert.ok(!Object.hasOwn(after, "plan"));
    assert.deepStrictEqual(Object.keys(after), ["alpha", "team-plan", "zulu"]);
    assert.strictEqual(host.uploads(store).length, uploads + 1, "the master index changed, so the link site was updated once");
    assert.deepStrictEqual(sub(host.live(store), "d/" + entry.slug + "/"), pageFiles, "the page's own public files are byte for byte the same");
    const again = await get(pub);
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body, page.body, "the public link serves the same page");
    const index = (await get(host.baseUrl(host.projectOf(store)) + "/d/" + indexSlug + "/")).body;
    assert.match(index, /data-text="team-plan plan doc"/);
    assert.ok(!/data-text="plan /.test(index), "the old name is off the index");
    assert.strictEqual(host.marker(store).commit, git(store, ["rev-parse", "HEAD"]), "the link site is confirmed at the rename's commit");
    const c = run(store, ["check"], { env: H });
    assert.strictEqual(c.status, 0, c.all);
    assert.match(c.out, /forge check OK/);
    // Taking it down by its new name works; by its old name it is no page.
    assert.strictEqual(run(store, ["unshare", "plan"], { env: H }).status, 1);
    assert.strictEqual(run(store, ["unshare", "team-plan"], { env: H }).status, 0);
  });

  await check("a page with no <title> shows its name on its history page: that page is rebuilt with the new name", () => {
    const store = makeStore();
    const src = makeSrc();
    src.file("notes.html", "<html><body>no title here</body></html>");
    assert.strictEqual(run(store, ["publish", "notes.html"], { cwd: src.dir }).status, 0);
    const slug = manifest(store).deliverables.notes.slug;
    const hist = path.join(store, "private", "d", slug, "versions", "index.html");
    assert.match(fs.readFileSync(hist, "utf8"), /notes/);
    const r = run(store, ["rename", "notes", "field-notes"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.match(fs.readFileSync(hist, "utf8"), /field-notes/);
    assert.deepStrictEqual(git(store, ["show", "--name-only", "--format=", "HEAD"]).split("\n").sort(), ["manifest.json", "private/d/" + slug + "/versions/index.html"]);
    assert.strictEqual(run(store, ["check"]).status, 0);
  });

  await check("refused, changing nothing: not a page, empty new name, new name already a page, same name, wrong argument count", () => {
    const store = makeStore();
    seed(store);
    const before = identity(store);
    const cases = [
      [["rename", "nope", "other"], /^unknown document: nope \(forge list shows every name\)$/m],
      [["rename", "plan", ""], /^refusing: the new name is empty; a page needs a name\. Nothing was changed\. Run: forge rename 'plan' '<new-name>'$/m],
      [["rename", "plan", "zulu"], /^refusing: zulu is already a page \(forge list shows it\); pick another new name\. Nothing was changed\. Run: forge rename 'plan' '<new-name>'$/m],
      [["rename", "plan", "plan"], /^refusing: plan already has that name, so there is nothing to rename\. Nothing was changed\.$/m],
      [["rename", "plan"], /^usage: forge rename <old> <new>$/m],
      [["rename", "plan", "a", "b"], /^usage: forge rename <old> <new>$/m],
    ];
    for (const [args, re] of cases) {
      const r = run(store, args);
      assert.strictEqual(r.status, 1, args.join(" ") + ": " + r.all);
      assert.match(r.err, re, args.join(" "));
      assert.strictEqual(r.out, "", args.join(" ") + ": no result lines");
      assert.deepStrictEqual(identity(store), before, args.join(" ") + ": same commit, clean tree, every file's bytes");
    }
  });

  await check("names that are also built-in object properties: only real pages count", () => {
    const store = makeStore();
    seed(store);
    const before = identity(store);
    for (const ghost of ["toString", "constructor", "__proto__"]) {
      const r = run(store, ["rename", ghost, "x"]);
      assert.strictEqual(r.status, 1, ghost + ": " + r.all);
      assert.match(r.err, new RegExp("unknown document: " + ghost));
      assert.deepStrictEqual(identity(store), before, ghost);
    }
    const entry = manifest(store).deliverables.plan;
    let r = run(store, ["rename", "plan", "constructor"]);
    assert.strictEqual(r.status, 0, r.all);
    // "__proto__" breaks the name rule, so it can never become a page name.
    r = run(store, ["rename", "zulu", "__proto__"]);
    assert.strictEqual(r.status, 1, r.all);
    const m = manifest(store).deliverables;
    assert.deepStrictEqual(Object.keys(m), ["alpha", "constructor", "zulu"]);
    assert.deepStrictEqual(m.constructor, entry);
    assert.strictEqual(run(store, ["check"]).status, 0);
    r = run(store, ["rename", "constructor", "plan"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.deepStrictEqual(manifest(store).deliverables.plan, entry);
  });

  await check("refused: a store with hand edits; nothing changed", () => {
    const store = makeStore();
    seed(store);
    fs.writeFileSync(path.join(store, "stray.txt"), "hand edit");
    const before = identity(store);
    const r = run(store, ["rename", "plan", "other"]);
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /refusing: this machine's copy of the store has changes no forge command made, so nothing was changed:\n {2}\?\? stray\.txt/);
    assert.deepStrictEqual(identity(store), before);
  });

  await check("lock: a rename waits for the store lock like any write (refused with 75 when it cannot get it)", async () => {
    const store = makeStore();
    seed(store);
    const src = makeSrc();
    src.page("bravo.html", "Bravo", "b");
    const slow = runAsync(store, ["publish", "bravo.html"], { cwd: src.dir, env: { FORGE_TEST_DELAY_MS: "2500" } });
    await new Promise((r) => setTimeout(r, 900));
    const before = manifest(store);
    const r = run(store, ["rename", "plan", "other"], { env: { FORGE_LOCK_WAIT: "0" } });
    assert.strictEqual(r.status, 75, r.all);
    assert.match(r.err, /another forge command has held the store lock/);
    assert.strictEqual((await slow).status, 0);
    assert.deepStrictEqual(Object.keys(manifest(store).deliverables), [...Object.keys(before.deliverables), "bravo"]);
  });

  await check("two machines: the other machine still using the old name gets the normal no-such-page refusal", () => {
    const { a, b } = twoMachines(() => makeStore());
    seed(a);
    git(a, ["push", "-q"]);
    assert.strictEqual(run(b, ["sync"]).status, 0);
    const r = run(a, ["rename", "plan", "team-plan"]);
    assert.strictEqual(r.status, 0, r.all);
    const before = identity(b);
    const old = run(b, ["share", "plan"]);
    assert.strictEqual(old.status, 1, old.all);
    assert.match(old.err, /unknown document: plan \(forge list shows every name\)/);
    assert.deepStrictEqual(identity(b), before, "nothing changed on b");
    const again = run(b, ["rename", "plan", "other"]);
    assert.strictEqual(again.status, 1);
    assert.match(again.err, /unknown document: plan/);
    assert.strictEqual(run(b, ["sync"]).status, 0);
    assert.deepStrictEqual(Object.keys(manifest(b).deliverables), ["alpha", "team-plan", "zulu"]);
  });

  await check("another machine renames the page right after this rename is saved: the result says so, with the page's private line and its name now", async () => {
    const { a, b } = twoMachines(() => makeStore());
    seed(a);
    assert.strictEqual(run(b, ["sync"]).status, 0);
    const slug = manifest(a).deliverables.plan.slug;
    const p = start(a, ["rename", "plan", "constructor"], { env: { FORGE_TEST_PAUSE: "fast-forward:5000" } });
    await p.waitFor(/forge-test: paused at fast-forward/);
    assert.strictEqual(run(b, ["sync"]).status, 0);
    const rb = run(b, ["rename", "constructor", "zeta"]);
    assert.strictEqual(rb.status, 0, rb.all);
    const ra = await p.closed;
    assert.strictEqual(ra.status, 0, ra.all);
    assert.deepStrictEqual(ra.out.trim().split("\n"), [
      "renamed plan to constructor",
      "note: another machine has since renamed constructor to zeta; forge list shows every name",
      "private: " + PRIV + "/d/" + slug + "/",
      "note: notes or scripts that name plan must be updated by hand; forge now knows this page only as zeta",
      "dry run (FORGE_DEPLOY=0): nothing was uploaded and the link site was not read",
    ]);
    assert.ok(!/undefined/.test(ra.all), ra.all);
    assert.deepStrictEqual(Object.keys(manifest(a).deliverables), ["alpha", "zeta", "zulu"]);
  });

  await check("an interrupted rename leaves the live copy untouched and only a temporary worktree, which forge recover removes", async () => {
    for (const step of ["before", "manifest", "staged", "after-commit", "pushed"]) {
      const { a } = twoMachines(() => host.store());
      seed(a, H);
      git(a, ["push", "-q"]);
      const before = identity(a);
      const p = start(a, ["rename", "plan", "team-plan"], { env: { ...H, FORGE_TEST_PAUSE: step + ":8000" } });
      await p.waitFor(new RegExp("forge-test: paused at " + step));
      process.kill(p.holder(), "SIGKILL");
      await p.closed;
      assert.deepStrictEqual(identity(a), before, step + ": the live copy is untouched");
      const r = run(a, ["recover"], { env: H });
      assert.strictEqual(r.status, 0, step + ": " + r.all);
      assert.match(r.out, step === "pushed" ? /the change was saved \(commit [0-9a-f]{12}: rename: plan to team-plan\); run forge deploy to finish/ : /(nothing was committed in it, so nothing was saved|\) was not saved); run the interrupted command again/, step);
      assert.deepStrictEqual(worktrees(a), [], step + ": no temporary worktree left");
      assert.deepStrictEqual(identity(a), before, step + ": recover touched nothing in the live copy");
      if (step === "pushed") {
        // Saved: running it again finds no page by the old name; catching up shows the rename.
        const again = run(a, ["rename", "plan", "team-plan"], { env: H });
        assert.strictEqual(again.status, 1, again.all);
        assert.match(again.err, /unknown document: plan/);
        assert.strictEqual(run(a, ["sync"], { env: H }).status, 0);
        assert.strictEqual(run(a, ["deploy"], { env: H }).status, 0);
      } else {
        const again = run(a, ["rename", "plan", "team-plan"], { env: H });
        assert.strictEqual(again.status, 0, step + ": the command runs again: " + again.all);
      }
      assert.deepStrictEqual(Object.keys(manifest(a).deliverables), ["alpha", "team-plan", "zulu"], step);
      assert.strictEqual(run(a, ["check"], { env: H }).status, 0, step);
    }
  });

  host.stop();
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
