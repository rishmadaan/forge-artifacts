// Runnable test: node test/state-rules.test.js
// Rules over every route into a bad state, through the real launch
// command against a fake link site (test/fakehost.js): what reaches public/,
// what is live, what an interruption leaves behind, what the privacy check
// catches. Each check states a must-never, not one guard's scenario.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../lib/core.js");
const workspace = require("../lib/workspace.js");
const { check, done, run, git, makeStore, makeSrc, manifest, treeState, start, twoMachines } = require("./helpers.js");
const { startFakeHost } = require("./fakehost.js");

const publicTree = (store) => git(store, ["rev-parse", "HEAD:public"]);
const identity = (store) => ({ head: git(store, ["rev-parse", "HEAD"]), status: git(store, ["status", "--porcelain", "--untracked-files=all"]), tree: treeState(store) });
const docs = (store) => Object.fromEntries(Object.entries(manifest(store).deliverables).map(([n, d]) => [n, [d.visibility, d.versions.map((v) => v.n)]]));
// Temporary worktrees this store's git knows about, other than the store itself.
const worktrees = (store) => git(store, ["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9)).filter((p) => fs.realpathSync.native(p) !== fs.realpathSync.native(store));

(async () => {
  const host = await startFakeHost();
  const H = host.env();

  await check("sink rule: no route publishes into a shared page without --live; public/ is unchanged and the output names the page as SHARED", () => {
    const store = host.store();
    const a = makeSrc();
    const b = makeSrc();
    a.page("status.html", "Status", "public status");
    assert.strictEqual(run(store, ["publish", "status.html"], { cwd: a.dir, env: H }).status, 0);
    assert.strictEqual(run(store, ["share", "status"], { env: H }).status, 0);
    const before = publicTree(store);
    const head = git(store, ["rev-parse", "HEAD"]);
    b.page("notes.html", "Notes", "PRIVATE-NOTES");
    b.page("status.html", "Status B", "PRIVATE-B");
    a.page("status-v2.html", "Status", "PRIVATE-SIBLING");
    const routes = [
      ["--name onto it from another file", ["publish", "notes.html", "--name", "status"], b.dir],
      ["a same-named file elsewhere", ["publish", "status.html"], b.dir],
      ["a -vN sibling", ["publish", "status-v2.html"], a.dir],
      ["the same path with new content", ["publish", "status.html"], a.dir, () => a.page("status.html", "Status", "PRIVATE-EDIT")],
    ];
    for (const [what, args, cwd, prep] of routes) {
      if (prep) prep();
      const r = run(store, args, { cwd, env: H });
      assert.notStrictEqual(r.status, 0, what + ": " + r.all);
      assert.strictEqual(r.out, "", what + ": no result line");
      assert.strictEqual(publicTree(store), before, what + ": public/ unchanged");
      assert.strictEqual(git(store, ["rev-parse", "HEAD"]), head, what + ": nothing committed");
      if (what !== "a same-named file elsewhere") assert.match(r.err, /status is SHARED at http:\/\/127\.0\.0\.1:\d+\/p\d+\/d\/[^/]+\/: this would put the file on the public site now/, what);
    }
    for (const f of Object.keys(host.live(store))) assert.ok(!fs.readFileSync(path.join(host.root, host.projectOf(store), "site", f), "utf8").includes("PRIVATE"), "nothing private went live");
    const r = run(store, ["publish", "status.html", "--live"], { cwd: a.dir, env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^published status v2 \(shared\)\n/);
    assert.notStrictEqual(publicTree(store), before, "with --live it goes public");
  });

  await check("upload succeeds but the read-back fails: exit 3, no public line, says not confirmed; list does not claim current", () => {
    const store = host.store();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    host.mode(store, "readback-fail");
    const r = run(store, ["share", "plan"], { env: H });
    assert.strictEqual(r.status, 3, r.all);
    assert.ok(!/^public: /m.test(r.out), "no public line: " + r.out);
    assert.match(r.out, /^private: /m, "results are printed on exit 3, the private line always");
    assert.match(r.err, /uploaded, not confirmed live; run: forge deploy/);
    assert.notStrictEqual(JSON.parse(run(store, ["list", "--json"], { env: H }).out).linkSite.state, "current");
    host.mode(store, null);
    const d = run(store, ["deploy"], { env: H });
    assert.strictEqual(d.status, 0, d.all);
    assert.strictEqual(JSON.parse(run(store, ["list", "--json"], { env: H }).out).linkSite.state, "current");
  });

  await check("a host that keeps serving the old marker is never reported live", () => {
    const store = host.store();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    host.mode(store, "stale");
    const r = run(store, ["share", "plan"], { env: H });
    assert.strictEqual(r.status, 3, r.all);
    assert.match(r.err, /uploaded, not confirmed live/);
    host.mode(store, null);
  });

  await check("A shares, B takes the page down before A confirms: A prints no public link and the last upload lacks the page", async () => {
    const { a, b } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    const slug = manifest(a).deliverables.plan.slug;
    const s = start(a, ["share", "plan"], { env: { ...H, FORGE_TEST_PAUSE: "deployed:8000" } });
    await s.waitFor(/forge-test: paused at deployed/);
    const down = run(b, ["unshare", "plan"], { env: H });
    assert.strictEqual(down.status, 0, down.all);
    const r = await s.closed;
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(!r.out.includes("public: "), "no public link: " + r.out);
    assert.match(r.out, /plan is private now/);
    const last = host.uploads(a).pop();
    assert.ok(!last.files.some((f) => f.includes(slug)), "the last upload lacks the page");
    assert.ok(!Object.keys(host.live(a)).some((f) => f.includes(slug)), "the link site lacks the page");
  });

  await check("B takes a shared page down while A's share of it waits: A's retry does not share it again", async () => {
    const { a, b } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    assert.strictEqual(run(a, ["share", "plan"], { env: H }).status, 0);
    const slug = manifest(a).deliverables.plan.slug;
    const s = start(a, ["share", "plan", "again"], { env: { ...H, FORGE_TEST_PAUSE: "after-commit:8000" } });
    await s.waitFor(/forge-test: paused at after-commit/);
    assert.strictEqual(run(b, ["unshare", "plan"], { env: H }).status, 0);
    const r = await s.closed;
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(!r.out.includes("public: "), "no public link");
    assert.match(r.err, /another machine changed plan while this command ran/);
    assert.ok(!Object.keys(host.live(a)).some((f) => f.includes(slug)), "the link site lacks the page");
    assert.strictEqual(run(a, ["sync"], { env: H }).status, 0);
    assert.strictEqual(docs(a).plan[0], "private");
  });

  await check("a repeated command after a failed deploy finishes the pending upload", () => {
    const store = host.store();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    host.mode(store, "fail-before");
    let r = run(store, ["share", "plan"], { env: H });
    assert.strictEqual(r.status, 3, r.all);
    host.mode(store, null);
    const n = host.uploads(store).length;
    r = run(store, ["share", "plan"], { env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(host.uploads(store).length, n + 1, "the repeated share uploads");
    assert.strictEqual(host.marker(store).tree, publicTree(store));
    // An unchanged republish over a failed deploy also finishes it.
    src.page("plan.html", "Plan", "p2");
    host.mode(store, "fail-before");
    const failed = run(store, ["publish", "plan.html", "--live"], { cwd: src.dir, env: H });
    assert.strictEqual(failed.status, 3, failed.all);
    assert.ok(!/^public: /m.test(failed.out), "no public line before the link site is confirmed: " + failed.out);
    host.mode(store, null);
    r = run(store, ["publish", "plan.html", "--live"], { cwd: src.dir, env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^unchanged plan/);
    assert.strictEqual(host.marker(store).tree, publicTree(store));
  });

  await check("a failed take-down never says the link is gone; it says the public link still works", () => {
    for (const m of ["fail-before", "fail-after"]) {
      const store = host.store();
      const src = makeSrc();
      src.page("plan.html", "Plan", "p");
      src.page("deck.html", "Deck", "d1");
      for (const a of [["publish", "plan.html"], ["share", "plan"], ["publish", "deck.html"], ["share", "deck"]]) assert.strictEqual(run(store, a, { cwd: src.dir, env: H }).status, 0);
      src.page("deck.html", "Deck", "d2");
      assert.strictEqual(run(store, ["publish", "deck.html", "--live"], { cwd: src.dir, env: H }).status, 0);
      for (const args of [["unshare", "deck", "--version", "1"], ["unshare", "plan"]]) {
        host.mode(store, m);
        const r = run(store, args, { env: H });
        assert.strictEqual(r.status, 3, m + " " + args.join(" ") + ": " + r.all);
        assert.ok(!/not found|is gone|no longer/i.test(r.all), m + ": never says the link is gone: " + r.all);
        assert.match(r.err, /the public link .* STILL WORKS until forge deploy succeeds/);
        assert.ok(!/^public: /m.test(r.out), r.out);
        assert.match(r.out, /^private: /m);
        host.mode(store, null);
        assert.strictEqual(run(store, ["deploy"], { env: H }).status, 0);
      }
    }
  });

  await check("B's list after A's deploy does not say the site is behind; a live read says current", () => {
    const { a, b } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    assert.strictEqual(run(a, ["share", "plan"], { env: H }).status, 0);
    assert.strictEqual(run(b, ["sync"], { env: H }).status, 0);
    const l = run(b, ["list", "--json"], { env: H });
    assert.notStrictEqual(JSON.parse(l.out).linkSite.state, "behind", l.out);
    assert.ok(!/behind/.test(run(b, ["list"], { env: H }).out));
    assert.ok(!/behind/.test(run(b, ["check"], { env: H }).all));
    const live = JSON.parse(run(b, ["list", "--live", "--json"], { env: H }).out).linkSite;
    assert.strictEqual(live.state, "current");
    assert.strictEqual(live.liveCommit, git(a, ["rev-parse", "HEAD"]));
  });

  await check("a push refused because the remote moved is retried from the new head and succeeds; an unreachable remote changes nothing", async () => {
    const { a, b, bare } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    src.page("bravo.html", "Bravo", "b");
    src.page("charlie.html", "Charlie", "c");
    const s = start(a, ["publish", "alpha.html"], { cwd: src.dir, env: { ...H, FORGE_TEST_PAUSE: "after-commit:8000" } });
    await s.waitFor(/forge-test: paused at after-commit/);
    assert.strictEqual(run(b, ["publish", "bravo.html"], { cwd: src.dir, env: H }).status, 0);
    const r = await s.closed;
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(git(a, ["rev-parse", "HEAD"]), git(bare, ["rev-parse", "HEAD"]), "A's copy is the remote's head");
    assert.deepStrictEqual(docs(a), { bravo: ["private", [1]], alpha: ["private", [1]] });
    fs.renameSync(bare, bare + ".away");
    const before = identity(a);
    const u = run(a, ["publish", "charlie.html"], { cwd: src.dir, env: H });
    assert.strictEqual(u.status, 1, u.all);
    assert.match(u.err, /nothing changed; try again when online/i);
    assert.deepStrictEqual(identity(a), before);
    assert.deepStrictEqual(worktrees(a), []);
    fs.renameSync(bare + ".away", bare);
    src.page("delta.html", "Delta", "d");
    assert.strictEqual(run(b, ["publish", "delta.html"], { cwd: src.dir, env: H }).status, 0);
    const back = run(a, ["publish", "charlie.html"], { cwd: src.dir, env: H });
    assert.strictEqual(back.status, 0, back.all);
    assert.deepStrictEqual(Object.keys(docs(a)).sort(), ["alpha", "bravo", "charlie", "delta"]);
  });

  await check("with no remote, a change this copy cannot take is refused, never printed as published", async () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    const s = start(store, ["publish", "alpha.html"], { cwd: src.dir, env: { FORGE_TEST_PAUSE: "after-commit:8000" } });
    await s.waitFor(/forge-test: paused at after-commit/);
    fs.writeFileSync(path.join(store, "README.md"), "a hand commit meanwhile\n");
    git(store, ["commit", "-qam", "hand commit"]);
    const handHead = git(store, ["rev-parse", "HEAD"]);
    const r = await s.closed;
    assert.strictEqual(r.status, 1, r.all);
    assert.strictEqual(r.out, "", "no result line");
    assert.match(r.err, /could not take the change, so nothing was changed/);
    assert.strictEqual(git(store, ["rev-parse", "HEAD"]), handHead);
    assert.deepStrictEqual(Object.keys(manifest(store).deliverables), []);
  });

  await check("an interruption at any step leaves the live copy untouched and only a temporary worktree, which forge recover removes", async () => {
    const steps = [
      ["before", ["publish", "deck"]],
      ["copy", ["publish", "deck"]],
      ["manifest", ["publish", "deck"]],
      ["staged", ["publish", "deck"]],
      ["after-commit", ["publish", "deck"]],
      ["move", ["share", "deck"]],
      ["pushed", ["share", "deck"]],
    ];
    for (const [step, args] of steps) {
      const { a } = twoMachines(() => host.store());
      const src = makeSrc();
      src.page("deck/index.html", "Deck", '<img src="a.png">');
      src.file("deck/a.png", "A1");
      src.file("deck/b.png", "B1");
      assert.strictEqual(run(a, ["publish", "deck"], { cwd: src.dir, env: H }).status, 0);
      src.file("deck/a.png", "A2");
      const before = identity(a);
      const p = start(a, args, { cwd: src.dir, env: { ...H, FORGE_TEST_PAUSE: step + ":8000" } });
      await p.waitFor(new RegExp("forge-test: paused at " + step));
      process.kill(p.holder(), "SIGKILL");
      await p.closed;
      assert.deepStrictEqual(identity(a), before, step + ": the live copy is untouched");
      const r = run(a, ["recover"], { env: H });
      assert.strictEqual(r.status, 0, step + ": " + r.all);
      // Killed after the push: the change is on the remote, so recover says so.
      assert.match(r.out, step === "pushed" ? /the change was saved \(commit [0-9a-f]{12}: \S.*\); run forge deploy to finish/ : /(nothing was committed in it, so nothing was saved|\) was not saved); run the interrupted command again/, step);
      assert.deepStrictEqual(worktrees(a), [], step + ": no temporary worktree left");
      assert.deepStrictEqual(identity(a), before, step + ": recover touched nothing in the live copy");
      const again = run(a, args, { cwd: src.dir, env: H });
      assert.strictEqual(again.status, 0, step + ": the command runs again: " + again.all);
    }
  });

  await check("hand edits in the live copy are refused, listed, and still present afterwards (recover included)", () => {
    const store = host.store();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    src.page("other.html", "Other", "o");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    const slug = manifest(store).deliverables.plan.slug;
    const page = path.join(store, "private", "d", slug, "index.html");
    fs.writeFileSync(page, "HAND EDIT");
    fs.writeFileSync(path.join(store, "private", "d", slug, "extra.txt"), "HAND ADDED");
    for (const args of [["publish", "other.html"], ["recover"]]) {
      const r = run(store, args, { cwd: src.dir, env: H });
      assert.match(r.all, new RegExp("private/d/" + slug + "/index\\.html"));
      assert.match(r.all, /never discards hand edits/);
      assert.strictEqual(fs.readFileSync(page, "utf8"), "HAND EDIT");
      assert.strictEqual(fs.readFileSync(path.join(store, "private", "d", slug, "extra.txt"), "utf8"), "HAND ADDED");
      if (args[0] === "publish") assert.strictEqual(r.status, 1);
    }
    assert.deepStrictEqual(Object.keys(docs(store)), ["plan"]);
    // recover runs even when the hand edit breaks the store's own files
    fs.writeFileSync(path.join(store, "manifest.json"), '{"torn');
    const r = run(store, ["recover"], { env: H });
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /never discards hand edits(.|\n)* M manifest\.json/);
    assert.strictEqual(fs.readFileSync(path.join(store, "manifest.json"), "utf8"), '{"torn');
  });

  await check("privacy: a private folder page's source copied into a shared folder is caught, even under a shared title", () => {
    const store = makeStore();
    const src = makeSrc();
    const ws = () => workspace.load(store);
    src.page("secret/index.html", "Secret Board", "SECRET-FOLDER-TEXT");
    src.file("secret/s.png", "S");
    let w = ws();
    core.publish(w, path.join(src.dir, "secret"));
    src.page("pub/index.html", "Secret Board", "harmless, and its title is public anyway");
    fs.copyFileSync(path.join(src.dir, "secret", "index.html"), path.join(src.dir, "pub", "board.html"));
    w = ws();
    const r = core.publish(w, path.join(src.dir, "pub"));
    core.share(w, r.name, "");
    const found = core.check(w);
    assert.ok(found.some((p) => /board\.html/.test(p) && /private document secret/.test(p)), "the folder page's source copy is named: " + JSON.stringify(found));
  });

  host.stop();
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
