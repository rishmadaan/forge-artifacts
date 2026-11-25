// Runnable test: node test/finish-rules.test.js
// How a command finishes: cleanup never decides the exit; a standalone deploy that uploaded never says nothing was deployed;
// result words come from the final state; hand edits are set aside by a
// command that keeps every version; one next step, written the same way in
// the engine's messages, USAGE, the README and the skill.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { check, done, run, git, tmp, makeSrc, makeStore, manifest, start, twoMachines, ENGINE } = require("./helpers.js");
const { startFakeHost } = require("./fakehost.js");

const NOTHING_CHANGED = /nothing (was )?changed/i;
// The two sentences every surface carries word for word (README, USAGE, skill).
const EXIT4 = "When online, run forge sync, then forge list: if the change is there, run forge deploy to finish; if it is not, run the same command again.";
// The rule: ask unless the owner's own request named the public page or its link.
const askLive = (name, link) => 'Ask the owner first: "' + name + " is public at " + link + '; update the public page now?" Skip the question only if the owner\'s own request already named that public page or its link (for example "update the public ' + name + '", or the link pasted): then the request is the yes. Never infer it from "update" alone. Naming the page without calling it the public or sent one (for example "update the plan") is not a yes: ask. On yes, add --live. On no, or if you cannot ask, keep it private with --name \'<new-name>\' and say a new private page was made.';
const flat = (s) => s.replace(/\s+/g, " ");

// A git that runs the real one, except: at a push it can make forge's temporary
// folders unremovable (WRAP_LOCK_WT) and lose the push's answer
// (WRAP_LOSE_ANSWER); after that push, fetch can fail (WRAP_FETCH_FAIL).
const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const wrapDir = tmp("gitwrap");
fs.writeFileSync(path.join(wrapDir, "git"), [
  "#!/bin/sh",
  'if [ "$1" = push ]; then',
  '  "$REAL_GIT" "$@"; s=$?',
  '  touch "$WRAP_FLAG"',
  '  if [ -n "$WRAP_LOCK_WT" ]; then for d in "$TMPDIR"/forge-wt-*; do chmod 555 "$d"; done; fi',
  '  if [ -n "$WRAP_LOSE_ANSWER" ]; then echo "fatal: the remote end hung up unexpectedly" >&2; exit 1; fi',
  "  exit $s",
  "fi",
  'if [ "$1" = fetch ] && [ -e "$WRAP_FLAG" ] && [ -n "$WRAP_FETCH_FAIL" ]; then echo "fatal: unable to access the remote" >&2; exit 128; fi',
  'exec "$REAL_GIT" "$@"',
  "",
].join("\n"), { mode: 0o755 });
let flags = 0;
const wrapped = (extra) => ({ PATH: wrapDir + path.delimiter + process.env.PATH, REAL_GIT: realGit, WRAP_FLAG: path.join(wrapDir, "pushed-" + ++flags), ...extra });
const forgeFolders = (dir) => fs.readdirSync(dir).filter((e) => e.startsWith("forge-wt-")).map((e) => path.join(dir, e));
const unlock = (dir) => { for (const d of forgeFolders(dir)) fs.chmodSync(d, 0o755); };

