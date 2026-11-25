// Runnable test: node test/command-name.test.js
// Installed as forgee (another program owns the name forge), every command
// forge prints for someone to run says forgee: usage, refusals from every
// layer, next steps, "finish with:" lines, and the copy the store lock
// re-launches. A tool that runs a printed line must never start the other
// program.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { check, done, tmp, env, makeStore, makeSrc, FORGE } = require("./helpers.js");

const bin = tmp("bin");
const FORGEE = path.join(bin, "forgee");
fs.symlinkSync(FORGE, FORGEE);
const forgee = (store, args, opts = {}) => {
  const r = spawnSync(FORGEE, args, { cwd: opts.cwd || bin, env: env(store, opts.env), encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
};
// A command forge prints for someone to run, under the wrong name.
const WRONG = /(^|[^\w-])forge (publish|share|unshare|rename|list|check|regenerate|deploy|sync|recover|import|init|store|open|host|<command>)\b/m;

(async () => {
  await check("installed as forgee: usage, next steps, refusals from every layer and finish lines all say forgee", () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    src.page("other/plan.html", "Other", "o");
    const runs = [];
    const go = (args, want, opts) => {
      const r = forgee(store, args, opts);
      runs.push([args.join(" "), r]);
      assert.ok(r.all.includes(want), args.join(" ") + ": wants " + JSON.stringify(want) + " in:\n" + r.all);
      return r;
    };
    go(["--help"], "usage: forgee <command>");
    go(["publish", "plan.html"], "share it with: forgee share plan", { cwd: src.dir });
    go(["publish", "other/plan.html"], "forgee publish 'other/plan.html' --name", { cwd: src.dir });
    go(["share", "nope"], "(forgee list shows every name)");
    go(["rename", "plan", "Plan B"], "forgee rename 'plan' 'plan-b'");
    go(["share", "plan"], "finish with: forgee deploy", { env: { FORGE_TEST_THROW: "pushed" } });
    go(["list"], "master index:");
    src.page("plan.html", "Plan", "p2");
    go(["publish", "plan.html"], "on yes:  forgee publish 'plan.html' --live", { cwd: src.dir });
    const none = forgee(path.join(tmp("none"), "x"), ["list"]);
    runs.push(["no store", none]);
    assert.ok(none.err.includes("forgee init") && none.err.includes("forgee store <path>"), none.err);
    for (const [what, r] of runs) assert.ok(!WRONG.test(r.all), what + ": prints a command as forge:\n" + r.all);
  });

  await check("installed as forgee: forge host's success and refusals print only forgee, and point at SETUP.md by its full path", () => {
    const runs = [];
    for (const [kind, extra, section] of [["cloudflare-pages", ["--account", "acct"], "Cloudflare Pages"], ["vercel", ["--account", "team"], "Vercel"], ["netlify", [], "Netlify"]]) {
      const store = path.join(tmp("fresh"), "store");
      assert.strictEqual(forgee(store, ["init", store]).status, 0);
      let r = forgee(store, ["host", kind, "--project", "p", ...extra]);
      runs.push([kind + " missing --url", r]);
      assert.strictEqual(r.status, 1, r.all);
      assert.ok(r.err.includes("usage: forgee host"), r.err);
      assert.ok(r.err.includes(path.join(path.dirname(path.dirname(FORGE)), "SETUP.md") + ", step 5, section \"" + section + "\""), r.err);
      r = forgee(store, ["host", kind, "--project", "p", ...extra, "--url", "https://x.example", "--token-name", "T"], { env: { T: "x" } });
      runs.push([kind, r]);
      assert.strictEqual(r.status, 0, r.all);
      assert.match(r.out, /^try: forgee share <name>$/m);
    }
    for (const [what, r] of runs) assert.ok(!WRONG.test(r.all) && !r.all.includes("`forge "), what + ": prints a command as forge:\n" + r.all);
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
