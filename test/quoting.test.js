// Runnable test: node test/quoting.test.js
// Every command forge prints for someone to run that carries a path quotes
// that path when it needs it, so the line works as printed: each check takes
// the printed line from forge's output and runs it, as printed, in sh, with a
// store at a path that holds a space. And a hand edit to config.json alone is
// refused with the commit-and-push line first and no "do not run git"
// sentence; with other files changed too, the config.json line is the one
// exception, after that sentence.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { check, done, run, git, tmp, env, makeSrc, FORGE, CONFIG } = require("./helpers.js");

const STOP = "Do not edit the store or run git in it; tell the owner and quote this message.";
// A folder with forge on it, so a printed "forge ..." line runs this engine.
const bin = tmp("bin");
fs.symlinkSync(FORGE, path.join(bin, "forge"));
// Run one printed line as printed, in sh, in the tests' own environment.
const sh = (line, store, extra = {}) => {
  const r = spawnSync("sh", ["-c", line], { encoding: "utf8", env: { ...env(store, extra), PATH: bin + path.delimiter + process.env.PATH } });
  return { status: r.status, all: r.stdout + r.stderr };
};
const lineOf = (text, re) => {
  const l = text.split("\n").find((x) => re.test(x));
  assert.ok(l, "no line matches " + re + " in:\n" + text);
  return l.trim();
};
// A store at a path with a space, configured, with a bare remote.
function spacedStore() {
  const store = path.join(tmp("spaced"), "My Pages");
  let r = run(store, ["init", store]);
  assert.strictEqual(r.status, 0, r.all);
  fs.writeFileSync(path.join(store, "config.json"), JSON.stringify(CONFIG, null, 2) + "\n");
  git(store, ["commit", "-qam", "configure"]);
  const bare = path.join(tmp("remote"), "store.git");
  git(path.dirname(bare), ["init", "-q", "--bare", bare]);
  git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(store, ["remote", "add", "origin", bare]);
  git(store, ["push", "-q", "-u", "origin", "HEAD"]);
  return { store, bare };
}
const brandOn = (bare) => JSON.parse(git(bare, ["show", "main:config.json"])).brand.name;

(async () => {
  await check("config.json alone changed by hand: the refusal leads with the commit-and-push line, says no 'do not run git', and the line works as printed at a path with a space", () => {
    const { store, bare } = spacedStore();
    const c = JSON.parse(fs.readFileSync(path.join(store, "config.json"), "utf8"));
    c.brand.name = "Own look";
    fs.writeFileSync(path.join(store, "config.json"), JSON.stringify(c, null, 2) + "\n");
    const src = makeSrc();
    src.page("hello.html", "Hello", "hi");
    const r = run(store, ["publish", "hello.html"], { cwd: src.dir });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(!r.err.includes(STOP), "says not to run git, then gives a git command:\n" + r.err);
    const first = r.err.split("\n").findIndex((l) => /commit it with this line/.test(l));
    assert.ok(first > 0 && first <= 3, "the commit-and-push line leads:\n" + r.err);
    const line = lineOf(r.err, /^\s+git -C .* commit /);
    assert.strictEqual(sh(line, store).status, 0, "the printed line failed: " + line);
    assert.strictEqual(brandOn(bare), "Own look", "the printed line committed and pushed the edit");
    assert.strictEqual(run(store, ["publish", "hello.html"], { cwd: src.dir }).status, 0);
  });

  await check("config.json and another file changed: 'do not run git' stays, and the config.json line follows it as the one exception", () => {
    const { store } = spacedStore();
    const c = JSON.parse(fs.readFileSync(path.join(store, "config.json"), "utf8"));
    c.brand.name = "Own look";
    fs.writeFileSync(path.join(store, "config.json"), JSON.stringify(c, null, 2) + "\n");
    fs.writeFileSync(path.join(store, "stray.txt"), "x");
    const r = run(store, ["regenerate"]);
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes(STOP), r.err);
    assert.ok(r.err.indexOf(STOP) < r.err.indexOf("The one exception: if you changed config.json on purpose"), r.err);
  });

  await check("commits the remote lacks: the printed push line works as printed at a path with a space", () => {
    const { store, bare } = spacedStore();
    const c = JSON.parse(fs.readFileSync(path.join(store, "config.json"), "utf8"));
    c.brand.name = "Pushed look";
    fs.writeFileSync(path.join(store, "config.json"), JSON.stringify(c, null, 2) + "\n");
    git(store, ["commit", "-qam", "look"]);
    const r = run(store, ["sync"]);
    assert.strictEqual(r.status, 1, r.all);
    const line = lineOf(r.err, /^\s+git -C .* push$/);
    assert.strictEqual(sh(line, store).status, 0, "the printed line failed: " + line);
    assert.strictEqual(brandOn(bare), "Pushed look");
    assert.ok(/'[^']*My Pages'/.test(lineOf(r.err, /pull --rebase$/)), "the rebase line quotes the path too:\n" + r.err);
  });

  await check("store, init and the no-store message: each printed forge line with a path works as printed at a path with a space", () => {
    const dir = path.join(tmp("spaced"), "New Pages");
    // forge store <a folder that is no store>: the printed init line makes one there.
    let r = run(dir, ["store", dir], { env: { FORGE_WORKSPACE: "" } });
    assert.strictEqual(r.status, 1, r.all);
    let line = lineOf(r.err, /To make one there:/).replace(/^.*To make one there: /, "");
    let s = sh(line, dir, { FORGE_WORKSPACE: "" });
    assert.strictEqual(s.status, 0, line + "\n" + s.all);
    assert.ok(fs.existsSync(path.join(dir, "manifest.json")), "the printed init line made the store at " + dir);
    // forge init under FORGE_WORKSPACE: the printed store line records it.
    const other = path.join(tmp("spaced"), "Other Pages");
    r = run(dir, ["init", other]);
    assert.strictEqual(r.status, 0, r.all);
    line = lineOf(r.out, /to use this store instead:/).replace(/^.*to use this store instead: /, "");
    s = sh(line, dir, { FORGE_WORKSPACE: "" });
    assert.strictEqual(s.status, 0, line + "\n" + s.all);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(env(dir).XDG_CONFIG_HOME, "forge", "settings.json"), "utf8")).store, other);
    // No store where FORGE_WORKSPACE points: the printed init line makes one.
    const third = path.join(tmp("spaced"), "Third Pages");
    r = run(third, ["list"]);
    assert.strictEqual(r.status, 1, r.all);
    line = lineOf(r.err, /make one there:/).replace(/^.*make one there:\s+/, "");
    s = sh(line, third, { FORGE_WORKSPACE: "" });
    assert.strictEqual(s.status, 0, line + "\n" + s.all);
    assert.ok(fs.existsSync(path.join(third, "manifest.json")), "the printed init line made the store at " + third);
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
