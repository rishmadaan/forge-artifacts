// Runnable test: node test/secrets.test.js
// The deploy token is read by NAME: from the environment, then, only when the
// user setting secretCommand is set (for example "fnox get {name}"), from that
// command's stdout. No built-in vault call. The value is never printed.
// Through a real share against the stand-in host (test/fakehost.js).
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, run, tmp, makeSrc } = require("./helpers.js");
const { startFakeHost } = require("./fakehost.js");

const VALUE = "s3cr3t-VALUE-never-printed";

// A scratch setting folder, and a fake secret program that logs each call.
function setup(host) {
  const cfg = tmp("cfg");
  const bin = path.join(tmp("bin"), "b");
  fs.mkdirSync(bin);
  const log = path.join(cfg, "calls");
  const prog = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '" + log + "'\n" + body + "\n", { mode: 0o755 });
    return p;
  };
  prog("fnox", "echo " + VALUE); // a vault program on PATH: forge must not call it on its own
  const setting = (obj) => {
    fs.mkdirSync(path.join(cfg, "forge"), { recursive: true });
    fs.writeFileSync(path.join(cfg, "forge", "settings.json"), JSON.stringify(obj));
  };
  const store = host.store();
  const src = makeSrc();
  src.page("plan.html", "Plan", "p");
  const env = (extra = {}) => ({ ...host.env(), FORGE_FAKE_HOST_TOKEN: "", FORGE_FNOX: "" /* the earlier engine's vault override, left empty so a run against it calls the vault on PATH */, XDG_CONFIG_HOME: cfg, PATH: bin + path.delimiter + host.env().PATH, ...extra });
  assert.strictEqual(run(store, ["publish", "plan.html"], { cwd: src.dir, env: env({ FORGE_FAKE_HOST_TOKEN: "x" }) }).status, 0);
  return { store, env, prog, setting, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []) };
}

(async () => {
  const host = await startFakeHost();

  await check("the environment comes first: the secret command is not run", () => {
    const x = setup(host);
    x.setting({ secretCommand: x.prog("getsecret", "echo " + VALUE) + " {name}" });
    const r = run(x.store, ["share", "plan"], { env: x.env({ FORGE_FAKE_HOST_TOKEN: VALUE }) });
    assert.strictEqual(r.status, 0, r.all);
    assert.deepStrictEqual(x.calls(), []);
    assert.ok(!r.all.includes(VALUE));
  });

  await check("not in the environment: secretCommand runs with the NAME in place of {name}, its stdout is the token, never printed", () => {
    const x = setup(host);
    x.setting({ secretCommand: x.prog("getsecret", "echo '  " + VALUE + "  '") + " get {name} --plain" });
    const r = run(x.store, ["share", "plan"], { env: x.env() });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /^public: /m);
    assert.deepStrictEqual(x.calls(), ["get FORGE_FAKE_HOST_TOKEN --plain"]);
    assert.ok(!r.all.includes(VALUE), r.all);
  });

  await check("no secretCommand: no vault program is called on its own; the deploy says there is no secret by that name, exit 3", () => {
    const x = setup(host);
    const r = run(x.store, ["share", "plan"], { env: x.env() });
    assert.strictEqual(r.status, 3, r.all);
    assert.match(r.err, /deploy FAILED: no secret named FORGE_FAKE_HOST_TOKEN in the environment/);
    assert.deepStrictEqual(x.calls(), [], "fnox on PATH was not called");
  });

  await check("a secret command that fails, hangs, prints nothing, or is missing gives no token and says which; its output never reaches forge's output", () => {
    for (const [body, why] of [
      ["echo " + VALUE + " >&2; echo " + VALUE + "; exit 3", /secretCommand exited 3/],
      ["echo " + VALUE + " >&2; exec sleep 30", /secretCommand timed out after 5 s/],
      ["true", /secretCommand printed nothing/],
      [null, /secretCommand could not be started \(ENOENT\)/],
    ]) {
      const x = setup(host);
      const cmd = body === null ? "/nonexistent/getsecret {name}" : x.prog("getsecret", body) + " {name}";
      x.setting({ secretCommand: cmd });
      const r = run(x.store, ["share", "plan"], { env: x.env() });
      assert.strictEqual(r.status, 3, String(body) + ": " + r.all);
      assert.match(r.err, /no secret named FORGE_FAKE_HOST_TOKEN/);
      assert.match(r.err, why, String(body) + ": " + r.err);
      assert.ok(!r.all.includes(VALUE), r.all);
    }
  });

  await check("a secretCommand without {name} is refused, naming the setting file", () => {
    const x = setup(host);
    x.setting({ secretCommand: "fnox get" });
    const r = run(x.store, ["share", "plan"], { env: x.env() });
    assert.notStrictEqual(r.status, 0, r.all);
    assert.match(r.all, /secretCommand must .*\{name\}/);
    assert.ok(r.all.includes(path.join("forge", "settings.json")), r.all);
  });

  host.stop();
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
