// Runnable test: node test/store.test.js
// Where the store lives: FORGE_WORKSPACE, then the user setting file
// ($XDG_CONFIG_HOME/forge/settings.json, else ~/.config/forge/settings.json, key
// "store"), then ~/.forge. `forge store` says which and why; `forge store
// <path>` sets the setting; `forge init` makes a store and records a path
// that is not the default. No store found is a loud stop naming both ways on,
// never a silent fallback. Every check runs in a scratch home folder.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { check, done, tmp, git, makeStore, FORGE, GIT_ENV } = require("./helpers.js");

// A scratch home with no FORGE_WORKSPACE; xdg: true sets XDG_CONFIG_HOME
// elsewhere, so the ~/.config fallback is tested too.
function home(opts = {}) {
  const h = tmp("storehome");
  const xdg = opts.xdg ? path.join(tmp("xdg"), "cfg") : null;
  const settings = path.join(xdg || path.join(h, ".config"), "forge", "settings.json");
  const env = { ...process.env, ...GIT_ENV, HOME: h, FORGE_DEPLOY: "0" };
  delete env.FORGE_WORKSPACE;
  delete env.FORGE_LOCK_HELD;
  delete env.FORGE_LOCK_FD;
  if (xdg) env.XDG_CONFIG_HOME = xdg;
  else delete env.XDG_CONFIG_HOME;
  const forge = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [FORGE, ...args], { cwd: h, env: { ...env, ...extra }, encoding: "utf8" });
    return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
  };
  const setting = (obj) => {
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, typeof obj === "string" ? obj : JSON.stringify(obj));
  };
  const read = () => (fs.existsSync(settings) ? JSON.parse(fs.readFileSync(settings, "utf8")) : null);
  return { h, settings, forge, setting, read, def: path.join(h, ".forge") };
}
const listed = (r) => JSON.parse(r.out).workspace;
// A configured store made through the real `forge init`, at a given path.
function storeAt(x, p) {
  const r = x.forge(["init", p], { FORGE_WORKSPACE: p });
  assert.strictEqual(r.status, 0, r.all);
  const src = makeStore();
  fs.copyFileSync(path.join(src, "config.json"), path.join(p, "config.json"));
  git(p, ["commit", "-qam", "configure"]);
  return p;
}

