// Runnable test: node test/unchanged.test.js
// "Unchanged" means the same source bytes as the last version: the file, or
// every file of a folder. A version records its source's plain hashes, so a
// change in what forge stamps into pages (the dark switch, the Markdown
// export) never turns an unchanged republish into a new version, and never
// makes an unchanged republish of a shared page ask for --live. A version
// recorded without them (an imported one) keeps the stamped-page check.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, run, git, makeStore, makeSrc, manifest } = require("./helpers.js");

// What a store made by an engine with other stamps looks like: the last
// version's stamped-page hash differs from what this engine computes.
function otherStamps(store, name, dropSourceHashes) {
  const m = manifest(store);
  const v = m.deliverables[name].versions.at(-1);
  v.sha256 = "0".repeat(64);
  if (dropSourceHashes) delete v.sourceHashes;
  fs.writeFileSync(path.join(store, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
  git(store, ["commit", "-qam", "an engine with other stamps"]);
}
const versions = (store, name) => manifest(store).deliverables[name].versions.map((v) => v.n);

(async () => {
  await check("a single file with the same bytes is unchanged even when the stamps differ; private and shared (no --live asked)", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    src.page("deck.html", "Deck", "d");
    for (const a of [["publish", "plan.html"], ["publish", "deck.html"], ["share", "deck"]]) assert.strictEqual(run(store, a, { cwd: src.dir }).status, 0);
    otherStamps(store, "plan");
    otherStamps(store, "deck");
    const head = git(store, ["rev-parse", "HEAD"]);
    let r = run(store, ["publish", "plan.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^unchanged plan is already at v1 \(private\), nothing published$/m);
    r = run(store, ["publish", "deck.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 0, "a shared page with the same source asks for nothing: " + r.all);
    assert.match(r.out, /^unchanged deck is already at v1 \(shared\), nothing published$/m);
    assert.strictEqual(git(store, ["rev-parse", "HEAD"]), head, "nothing committed");
    assert.deepStrictEqual([versions(store, "plan"), versions(store, "deck")], [[1], [1]]);
    // A real edit is still a new version.
    src.page("plan.html", "Plan", "p2");
    r = run(store, ["publish", "plan.html"], { cwd: src.dir });
    assert.match(r.out, /^published plan v2/m, r.all);
  });

  await check("a folder is unchanged only when every file is the same: an image change is a new version, even with the same HTML", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("deck/index.html", "Deck", "<img src=a.png>");
    src.file("deck/a.png", "A1");
    src.page("deck/notes/more.html", "More", "m");
    assert.strictEqual(run(store, ["publish", "deck"], { cwd: src.dir }).status, 0);
    otherStamps(store, "deck");
    let r = run(store, ["publish", "deck"], { cwd: src.dir });
    assert.match(r.out, /^unchanged deck is already at v1/m, r.all);
    src.file("deck/a.png", "A2"); // v1's stamped hash already differs
    r = run(store, ["publish", "deck"], { cwd: src.dir });
    assert.match(r.out, /^published deck v2/m, "a changed image: " + r.all);
    src.file("deck/b.png", "B");
    r = run(store, ["publish", "deck"], { cwd: src.dir });
    assert.match(r.out, /^published deck v3/m, "an added file: " + r.all);
    fs.rmSync(path.join(src.dir, "deck", "b.png"));
    otherStamps(store, "deck");
    r = run(store, ["publish", "deck"], { cwd: src.dir });
    assert.match(r.out, /^published deck v4/m, "a removed file: " + r.all);
    assert.deepStrictEqual(versions(store, "deck"), [1, 2, 3, 4]);
  });

  await check("a version with no recorded source hashes (an imported one) keeps the stamped-page check: other stamps make one new version", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir }).status, 0);
    otherStamps(store, "plan", true);
    let r = run(store, ["publish", "plan.html"], { cwd: src.dir });
    assert.match(r.out, /^published plan v2/m, r.all);
    r = run(store, ["publish", "plan.html"], { cwd: src.dir });
    assert.match(r.out, /^unchanged plan is already at v2/m, "after that, a no-op: " + r.all);
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
