// Runnable test: node test/identity.test.js
// A page is its slug; its name can change (rename) and be given to another
// page. Two rules, over every page-writing command, with two machines sharing
// one remote:
//   1. a retry (the remote moved, so the change is made again from its new
//      state) that finds the name now on a different page refuses and
//      changes nothing; it never shares, publishes, takes down or renames the
//      other page;
//   2. the result lines describe the page the command changed, found by its
//      slug, under the name it has now, never another page that took its name.
// Every check asserts WHICH page (slug) changed. FORGE_DEPLOY=0.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, run, git, makeStore, makeSrc, manifest, start, twoMachines } = require("./helpers.js");

// Each page by slug: [its name, visibility, version numbers].
const pages = (store) => Object.fromEntries(Object.entries(manifest(store).deliverables).map(([n, d]) => [d.slug, [n, d.visibility, d.versions.map((v) => v.n)]]));
const ok = (r, what) => assert.strictEqual(r.status, 0, what + ": " + r.all);

// A has page plan (slug X) from plan.html, optionally shared; B is in sync.
function setup(shared) {
  const { a, b } = twoMachines(() => makeStore());
  const src = makeSrc();
  src.page("plan.html", "Plan", "plan one");
  src.page("other.html", "Other", "another page");
  ok(run(a, ["publish", "plan.html"], { cwd: src.dir }), "publish plan");
  if (shared) ok(run(a, ["share", "plan"]), "share plan");
  ok(run(b, ["sync"]), "b sync");
  return { a, b, src, X: manifest(a).deliverables.plan.slug };
}

// On B: plan becomes old-plan, and a different file takes the name plan
// (shared too when asked). Returns the new page's slug.
function takeTheName(b, src, shared) {
  ok(run(b, ["sync"]), "b sync");
  ok(run(b, ["rename", "plan", "old-plan"]), "b rename");
  ok(run(b, ["publish", "other.html", "--name", "plan"], { cwd: src.dir }), "b publish other as plan");
  if (shared) ok(run(b, ["share", "plan"]), "b share the new plan");
  return manifest(b).deliverables.plan.slug;
}

(async () => {
  const retries = [
    ["share", false, false, ["share", "plan"]],
    ["publish --live --name", true, true, ["publish", "plan.html", "--name", "plan", "--live"]],
    ["unshare", true, true, ["unshare", "plan"]],
    ["rename", false, false, ["rename", "plan", "team-plan"]],
  ];
  for (const [what, sharedA, sharedB, args] of retries) {
    await check("retry: " + what + " refuses when another machine gave the name to a different page meanwhile; neither page changes", async () => {
      const { a, b, src, X } = setup(sharedA);
      if (what.startsWith("publish")) src.page("plan.html", "Plan", "plan two, meant for the page X");
      const p = start(a, args, { cwd: src.dir, env: { FORGE_TEST_PAUSE: "after-commit:8000" } });
      await p.waitFor(/forge-test: paused at after-commit/);
      const Y = takeTheName(b, src, sharedB);
      const expected = pages(b);
      const r = await p.closed;
      assert.strictEqual(r.status, 1, r.all);
      assert.strictEqual(r.out, "", "no result lines");
      assert.match(r.err, /refusing: another machine gave the name plan to a different page while this command ran .*so this command changed nothing/);
      ok(run(a, ["sync"]), "a sync");
      assert.deepStrictEqual(pages(a), expected, "the remote has only B's changes");
      assert.deepStrictEqual(pages(a)[X], ["old-plan", sharedA ? "shared" : "private", [1]], "page X: unchanged but its new name");
      assert.deepStrictEqual(pages(a)[Y], ["plan", sharedB ? "shared" : "private", [1]], "page Y: untouched");
      const pub = fs.readdirSync(path.join(a, "public", "d"));
      assert.strictEqual(pub.includes(X), sharedA, "X is where it was");
      assert.strictEqual(pub.includes(Y), sharedB, "Y is where B put it");
    });
  }

  // Paused after the push, before the result lines are built from the final manifest.
  const results = [
    ["publish", false, ["publish", "plan.html"], /^published plan v2 \(private\)$/m],
    ["share", false, ["share", "plan"], /^shared plan \(latest v1\)$/m],
    ["unshare", true, ["unshare", "plan"], /^taken down: plan \(whole document\)/m],
  ];
  for (const [what, sharedA, args, first] of results) {
    await check("result: " + what + " reports the page it changed (by slug) under its new name, never the page that took its old name", async () => {
      const { a, b, src, X } = setup(sharedA);
      if (what === "publish") src.page("plan.html", "Plan", "plan two");
      const p = start(a, args, { cwd: src.dir, env: { FORGE_TEST_PAUSE: "fast-forward:8000" } });
      await p.waitFor(/forge-test: paused at fast-forward/);
      const Y = takeTheName(b, src, what === "unshare");
      const r = await p.closed;
      assert.strictEqual(r.status, 0, r.all);
      assert.match(r.out, first);
      assert.match(r.out, /^note: another machine has since renamed plan to old-plan; forge list shows every name$/m);
      assert.match(r.out, new RegExp("^private: \\S*/d/" + X + "/$", "m"), "the private line is page X's");
      assert.ok(!r.all.includes(Y), "nothing about page Y: " + r.all);
      assert.ok(!/undefined/.test(r.all), r.all);
      const now = pages(a);
      assert.deepStrictEqual(now[X].slice(0, 2), ["old-plan", what === "share" ? "shared" : "private"], "X changed as asked");
      assert.deepStrictEqual(now[Y], ["plan", what === "unshare" ? "shared" : "private", [1]], "Y untouched");
    });
  }

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