(async () => {
  await check("precedence: FORGE_WORKSPACE, then the setting, then ~/.forge; forge store names the store and where it came from", () => {
    for (const xdg of [false, true]) {
      const x = home({ xdg });
      const A = storeAt(x, path.join(tmp("a"), "store"));
      const B = storeAt(x, path.join(tmp("b"), "store"));
      const C = storeAt(x, x.def);
      x.setting({ store: B });
      let r = x.forge(["list", "--json"], { FORGE_WORKSPACE: A });
      assert.strictEqual(r.status, 0, r.all);
      assert.strictEqual(listed(r), A);
      r = x.forge(["store"], { FORGE_WORKSPACE: A });
      assert.strictEqual(r.status, 0, r.all);
      assert.ok(r.out.includes("store: " + A) && r.out.includes("FORGE_WORKSPACE"), r.out);
      r = x.forge(["list", "--json"]);
      assert.strictEqual(listed(r), B, r.all);
      r = x.forge(["store"]);
      assert.ok(r.out.includes("store: " + B) && r.out.includes(x.settings), r.out);
      fs.rmSync(x.settings);
      r = x.forge(["list", "--json"]);
      assert.strictEqual(listed(r), C, r.all);
      r = x.forge(["store"]);
      assert.ok(r.out.includes("store: " + C) && /default/.test(r.out), r.out);
    }
  });

  await check("no store found: a loud stop naming forge init and forge store, from every source; nothing is created", () => {
    const x = home();
    const missing = path.join(tmp("gone"), "nowhere");
    for (const [extra, from] of [[{}, /default/], [{ FORGE_WORKSPACE: missing }, /FORGE_WORKSPACE/]]) {
      for (const cmd of [["list"], ["publish", "x.html"], ["store"], ["recover"]]) {
        const r = x.forge(cmd, extra);
        assert.strictEqual(r.status, 1, cmd + ": " + r.all);
        assert.ok(r.err.includes("forge init") && r.err.includes("forge store <path>"), cmd + ": " + r.err);
        assert.match(r.err, from, cmd + ": " + r.err);
        assert.strictEqual(r.out.includes("[") || r.out.includes("published"), false, r.out);
      }
    }
    x.setting({ store: missing });
    const r = x.forge(["list"]);
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes(missing) && r.err.includes(x.settings) && r.err.includes("forge init"), r.err);
    assert.ok(!fs.existsSync(x.def) && !fs.existsSync(missing), "nothing created");
  });

  await check("a setting file that cannot be read stops every command, naming the file; never a silent fallback to another store", () => {
    const x = home();
    storeAt(x, x.def);
    for (const bad of ["{not json", "[]", JSON.stringify({ store: 5 }), JSON.stringify({ store: "relative/path" })]) {
      x.setting(bad);
      const r = x.forge(["list", "--json"]);
      assert.strictEqual(r.status, 1, bad + ": " + r.all);
      assert.ok(r.err.includes(x.settings), r.err);
      assert.strictEqual(r.out, "", bad);
    }
  });

  await check("a setting file in a folder forge cannot search or read stops every command, naming the file; never the default store", () => {
    if (process.getuid && process.getuid() === 0) return; // root reads through any permission
    const x = home();
    storeAt(x, x.def);
    const other = storeAt(x, path.join(tmp("b"), "store"));
    x.setting({ store: other });
    const dir = path.dirname(x.settings);
    for (const [what, lock, unlock] of [
      ["an unsearchable folder", () => fs.chmodSync(dir, 0o000), () => fs.chmodSync(dir, 0o755)],
      ["an unreadable file", () => fs.chmodSync(x.settings, 0o000), () => fs.chmodSync(x.settings, 0o644)],
    ]) {
      lock();
      try {
        for (const cmd of [["list", "--json"], ["store"]]) {
          const r = x.forge(cmd);
          assert.strictEqual(r.status, 1, what + ", " + cmd.join(" ") + ": " + r.all);
          assert.ok(r.err.includes(x.settings), what + ": " + r.err);
          assert.match(r.err, /could not be read \(EACCES\)/, what);
          assert.ok(!r.out.includes(x.def), what + ": never the default store: " + r.out);
        }
      } finally {
        unlock();
      }
    }
    assert.strictEqual(listed(x.forge(["list", "--json"])), other, "readable again: the setting is used");
  });

  await check("forge store <path>: refuses a folder that holds no store (says forge init <path>), keeps other settings, then forge uses it", () => {
    const x = home();
    x.setting({ secretCommand: "printf {name}" });
    const empty = tmp("empty");
    let r = x.forge(["store", empty]);
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes("forge init " + empty), r.err);
    assert.deepStrictEqual(x.read(), { secretCommand: "printf {name}" }, "setting unchanged");
    const B = storeAt(x, path.join(tmp("b"), "store"));
    r = x.forge(["store", B]);
    assert.strictEqual(r.status, 0, r.all);
    assert.deepStrictEqual(x.read(), { secretCommand: "printf {name}", store: B });
    assert.strictEqual(listed(x.forge(["list", "--json"])), B);
    // A relative path is made absolute before it is recorded.
    r = x.forge(["store", path.relative(x.h, B)]);
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(x.read().store, B);
  });

  await check("forge init: no path makes ~/.forge and records nothing; another path is recorded as the setting", () => {
    const x = home();
    let r = x.forge(["init"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(fs.existsSync(path.join(x.def, "manifest.json")) && fs.existsSync(path.join(x.def, ".git")));
    assert.strictEqual(x.read(), null, "the default is not recorded");
    const other = path.join(tmp("o"), "pages");
    r = x.forge(["init", other]);
    assert.strictEqual(r.status, 0, r.all);
    assert.deepStrictEqual(x.read(), { store: other });
    r = x.forge(["store"]);
    assert.ok(r.out.includes("store: " + other), r.out);
    // A refused init records nothing.
    const busy = tmp("busy");
    fs.writeFileSync(path.join(busy, "x"), "x");
    r = x.forge(["init", busy]);
    assert.strictEqual(r.status, 1, r.all);
    assert.deepStrictEqual(x.read(), { store: other });
  });

  await check("forge init: when recording the path fails after the store was made, it says the store exists and how to use it (exit 3), never that nothing was made", () => {
    const x = home();
    const dir = path.dirname(x.settings);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o555); // the setting file cannot be written there
    try {
      const other = path.join(tmp("o"), "pages");
      const r = x.forge(["init", other]);
      assert.strictEqual(r.status, 3, r.all);
      assert.ok(fs.existsSync(path.join(other, "manifest.json")) && fs.existsSync(path.join(other, ".git")), "the store exists");
      assert.ok(r.err.includes("the store was created at " + other), r.err);
      assert.ok(r.err.includes("forge store " + other), "says how to record it:\n" + r.err);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  await check("the engine's own folder is never a store location", () => {
    const x = home();
    const r = x.forge(["list"]);
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(r.err.includes(x.def), r.err);
    assert.ok(!r.all.includes(path.join(path.dirname(path.dirname(FORGE)), "workspace")), r.all);
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
