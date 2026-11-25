// Runnable test: node test/edge-rules.test.js
// Edge rules, one check per rule: the different-file refusal names both files
// and prints a command that works; the exit 4 next step never republishes
// stale content over a newer version; a lock inspection that fails refuses
// instead of moving the lock; a source's fingerprint is of its raw bytes; the
// last-resort result after the push never calls the private link working;
// set-aside that stashed but could not pin says where the edits are, exit 3;
// a take-down raced by a share is not reported as finished; --name onto a
// shared page from a different file gets the replace question; a set-aside
// refusal over an unreadable git process names a step the owner can take;
// exit 4 says "not known whether it was saved" once on every surface, and an
// unpinned stash entry names git's 90-day cleanup; the different-file
// refusal's new-page step says it was not an update.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { check, done, run, git, tmp, env, makeStore, makeSrc, manifest, start, twoMachines, FORGE } = require("./helpers.js");
const core = require("../lib/core.js");
const workspace = require("../lib/workspace.js");

const flat = (s) => s.replace(/\s+/g, " ");

// A git that runs the real one, except: a push can lose its answer
// (WRAP_LOSE_ANSWER), then fetch fails (WRAP_FETCH_FAIL); update-ref can fail
// (WRAP_PIN_FAIL).
const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const wrapDir = tmp("gitwrap");
fs.writeFileSync(path.join(wrapDir, "git"), [
  "#!/bin/sh",
  'if [ "$1" = push ]; then',
  '  "$REAL_GIT" "$@"; s=$?',
  '  touch "$WRAP_FLAG"',
  '  if [ -n "$WRAP_LOSE_ANSWER" ]; then echo "fatal: the remote end hung up unexpectedly" >&2; exit 1; fi',
  "  exit $s",
  "fi",
  'if [ "$1" = fetch ] && [ -e "$WRAP_FLAG" ] && [ -n "$WRAP_FETCH_FAIL" ]; then echo "fatal: unable to access the remote" >&2; exit 128; fi',
  'if [ "$1" = update-ref ] && [ -n "$WRAP_PIN_FAIL" ]; then echo "fatal: update_ref failed: cannot lock ref" >&2; exit 128; fi',
  'exec "$REAL_GIT" "$@"',
  "",
].join("\n"), { mode: 0o755 });
let flags = 0;
const wrapped = (extra) => ({ PATH: wrapDir + path.delimiter + process.env.PATH, REAL_GIT: realGit, WRAP_FLAG: path.join(wrapDir, "pushed-" + ++flags), ...extra });

