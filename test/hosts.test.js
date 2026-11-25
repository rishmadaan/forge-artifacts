// Runnable test: node test/hosts.test.js
// One adapter per host, behind one interface: Cloudflare Pages, Vercel and
// Netlify. Each writes its host's own header file so /_forge/revision.json is
// served Cache-Control: no-store (and every path noindex), uploads through the
// host's official CLI with a token read by name, and the engine's read-back of
// the live marker stays the only proof of "live". Run against the stand-in
// host in test/fakehost.js, never a real one.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, run, git, makeSrc, makeStore, CONFIG } = require("./helpers.js");
const { startFakeHost } = require("./fakehost.js");

const KINDS = {
  "cloudflare-pages": { cli: "wrangler", flags: ["pages", "deploy", "--project-name", "--branch", "main"] },
  vercel: { cli: "vercel", flags: ["deploy", "--prod", "--yes"] },
  netlify: { cli: "netlify-cli", flags: ["deploy", "--dir", "--prod", "--no-build", "--site"] },
};

(async () => {
  const host = await startFakeHost();
  const H = host.env();

  for (const [kind, want] of Object.entries(KINDS)) {
    await check(kind + ": share goes live through the host's CLI; the marker is served no-store and pages noindex, read back as live", () => {
      const store = host.store(kind);
      const src = makeSrc();
      src.page("plan.html", "Plan", "p");
      assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
      const r = run(store, ["share", "plan"], { env: H });
      assert.strictEqual(r.status, 0, r.all);
      assert.match(r.out, /^public: /m);
      const up = host.uploads(store).pop();
      assert.strictEqual(up.cli, want.cli);
      for (const f of want.flags) assert.ok(up.args.includes(f), kind + ": " + f + " in " + up.args.join(" "));
      assert.strictEqual(up.marker.commit, git(store, ["rev-parse", "HEAD"]));
      const m = host.get(store, "/_forge/revision.json");
      assert.strictEqual(m.status, 200);
      assert.strictEqual(m.headers["cache-control"], "no-store", kind + ": " + JSON.stringify(m.headers));
      assert.strictEqual(JSON.parse(m.body).commit, git(store, ["rev-parse", "HEAD"]));
      const page = host.get(store, "/d/" + JSON.parse(fs.readFileSync(path.join(store, "manifest.json"), "utf8")).deliverables.plan.slug + "/");
      assert.strictEqual(page.status, 200);
      assert.match(page.headers["x-robots-tag"] || "", /noindex/, kind + ": " + JSON.stringify(page.headers));
      assert.ok(!/no-store/.test(page.headers["cache-control"] || ""), "only the marker is no-store");
      // The header file is written into the upload only, never into the store.
      assert.strictEqual(git(store, ["status", "--porcelain"]), "");
      assert.ok(!fs.existsSync(path.join(store, "public", "vercel.json")));
      assert.ok(!fs.readFileSync(path.join(store, "public", "_headers"), "utf8").includes("_forge"));
    });

    await check(kind + ": no token under the configured name: the upload is not attempted, the change is saved, exit 3", () => {
      const store = host.store(kind);
      const src = makeSrc();
      src.page("plan.html", "Plan", "p");
      assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
      const before = host.uploads(store).length;
      const r = run(store, ["share", "plan"], { env: { ...H, FORGE_FAKE_HOST_TOKEN: "" } });
      assert.strictEqual(r.status, 3, r.all);
      assert.match(r.err, /deploy FAILED: no secret named FORGE_FAKE_HOST_TOKEN/);
      assert.doesNotMatch(r.out, /^public: /m);
      assert.strictEqual(host.uploads(store).length, before, "nothing uploaded");
    });
  }

  await check("the read-back confirms live only a marker served Cache-Control: no-store; missing, cacheable or no-cache is not confirmed (exit 3, no public line)", () => {
    for (const [cc, live] of [["none", false], ["public, max-age=86400", false], ["no-cache", false], ["private, max-age=600", false], ["max-age=0, no-store", true]]) {
      const store = host.store();
      const src = makeSrc();
      src.page("plan.html", "Plan", "p");
      assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
      host.mode(store, "cache:" + cc);
      const r = run(store, ["share", "plan"], { env: H });
      assert.strictEqual(r.status, live ? 0 : 3, cc + ": " + r.all);
      assert.strictEqual(/^public: /m.test(r.out), live, cc + ": " + r.out);
      if (!live) {
        assert.match(r.err, /uploaded, not confirmed live/, cc);
        assert.ok(r.err.includes(cc === "none" ? "with no Cache-Control header" : "with Cache-Control: " + cc), cc + ": " + r.err);
        assert.ok(host.uploads(store).length > 0, "it was uploaded");
        const l = JSON.parse(run(store, ["list", "--json", "--live"], { env: H }).out).linkSite;
        assert.strictEqual(l.state, "unknown", cc + ": list --live does not call it current");
      }
    }
  });

  await check("config: the three host kinds are offered; each names what it needs; another kind is refused naming the three", () => {
    const store = makeStore();
    const cfg = (h) => {
      fs.writeFileSync(path.join(store, "config.json"), JSON.stringify({ ...CONFIG, host: h }));
      return run(store, ["list"]);
    };
    let r = cfg({ kind: "github-pages", project: "p", tokenSecret: "T" });
    assert.strictEqual(r.status, 1);
    assert.ok(r.err.includes('host.kind must be one of "cloudflare-pages", "vercel", "netlify"'), r.err);
    r = cfg({ kind: "vercel", project: "prj", tokenSecret: "T" });
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /host\.accountId is required for Vercel/);
    r = cfg({ kind: "cloudflare-pages", project: "p", tokenSecret: "T" });
    assert.match(r.err, /host\.accountId is required for Cloudflare Pages/);
    r = cfg({ kind: "netlify", project: "site-id", tokenSecret: "T" });
    assert.strictEqual(r.status, 0, r.all);
  });

  host.stop();
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
