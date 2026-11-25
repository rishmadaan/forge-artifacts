// Runnable test: node test/init-race.test.js
// forge init builds the store in a temporary folder it made and renames it
// onto the target. A failure removes that temporary folder and nothing else:
// never a parent folder it created, which by then may hold another store or
// another file. A target that became non-empty meanwhile is a refusal naming
// it, and whatever is there survives by identity.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, run, start, git, tmp, treeState } = require("./helpers.js");

const temps = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((e) => e.includes(".forge-init-")) : []);

(async () => {
  await check("two inits at one nested absent target: the one that loses refuses, and the other's store survives whole", async () => {
    const target = path.join(tmp("race"), "p", "a", "store");
    const A = start(target, ["init", target], { env: { FORGE_TEST_PAUSE: "init:4000" } });
    await A.waitFor(/paused at init/);
    const b = run(target, ["init", target]);
    assert.strictEqual(b.status, 0, b.all);
    const won = { head: git(target, ["rev-parse", "HEAD"]), tree: treeState(target) };
    const r = await A.closed;
    assert.ok(fs.existsSync(target), "the other store is still there");
    assert.deepStrictEqual({ head: git(target, ["rev-parse", "HEAD"]), tree: treeState(target) }, won, "the other store, unchanged");
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes(target) && /exists and is not empty/.test(r.err), r.err);
    assert.deepStrictEqual(temps(path.dirname(target)), [], "the temporary folder is gone");
  });

  await check("an init that fails after making the parent folder removes only its temporary folder; a file put beside it survives", async () => {
    const parent = path.join(tmp("fail"), "q");
    const target = path.join(parent, "store");
    const A = start(target, ["init", target], { env: { FORGE_TEST_PAUSE: "init:4000" } });
    await A.waitFor(/paused at init/);
    fs.writeFileSync(path.join(parent, "notes.txt"), "someone's notes\n");
    fs.writeFileSync(target, "someone's file\n"); // the rename onto it fails
    const r = await A.closed;
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes(target), r.err);
    assert.strictEqual(fs.readFileSync(path.join(parent, "notes.txt"), "utf8"), "someone's notes\n");
    assert.strictEqual(fs.readFileSync(target, "utf8"), "someone's file\n");
    assert.deepStrictEqual(temps(parent), [], "the temporary folder is gone");
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
