// Runnable test: node test/outcome-rules.test.js
// Outcome rules: what a command reports comes from one outcome record (saved,
// site, local), each fact read from durable state, never from which call threw.
// Through the real launch command, against a fake link site (test/fakehost.js)
// or a dry run. Each check states a must-never over every route.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { check, done, run, git, tmp, makeSrc, manifest, treeState, start, twoMachines } = require("./helpers.js");
const { startFakeHost } = require("./fakehost.js");

const identity = (store) => ({ head: git(store, ["rev-parse", "HEAD"]), status: git(store, ["status", "--porcelain", "--untracked-files=all"]), tree: treeState(store) });
const worktrees = (store) => git(store, ["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9)).filter((p) => fs.realpathSync.native(p) !== fs.realpathSync.native(store));
const NOTHING_CHANGED = /nothing (was )?changed/i;

(async () => {
  const host = await startFakeHost();
  const H = host.env();

  await check("the remote becomes unreachable after the upload: exit 3, no public line, no current record", async () => {
    const { a, bare } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    const s = start(a, ["share", "plan"], { env: { ...H, FORGE_TEST_PAUSE: "deployed:6000" } });
    await s.waitFor(/forge-test: paused at deployed/);
    fs.renameSync(bare, bare + ".away");
    const r = await s.closed;
    fs.renameSync(bare + ".away", bare);
    assert.strictEqual(r.status, 3, r.all);
    assert.ok(!/^public: /m.test(r.out), "no public line: " + r.out);
    assert.match(r.out, /^private: /m);
    assert.notStrictEqual(JSON.parse(run(a, ["list", "--json"], { env: H }).out).linkSite.state, "current");
  });

  await check("an ignored hand-made file at a path the other machine publishes keeps its bytes, and the path is named", () => {
    const { a, b } = twoMachines();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(b, ["publish", "plan.html"], { cwd: src.dir }).status, 0);
    const slug = manifest(b).deliverables.plan.slug;
    const rel = "private/d/" + slug + "/index.html";
    fs.mkdirSync(path.join(a, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(a, rel), "HAND-MADE BYTES");
    fs.appendFileSync(path.join(a, ".git", "info", "exclude"), "private/d/" + slug + "/\n");
    const s = run(a, ["sync"]);
    assert.notStrictEqual(s.status, 0, s.all);
    assert.ok(s.all.includes(rel), "sync names the path: " + s.all);
    assert.strictEqual(fs.readFileSync(path.join(a, rel), "utf8"), "HAND-MADE BYTES");
    src.page("other.html", "Other", "o");
    const w = run(a, ["publish", "other.html"], { cwd: src.dir });
    assert.ok(w.all.includes(rel), "a write names the path: " + w.all);
    assert.strictEqual(fs.readFileSync(path.join(a, rel), "utf8"), "HAND-MADE BYTES");
    assert.ok(!NOTHING_CHANGED.test(w.all), w.all);
  });

  await check("a take-down killed after the push: recover says saved, the second run exits 0, the last upload lacks the page, one take-down commit", async () => {
    const { a, bare } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    assert.strictEqual(run(a, ["share", "plan"], { env: H }).status, 0);
    const slug = manifest(a).deliverables.plan.slug;
    const p = start(a, ["unshare", "plan"], { env: { ...H, FORGE_TEST_PAUSE: "pushed:8000" } });
    await p.waitFor(/forge-test: paused at pushed/);
    process.kill(p.holder(), "SIGKILL");
    await p.closed;
    const rec = run(a, ["recover"], { env: H });
    assert.strictEqual(rec.status, 0, rec.all);
    assert.match(rec.out, /the change was saved \(commit [0-9a-f]{12}: unshare: plan \(whole document\)\); run forge deploy to finish/);
    assert.deepStrictEqual(worktrees(a), []);
    const again = run(a, ["unshare", "plan"], { env: H });
    assert.strictEqual(again.status, 0, again.all);
    assert.match(again.out, /plan was already private; the link site is confirmed not to serve it/);
    assert.ok(!host.uploads(a).pop().files.some((f) => f.includes(slug)), "the last upload lacks the page");
    assert.strictEqual(git(bare, ["log", "--format=%s"]).split("\n").filter((l) => l.startsWith("unshare: plan")).length, 1, "one take-down commit");
    const v = run(a, ["unshare", "plan", "--version", "1"], { env: H });
    assert.strictEqual(v.status, 1, "the latest version of a private page cannot be marked to stay off (the stable link shows it): " + v.all);
    assert.match(v.err, /v1 is the latest version of plan/);
  });

  await check("the source moves away after the push: the publish still exits 0 with its result lines", async () => {
    const store = host.store();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    const s = start(store, ["publish", "plan.html"], { cwd: src.dir, env: { ...H, FORGE_TEST_PAUSE: "deployed:6000" } });
    await s.waitFor(/forge-test: paused at deployed/);
    fs.rmSync(path.join(src.dir, "plan.html"));
    const r = await s.closed;
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^published plan v1 \(private\)$/m);
  });

  await check("rule: a failure at any step after the push never exits 1 and never says nothing changed", () => {
    for (const point of ["pushed", "fast-forward", "deployed", "lines"]) {
      const { a, bare } = twoMachines(() => host.store());
      const src = makeSrc();
      src.page("plan.html", "Plan", "p");
      assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
      const r = run(a, ["share", "plan"], { env: { ...H, FORGE_TEST_THROW: point } });
      assert.strictEqual(r.status, 3, point + ": " + r.all);
      assert.ok(!NOTHING_CHANGED.test(r.all), point + ": " + r.all);
      // Inside the deploy a failure is the link site not confirmed; elsewhere a later step.
      assert.match(r.err, new RegExp((point === "deployed" ? "the link site is not confirmed" : "a later step failed") + ": forge-test: injected failure at " + point), point);
      assert.match(r.out, /^private: /m, point);
      // Reported where it happened, through report() (it names the commit), not
      // only by the top handler's last-resort catch.
      assert.match(r.err, /\(saved and pushed, commit [0-9a-f]{12}\)/, point + ": " + r.err);
      assert.strictEqual(JSON.parse(git(bare, ["show", "HEAD:manifest.json"])).deliverables.plan.visibility, "shared", point + ": saved");
    }
  });

  await check("the push lands but reports failure: with fetch failing exit 4 (not known), with fetch working it is saved", () => {
    const wrap = tmp("gitwrap");
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    fs.writeFileSync(path.join(wrap, "git"), [
      "#!/bin/sh",
      'if [ "$1" = push ]; then "$REAL_GIT" "$@"; touch "$WRAP_FLAG"; echo "fatal: the remote end hung up unexpectedly" >&2; exit 1; fi',
      'if [ "$1" = fetch ] && [ -e "$WRAP_FLAG" ] && [ -n "$WRAP_FETCH_FAIL" ]; then echo "fatal: unable to access the remote" >&2; exit 128; fi',
      'exec "$REAL_GIT" "$@"',
      "",
    ].join("\n"), { mode: 0o755 });
    for (const failFetch of [true, false]) {
      const { a, bare } = twoMachines();
      const src = makeSrc();
      src.page("plan.html", "Plan", "p");
      const flag = path.join(wrap, "pushed-" + failFetch);
      const r = run(a, ["publish", "plan.html"], { cwd: src.dir, env: { PATH: wrap + path.delimiter + process.env.PATH, REAL_GIT: realGit, WRAP_FLAG: flag, WRAP_FETCH_FAIL: failFetch ? "1" : "" } });
      assert.ok(fs.existsSync(flag), "the push ran");
      assert.ok(git(bare, ["log", "--format=%s"]).includes("publish: plan v1"), "the remote really has it");
      assert.ok(!NOTHING_CHANGED.test(r.all), failFetch + ": " + r.all);
      if (failFetch) {
        assert.strictEqual(r.status, 4, r.all);
        assert.match(r.err, /^NOT KNOWN whether the change was saved: /m);
        assert.match(r.err, /When online, run forge sync, then forge list: if the change is there, run forge deploy to finish; if it is not, run the same command again\./);
        assert.strictEqual(r.out, "");
      } else {
        assert.strictEqual(r.status, 0, r.all);
        assert.match(r.out, /^published plan v1 \(private\)$/m);
      }
    }
  });

  await check("a copy left half-updated with .git/index.lock: recover names it, not as hand edits, and touches nothing", () => {
    const { a, b } = twoMachines();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(b, ["publish", "plan.html"], { cwd: src.dir }).status, 0);
    git(a, ["fetch", "-q"]);
    const up = git(a, ["rev-parse", "@{u}"]);
    // What an interrupted fast-forward leaves: some incoming files written, the index lock still there.
    fs.writeFileSync(path.join(a, "manifest.json"), git(a, ["show", "@{u}:manifest.json"]) + "\n");
    const lockFile = path.join(a, ".git", "index.lock");
    fs.writeFileSync(lockFile, "");
    const before = identity(a);
    for (const args of [["recover"], ["publish", "plan.html"]]) {
      const r = run(a, args, { cwd: src.dir });
      assert.strictEqual(r.status, 1, r.all);
      assert.match(r.all, /a forge command was stopped while updating this machine's copy/);
      assert.match(r.all, new RegExp("safe on the store's remote at commit " + up.slice(0, 12)));
      assert.match(r.all, /will not repair it by guessing/);
      assert.ok(!/hand edit/i.test(r.all), r.all);
      assert.deepStrictEqual(identity(a), before, "nothing touched");
      assert.ok(fs.existsSync(lockFile));
    }
  });

  await check("a private publish with the link site unreadable prints its private link, says saved, and uploads nothing", () => {
    const store = host.store();
    const src = makeSrc();
    // The store's first publish creates the public master index; this check is about the next one.
    src.page("first.html", "First", "f");
    assert.strictEqual(run(store, ["publish", "first.html"], { cwd: src.dir, env: H }).status, 0);
    const n = host.uploads(store).length;
    host.mode(store, "readback-fail");
    src.page("plan.html", "Plan", "p");
    const r = run(store, ["publish", "plan.html"], { cwd: src.dir, env: H });
    host.mode(store, null);
    assert.strictEqual(r.status, 3, r.all);
    assert.match(r.out, /^published plan v1 \(private\)$/m);
    assert.match(r.out, /^private: http/m);
    assert.match(r.err, /saved; its private link works: http/);
    assert.strictEqual(host.uploads(store).length, n, "no upload");
  });

  await check("a link site with no marker yet (HTTP 404, never deployed) is levelled by a private publish: exit 0", () => {
    const store = host.store();
    const src = makeSrc();
    src.page("first.html", "First", "f");
    assert.strictEqual(run(store, ["publish", "first.html"], { cwd: src.dir }).status, 0, "saved with deploys off");
    src.page("plan.html", "Plan", "p");
    const r = run(store, ["publish", "plan.html"], { cwd: src.dir, env: H });
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(host.uploads(store).length, 1);
    assert.strictEqual(host.marker(store).tree, git(store, ["rev-parse", "HEAD:public"]));
  });

  await check("words: hand-edit refusal names forge recover --set-aside and the README section; derived-name refusal says SHARED; share's done line; UTC times", () => {
    const store = host.store();
    const a = makeSrc();
    const b = makeSrc();
    a.page("plan.html", "Plan", "p");
    b.page("plan.html", "Plan B", "q");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: a.dir, env: H }).status, 0);
    host.mode(store, "readback-fail");
    const s = run(store, ["share", "plan"], { env: H });
    host.mode(store, null);
    assert.match(s.err, /done: share: plan \(latest v1\)/);
    assert.ok(!/now public/.test(s.all), s.all);
    assert.strictEqual(run(store, ["deploy"], { env: H }).status, 0);
    const d = run(store, ["publish", "plan.html"], { cwd: b.dir, env: H });
    assert.match(d.err, /belongs to a SHARED page/);
    assert.match(run(store, ["list"], { env: H }).out, /link site: current.* UTC\)/);
    fs.writeFileSync(path.join(store, "README.md"), "hand edit\n");
    const h = run(store, ["publish", "plan.html"], { cwd: b.dir, env: H });
    assert.match(h.err, /forge recover --set-aside(.|\n)*Setting changes aside \(only when the owner asks\)/);
  });

  host.stop();
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