// `forge` on PATH, so a command the engine prints can be run exactly as printed.
const shim = tmp("shim");
fs.writeFileSync(path.join(shim, "forge"), "#!/bin/sh\nexec " + JSON.stringify(process.execPath) + " " + JSON.stringify(FORGE) + ' "$@"\n', { mode: 0o755 });
function runPrinted(store, cmd, cwd) {
  const r = spawnSync("sh", ["-c", cmd], { cwd, env: env(store, { PATH: shim + path.delimiter + process.env.PATH }), encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

// A copy of the store left with git's index lock (as a stopped git leaves it).
function lockedStore() {
  const store = makeStore();
  const lockFile = path.join(store, ".git", "index.lock");
  fs.writeFileSync(lockFile, "");
  return { store, lockFile };
}
// A PATH with only what recover runs (git, ps, perl, sh): no lsof on it.
const bare = tmp("nolsof");
for (const t of ["git", "ps", "perl", "sh"]) fs.symlinkSync(execFileSync("sh", ["-c", "command -v " + t], { encoding: "utf8" }).trim(), path.join(bare, t));
// A fake lsof first on that PATH, with the given script body (or not executable).
function fakeLsof(body, mode = 0o755) {
  const d = tmp("lsof");
  fs.writeFileSync(path.join(d, "lsof"), "#!/bin/sh\n" + body + "\n", { mode });
  return { PATH: d + path.delimiter + bare };
}
// A fake /proc: { pid: { comm, fds: [targets] | null (unreadable) } }.
function fakeProc(procs, opts = {}) {
  const root = tmp("proc");
  fs.mkdirSync(path.join(root, "self", "fd"), { recursive: true });
  for (const [pid, p] of Object.entries(procs)) {
    const fd = path.join(root, pid, "fd");
    fs.mkdirSync(fd, { recursive: true });
    fs.writeFileSync(path.join(root, pid, "comm"), p.comm + "\n");
    (p.fds || []).forEach((t, i) => fs.symlinkSync(t, path.join(fd, String(i))));
    if (p.fds === null) fs.chmodSync(fd, 0o000);
    if (p.hidden) fs.chmodSync(fd, 0o444); // listable, but each descriptor's target cannot be read
  }
  if (opts.unreadable) fs.chmodSync(root, 0o311);
  return root;
}
const restore = (root) => { for (const e of fs.readdirSync(root)) { try { fs.chmodSync(path.join(root, e, "fd"), 0o755); } catch { /* none */ } } };

// Windows-1252 bytes: "é" is 0xE9, invalid on its own in UTF-8.
const cp1252 = (title, body) => Buffer.concat([Buffer.from("<html><head><title>" + title + "</title></head><body>caf"), Buffer.from([0xe9]), Buffer.from(" " + body + "</body></html>")]);

(async () => {
  await check("a different file whose name collides with a SHARED page: the question names both files, and the printed replace command works as printed", () => {
    const store = makeStore();
    const a = makeSrc();
    const b = makeSrc();
    a.page("plan.html", "Plan", "A-TEXT");
    b.page("plan.html", "Plan B", "B-TEXT");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: a.dir }).status, 0);
    assert.strictEqual(run(store, ["share", "plan"]).status, 0);
    const link = "https://pub.example.org/d/" + manifest(store).deliverables.plan.slug + "/";
    const A = core.toSourceKey(path.join(a.dir, "plan.html"));
    const B = core.toSourceKey(path.join(b.dir, "plan.html"));
    const r = run(store, ["publish", "plan.html"], { cwd: b.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes('"plan is public at ' + link + ", made from " + A + "; replace it with " + B + '?"'), r.err);
    assert.ok(!/update the public page now/.test(r.err), "not the same-page question: " + r.err);
    assert.ok(r.err.includes("ask the owner, even if the request named that page (that is not a yes to replacing it with a different file): "), "naming the page is not a yes to a different file: " + r.err);
    assert.match(r.err, /Usually this is a new page/);
    assert.match(r.err, /^ {2}forge publish 'plan\.html' --name '<new-name>'$/m);
    const cmd = (r.err.match(/^ {2}(forge publish .* --live)$/m) || [])[1];
    assert.strictEqual(cmd, "forge publish 'plan.html' --name 'plan' --live", r.err);
    const y = runPrinted(store, cmd, b.dir);
    assert.strictEqual(y.status, 0, y.all);
    assert.match(y.out, /^published plan v2 \(shared\)$/m);
    const slug = manifest(store).deliverables.plan.slug;
    assert.match(fs.readFileSync(path.join(store, "public", "d", slug, "index.html"), "utf8"), /B-TEXT/);
  });

  await check("the same for a PRIVATE page: no public link, no --live, and the printed command works as printed", () => {
    const store = makeStore();
    const a = makeSrc();
    const b = makeSrc();
    a.page("plan.html", "Plan", "A-TEXT");
    b.page("plan.html", "Plan B", "B-TEXT");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: a.dir }).status, 0);
    const A = core.toSourceKey(path.join(a.dir, "plan.html"));
    const B = core.toSourceKey(path.join(b.dir, "plan.html"));
    const r = run(store, ["publish", "plan.html"], { cwd: b.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes('"plan is a private page made from ' + A + "; replace it with " + B + '?"'), r.err);
    assert.ok(!/--live|https:\/\/pub\.example\.org/.test(r.err), r.err);
    const cmd = (r.err.match(/^ {2}(forge publish .* --name 'plan')$/m) || [])[1];
    assert.strictEqual(cmd, "forge publish 'plan.html' --name 'plan'", r.err);
    const y = runPrinted(store, cmd, b.dir);
    assert.strictEqual(y.status, 0, y.all);
    assert.match(y.out, /^published plan v2 \(private\)$/m);
  });

  await check("after exit 4 another machine publishes v3; following the printed next step never makes a v4 with the stale content", () => {
    const { a, b, bare } = twoMachines();
    const sa = makeSrc();
    const sb = makeSrc();
    sa.page("plan.html", "Plan", "V1");
    assert.strictEqual(run(a, ["publish", "plan.html", "--name", "plan"], { cwd: sa.dir }).status, 0);
    sa.page("plan.html", "Plan", "A-V2");
    const lost = run(a, ["publish", "plan.html", "--name", "plan"], { cwd: sa.dir, env: wrapped({ WRAP_LOSE_ANSWER: "1", WRAP_FETCH_FAIL: "1" }) });
    assert.strictEqual(lost.status, 4, lost.all);
    sb.page("plan.html", "Plan", "B-V3");
    const v3 = run(b, ["publish", "plan.html", "--name", "plan"], { cwd: sb.dir });
    assert.match(v3.out, /^published plan v3/m, v3.all);
    // Follow the printed next step, as a model would.
    let last;
    const e = flat(lost.err);
    if (e.includes("run forge sync, then forge list")) {
      assert.strictEqual(run(a, ["sync"]).status, 0);
      const d = JSON.parse(run(a, ["list", "--json"]).out).documents.find((x) => x.name === "plan");
      const want = Number((e.match(/publish: plan v(\d+)/) || [])[1]);
      last = d && d.versions >= want ? run(a, ["deploy"]) : run(a, ["publish", "plan.html", "--name", "plan"], { cwd: sa.dir });
    } else {
      last = run(a, ["publish", "plan.html", "--name", "plan"], { cwd: sa.dir });
    }
    assert.strictEqual(last.status, 0, last.all);
    const m = JSON.parse(git(bare, ["show", "HEAD:manifest.json"]));
    assert.deepStrictEqual(m.deliverables.plan.versions.map((v) => v.n), [1, 2, 3], "no v4: " + last.all);
    assert.match(git(bare, ["show", "HEAD:private/d/" + m.deliverables.plan.slug + "/index.html"]), /B-V3/);
  });

  await check("set-aside refuses, and leaves the lock, when lsof is missing, cannot be run, fails, or reports an error", () => {
    for (const [what, lsof] of [
      ["missing", { PATH: bare }],
      ["not executable", fakeLsof("exit 0", 0o644)],
      ["error status", fakeLsof("echo 'lsof: internal error' >&2; exit 2")],
      ["error on status 1", fakeLsof("echo 'lsof: status error on the file: Permission denied' >&2; exit 1")],
    ]) {
      const { store, lockFile } = lockedStore();
      const r = run(store, ["recover", "--set-aside"], { env: { ...lsof, FORGE_TEST_PROC: tmp("noproc") } });
      assert.strictEqual(r.status, 1, what + ": " + r.all);
      assert.ok(fs.existsSync(lockFile), what + ": the lock stays");
      assert.match(r.err, /could not check whether a process has git's index lock open/, what);
    }
    const { store, lockFile } = lockedStore();
    const ok = run(store, ["recover", "--set-aside"], { env: { ...fakeLsof("exit 1"), FORGE_TEST_PROC: tmp("noproc") } });
    assert.strictEqual(ok.status, 0, "no holders found: " + ok.all);
    assert.ok(!fs.existsSync(lockFile), "the lock was moved aside");
  });

  await check("set-aside refuses when /proc cannot be listed, or a git process's open files cannot be read; an unreadable non-git process does not block it", () => {
    for (const [what, procs, opts] of [
      ["/proc unreadable", {}, { unreadable: true }],
      ["a git process unreadable", { 4242: { comm: "git", fds: null } }, {}],
    ]) {
      const { store, lockFile } = lockedStore();
      const proc = fakeProc(procs, opts);
      let r;
      try {
        r = run(store, ["recover", "--set-aside"], { env: { FORGE_TEST_PROC: proc } });
      } finally {
        fs.chmodSync(proc, 0o755);
        restore(proc);
      }
      assert.strictEqual(r.status, 1, what + ": " + r.all);
      assert.ok(fs.existsSync(lockFile), what + ": the lock stays");
      assert.match(r.err, /could not check whether a process has git's index lock open/, what);
    }
    const { store, lockFile } = lockedStore();
    const proc = fakeProc({ 4242: { comm: "sshd", fds: null }, 4343: { comm: "git", fds: ["/elsewhere"] } });
    let r;
    try {
      r = run(store, ["recover", "--set-aside"], { env: { FORGE_TEST_PROC: proc } });
    } finally {
      restore(proc);
    }
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(!fs.existsSync(lockFile), "the lock was moved aside");
  });

  await check("set-aside refuses when a git process's descriptor list is readable but a descriptor's target is not; the same for a non-git process does not block it", () => {
    const { store, lockFile } = lockedStore();
    const proc = fakeProc({ 4242: { comm: "git", fds: [lockFile], hidden: true } });
    let r;
    try {
      r = run(store, ["recover", "--set-aside"], { env: { FORGE_TEST_PROC: proc } });
    } finally {
      restore(proc);
    }
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(fs.existsSync(lockFile), "the lock stays");
    assert.match(r.err, /could not check whether a process has git's index lock open in this copy of the store: process 4242 \(git\) could not be inspected \(EACCES\)/);
    const other = lockedStore();
    const proc2 = fakeProc({ 4242: { comm: "sshd", fds: ["/elsewhere"], hidden: true } });
    let r2;
    try {
      r2 = run(other.store, ["recover", "--set-aside"], { env: { FORGE_TEST_PROC: proc2 } });
    } finally {
      restore(proc2);
    }
    assert.strictEqual(r2.status, 0, r2.all);
    assert.ok(!fs.existsSync(other.lockFile), "the lock was moved aside");
  });

  await check("a Windows-1252 private page (single file, and a folder's index.html) copied byte for byte into a shared folder is caught", () => {
    for (const kind of ["file", "folder"]) {
      const store = makeStore();
      const src = makeSrc();
      const ws = () => workspace.load(store);
      const secret = kind === "file" ? src.file("secret.html", cp1252("Board", "SECRET-1252")) : src.file("secret/index.html", cp1252("Board", "SECRET-1252"));
      let w = ws();
      core.publish(w, kind === "file" ? secret : path.dirname(secret));
      src.page("pub/index.html", "Board", "harmless, same title");
      fs.copyFileSync(secret, path.join(src.dir, "pub", "copy.html"));
      w = ws();
      const r = core.publish(w, path.join(src.dir, "pub"));
      core.share(w, r.name, "");
      const found = core.check(w);
      assert.ok(found.some((p) => /copy\.html/.test(p) && /private document secret/.test(p)), kind + ": the byte copy is named: " + JSON.stringify(found));
    }
  });

  await check("an exception after the push of a new page: exit 3, never 'works', says it is not in this machine's copy yet, names forge sync then forge deploy; following them finishes", () => {
    const { a } = twoMachines();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    const r = run(a, ["publish", "plan.html"], { cwd: src.dir, env: { FORGE_TEST_THROW: "cleanup" } });
    assert.strictEqual(r.status, 3, r.all);
    assert.match(r.out, /^private: http/m);
    assert.ok(!/private link works/.test(r.all), r.all);
    assert.match(r.err, /saved; not in this machine's copy of the store until it catches up/);
    assert.match(r.err, /forge sync, then forge deploy/);
    assert.ok(!manifest(a).deliverables.plan, "really not on this machine's copy yet");
    assert.strictEqual(run(a, ["sync"]).status, 0);
    assert.ok(manifest(a).deliverables.plan, "on this machine's copy after forge sync");
    assert.strictEqual(run(a, ["deploy"]).status, 0);
  });

  await check("set-aside stashed but could not pin: exit 3, names the stash entry, nothing lost, never 'nothing changed'", () => {
    const store = makeStore();
    fs.writeFileSync(path.join(store, "README.md"), "HAND EDIT\n");
    const r = run(store, ["recover", "--set-aside"], { env: wrapped({ WRAP_PIN_FAIL: "1" }) });
    assert.strictEqual(r.status, 3, r.all);
    assert.ok(!/nothing (was )?changed/i.test(r.all), r.all);
    const sha = (r.all.match(/stash list as entry ([0-9a-f]{40})/) || [])[1];
    assert.ok(sha, "names the entry: " + r.all);
    assert.match(r.all, /not pinned to a name/);
    assert.match(r.all, /nothing was lost/);
    assert.strictEqual(git(store, ["show", sha + ":README.md"]), "HAND EDIT");
    assert.strictEqual(git(store, ["status", "--porcelain", "--untracked-files=all"]), "");
  });

  await check("a take-down raced by another machine's share: exit 3, says it is public and how to take it down; that step works", async () => {
    const { a, b } = twoMachines();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir }).status, 0);
    assert.strictEqual(run(a, ["share", "plan"]).status, 0);
    const p = start(a, ["unshare", "plan"], { env: { FORGE_TEST_PAUSE: "pushed:8000" } });
    await p.waitFor(/forge-test: paused at pushed/);
    assert.strictEqual(run(b, ["share", "plan"]).status, 0);
    const r = await p.closed;
    assert.strictEqual(r.status, 3, r.all);
    assert.ok(r.all.includes("plan is public: another machine has since shared it; if the owner still wants it down, run: forge unshare plan"), r.all);
    const again = run(a, ["unshare", "plan"]);
    assert.strictEqual(again.status, 0, again.all);
    assert.strictEqual(manifest(a).deliverables.plan.visibility, "private");
  });

  await check("README and the skill never promise a blind repeat is safe, and give exit 3's next step as the one stderr names, with the raced take-down left to the owner", () => {
    const readme = flat(fs.readFileSync(path.join(__dirname, "..", "docs", "reference.md"), "utf8"));
    const tools = flat(fs.readFileSync(path.join(__dirname, "..", "docs", "reference.md"), "utf8").split("## For a tool built on forge")[1].split("\n## ")[0]);
    const skill = flat(fs.readFileSync(path.join(__dirname, "..", "skills", "publish", "SKILL.md"), "utf8"));
    assert.ok(!/safe either way/.test(readme), "README promises a blind repeat is safe");
    assert.ok(readme.includes("run the same command again only when `forge recover` says the change was not saved"), "README names when a repeat is safe");
    const raced = "has since shared it` was undone by another machine: tell the owner, and run the printed `forge unshare` only if the owner still wants it down";
    for (const [where, text] of [["README tools section", tools], ["skill", skill]]) {
      assert.ok(!/offer `forge deploy`/.test(text), where + " says exit 3 means deploy");
      assert.ok(text.includes("the next step stderr names after `finish with:`"), where + " gives exit 3's step as stderr's");
      assert.ok(text.includes(raced), where + " leaves the raced take-down to the owner");
    }
  });

  await check("--name onto a SHARED page from a different file gets the replace question (new page first), not the same-page one; the same file or a -vN sibling still gets the same-page one", () => {
    const store = makeStore();
    const a = makeSrc();
    const b = makeSrc();
    a.page("plan.html", "Plan", "A-TEXT");
    b.page("x.html", "Other", "B-TEXT");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: a.dir }).status, 0);
    assert.strictEqual(run(store, ["share", "plan"]).status, 0);
    const link = "https://pub.example.org/d/" + manifest(store).deliverables.plan.slug + "/";
    const A = core.toSourceKey(path.join(a.dir, "plan.html"));
    const B = core.toSourceKey(path.join(b.dir, "x.html"));
    const r = run(store, ["publish", "x.html", "--name", "plan"], { cwd: b.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /^refusing: plan is SHARED at https:\/\/pub\.example\.org\/d\/[^/]+\/: this would put the file on the public site now\.$/m);
    assert.ok(r.err.includes('"plan is public at ' + link + ", made from " + A + "; replace it with " + B + '?"'), r.err);
    assert.ok(r.err.includes("ask the owner, even if the request named that page (that is not a yes to replacing it with a different file): "), r.err);
    assert.ok(!/update the public page now/.test(r.err), "not the same-page question: " + r.err);
    const fresh = r.err.indexOf("  forge publish 'x.html' --name '<new-name>'\n");
    const cmd = (r.err.match(/^ {2}(forge publish .* --live)$/m) || [])[1];
    assert.ok(fresh >= 0 && fresh < r.err.indexOf(cmd), "the new-page default comes first: " + r.err);
    assert.strictEqual(cmd, "forge publish 'x.html' --name 'plan' --live", r.err);
    assert.match(r.err.trimEnd(), /Nothing was changed\.$/);
    const y = runPrinted(store, cmd, b.dir);
    assert.strictEqual(y.status, 0, y.all);
    assert.match(fs.readFileSync(path.join(store, "public", "d", manifest(store).deliverables.plan.slug, "index.html"), "utf8"), /B-TEXT/);
    // Unchanged: the page's own file, and a -vN sibling of it, get the same-page question.
    const s2 = makeStore();
    a.page("plan.html", "Plan", "A-TEXT");
    assert.strictEqual(run(s2, ["publish", "plan.html"], { cwd: a.dir }).status, 0);
    assert.strictEqual(run(s2, ["share", "plan"]).status, 0);
    const link2 = "https://pub.example.org/d/" + manifest(s2).deliverables.plan.slug + "/";
    a.page("plan.html", "Plan", "A-EDIT");
    a.page("plan-v2.html", "Plan", "A-V2");
    for (const f of ["plan.html", "plan-v2.html"]) {
      const same = run(s2, ["publish", f, "--name", "plan"], { cwd: a.dir });
      assert.strictEqual(same.status, 1, f + ": " + same.all);
      assert.ok(same.err.includes(core.askLive("plan", link2)), f + ": " + same.err);
      assert.ok(!/replace it with/.test(same.err), f + ": " + same.err);
    }
  });

  await check("a set-aside refusal over an unreadable git process says to run it again in a minute; other refusals still say tell the owner; README names the Linux and macOS behaviour", () => {
    const again = "this is usually a short-lived git run: run forge recover --set-aside again in a minute.";
    for (const [what, procs, opts, git] of [
      ["a git process unreadable", { 4242: { comm: "git", fds: null } }, {}, true],
      ["a git process's descriptor unreadable", { 4242: { comm: "git", fds: ["/elsewhere"], hidden: true } }, {}, true],
      ["/proc unreadable", {}, { unreadable: true }, false],
    ]) {
      const { store, lockFile } = lockedStore();
      const proc = fakeProc(procs, opts);
      let r;
      try {
        r = run(store, ["recover", "--set-aside"], { env: { FORGE_TEST_PROC: proc } });
      } finally {
        fs.chmodSync(proc, 0o755);
        restore(proc);
      }
      assert.strictEqual(r.status, 1, what + ": " + r.all);
      assert.ok(fs.existsSync(lockFile), what + ": the lock stays");
      const line = r.err.split("\n").find((l) => l.startsWith("could not check whether")) || "";
      if (git) {
        assert.ok(line.endsWith("Nothing was set aside and the lock was not moved; " + again), what + ": " + r.err);
        assert.ok(!/tell the owner/.test(line), what + ": " + line);
      } else assert.ok(line.endsWith("Nothing was set aside and the lock was not moved; tell the owner."), what + ": " + r.err);
    }
    const { store } = lockedStore();
    const r = run(store, ["recover", "--set-aside"], { env: { ...fakeLsof("exit 2"), FORGE_TEST_PROC: tmp("noproc") } });
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /lock was not moved; tell the owner\./, "lsof failing: " + r.err);
    const readme = flat(fs.readFileSync(path.join(require("./helpers.js").ENGINE, "docs", "reference.md"), "utf8"));
    assert.ok(readme.includes("On Linux, among those it refuses only for a process named `git`"), "README: the Linux behaviour");
    assert.ok(readme.includes("On macOS forge asks lsof instead, run without root, and takes what lsof lists as the whole answer: other users' processes that lsof does not show never block set-aside there."), "README: the macOS behaviour");
  });

  await check("exit 4 says once that it is not known whether the change was saved (the message, the handler, USAGE, README, the skill); an unpinned stash names git's cleanup", () => {
    const once = (text, where) => assert.strictEqual((flat(text).match(/(not known|could not confirm) whether/gi) || []).length, 1, where + ": " + text);
    const forgeSrc = fs.readFileSync(FORGE, "utf8");
    // The source line builds the text around the command name; read it as forge.
    const EXIT4 = JSON.parse((forgeSrc.match(/^const EXIT4 = (".*");$/m) || [])[1].split('" + CMD + "').join("forge"));
    assert.ok(!/saved/.test(EXIT4), "EXIT4 carries only the next step: " + EXIT4);
    // report()'s exit 4, live.
    const { a } = twoMachines();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    const r = run(a, ["publish", "plan.html"], { cwd: src.dir, env: wrapped({ WRAP_LOSE_ANSWER: "1", WRAP_FETCH_FAIL: "1" }) });
    assert.strictEqual(r.status, 4, r.all);
    assert.match(r.err, /^NOT KNOWN whether the change was saved: /);
    assert.ok(r.err.includes(EXIT4), r.err);
    once(r.err, "report()");
    // The top handler's exit 4 has no test hook (pushRev itself would have to throw): its line is the header plus EXIT4.
    const handler = (forgeSrc.match(/^ {4}console\.error\("NOT KNOWN whether the change was saved: ".*$/m) || [])[0] || "";
    assert.match(handler, /\+ "\\n" \+ EXIT4\);$/, "the handler ends with EXIT4: " + handler);
    once(handler.replace("EXIT4", JSON.stringify(EXIT4)), "the handler");
    const readme = fs.readFileSync(path.join(require("./helpers.js").ENGINE, "docs", "reference.md"), "utf8");
    once(readme.split("\n").find((l) => l.startsWith("| 4 |")) || "", "README exit table");
    once(readme.split("## For a tool built on forge")[1].split("\n## ")[0], "README tools section");
    once(run(makeStore(), ["--help"]).out, "USAGE");
    once(fs.readFileSync(path.join(require("./helpers.js").ENGINE, "skills", "publish", "SKILL.md"), "utf8"), "skill");
    // The unpinned-stash line: the entry is kept, until git's routine cleanup.
    const store = makeStore();
    fs.writeFileSync(path.join(store, "README.md"), "HAND EDIT\n");
    const u = run(store, ["recover", "--set-aside"], { env: wrapped({ WRAP_PIN_FAIL: "1" }) });
    assert.strictEqual(u.status, 3, u.all);
    assert.ok(u.err.includes("git's routine cleanup can drop stash entries after about 90 days (gc.reflogExpire), so a developer should pin or apply it before then."), u.err);
    assert.ok(flat(readme).includes("git's routine cleanup can drop stash entries after about 90 days (`gc.reflogExpire`, `git help gc`), so a developer should pin or apply it before then."), "README unpinned stash line");
  });

  await check("the different-file refusal's new-page step says to tell the owner a new private page was made, not an update, on both routes and for a private page", () => {
    const store = makeStore();
    const a = makeSrc();
    const b = makeSrc();
    a.page("plan.html", "Plan", "A-TEXT");
    a.page("notes.html", "Notes", "N-TEXT");
    b.page("plan.html", "Plan B", "B-TEXT");
    b.page("x.html", "Other", "X-TEXT");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: a.dir }).status, 0);
    assert.strictEqual(run(store, ["publish", "notes.html"], { cwd: a.dir }).status, 0);
    assert.strictEqual(run(store, ["share", "plan"]).status, 0);
    for (const [what, args, name] of [
      ["derived name, shared page", ["publish", "plan.html"], "plan"],
      ["--name onto a shared page", ["publish", "x.html", "--name", "plan"], "plan"],
      ["derived name, private page", ["publish", "notes.html"], "notes"],
    ]) {
      if (name === "notes") b.page("notes.html", "Notes B", "NB-TEXT");
      const r = run(store, args, { cwd: b.dir });
      assert.strictEqual(r.status, 1, what + ": " + r.all);
      assert.ok(r.err.includes("Usually this is a new page: publish it with --name '<new-name>', and tell the owner a new private page was made, not an update of " + name + ":\n  forge publish '" + args[1] + "' --name '<new-name>'\n"), what + ": " + r.err);
    }
    const readme = flat(fs.readFileSync(path.join(require("./helpers.js").ENGINE, "docs", "reference.md"), "utf8"));
    assert.ok(readme.includes("usually this is a new page, published with `--name '<new-name>'`, and the owner is told a new private page was made, not an update of that page;"), "README");
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
