// Runnable test: node test/dry-run.test.js
// With FORGE_DEPLOY=0 nothing is uploaded and the link site is never read, so
// no result line may say what the link site shows: no public: line (it means
// "confirmed live") and no "now returns not found". Each result says it was a
// dry run instead; the exit code and the private: line are as usual.
const assert = require("node:assert");
const path = require("node:path");
const { check, done, run, makeStore, makeSrc, tmp } = require("./helpers.js");

const DRY = "dry run (FORGE_DEPLOY=0): nothing was uploaded and the link site was not read";

(async () => {
  await check("share, publish --live and unshare in a dry run claim nothing about the link site", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir }).status, 0);
    src.page("plan.html", "Plan", "p2");
    for (const a of [["share", "plan"], ["publish", "plan.html", "--live"], ["share", "plan", "again"], ["unshare", "plan"], ["unshare", "plan"]]) {
      const r = run(store, a, { cwd: src.dir });
      assert.strictEqual(r.status, 0, a.join(" ") + ": " + r.all);
      assert.ok(!/^public: /m.test(r.out), a.join(" ") + ": no public: line in a dry run: " + r.out);
      assert.ok(!/now returns not found|confirmed not to serve it/.test(r.out), a.join(" ") + ": " + r.out);
      assert.ok(r.out.includes(DRY), a.join(" ") + ": says it was a dry run: " + r.out);
      assert.match(r.out, /^private: /m);
    }
  });

  await check("forge check in a dry run on a store with a host says the link site was not read", () => {
    const r = run(makeStore(), ["check"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(r.out.includes("dry run (FORGE_DEPLOY=0): the link site was not read"), r.out);
  });

  await check("forge host in a dry run says the host is set but not proven", () => {
    const store = path.join(tmp("fresh"), "store");
    assert.strictEqual(run(store, ["init", store]).status, 0);
    const r = run(store, ["host", "netlify", "--project", "p", "--url", "https://x.example"], { env: { FORGE_NETLIFY_TOKEN: "v" } });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^host set \(dry run: not proven\): Netlify, project p, /m);
    assert.ok(!/^host set: /m.test(r.out), r.out);
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
