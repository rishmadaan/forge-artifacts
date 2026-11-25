// Runnable test: node test/release.test.js
// scripts/release.sh and scripts/changelog-section.sh, with no network: each
// case is a scratch repository holding this engine's bin/, lib/ and scripts/,
// a CHANGELOG, and a stub test/run.js (exit 0, or 1 to fail), with a bare
// "origin". Every refusal leaves the checkout (HEAD, every ref, every file's
// bytes, git status) and the origin's refs as they were; the success paths
// put the tag and main on the origin, then bring the checkout up to them.
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { check, done, tmp, git, env, ENGINE, treeState } = require("./helpers.js");

const VLINE = /^const VERSION = "\d+\.\d+\.\d+";$/m;
const BASE = "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-11-25\n\n- the first release\n\n[0.1.0]: https://example.invalid/v0.1.0\n";
// A CHANGELOG with the given text inserted above the 0.1.0 section.
const withSection = (s) => BASE.replace("## [0.1.0]", () => s + "## [0.1.0]");
const NOTES = "## [0.2.0] - 2026-12-01\n\n- the second release's note\n\n";

function repo({ changelog = withSection(NOTES), tests = 0, testScript = null } = {}) {
  const dir = path.join(tmp("rel"), "forge");
  for (const d of ["bin", "lib", "scripts"]) fs.cpSync(path.join(ENGINE, d), path.join(dir, d), { recursive: true });
  const f = path.join(dir, "bin", "forge");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(VLINE, () => 'const VERSION = "0.1.0";'));
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), changelog);
  fs.mkdirSync(path.join(dir, "test"));
  fs.writeFileSync(path.join(dir, "test", "run.js"), testScript || "process.exit(" + tests + ");\n");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const bare = path.join(path.dirname(dir), "origin.git");
  git(path.dirname(dir), ["init", "-q", "--bare", "-b", "main", bare]);
  git(dir, ["remote", "add", "origin", bare]);
  git(dir, ["push", "-q", "origin", "main"]);
  return { dir, bare };
}

