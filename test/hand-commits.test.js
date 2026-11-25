// Runnable test: node test/hand-commits.test.js
// A store with a remote whose copy here has commits the remote lacks (a
// config.json change committed by hand and not pushed): every write and sync
// refuses before writing anything, names the one step that clears it
// (git -C <store> push), and changes neither the remote nor this copy. Once
// pushed, the same command works.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, run, git, makeSrc, twoMachines } = require("./helpers.js");

(async () => {
  await check("commits the remote lacks: publish and sync refuse naming git -C <store> push, nothing changes; after the push, publish works", () => {
    const { a, bare } = twoMachines();
    const c = JSON.parse(fs.readFileSync(path.join(a, "config.json"), "utf8"));
    c.brand.name = "Own look";
    fs.writeFileSync(path.join(a, "config.json"), JSON.stringify(c, null, 2) + "\n");
    git(a, ["commit", "-qam", "store look"]);
    const remote = git(bare, ["rev-parse", "main"]);
    const local = git(a, ["rev-parse", "HEAD"]);
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    for (const args of [["publish", "hello.html"], ["sync"]]) {
      const r = run(a, args, { cwd: src.dir });
      assert.strictEqual(r.status, 1, args[0] + ": " + r.all);
      assert.ok(r.err.includes("git -C " + a + " push"), args[0] + " names the push: " + r.err);
      assert.match(r.err, /1 commit\(s\) its remote lacks/, args[0]);
      assert.strictEqual(git(bare, ["rev-parse", "main"]), remote, args[0] + ": the remote is unchanged");
      assert.strictEqual(git(a, ["rev-parse", "HEAD"]), local, args[0] + ": this copy is unchanged");
      assert.strictEqual(r.out, "", args[0]);
    }
    git(a, ["push", "-q"]);
    const r = run(a, ["publish", "hello.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(git(bare, ["rev-parse", "main"]), git(a, ["rev-parse", "HEAD"]));
    assert.strictEqual(JSON.parse(git(bare, ["show", "main:config.json"])).brand.name, "Own look", "the hand commit is on the remote");
  });

  await check("an uncommitted config.json edit: the hand-edit refusal says to commit and push it if it was on purpose, with the commands; another file gets no such line", () => {
    const { a } = twoMachines();
    const c = JSON.parse(fs.readFileSync(path.join(a, "config.json"), "utf8"));
    c.brand.name = "Own look";
    fs.writeFileSync(path.join(a, "config.json"), JSON.stringify(c, null, 2) + "\n");
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    let r = run(a, ["publish", "hello.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes("if you changed config.json on purpose, commit it with this line, then run the same command again:\n  git -C " + a + " commit -m \"store setting\" config.json && git -C " + a + " push"), r.err);
    git(a, ["checkout", "--", "config.json"]);
    fs.writeFileSync(path.join(a, "stray.txt"), "x");
    r = run(a, ["publish", "hello.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(!r.err.includes("on purpose"), "only a config.json edit gets the commit line:\n" + r.err);
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
