// Runnable test: node test/token-names.test.js
// forge host saves the NAME a token is kept under, never a token, and a value
// typed on the command line never goes on another program's argument list.
// The secret command only ever receives a name forge already holds: the
// host's default name, or the committed tokenSecret. A typed --token-name
// that is not the default is looked up in the environment only; a value that
// resolves to no secret is refused, and the refusal never repeats what was
// typed. Real token shapes are used, since a pattern alone cannot tell a name
// from a token (a token of letters and digits fits any name pattern). The
// boundary observer is a secret command that records its arguments. Each host
// has a default name, so --token-name is optional.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, run, git, tmp, makeSrc } = require("./helpers.js");
const { startFakeHost } = require("./fakehost.js");

const fresh = () => {
  const store = path.join(tmp("fresh"), "store");
  const r = run(store, ["init", store]);
  assert.strictEqual(r.status, 0, r.all);
  return store;
};
const identity = (store) => ({ head: git(store, ["rev-parse", "HEAD"]), config: fs.readFileSync(path.join(store, "config.json"), "utf8") });
// Shapes of real tokens: a Netlify personal token (nfp_ and mixed letters and
// digits), a 24-character mixed string (Vercel's shape), a 40-character mixed
// string (Cloudflare's shape).
const TOKENS = ["nfp_Xk29Lm4QpR7sT1vWz8Yb3Nc6Dh5Fj0GaK2eU", "aB3dE5gH7jK9mN1pQ3sT5vX7", "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0FeDcBa9Zy8"];
// A user setting file with a secretCommand that answers nothing for any name.
const silentCommand = () => {
  const xdg = tmp("xdg");
  fs.mkdirSync(path.join(xdg, "forge"));
  fs.writeFileSync(path.join(xdg, "forge", "settings.json"), JSON.stringify({ secretCommand: "true {name}" }));
  return { XDG_CONFIG_HOME: xdg };
};