// opts.cwd: the folder the script is started from; opts.env: extra settings
// (GIT_CONFIG_* to give every git call a setting, as a user's global one would).
function release(dir, args, opts = {}) {
  const e = { ...env(path.join(tmp("rel-nostore"), "store")), ...opts.env };
  e.PATH = path.dirname(process.execPath) + path.delimiter + e.PATH; // node for the script's own calls
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k]; // a setting given as undefined is left out
  const r = spawnSync("bash", [path.join(dir, "scripts", "release.sh"), ...args], { cwd: opts.cwd || os.tmpdir(), env: e, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

// Everything a release could change in the owner's checkout and on the origin.
const state = ({ dir, bare }) => ({
  head: git(dir, ["rev-parse", "HEAD"]),
  refs: git(dir, ["for-each-ref", "--format=%(refname) %(objectname)"]),
  status: git(dir, ["status", "--porcelain", "--untracked-files=all", "--ignored"]),
  files: treeState(dir),
  origin: git(bare, ["for-each-ref", "--format=%(refname) %(objectname)"]),
});

// A temporary folder of its own, so a case can see that the script left nothing in it.
function refused(r, args, re, opts = {}) {
  const before = state(r);
  const t = tmp("rel-tmpdir");
  const out = release(r.dir, args, { ...opts, env: { TMPDIR: t, ...opts.env } });
  assert.strictEqual(out.status, 1, out.all);
  assert.match(out.err, re);
  assert.match(out.err, /nothing was changed/);
  assert.ok(!/\breset\b/.test(out.all), "no reset command is ever printed: " + out.all);
  assert.deepStrictEqual(state(r), before, "a refusal changed something");
  assert.deepStrictEqual(fs.readdirSync(t), [], "the temporary copy is removed");
  return out;
}

// A test script that changes the named file of the copy it runs in, then passes.
const touches = (rel) => 'require("fs").appendFileSync(require("path").join(__dirname, "..", ' + JSON.stringify(rel) + '), "// changed by the tests\\n");\n';
// Every git call in a run gets this one setting, as from a user's global configuration.
const gitSetting = (key, value) => ({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: key, GIT_CONFIG_VALUE_0: value });

function section(file, v) {
  const r = spawnSync("bash", [path.join(ENGINE, "scripts", "changelog-section.sh"), v, file], { encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

(async () => {
  await check("release refuses a version that is not X.Y.Z, even with a CHANGELOG section of that name", () => {
    refused(repo({ changelog: withSection("## [1.2] - 2026-12-01\n\n- a note\n\n") }), ["1.2"], /must be X\.Y\.Z/);
    refused(repo(), [], /usage: scripts\/release\.sh <X\.Y\.Z>/);
  });

  await check("release refuses a version with a leading zero", () => {
    refused(repo({ changelog: withSection("## [01.2.3] - 2026-12-01\n\n- a note\n\n") }), ["01.2.3"], /must be X\.Y\.Z \(three numbers, no leading zeros\)/);
    refused(repo({ changelog: withSection("## [0.2.00] - 2026-12-01\n\n- a note\n\n") }), ["0.2.00"], /no leading zeros/);
  });

  await check("release refuses a version lower than bin/forge's VERSION", () => {
    refused(repo({ changelog: withSection("## [0.0.9] - 2026-12-01\n\n- a note\n\n") }), ["0.0.9"], /0\.0\.9 is not newer than bin\/forge's VERSION \(0\.1\.0\)/);
  });

  await check("release refuses a version that is not newer than a release tag on origin", () => {
    const r = repo();
    git(r.dir, ["push", "-q", "origin", "HEAD:refs/tags/v0.10.0"]);
    refused(r, ["0.2.0"], /0\.2\.0 is not newer than the release v0\.10\.0 on origin/);
  });

  await check("release of bin/forge's own VERSION is only the first release: refused once any release tag exists, here or on origin", () => {
    const onOrigin = repo();
    git(onOrigin.dir, ["push", "-q", "origin", "HEAD:refs/tags/v0.0.5"]);
    refused(onOrigin, ["0.1.0"], /0\.1\.0 is already bin\/forge's VERSION, and v0\.0\.5 is a release tag already/);
    const here = repo();
    git(here.dir, ["tag", "v0.0.5"]);
    refused(here, ["0.1.0"], /0\.1\.0 is already bin\/forge's VERSION, and v0\.0\.5 is a release tag already/);
  });

  await check("release refuses uncommitted changes to tracked files", () => {
    const r = repo();
    fs.appendFileSync(path.join(r.dir, "CHANGELOG.md"), "an edit\n");
    refused(r, ["0.2.0"], /M CHANGELOG\.md\n[\s\S]*uncommitted changes/);
  });

  await check("release refuses a file git does not track (one the release would leave out), naming it", () => {
    const r = repo();
    fs.writeFileSync(path.join(r.dir, "lib", "feature.js"), "module.exports = 1;\n");
    refused(r, ["0.2.0"], /\?\? lib\/feature\.js\n[\s\S]*not tracked/);
    assert.ok(fs.existsSync(path.join(r.dir, "lib", "feature.js")), "the file is left where it was");
  });

  await check("release refuses a file git does not track even where git's settings hide untracked files", () => {
    const r = repo();
    git(r.dir, ["config", "status.showUntrackedFiles", "no"]);
    fs.writeFileSync(path.join(r.dir, "lib", "feature.js"), "module.exports = 1;\n");
    refused(r, ["0.2.0"], /\?\? lib\/feature\.js\n[\s\S]*not tracked/);
  });

  await check("release refuses a branch other than main", () => {
    const r = repo();
    git(r.dir, ["checkout", "-q", "-b", "other"]);
    refused(r, ["0.2.0"], /releases are made from main, and this is 'other'/);
  });

  await check("release refuses a tag that exists here", () => {
    const r = repo();
    git(r.dir, ["tag", "v0.2.0"]);
    refused(r, ["0.2.0"], /the tag v0\.2\.0 already exists here/);
  });

  await check("release refuses a tag that exists on origin", () => {
    const r = repo();
    git(r.dir, ["push", "-q", "origin", "HEAD:refs/tags/v0.2.0"]);
    refused(r, ["0.2.0"], /the tag v0\.2\.0 already exists on origin/);
  });

  await check("release refuses when origin's tags cannot be read", () => {
    const r = repo();
    git(r.dir, ["remote", "set-url", "origin", path.join(path.dirname(r.dir), "gone.git")]);
    refused(r, ["0.2.0"], /could not read origin's tags/);
  });

  await check("release refuses a CHANGELOG without the version's section, or with a heading that has no date", () => {
    refused(repo({ changelog: BASE }), ["0.2.0"], /no '## \[0\.2\.0\] - YYYY-MM-DD' heading/);
    refused(repo({ changelog: withSection("## [0.2.0]\n\n- a note\n\n") }), ["0.2.0"], /no '## \[0\.2\.0\] - YYYY-MM-DD' heading/);
  });

  await check("release refuses a CHANGELOG section with no notes", () => {
    refused(repo({ changelog: withSection("## [0.2.0] - 2026-12-01\n\n") }), ["0.2.0"], /0\.2\.0 section has no notes/);
  });

  await check("release refuses when the tests fail", () => {
    refused(repo({ tests: 1 }), ["0.2.0"], /the tests failed/);
  });

  await check("release tests the release as it will be tagged: tests that fail only at the new version refuse, the checkout untouched", () => {
    // These tests pass at 0.1.0 and fail once bin/forge says 0.2.0.
    const testScript = 'const t = require("fs").readFileSync(require("path").join(__dirname, "..", "bin", "forge"), "utf8");\n' +
      'process.exit(t.includes(\'const VERSION = "0.2.0";\') ? 1 : 0);\n';
    const r = repo({ testScript });
    refused(r, ["0.2.0"], /the tests failed at 0\.2\.0/);
  });

  await check("the tests run in a copy and must leave it as it was: a suite that changes a tracked library file refuses, the checkout untouched", () => {
    refused(repo({ testScript: touches("lib/core.js") }), ["0.2.0"], / M lib\/core\.js\n[\s\S]*the tests changed the copy they ran in/);
  });

  await check("a suite that changes bin/forge refuses, on a version bump and on the first release", () => {
    refused(repo({ testScript: touches("bin/forge") }), ["0.2.0"], / M bin\/forge\n[\s\S]*the tests changed the copy they ran in/);
    refused(repo({ testScript: touches("bin/forge") }), ["0.1.0"], / M bin\/forge\n[\s\S]*the tests changed the copy they ran in/);
  });

  await check("a suite that moves the copy's HEAD refuses", () => {
    const testScript = 'require("child_process").execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "moved by the tests"], { cwd: require("path").join(__dirname, "..") });\n';
    refused(repo({ testScript }), ["0.2.0"], /the tests moved the copy's HEAD/);
  });

  await check("a commit hook that changes the Release commit refuses, nothing tagged or pushed, the checkout untouched, even when started from inside another repository", () => {
    const r = repo();
    const hooks = tmp("hooks");
    fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\necho added > extra.txt\ngit add extra.txt\n", { mode: 0o755 });
    const other = path.join(tmp("other-repo"), "work");
    fs.mkdirSync(other);
    git(other, ["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(other, "a.txt"), "committed\n");
    git(other, ["add", "a.txt"]);
    git(other, ["commit", "-q", "-m", "one"]);
    git(other, ["commit", "-q", "--allow-empty", "-m", "two"]);
    fs.writeFileSync(path.join(other, "a.txt"), "the owner's unsaved edit\n");
    const was = state({ dir: other, bare: other });
    refused(r, ["0.2.0"], /the Release 0\.2\.0 commit is not the tree that was checked \(a commit hook changed it\?\)/, { cwd: other, env: gitSetting("core.hooksPath", hooks) });
    assert.deepStrictEqual(state({ dir: other, bare: other }), was, "the repository it was started from is untouched");
  });

  await check("release refuses a bin/forge with more than one VERSION line", () => {
    const r = repo();
    const f = path.join(r.dir, "bin", "forge");
    fs.appendFileSync(f, 'const VERSION = "0.1.0";\n');
    git(r.dir, ["commit", "-q", "-am", "two lines"]);
    refused(r, ["0.2.0"], /does not have exactly one VERSION line/);
  });

  await check("release X.Y.Z: a Release commit that changes only the VERSION line, an annotated tag on it, both on origin", () => {
    const r = repo();
    const was = git(r.dir, ["rev-parse", "HEAD"]);
    const t = tmp("rel-tmpdir");
    const out = release(r.dir, ["0.2.0"], { env: { TMPDIR: t } });
    assert.strictEqual(out.status, 0, out.all);
    assert.match(out.out, /setting VERSION in bin\/forge: 0\.1\.0 -> 0\.2\.0[\s\S]*tagged v0\.2\.0[\s\S]*pushed main and v0\.2\.0[\s\S]*this checkout is now at the release/);
    assert.deepStrictEqual(fs.readdirSync(t), [], "the temporary copy is removed");
    const head = git(r.dir, ["rev-parse", "HEAD"]);
    assert.strictEqual(git(r.dir, ["rev-parse", "HEAD^"]), was);
    assert.strictEqual(git(r.dir, ["log", "-1", "--format=%s"]), "Release 0.2.0");
    assert.strictEqual(git(r.dir, ["diff", "--numstat", "HEAD^", "HEAD"]), "1\t1\tbin/forge");
    assert.strictEqual(spawnSync(process.execPath, [path.join(r.dir, "bin", "forge"), "--version"], { encoding: "utf8" }).stdout, "Forge 0.2.0\n");
    assert.ok(fs.statSync(path.join(r.dir, "bin", "forge")).mode & 0o100, "bin/forge is still executable");
    assert.strictEqual(git(r.dir, ["cat-file", "-t", "v0.2.0"]), "tag", "an annotated tag");
    assert.strictEqual(git(r.dir, ["tag", "-l", "--format=%(contents:subject)", "v0.2.0"]), "Forge 0.2.0");
    assert.strictEqual(git(r.dir, ["rev-parse", "v0.2.0^{commit}"]), head);
    assert.strictEqual(git(r.bare, ["rev-parse", "v0.2.0^{commit}"]), head, "the tag is on origin");
    assert.strictEqual(git(r.bare, ["rev-parse", "main"]), head, "main is on origin");
    assert.strictEqual(git(r.dir, ["status", "--porcelain"]), "");
  });

  await check("release of the version bin/forge already has: no commit, the tag on HEAD, on origin", () => {
    const r = repo();
    const was = git(r.dir, ["rev-parse", "HEAD"]);
    const out = release(r.dir, ["0.1.0"]);
    assert.strictEqual(out.status, 0, out.all);
    assert.match(out.out, /bin\/forge already says 0\.1\.0: tagging HEAD/);
    assert.strictEqual(git(r.dir, ["rev-parse", "HEAD"]), was, "no new commit");
    assert.strictEqual(git(r.bare, ["rev-parse", "v0.1.0^{commit}"]), was, "the tag is on origin");
    assert.strictEqual(git(r.dir, ["rev-parse", "v0.1.0^{commit}"]), was, "and here");
  });

  await check("a release started from inside another repository releases this one and leaves that one untouched", () => {
    const r = repo();
    const other = path.join(tmp("other-repo"), "work");
    fs.mkdirSync(other);
    git(other, ["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(other, "a.txt"), "committed\n");
    git(other, ["add", "a.txt"]);
    git(other, ["commit", "-q", "-m", "one"]);
    fs.writeFileSync(path.join(other, "a.txt"), "the owner's unsaved edit\n");
    const was = state({ dir: other, bare: other });
    const out = release(r.dir, ["0.2.0"], { cwd: other });
    assert.strictEqual(out.status, 0, out.all);
    assert.strictEqual(git(r.bare, ["rev-parse", "v0.2.0^{commit}"]), git(r.dir, ["rev-parse", "HEAD"]));
    assert.deepStrictEqual(state({ dir: other, bare: other }), was, "the repository it was started from is untouched");
  });

  await check("origin given as a path relative to the checkout: the release reaches that origin", () => {
    const r = repo();
    git(r.dir, ["remote", "set-url", "origin", "../origin.git"]);
    const out = release(r.dir, ["0.2.0"]);
    assert.strictEqual(out.status, 0, out.all);
    assert.strictEqual(git(r.bare, ["rev-parse", "v0.2.0^{commit}"]), git(r.dir, ["rev-parse", "HEAD"]));
  });

  await check("the Release commit carries the identity this checkout is set to", () => {
    const r = repo();
    git(r.dir, ["config", "user.name", "Checkout Person"]);
    git(r.dir, ["config", "user.email", "person@example.invalid"]);
    const e = {};
    for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) e[k] = undefined;
    const out = release(r.dir, ["0.2.0"], { env: e });
    assert.strictEqual(out.status, 0, out.all);
    assert.strictEqual(git(r.bare, ["log", "-1", "--format=%an <%ae>|%cn <%ce>", "v0.2.0"]), "Checkout Person <person@example.invalid>|Checkout Person <person@example.invalid>");
  });

  await check("the owner commits to the checkout while the tests run: the release is out and the checkout stays on the owner's commit", () => {
    const r = repo();
    const testScript = 'require("child_process").execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "the owner\'s commit"], { cwd: ' + JSON.stringify(r.dir) + ' });\n';
    fs.writeFileSync(path.join(r.dir, "test", "run.js"), testScript);
    git(r.dir, ["commit", "-q", "-am", "tests"]);
    git(r.dir, ["push", "-q", "origin", "main"]);
    const out = release(r.dir, ["0.2.0"]);
    assert.strictEqual(out.status, 1, out.all);
    assert.match(out.err, /NOT FINISHED: v0\.2\.0 is released/);
    assert.strictEqual(git(r.dir, ["log", "-1", "--format=%s"]), "the owner's commit", "the checkout stays on the owner's commit");
    assert.strictEqual(git(r.dir, ["rev-parse", "HEAD^"]), git(r.bare, ["rev-parse", "main^"]), "and was not merged");
  });

  await check("the owner changes the checkout while the tests run: the release is out, the checkout keeps the change, and the printed line brings it up later", () => {
    const r = repo();
    // The tests (in the copy) stand in for the owner editing the checkout's bin/forge meanwhile, VERSION line included.
    const testScript = 'const f = ' + JSON.stringify(path.join(r.dir, "bin", "forge")) + ';\n' +
      'const fs = require("fs");\nfs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(\'const VERSION = "0.1.0";\', \'const VERSION = "0.1.0"; // the owner edit\'));\n';
    fs.writeFileSync(path.join(r.dir, "test", "run.js"), testScript);
    git(r.dir, ["commit", "-q", "-am", "tests"]);
    git(r.dir, ["push", "-q", "origin", "main"]);
    git(r.dir, ["config", "merge.autoStash", "true"]);
    const was = git(r.dir, ["rev-parse", "HEAD"]);
    const out = release(r.dir, ["0.2.0"]);
    assert.strictEqual(out.status, 1, out.all);
    const released = git(r.bare, ["rev-parse", "main"]);
    assert.strictEqual(git(r.bare, ["rev-parse", "v0.2.0^{commit}"]), released, "the release is out");
    assert.strictEqual(git(r.bare, ["rev-parse", "main^"]), was);
    assert.strictEqual(git(r.dir, ["rev-parse", "HEAD"]), was, "the checkout did not move");
    const edited = fs.readFileSync(path.join(r.dir, "bin", "forge"), "utf8");
    assert.ok(edited.includes('const VERSION = "0.1.0"; // the owner edit'), "the owner's change is kept");
    assert.strictEqual(git(r.dir, ["stash", "list"]), "", "nothing was stashed");
    assert.ok(!/\breset\b/.test(out.all), out.all);
    const m = out.err.match(/NOT FINISHED: v0\.2\.0 is released \(main and the tag are on origin\), but this checkout was not brought up to it[\s\S]*bring it up with: (.*)$/m);
    assert.ok(m, out.err);
    git(r.dir, ["checkout", "-q", "--", "bin/forge"]); // the owner puts their change away
    const e = env(path.join(tmp("rel-nostore"), "store"));
    const up = spawnSync("bash", ["-c", m[1]], { cwd: os.tmpdir(), env: e, encoding: "utf8" });
    assert.strictEqual(up.status, 0, up.stderr);
    assert.strictEqual(git(r.dir, ["rev-parse", "HEAD"]), released, "the printed line brings the checkout up to the release");
  });

  await check("a push the origin refuses sends neither main nor the tag (atomic), and changes nothing here", () => {
    const r = repo();
    // Another clone moves origin's main on, so this main's push is refused.
    const other = path.join(path.dirname(r.dir), "other");
    git(path.dirname(r.dir), ["clone", "-q", r.bare, other]);
    git(other, ["commit", "-q", "--allow-empty", "-m", "elsewhere"]);
    git(other, ["push", "-q", "origin", "main"]);
    refused(r, ["0.2.0"], /origin did not take the push \(above\); main and v0\.2\.0 go together or not at all, so neither was pushed/);
  });

  await check("a network failure between the tag and the push leaves origin without the tag and the checkout untouched", () => {
    const r = repo();
    // Reading origin works; pushing to it does not (its push address is gone).
    git(r.dir, ["remote", "set-url", "--push", "origin", path.join(path.dirname(r.dir), "gone.git")]);
    const out = refused(r, ["0.2.0"], /origin did not take the push \(above\); main and v0\.2\.0 go together or not at all, so neither was pushed/);
    assert.match(out.out, /tagged v0\.2\.0 \([0-9a-f]+\) in a temporary copy\n/, "the failure came after the tag");
  });

  await check("changelog-section prints one section's notes, stops at the next section and the link references, and fails on an empty or missing one", () => {
    const f = path.join(tmp("cl"), "CHANGELOG.md");
    fs.writeFileSync(f, "# Changelog\n\n## [Unreleased]\n\n- not yet\n\n## [0.2.0] - 2026-12-01\n\n### Added\n\n- two\n\n## [0.1.1] - 2026-11-30\n\n## [0.1.0] - 2026-11-25\n\n- one\n\n[Unreleased]: https://example.invalid/compare\n[0.1.0]: https://example.invalid/v0.1.0\n");
    assert.deepStrictEqual(section(f, "0.2.0"), { status: 0, out: "### Added\n\n- two\n", err: "" });
    assert.deepStrictEqual(section(f, "0.1.0"), { status: 0, out: "- one\n", err: "" });
    for (const v of ["0.1.1", "0.3.0"]) {
      const r = section(f, v);
      assert.strictEqual(r.status, 1, v);
      assert.match(r.err, new RegExp("no notes under a '## \\[" + v.replace(/\./g, "\\.") + "\\]' heading"));
      assert.strictEqual(r.out, "");
    }
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
