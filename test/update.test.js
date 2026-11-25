// Runnable test: node test/update.test.js
// forge update [--check] on scratch copies of the engine, with no network: a
// repository made from this engine with releases v0.1.0 and v0.2.0, a bare
// "origin" of it, and clones of that origin at v0.1.0 as the engine to update.
// No store exists anywhere (FORGE_WORKSPACE names a folder that is never
// made): update needs none and must never make one. Every refusal leaves HEAD
// and the changed file's bytes as they were.
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");
const { check, done, tmp, git, env, ENGINE, HOME } = require("./helpers.js");

// The engine's files without its git folder, a store, or a test run's scratch
// (entry by entry: the scratch folder may be inside the engine, and cpSync
// refuses to copy a folder into itself).
function copyEngine(to) {
  for (const e of fs.readdirSync(ENGINE)) {
    if (![".git", "workspace", ".tmp", "node_modules"].includes(e)) fs.cpSync(path.join(ENGINE, e), path.join(to, e), { recursive: true });
  }
}
const VLINE = /^const VERSION = "\d+\.\d+\.\d+";$/m;
function setVersion(dir, v) {
  const f = path.join(dir, "bin", "forge");
  const text = fs.readFileSync(f, "utf8");
  assert.ok(VLINE.test(text), "bin/forge has a VERSION line");
  fs.writeFileSync(f, text.replace(VLINE, () => 'const VERSION = "' + v + '";'));
}
const NOTE = "- the second release's note";
const changelog = (two) => "# Changelog\n\n## [Unreleased]\n\n" + (two ? "## [0.2.0] - 2026-12-01\n\n" + NOTE + "\n\n" : "") +
  "## [0.1.0] - 2026-11-25\n\n- the first release\n\n[0.1.0]: https://example.invalid/v0.1.0\n";

// A set of releases: v0.1.0, then (unless second is false) v0.2.0 (VERSION
// and a CHANGELOG section, plus whatever extra adds; LICENSE is the same in
// both, so a change to it is the only one), each in a bare "origin".
let sets = 0;
function makeOrigin({ second = true, extra = null } = {}) {
  const work = tmp("upd" + ++sets);
  const src = path.join(work, "src");
  copyEngine(src);
  setVersion(src, "0.1.0");
  fs.writeFileSync(path.join(src, "CHANGELOG.md"), changelog(false));
  git(src, ["init", "-q", "-b", "main"]);
  git(src, ["add", "-A"]);
  git(src, ["commit", "-q", "-m", "one"]);
  git(src, ["tag", "-a", "v0.1.0", "-m", "Forge 0.1.0"]);
  const origin = path.join(work, "origin.git");
  git(work, ["clone", "-q", "--bare", src, origin]);
  git(src, ["remote", "add", "origin", origin]);
  if (!second) return { work, src, origin, second: null };
  setVersion(src, "0.2.0");
  fs.writeFileSync(path.join(src, "CHANGELOG.md"), changelog(true));
  if (extra) extra(src);
  git(src, ["add", "-A"]);
  git(src, ["commit", "-q", "-m", "two"]);
  git(src, ["tag", "-a", "v0.2.0", "-m", "Forge 0.2.0"]);
  git(src, ["push", "-q", "origin", "main", "v0.2.0"]);
  return { work, src, origin, second: git(src, ["rev-parse", "v0.2.0^{commit}"]) };
}
const base = makeOrigin();
const { work, origin } = base;
const SECOND = base.second;

// A clone of an origin at v0.1.0 on main, with no tag but v0.1.0, so only a
// fetch can bring the others.
let n = 0;
function fresh(o = base) {
  const e = path.join(o.work, "engine" + ++n);
  git(o.work, ["clone", "-q", o.origin, e]);
  git(e, ["reset", "-q", "--hard", "v0.1.0"]);
  for (const t of git(e, ["tag", "--list"]).split("\n")) if (t && t !== "v0.1.0") git(e, ["tag", "-d", t]);
  return e;
}