// A secretCommand that records every argument list it is started with, one
// line per start, and prints `answer` (nothing by default). Returns the env
// that selects it and a reader for what it recorded (null: never started).
const recorder = (answer = "") => {
  const dir = tmp("rec");
  const rec = path.join(dir, "args");
  const cmd = path.join(dir, "secret.sh");
  fs.writeFileSync(cmd, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '" + rec + "'\nprintf '%s' '" + answer + "'\n", { mode: 0o755 });
  const xdg = tmp("xdg");
  fs.mkdirSync(path.join(xdg, "forge"));
  fs.writeFileSync(path.join(xdg, "forge", "settings.json"), JSON.stringify({ secretCommand: cmd + " {name}" }));
  return { env: { XDG_CONFIG_HOME: xdg }, got: () => (fs.existsSync(rec) ? fs.readFileSync(rec, "utf8").trim().split("\n") : null) };
};

// A typed name in the environment: forge host runs no secret command; the
// share's upload later hands the committed name to it.
async function typedThenCommitted(host) {
  const store = fresh();
  const r0 = recorder("a-value");
  const project = "ptyped";
  let r = run(store, ["host", "netlify", "--project", project, "--url", host.baseUrl(project), "--token-name", "MY_TOK"], { env: { ...host.env(), ...r0.env, MY_TOK: "a-value" } });
  assert.strictEqual(r.status, 0, r.all);
  assert.strictEqual(r0.got(), null, "no secret command for a typed name");
  assert.strictEqual(host.log(project, "uploads").length, 1, r.all);
  const src = makeSrc();
  src.page("hello.html", "Hello", "hi");
  r = run(store, ["publish", "hello.html"], { cwd: src.dir, env: { ...host.env(), ...r0.env } });
  assert.strictEqual(r.status, 0, r.all);
  r = run(store, ["share", "hello"], { env: { ...host.env(), ...r0.env } });
  assert.strictEqual(r.status, 0, r.all);
  // The first publish uploads too (it makes the master index), so every start
  // of the secret command is checked by what it received: the committed name.
  const got = r0.got() || [];
  assert.ok(got.length >= 1 && got.every((a) => a === "MY_TOK"), "the secret command received: " + JSON.stringify(got));
}

(async () => {
  await check("a token pasted as --token-name never reaches the secret command: exit 1, nothing saved, the value in neither stream, and the refusal says to revoke it", () => {
    const store = fresh();
    const before = identity(store);
    for (const v of TOKENS) {
      const r0 = recorder();
      const r = run(store, ["host", "netlify", "--project", "p", "--url", "https://x.example", "--token-name", v], { env: r0.env });
      assert.strictEqual(r.status, 1, r.all);
      assert.strictEqual(r0.got(), null, "the secret command was started with: " + JSON.stringify(r0.got()));
      assert.ok(!r.out.includes(v) && !r.err.includes(v), "the value is printed:\n" + r.all);
      assert.match(r.err, /looked up in the environment only/);
      assert.match(r.err, /[Ii]f what you typed as --token-name was the token itself, it is now in your shell history \(and in any chat or log it was typed into\): revoke it and create a new one/);
      assert.ok(r.err.includes("FORGE_NETLIFY_TOKEN"), "names the default name to store it under:\n" + r.err);
      assert.deepStrictEqual(identity(store), before, "nothing saved");
    }
  });

  await check("a token that fails the name pattern (a dash, a leading digit) gets the same revoke sentence; the value is in neither stream; nothing saved", () => {
    const store = fresh();
    const before = identity(store);
    for (const v of ["Zx9-Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0FeDcBa9Zy8", "7c1a9f0e2b8d4c6a5e3f1b9d7c5a3e1f", "cf-9a8b7c6d5e4f3a2b1c0d"]) {
      const r = run(store, ["host", "netlify", "--project", "p", "--url", "https://x.example", "--token-name", v]);
      assert.strictEqual(r.status, 1, r.all);
      assert.match(r.err, /--token-name must be the NAME the token is kept under/);
      assert.ok(r.err.includes("If what you typed as --token-name was the token itself, it is now in your shell history (and in any chat or log it was typed into): revoke it and create a new one."), "the revoke sentence:\n" + r.err);
      assert.ok(!r.out.includes(v) && !r.err.includes(v), "the value is printed:\n" + r.all);
      assert.deepStrictEqual(identity(store), before, "nothing saved");
    }
  });

  await check("a secret command that answers any name: a pasted token is still refused, never saved, never handed to it", () => {
    const store = fresh();
    const before = identity(store);
    for (const v of TOKENS) {
      const r0 = recorder("anything");
      const r = run(store, ["host", "vercel", "--project", "p", "--account", "team", "--url", "https://x.example", "--token-name", v], { env: r0.env });
      assert.strictEqual(r.status, 1, r.all);
      assert.strictEqual(r0.got(), null, "the secret command was started with: " + JSON.stringify(r0.got()));
      assert.ok(!r.all.includes(v), r.all);
      assert.deepStrictEqual(identity(store), before, "nothing saved");
    }
  });

  await check("the default name goes to the secret command, exactly that name", () => {
    const store = fresh();
    const r0 = recorder("a-value");
    const r = run(store, ["host", "netlify", "--project", "p", "--url", "https://x.example"], { env: r0.env });
    assert.strictEqual(r.status, 0, r.all);
    assert.deepStrictEqual(r0.got(), ["FORGE_NETLIFY_TOKEN"]);
  });

  await check("a typed name set in the environment: no secret command runs; a later upload hands the committed name to it", async () => {
    const host = await startFakeHost();
    try {
      await typedThenCommitted(host);
    } finally {
      host.stop();
    }
  });

  await check("a token pasted as --token-name is refused: exit 1, nothing saved, and the value is in neither stdout nor stderr", () => {
    const store = fresh();
    const before = identity(store);
    for (const env of [{}, silentCommand()]) {
      for (const v of TOKENS) {
        for (const kind of [["netlify"], ["vercel", "--account", "team"], ["cloudflare-pages", "--account", "acct"]]) {
          const r = run(store, ["host", kind[0], "--project", "p", ...kind.slice(1), "--url", "https://x.example", "--token-name", v], { env });
          const what = kind[0] + " " + v.slice(0, 4) + "... " + JSON.stringify(env);
          assert.strictEqual(r.status, 1, what + ": " + r.all);
          assert.ok(!r.out.includes(v) && !r.err.includes(v), what + ": the value is printed:\n" + r.all);
          assert.match(r.err, /is not set in the environment/, what);
          assert.deepStrictEqual(identity(store), before, what + ": nothing saved");
        }
      }
    }
  });

  await check("a name that resolves is saved and printed; the token's value never is", () => {
    const store = fresh();
    const r = run(store, ["host", "netlify", "--project", "p", "--url", "https://x.example", "--token-name", "MY_NETLIFY"], { env: { MY_NETLIFY: TOKENS[0] } });
    assert.strictEqual(r.status, 0, r.all);
    assert.match(r.out, /token read by the name MY_NETLIFY$/m);
    assert.ok(!r.all.includes(TOKENS[0]), r.all);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(store, "config.json"), "utf8")).host.tokenSecret, "MY_NETLIFY");
  });

  await check("each host has a default token name, so --token-name is optional; an unset default is refused, naming it", () => {
    for (const [kind, extra, name] of [["netlify", [], "FORGE_NETLIFY_TOKEN"], ["vercel", ["--account", "team"], "FORGE_VERCEL_TOKEN"], ["cloudflare-pages", ["--account", "acct"], "FORGE_CLOUDFLARE_TOKEN"]]) {
      const store = fresh();
      const before = identity(store);
      let r = run(store, ["host", kind, "--project", "p", ...extra, "--url", "https://x.example"]);
      assert.strictEqual(r.status, 1, kind + ": " + r.all);
      assert.ok(r.err.includes(name) && /resolves to no secret/.test(r.err), kind + ": " + r.err);
      assert.deepStrictEqual(identity(store), before);
      r = run(store, ["host", kind, "--project", "p", ...extra, "--url", "https://x.example"], { env: { [name]: TOKENS[1] } });
      assert.strictEqual(r.status, 0, kind + ": " + r.all);
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(store, "config.json"), "utf8")).host.tokenSecret, name);
    }
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