(async () => {
  const host = await startFakeHost();
  const H = host.env();

  await check("forge recover --set-aside keeps the staged, working and untracked versions and the deletion under a named ref, clears the copy, and a publish works after", () => {
    const store = makeStore();
    const readme = path.join(store, "README.md");
    git(store, ["show", "HEAD:README.md"]); // A, in HEAD
    fs.writeFileSync(readme, "STAGED B\n");
    git(store, ["add", "README.md"]);
    fs.writeFileSync(readme, "WORKING C\n");
    fs.mkdirSync(path.join(store, "extra", "notes"), { recursive: true });
    fs.writeFileSync(path.join(store, "extra", "notes", "u.txt"), "UNTRACKED U\n");
    fs.rmSync(path.join(store, "schema.md"));
    const r = run(store, ["recover", "--set-aside"]);
    assert.strictEqual(r.status, 0, r.all);
    const ref = (r.out.match(/refs\/forge\/hand-edits\/[^\s,;:]+/) || [])[0];
    assert.ok(ref, "names the ref: " + r.out);
    assert.match(r.out, /git stash apply --index refs\/forge\/hand-edits\//);
    assert.strictEqual(git(store, ["show", ref + ":README.md"]), "WORKING C");
    assert.strictEqual(git(store, ["show", ref + "^2:README.md"]), "STAGED B");
    assert.strictEqual(git(store, ["show", ref + "^3:extra/notes/u.txt"]), "UNTRACKED U");
    assert.strictEqual(git(store, ["ls-tree", "--name-only", ref, "--", "schema.md"]), "", "the deletion is recorded");
    assert.strictEqual(git(store, ["status", "--porcelain", "--untracked-files=all"]), "");
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    const p = run(store, ["publish", "plan.html"], { cwd: src.dir });
    assert.strictEqual(p.status, 0, p.all);
  });

  await check("a version take-down on a private page while another machine shares it: the share keeps that version off the link site", async () => {
    const { a, b } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p1");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    src.page("plan.html", "Plan", "p2");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    const p = start(a, ["unshare", "plan", "--version", "1"], { env: { ...H, FORGE_TEST_PAUSE: "pushed:8000" } });
    await p.waitFor(/forge-test: paused at pushed/);
    const s = run(b, ["share", "plan"], { env: H });
    assert.strictEqual(s.status, 0, s.all);
    const r = await p.closed;
    assert.ok(!/already|is public/.test(r.all), r.all);
    const slug = manifest(b).deliverables.plan.slug;
    assert.deepStrictEqual(fs.readdirSync(path.join(b, "public", "d", slug)).sort(), ["index.html", "v2", "versions"], "v1 stayed off the link site");
  });

  await check("a version take-down that another machine's commit left public at the end (no forge command does that; a copy of the store edited by hand could): says it is public, never 'already' or 'confirmed'", async () => {
    const { a, b } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p1");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    src.page("plan.html", "Plan", "p2");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    const p = start(a, ["unshare", "plan", "--version", "1"], { env: { ...H, FORGE_TEST_PAUSE: "pushed:8000" } });
    await p.waitFor(/forge-test: paused at pushed/);
    assert.strictEqual(run(b, ["share", "plan"], { env: H }).status, 0);
    // The other machine then puts v1 back on the link site with plain git.
    const slug = manifest(b).deliverables.plan.slug;
    const mf = path.join(b, "manifest.json");
    const m = JSON.parse(fs.readFileSync(mf, "utf8"));
    delete m.deliverables.plan.versions[0].takenDown;
    fs.writeFileSync(mf, JSON.stringify(m, null, 2) + "\n");
    fs.renameSync(path.join(b, "private", "d", slug, "v1"), path.join(b, "public", "d", slug, "v1"));
    git(b, ["add", "-A"]);
    git(b, ["commit", "-q", "-m", "v1 public again"]);
    git(b, ["push", "-q", "origin", "HEAD"]);
    const r = await p.closed;
    assert.ok(!/already|confirmed not to serve/.test(r.all), r.all);
    assert.match(r.out, /^plan v1 is public/m);
  });

  await check("a publish superseded by another machine's newer version says so (the stable link shows it)", async () => {
    const { a, b } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p1");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    src.page("plan.html", "Plan", "p2");
    const p = start(a, ["publish", "plan.html"], { cwd: src.dir, env: { ...H, FORGE_TEST_PAUSE: "pushed:8000" } });
    await p.waitFor(/forge-test: paused at pushed/);
    src.page("plan.html", "Plan", "p3");
    const s = run(b, ["publish", "plan.html"], { cwd: src.dir, env: H });
    assert.match(s.out, /^published plan v3/m, s.all);
    const r = await p.closed;
    assert.match(r.out, /^published plan v2 \(private\)$/m, r.all);
    assert.match(r.out, /another machine has since published v3; the stable link shows v3/);
  });

  await check("forge's temporary folder cannot be removed after the push: the result stands (exit 0, private line), the folder is named, and forge recover removes it", () => {
    const store = twoMachines().a;
    const t = tmp("wt");
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    let r;
    try {
      r = run(store, ["publish", "plan.html"], { cwd: src.dir, env: wrapped({ TMPDIR: t, WRAP_LOCK_WT: "1" }) });
    } finally {
      unlock(t);
    }
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^private: http/m);
    assert.match(r.err, /left a temporary folder .*; forge recover removes it/);
    const rec = run(store, ["recover"], { env: { TMPDIR: t } });
    assert.strictEqual(rec.status, 0, rec.all);
    assert.deepStrictEqual(forgeFolders(t), [], "recover removed it: " + rec.all);
  });

  await check("the same with the push's answer lost and the remote unreadable: exit 4, never 1", () => {
    const store = twoMachines().a;
    const t = tmp("wt");
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    let r;
    try {
      r = run(store, ["publish", "plan.html"], { cwd: src.dir, env: wrapped({ TMPDIR: t, WRAP_LOCK_WT: "1", WRAP_LOSE_ANSWER: "1", WRAP_FETCH_FAIL: "1" }) });
    } finally {
      unlock(t);
    }
    assert.strictEqual(r.status, 4, r.all);
    assert.ok(!NOTHING_CHANGED.test(r.all), r.all);
  });

  await check("an exception that escapes after the push exits 3 (saved, private line) or 4 (not known), never 1", () => {
    const { a } = twoMachines();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    const r = run(a, ["publish", "plan.html"], { cwd: src.dir, env: { FORGE_TEST_THROW: "cleanup" } });
    assert.strictEqual(r.status, 3, r.all);
    assert.match(r.out, /^private: http/m);
    assert.ok(!NOTHING_CHANGED.test(r.all), r.all);
    const b = twoMachines().a;
    const u = run(b, ["publish", "plan.html"], { cwd: src.dir, env: wrapped({ FORGE_TEST_THROW: "cleanup", WRAP_LOSE_ANSWER: "1", WRAP_FETCH_FAIL: "1" }) });
    assert.strictEqual(u.status, 4, u.all);
    assert.ok(!NOTHING_CHANGED.test(u.all), u.all);
  });

  await check("saved but this machine's copy could not catch up: never 'its private link works'; says it is not in this machine's copy yet", async () => {
    const { a } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("first.html", "First", "f");
    assert.strictEqual(run(a, ["publish", "first.html"], { cwd: src.dir, env: H }).status, 0);
    host.mode(a, "readback-fail");
    src.page("plan.html", "Plan", "p");
    // A commit made here while the publish runs: this copy cannot fast-forward past it.
    const p = start(a, ["publish", "plan.html"], { cwd: src.dir, env: { ...H, FORGE_TEST_PAUSE: "fast-forward:4000" } });
    await p.waitFor(/paused at fast-forward/);
    git(a, ["commit", "-q", "--allow-empty", "-m", "a commit only this machine has"]);
    const r = await p.closed;
    host.mode(a, null);
    assert.strictEqual(r.status, 3, r.all);
    assert.ok(!/private link works/.test(r.all), r.all);
    assert.match(r.err, /not in this machine's copy of the store until it catches up/);
  });

  await check("forge deploy uploads, then the remote's newer commit fails the check: exit 3, names both commits, never 'Nothing was deployed'", async () => {
    const { a, b } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir }).status, 0);
    const sent = git(a, ["rev-parse", "HEAD"]);
    const p = start(a, ["deploy"], { env: { ...H, FORGE_TEST_PAUSE: "deployed:8000" } });
    await p.waitFor(/forge-test: paused at deployed/);
    git(b, ["pull", "-q", "--ff-only"]);
    fs.mkdirSync(path.join(b, "public", "d", "orphan000000"), { recursive: true });
    fs.writeFileSync(path.join(b, "public", "d", "orphan000000", "index.html"), "<html></html>");
    git(b, ["add", "-A"]);
    git(b, ["commit", "-qm", "a commit that fails the check"]);
    git(b, ["push", "-q"]);
    const bad = git(b, ["rev-parse", "HEAD"]);
    const r = await p.closed;
    assert.strictEqual(r.status, 3, r.all);
    assert.ok(!/Nothing was deployed/.test(r.all), r.all);
    assert.ok(r.err.includes(sent.slice(0, 12)), "names the uploaded commit: " + r.err);
    assert.ok(r.err.includes(bad.slice(0, 12)), "names the newer commit: " + r.err);
  });

  await check("a failure after forge deploy uploaded is exit 3, never 1", () => {
    const store = host.store();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir }).status, 0);
    const r = run(store, ["deploy"], { env: { ...H, FORGE_TEST_THROW: "deployed" } });
    assert.strictEqual(r.status, 3, r.all);
    assert.ok(!/Nothing was deployed/.test(r.all), r.all);
  });

  await check("a later failure with the link site confirmed prints public: on exit 3, and the README says what a public: line means", () => {
    const store = host.store();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    const r = run(store, ["share", "plan"], { env: { ...H, FORGE_TEST_THROW: "pushed" } });
    assert.strictEqual(r.status, 3, r.all);
    assert.match(r.out, /^public: http/m);
    const readme = flat(fs.readFileSync(path.join(ENGINE, "docs", "reference.md"), "utf8"));
    assert.ok(readme.includes("A `public:` line means the link site was confirmed to show the page, whatever the exit code."), "README states it");
    assert.ok(!readme.includes("on exit 3 it is missing even for a shared page"), "README no longer says public: never comes on exit 3");
    assert.ok(!/a share of a shared page and a take-down of a page already off the link site change nothing/.test(readme), "README no longer says a repeated share or take-down changes nothing");
    assert.ok(!readme.includes("Never after the push:"), "README no longer carries the old 'Never after the push' rule");
  });

  await check("both refusals to change a shared page ask the owner first (the different-file one names both files), never 'if the owner said'", () => {
    const store = makeStore();
    const a = makeSrc();
    const b = makeSrc();
    a.page("plan.html", "Plan", "p1");
    b.page("plan.html", "Plan B", "q");
    assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: a.dir }).status, 0);
    assert.strictEqual(run(store, ["share", "plan"]).status, 0);
    const link = "https://pub.example.org/d/" + manifest(store).deliverables.plan.slug + "/";
    a.page("plan.html", "Plan", "p2");
    const r = run(store, ["publish", "plan.html"], { cwd: a.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes(askLive("plan", link)), r.err);
    const d = run(store, ["publish", "plan.html"], { cwd: b.dir });
    assert.strictEqual(d.status, 1, d.all);
    // a different file gets the replace question, naming both files.
    assert.ok(d.err.includes('"plan is public at ' + link + ", made from " + require("../lib/core.js").toSourceKey(path.join(a.dir, "plan.html")) + "; replace it with "), d.err);
    for (const x of [r, d]) assert.ok(!/owner said/.test(x.all), x.all);
  });

  await check("a take-down whose answer was lost (exit 4) is finished by the printed next step (forge sync, forge list, forge deploy): exit 0, the last upload lacks the page, one take-down commit", () => {
    const { a, bare } = twoMachines(() => host.store());
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir, env: H }).status, 0);
    assert.strictEqual(run(a, ["share", "plan"], { env: H }).status, 0);
    const slug = manifest(a).deliverables.plan.slug;
    const lost = run(a, ["unshare", "plan"], { env: { ...H, ...wrapped({ PATH: wrapDir + path.delimiter + H.PATH, WRAP_LOSE_ANSWER: "1", WRAP_FETCH_FAIL: "1" }) } });
    assert.strictEqual(lost.status, 4, lost.all);
    assert.ok(flat(lost.err).includes(EXIT4), lost.err);
    // The printed next step: forge sync, then forge list; the change is there, so forge deploy.
    assert.strictEqual(run(a, ["sync"], { env: H }).status, 0);
    assert.strictEqual(JSON.parse(run(a, ["list", "--json"], { env: H }).out).documents.find((x) => x.name === "plan").visibility, "private");
    const again = run(a, ["deploy"], { env: H });
    assert.strictEqual(again.status, 0, again.all);
    assert.ok(!host.uploads(a).pop().files.some((f) => f.includes(slug)), "the last upload lacks the page");
    assert.strictEqual(git(bare, ["log", "--format=%s"]).split("\n").filter((l) => l.startsWith("unshare: plan")).length, 1, "one take-down commit");
  });

  await check("README's section for tools built on forge, USAGE and the skill carry the exit 4 step and the --live question word for word", () => {
    const readme = fs.readFileSync(path.join(ENGINE, "docs", "reference.md"), "utf8");
    const tools = flat(readme.split("## For a tool built on forge")[1].split("\n## ")[0]);
    const usage = flat(run(makeStore(), ["--help"]).out);
    const skill = flat(fs.readFileSync(path.join(ENGINE, "skills", "publish", "SKILL.md"), "utf8"));
    const table = flat(readme.split("\n").find((l) => l.startsWith("| `forge publish ")) || "");
    assert.ok(table.includes(askLive("<name>", "<link>")), "README command table has the --live question");
    for (const [where, text] of [["README tools section", tools], ["USAGE", usage], ["skill", skill]]) {
      assert.ok(text.includes(EXIT4), where + " has the exit 4 step");
      assert.ok(text.includes(askLive("<name>", "<link>")), where + " has the --live question");
      assert.ok(!/do not repeat (the command )?blindly|do not retry|do not run it again/i.test(text), where + " has no contrary exit 4 advice");
    }
  });

  await check("the hand-edit refusal, from a folder with its own README.md, names forge recover --set-aside and an absolute README path that has the section; the store README no longer says to commit", () => {
    const store = makeStore();
    const src = makeSrc();
    src.file("README.md", "this folder's own readme\n");
    src.page("plan.html", "Plan", "p");
    fs.writeFileSync(path.join(store, "README.md"), "hand edit\n");
    const r = run(store, ["publish", "plan.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /forge recover --set-aside/);
    const p = (r.err.match(/(\/\S*reference\.md)/) || [])[1];
    assert.ok(p && path.isAbsolute(p) && fs.existsSync(p), "an absolute path to the engine's reference that exists: " + r.err);
    assert.ok(fs.readFileSync(p, "utf8").includes("## Setting changes aside (only when the owner asks)"), p);
    const init = path.join(tmp("init"), "s");
    assert.strictEqual(run(init, ["init", init]).status, 0);
    const tpl = fs.readFileSync(path.join(init, "README.md"), "utf8");
    assert.ok(!/committed or undone/.test(tpl), tpl);
    assert.match(flat(tpl), /Do not commit hand edits here/);
    assert.match(tpl, /forge recover --set-aside/);
  });

  await check("a half-updated copy names forge recover --set-aside; it moves the lock aside (kept), clears the copy, and forge sync then catches up", () => {
    const { a, b } = twoMachines();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(b, ["publish", "plan.html"], { cwd: src.dir }).status, 0);
    git(a, ["fetch", "-q"]);
    const up = git(a, ["rev-parse", "@{u}"]);
    fs.writeFileSync(path.join(a, "manifest.json"), git(a, ["show", "@{u}:manifest.json"]) + "\n");
    const lockFile = path.join(a, ".git", "index.lock");
    fs.writeFileSync(lockFile, "");
    const w = run(a, ["publish", "plan.html"], { cwd: src.dir });
    assert.strictEqual(w.status, 1, w.all);
    assert.match(w.err, /forge recover --set-aside/);
    assert.ok(!/hand edit/i.test(w.all), w.all);
    // A git still holding the lock file open: the lock is not moved.
    const holder = spawn(process.execPath, ["-e", "require('fs').openSync(process.argv[1], 'r'); setTimeout(() => {}, 20000)", lockFile], { stdio: "ignore" });
    try {
      let busy;
      for (let i = 0; i < 50; i++) {
        busy = run(a, ["recover", "--set-aside"]);
        if (busy.status !== 0) break;
      }
      assert.strictEqual(busy.status, 1, busy.all);
      assert.ok(busy.all.includes(String(holder.pid)), "names the process: " + busy.all);
      assert.ok(fs.existsSync(lockFile), "the lock stays while a process has it open");
    } finally {
      holder.kill("SIGKILL");
    }
    const r = run(a, ["recover", "--set-aside"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(!fs.existsSync(lockFile), "the lock was moved aside");
    const kept = (r.out.match(/(\/\S*index\.lock)/) || [])[1];
    assert.ok(kept && fs.existsSync(kept), "names where the lock went: " + r.out);
    assert.strictEqual(git(a, ["status", "--porcelain", "--untracked-files=all"]), "");
    const s = run(a, ["sync"]);
    assert.strictEqual(s.status, 0, s.all);
    assert.strictEqual(git(a, ["rev-parse", "HEAD"]), up);
  });

  await check("forge recover names what each interrupted command was (the commit's subject), and says when nothing was committed", async () => {
    const { a } = twoMachines();
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    assert.strictEqual(run(a, ["publish", "plan.html"], { cwd: src.dir }).status, 0);
    assert.strictEqual(run(a, ["share", "plan"]).status, 0);
    const p = start(a, ["unshare", "plan"], { env: { FORGE_TEST_PAUSE: "pushed:8000" } });
    await p.waitFor(/forge-test: paused at pushed/);
    process.kill(p.holder(), "SIGKILL");
    await p.closed;
    const rec = run(a, ["recover"]);
    assert.strictEqual(rec.status, 0, rec.all);
    assert.match(rec.out, /the change was saved \(commit [0-9a-f]{12}: unshare: plan \(whole document\)\)/);
    src.page("other.html", "Other", "o");
    const q = start(a, ["publish", "other.html"], { cwd: src.dir, env: { FORGE_TEST_PAUSE: "before:8000" } });
    await q.waitFor(/forge-test: paused at before/);
    process.kill(q.holder(), "SIGKILL");
    await q.closed;
    const rec2 = run(a, ["recover"]);
    assert.strictEqual(rec2.status, 0, rec2.all);
    assert.match(rec2.out, /nothing was committed in it/);
  });

  await check("covering: a push the remote refuses (a hook), read back as not taken, stays exit 1 with nothing changed", () => {
    const { a, bare } = twoMachines();
    fs.writeFileSync(path.join(bare, "hooks", "pre-receive"), "#!/bin/sh\necho 'rejected by policy' >&2\nexit 1\n", { mode: 0o755 });
    const before = git(bare, ["rev-parse", "HEAD"]);
    const src = makeSrc();
    src.page("plan.html", "Plan", "p");
    const r = run(a, ["publish", "plan.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /the store's remote refused the change, so nothing changed/);
    assert.strictEqual(git(bare, ["rev-parse", "HEAD"]), before);
  });

  host.stop();
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