const NOSTORE = path.join(tmp("upd-nostore"), "store");
function update(e, args, store = NOSTORE) {
  const r = spawnSync(process.execPath, [path.join(e, "bin", "forge"), ...args], { cwd: os.tmpdir(), env: env(store), encoding: "utf8" });
  assert.ok(!fs.existsSync(NOSTORE) && !fs.existsSync(path.join(HOME, ".forge")), "no store was made");
  return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}
const head = (e) => git(e, ["rev-parse", "HEAD"]);
const bytes = (e, f) => fs.readFileSync(path.join(e, f));

// A refusal: exit 1, the message, and HEAD and the file's bytes unchanged.
function refused(e, args, re, file, store) {
  const before = { head: head(e), bytes: bytes(e, file) };
  const r = update(e, args, store);
  assert.strictEqual(r.status, 1, r.all);
  assert.match(r.err, re);
  assert.match(r.err, /nothing was changed/);
  assert.strictEqual(head(e), before.head, "HEAD moved");
  assert.ok(bytes(e, file).equals(before.bytes), file + " changed");
}

(async () => {
  await check("update --check names the newer release and its CHANGELOG heading, and changes nothing, with no store anywhere", () => {
    const e = fresh();
    const before = { head: head(e), forge: bytes(e, "bin/forge") };
    const r = update(e, ["update", "--check"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(r.out.includes("Forge 0.2.0 is available (you have 0.1.0); update with: forge update\n## [0.2.0] - 2026-12-01\n"), r.out);
    assert.ok(!r.out.includes(NOTE), "--check lists headings only");
    assert.strictEqual(head(e), before.head, "HEAD moved");
    assert.ok(bytes(e, "bin/forge").equals(before.forge), "bin/forge changed");
  });

  await check("update fast-forwards to the release tag, prints the newer CHANGELOG section and bin/install --check, and is then the latest", () => {
    const e = fresh();
    const r = update(e, ["update"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(r.out.startsWith("updated Forge 0.1.0 -> 0.2.0\n\n## [0.2.0] - 2026-12-01\n\n" + NOTE + "\n"), r.out);
    assert.ok(!r.out.includes("the first release"), "only the newer section");
    assert.match(r.out, /bin\/install --check:\n[\s\S]*command: forge/);
    assert.strictEqual(head(e), SECOND, "HEAD is the v0.2.0 commit");
    assert.strictEqual(git(e, ["status", "--porcelain"]), "", "a clean checkout");
    assert.strictEqual(spawnSync(process.execPath, [path.join(e, "bin", "forge"), "--version"], { encoding: "utf8" }).stdout, "Forge 0.2.0\n");
    for (const args of [["update"], ["update", "--check"]]) {
      const again = update(e, args);
      assert.deepStrictEqual([again.status, again.out], [0, "Forge 0.2.0 is the latest release\n"], args.join(" "));
    }
    assert.strictEqual(head(e), SECOND);
  });

  await check("update refuses a checkout with an uncommitted change to a tracked file", () => {
    const e = fresh();
    fs.appendFileSync(path.join(e, "LICENSE"), "a local edit\n");
    refused(e, ["update"], /has uncommitted changes to tracked files[\s\S]*LICENSE/, "LICENSE");
  });

  await check("update refuses a checkout with commits the release lacks (not a fast-forward)", () => {
    const e = fresh();
    fs.appendFileSync(path.join(e, "LICENSE"), "a local commit\n");
    git(e, ["commit", "-q", "-am", "local"]);
    refused(e, ["update"], /has commits that release 0\.2\.0 does not have/, "LICENSE");
  });

  await check("update refuses when the remote it was cloned from cannot be reached, even with the newer tag already here", () => {
    const e = fresh();
    git(e, ["fetch", "-q", "--tags", "origin"]);
    git(e, ["remote", "set-url", "origin", path.join(work, "gone.git")]);
    const said = /^could not reach the remote this copy of Forge was cloned from \(git remote origin\) to look for a release; nothing was changed\ngit said: \S.*\n$/;
    refused(e, ["update"], said, "bin/forge");
    refused(e, ["update", "--check"], said, "bin/forge");
  });

  await check("update refuses a copy that is not its own git checkout: a plain folder, and a folder inside another repository", () => {
    const plain = path.join(tmp("upd-plain"), "forge");
    copyEngine(plain);
    const r = update(plain, ["update"]);
    assert.strictEqual(r.status, 1, r.all);
    for (const x of ["is not a git checkout", "git clone https://github.com/rishmadaan/forge-artifacts", "https://github.com/rishmadaan/forge-artifacts/releases", "nothing was changed"]) assert.ok(r.err.includes(x), r.err);
    assert.ok(!fs.existsSync(path.join(plain, ".git")));
    // Inside a clone of the same origin at v0.1.0: without the own-checkout
    // check, update would fetch and fast-forward that outer repository.
    const outer = fresh();
    const inner = path.join(outer, "vendor", "forge");
    copyEngine(inner);
    setVersion(inner, "0.1.0");
    refused(inner, ["update"], /is not a git checkout/, "bin/forge");
    assert.strictEqual(head(outer), git(outer, ["rev-parse", "v0.1.0^{commit}"]), "the outer repository did not move");
  });

  await check("update never overwrites an ignored local file at a path the release adds: a store under workspace/ stays as it was", () => {
    // The release adds workspace/manifest.json (force-added past .gitignore);
    // this checkout keeps its own store there, which git ignores.
    const o = makeOrigin({ extra: (src) => {
      fs.mkdirSync(path.join(src, "workspace"));
      fs.writeFileSync(path.join(src, "workspace", "manifest.json"), "the release's file\n");
      git(src, ["add", "-f", "workspace/manifest.json"]);
    } });
    const e = fresh(o);
    fs.mkdirSync(path.join(e, "workspace"));
    fs.writeFileSync(path.join(e, "workspace", "manifest.json"), '{"pages":"mine"}\n');
    fs.writeFileSync(path.join(e, "workspace", "TEMPLATE_VERSION"), "1\n");
    const other = bytes(e, "workspace/TEMPLATE_VERSION");
    refused(e, ["update"], /git refused the update to 0\.2\.0[\s\S]*workspace\/manifest\.json/, "workspace/manifest.json");
    assert.strictEqual(bytes(e, "workspace/manifest.json").toString(), '{"pages":"mine"}\n');
    assert.ok(bytes(e, "workspace/TEMPLATE_VERSION").equals(other));
    assert.strictEqual(head(e), git(e, ["rev-parse", "v0.1.0^{commit}"]));
  });

  await check("update takes a tag as a release only when bin/forge at that tag says that version: a mismatched tag is skipped and named by --check", () => {
    // Only v0.1.0 and a v0.2.0 tag on that same commit (its VERSION says 0.1.0).
    const lone = makeOrigin({ second: false });
    git(lone.src, ["tag", "-a", "v0.2.0", "-m", "Forge 0.2.0"]);
    git(lone.src, ["push", "-q", "origin", "v0.2.0"]);
    const e = fresh(lone);
    const before = { head: head(e), forge: bytes(e, "bin/forge") };
    const c = update(e, ["update", "--check"]);
    assert.deepStrictEqual([c.status, c.out], [0, "skipped tag v0.2.0: bin/forge at that tag says VERSION 0.1.0, so it is not a release\nForge 0.1.0 is the latest release\n"], c.all);
    const u = update(e, ["update"]);
    assert.deepStrictEqual([u.status, u.out], [0, "Forge 0.1.0 is the latest release\n"], u.all);
    assert.strictEqual(head(e), before.head, "HEAD moved");
    assert.ok(bytes(e, "bin/forge").equals(before.forge), "bin/forge changed");
    // v0.2.0 is a release and a v0.3.0 tag sits on it: update goes to v0.2.0.
    const both = makeOrigin();
    git(both.src, ["tag", "-a", "v0.3.0", "-m", "Forge 0.3.0"]);
    git(both.src, ["push", "-q", "origin", "v0.3.0"]);
    const e2 = fresh(both);
    const c2 = update(e2, ["update", "--check"]);
    assert.strictEqual(c2.status, 0, c2.all);
    assert.ok(c2.out.startsWith("skipped tag v0.3.0: bin/forge at that tag says VERSION 0.2.0, so it is not a release\nForge 0.2.0 is available (you have 0.1.0)"), c2.out);
    const u2 = update(e2, ["update"]);
    assert.strictEqual(u2.status, 0, u2.all);
    assert.ok(u2.out.startsWith("updated Forge 0.1.0 -> 0.2.0\n"), u2.out);
    assert.strictEqual(head(e2), both.second, "HEAD is the v0.2.0 commit");
  });

  await check("update says updated only when the updated forge --version prints the new version; otherwise it says what it found and how to go back", () => {
    // v0.2.0's VERSION line is right, but the release does not start.
    const o = makeOrigin({ extra: (src) => fs.appendFileSync(path.join(src, "lib", "core.js"), "\nthrow new Error(\"a broken release\");\n") });
    const e = fresh(o);
    const was = head(e);
    const r = update(e, ["update"]);
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(!r.out.includes("updated Forge"), r.out);
    assert.match(r.err, /moved to v0\.2\.0 \([0-9a-f]{12}\), but the updated forge --version failed[\s\S]*a broken release[\s\S]*instead of printing Forge 0\.2\.0/);
    assert.ok(!/nothing was changed/.test(r.err), "the checkout did change");
    assert.strictEqual(head(e), o.second, "HEAD is where the message says");
    const back = /git -C (\S+) reset --keep ([0-9a-f]{40})/.exec(r.err);
    assert.ok(back, r.err);
    assert.strictEqual(back[2], was);
    git(e, ["reset", "-q", "--keep", back[2]]);
    assert.strictEqual(head(e), was, "the printed command goes back");
  });

  await check("update refuses while another forge command holds the store lock, and goes ahead once it is free", async () => {
    const store = path.join(tmp("upd-store"), "store");
    git(path.dirname(store), ["init", "-q", store]);
    const lockFile = path.join(store, ".git", "forge.lock");
    // Holds the same OS lock the writing commands take, until killed.
    const holder = spawn("perl", ["-MFcntl=:flock", "-e", 'open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX) or die; $| = 1; print "held\\n"; sleep 60', lockFile]);
    await new Promise((resolve, reject) => {
      holder.stdout.on("data", (d) => String(d).includes("held") && resolve());
      holder.on("exit", () => reject(new Error("the lock holder ended early")));
    });
    const e = fresh();
    try {
      refused(e, ["update"], /another forge command is running on the store at [\s\S]*Run forge update again when it finishes/, "bin/forge", store);
    } finally {
      holder.kill();
    }
    await new Promise((resolve) => (holder.exitCode !== null || holder.signalCode !== null ? resolve() : holder.on("exit", resolve)));
    const r = update(e, ["update"], store);
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(head(e), SECOND, "HEAD is the v0.2.0 commit");
    // A store whose lock was never taken is only looked at: no lock file is made in it.
    const untouched = path.join(tmp("upd-store2"), "store");
    git(path.dirname(untouched), ["init", "-q", untouched]);
    const e2 = fresh();
    const r2 = update(e2, ["update"], untouched);
    assert.strictEqual(r2.status, 0, r2.all);
    assert.ok(!fs.existsSync(path.join(untouched, ".git", "forge.lock")), "update made a lock file in the store");
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
