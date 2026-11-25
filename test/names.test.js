// Runnable test: node test/names.test.js
// One name rule for every way a page gets a name: publish --name, a name
// derived from the file name, and rename. A name that breaks it is refused,
// the refusal names the rule, and nothing changes.
const assert = require("node:assert");
const { check, done, run, git, makeStore, makeSrc, manifest, treeState } = require("./helpers.js");

const RULE = "^[a-z0-9][a-z0-9._-]*$";
const identity = (store) => ({ head: git(store, ["rev-parse", "HEAD"]), tree: treeState(store) });

(async () => {
  await check("names an object inherits (constructor, toString, __proto__) publish normally or are refused by the rule, never crash", () => {
    const store = makeStore();
    const src = makeSrc();
    const r1 = run(store, ["publish", src.page("x.html", "X", "x"), "--name", "constructor"]);
    assert.strictEqual(r1.status, 0, r1.all);
    assert.match(r1.out, /^published constructor v1 \(private\)$/m);
    const r2 = run(store, ["publish", src.page("constructor.html", "C", "c")]);
    assert.strictEqual(r2.status, 1, "a different file with the derived name constructor meets the existing page: " + r2.all);
    assert.match(r2.err, /the name constructor already belongs to a private page published from a different file/);
    const fresh = makeStore();
    const r3 = run(fresh, ["publish", src.page("sub/constructor.html", "C", "c")]);
    assert.strictEqual(r3.status, 0, "a derived name constructor on an empty store: " + r3.all);
    assert.match(r3.out, /^published constructor v1 \(private\)$/m);
    for (const bad of ["toString", "__proto__"]) {
      const r = run(store, ["publish", src.page("y.html", "Y", "y"), "--name", bad]);
      assert.strictEqual(r.status, 1, bad + ": " + r.all);
      assert.match(r.err, /does not fit the name rule/, bad);
    }
    assert.deepStrictEqual(Object.keys(manifest(store).deliverables), ["constructor"]);
    assert.ok(!/TypeError/.test(r1.all + r2.all + r3.all));
  });

  await check("publish --name: a name that breaks the rule is refused, names the rule, changes nothing", () => {
    const store = makeStore();
    const src = makeSrc();
    const f = src.page("plan.html", "Plan", "p");
    const before = identity(store);
    for (const bad of ["Plan", "my plan", "-plan", ".plan", "plan/x", "plán", "a".repeat(101)]) {
      const r = run(store, ["publish", f, "--name", bad]);
      assert.strictEqual(r.status, 1, bad + ": " + r.all);
      assert.ok(r.err.includes(RULE), bad + ": " + r.err);
      assert.ok(r.err.includes("at most 100 characters"), r.err);
      assert.strictEqual(r.out, "", bad);
    }
    assert.deepStrictEqual(identity(store), before);
  });

  await check("publish --name: names that fit the rule are taken, up to 100 characters", () => {
    const store = makeStore();
    const src = makeSrc();
    const f = src.page("plan.html", "Plan", "p");
    for (const good of ["plan", "a.b_c-1", "0day", "a".repeat(100)]) {
      const r = run(store, ["publish", f, "--name", good]);
      assert.strictEqual(r.status, 0, good + ": " + r.all);
    }
    assert.deepStrictEqual(Object.keys(manifest(store).deliverables).sort(), ["0day", "a".repeat(100), "a.b_c-1", "plan"].sort());
  });

  await check("a name derived from the file name that breaks the rule is fitted to it, and the output says so; one nothing fits is refused", () => {
    const store = makeStore();
    const src = makeSrc();
    for (const [file, name] of [["My Plan.html", "my-plan"], ["Q3 Report.html", "q3-report"], ["Notes.html", "notes"], ["123.html", "page-123"]]) {
      const r = run(store, ["publish", src.page(file, "P", file)]);
      assert.strictEqual(r.status, 0, file + ": " + r.all);
      assert.match(r.out, new RegExp("^published " + name + " v1 \\(private\\)$", "m"), file);
      assert.ok(r.out.includes("note: the name " + name + " was made from the file name " + file.replace(/\.html$/, "") + " to fit the name rule"), file + ": " + r.out);
      assert.ok(Object.hasOwn(manifest(store).deliverables, name), file);
    }
    const before = identity(store);
    const r = run(store, ["publish", src.page("!!!.html", "X", "x")]);
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes(RULE) && r.err.includes("--name"), r.err);
    assert.deepStrictEqual(identity(store), before);
  });

  await check("a refused name suggests the name that fits (publish --name, rename), not only the rule", () => {
    const store = makeStore();
    const src = makeSrc();
    const cases = [
      [["publish", src.page("x.html", "X", "x"), "--name", "Year Plan!"], "--name 'year-plan'"],
      [["publish", src.page("x.html", "X", "x"), "--name", "2026"], "--name 'page-2026'"],
    ];
    for (const [a, want] of cases) {
      const r = run(store, a);
      assert.strictEqual(r.status, 1, r.all);
      assert.ok(r.err.includes(want), want + ": " + r.err);
      assert.ok(!r.err.includes("'<new-name>'"), "a fitted name is suggested, not a placeholder: " + r.err);
    }
    assert.strictEqual(run(store, ["publish", src.page("plan.html", "Plan", "p")]).status, 0);
    const r = run(store, ["rename", "plan", "Plan B"]);
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes("forge rename 'plan' 'plan-b'"), r.err);
  });

  await check("publish --name with an empty value is refused, never taken as no --name; nothing changes", () => {
    const store = makeStore();
    const src = makeSrc();
    const f = src.page("plan.html", "Plan", "p");
    const before = identity(store);
    const r = run(store, ["publish", f, "--name", ""]);
    assert.strictEqual(r.status, 1, r.all);
    assert.strictEqual(r.out, "");
    assert.match(r.err, /the name "" does not fit the name rule/);
    assert.deepStrictEqual(identity(store), before);
    const e = run(store, ["rename", "x", ""]);
    assert.strictEqual(e.status, 1, e.all);
  });

  await check("rename: a new name that breaks the rule is refused, names the rule, changes nothing; one that fits is taken", () => {
    const store = makeStore();
    const src = makeSrc();
    assert.strictEqual(run(store, ["publish", src.page("plan.html", "Plan", "p")]).status, 0);
    const before = identity(store);
    for (const bad of ["Plan B", "_plan", "a".repeat(101)]) {
      const r = run(store, ["rename", "plan", bad]);
      assert.strictEqual(r.status, 1, bad + ": " + r.all);
      assert.ok(r.err.includes(RULE), bad + ": " + r.err);
    }
    assert.deepStrictEqual(identity(store), before);
    const ok = run(store, ["rename", "plan", "plan.v2_final-1"]);
    assert.strictEqual(ok.status, 0, ok.all);
    assert.deepStrictEqual(Object.keys(manifest(store).deliverables), ["plan.v2_final-1"]);
  });

  // JavaScript lists integer-like keys first, so a name made of digits only
  // would jump to the top of the list and lose its place.
  await check("a name of digits only is refused by the rule, for publish --name and rename; one with a letter is taken", () => {
    const store = makeStore();
    const src = makeSrc();
    for (const f of ["alpha", "plan", "zulu"]) assert.strictEqual(run(store, ["publish", src.page(f + ".html", f, f)]).status, 0);
    const before = identity(store);
    const tries = [
      ["publish", src.page("x.html", "X", "x"), "--name", "0"],
      ["publish", src.page("x.html", "X", "x"), "--name", "2026"],
      ["rename", "plan", "0"],
      ["rename", "plan", "42"],
    ];
    for (const a of tries) {
      const r = run(store, a);
      assert.strictEqual(r.status, 1, a.join(" ") + ": " + r.all);
      assert.ok(r.err.includes("not digits only"), a.join(" ") + ": " + r.err);
      assert.strictEqual(r.out, "", a.join(" "));
    }
    assert.deepStrictEqual(identity(store), before);
    assert.strictEqual(run(store, ["rename", "plan", "0a"]).status, 0);
    assert.deepStrictEqual(Object.keys(manifest(store).deliverables), ["alpha", "0a", "zulu"], "it keeps its place");
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
