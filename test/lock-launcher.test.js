// Runnable test: node test/lock-launcher.test.js
// The store lock is taken by a small perl program that is started with the
// command's whole argument list. So a value typed on the command line reaches
// perl's argument list before the command itself runs, and a waiting
// command's message lists the other processes with the lock file open. Two
// guarantees, each observed at the boundary itself:
//  - a --token-name value that forge would refuse never reaches perl (a PATH
//    shim named perl records every argument list it is started with, then
//    runs the real perl), and --token-name given to any command but host is
//    refused before the lock;
//  - the wait message, and recover's message about git's index lock, print
//    each process as "pid <n>: <program>", never its command line (three
//    processes: one holding the lock, one waiting with a distinctive
//    argument, and the one whose message is read).
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { check, done, run, tmp, makeStore, makeSrc, start, git } = require("./helpers.js");

// Shapes of real tokens, including a dashed one and a digit-led one.
const TOKENS = ["nfp_Xk29Lm4QpR7sT1vWz8Yb3Nc6Dh5Fj0GaK2eU", "aB3dE5gH7jK9mN1pQ3sT5vX7", "Zx9-Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0FeDcBa9Zy8", "7c1a9f0e2b8d4c6a5e3f1b9d7c5a3e1f"];
const PERL = spawnSync("sh", ["-c", "command -v perl"], { encoding: "utf8" }).stdout.trim();

// A folder with a program named perl that records its arguments, then runs the real perl.
function perlRecorder() {
  const dir = tmp("perlshim");
  const rec = path.join(dir, "args.log");
  fs.writeFileSync(path.join(dir, "perl"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '" + rec + "'\nexec '" + PERL + "' \"$@\"\n", { mode: 0o755 });
  return { PATH: dir + path.delimiter + process.env.PATH, got: () => (fs.existsSync(rec) ? fs.readFileSync(rec, "utf8") : "") };
}

(async () => {
  await check("a token typed as --token-name never reaches perl's argument list: exit 1, the value in neither stream; a set name does reach it (the shim is in use)", () => {
    const store = makeStore();
    for (const v of TOKENS) {
      const p = perlRecorder();
      const r = run(store, ["host", "netlify", "--project", "p", "--url", "https://x.example", "--token-name", v, "--replace"], { env: { PATH: p.PATH } });
      assert.strictEqual(r.status, 1, r.all);
      assert.ok(!p.got().includes(v), "perl was started with the value:\n" + p.got().slice(0, 300));
      assert.ok(!r.all.includes(v), "the value is printed:\n" + r.all);
    }
    const p = perlRecorder();
    const r = run(store, ["host", "netlify", "--project", "p", "--url", "https://x.example", "--token-name", "MY_TOK", "--replace"], { env: { PATH: p.PATH, MY_TOK: "a-value" } });
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(p.got().includes("--token-name MY_TOK"), "the shim saw the locked run:\n" + p.got().slice(0, 300));
  });

  await check("a host flag given twice is refused before the lock: a token typed first and a good name second never reaches perl, and is in neither stream", () => {
    const store = makeStore();
    const head = git(store, ["rev-parse", "HEAD"]);
    for (const v of TOKENS) {
      for (const second of [["--token-name", "FORGE_NETLIFY_TOKEN"], ["--token-name", "MY_TOK"]]) {
        const p = perlRecorder();
        const r = run(store, ["host", "netlify", "--project", "p", "--url", "https://x.example", "--token-name", v, ...second, "--replace"], { env: { PATH: p.PATH, MY_TOK: "a-value", FORGE_NETLIFY_TOKEN: "a-value" } });
        assert.strictEqual(r.status, 1, r.all);
        assert.match(r.err, /--token-name was given more than once/, r.all);
        assert.ok(!p.got().includes(v), "perl was started with the value:\n" + p.got().slice(0, 300));
        assert.ok(!r.all.includes(v), "the value is printed:\n" + r.all);
      }
    }
    assert.strictEqual(git(store, ["rev-parse", "HEAD"]), head);
  });

  await check("every route of a pasted token into host gets the revoke sentence (--token-name=<token>, the flag before the kind, an unknown kind, no store at all): exit 1, the value in neither stream nor perl's arguments, nothing changed", () => {
    const store = makeStore();
    const head = git(store, ["rev-parse", "HEAD"]);
    const noStore = path.join(tmp("nostore"), "absent");
    for (const v of TOKENS) {
      for (const [label, at, args] of [
        ["--token-name=<token>", store, ["host", "netlify", "--project", "p", "--url", "https://x.example", "--token-name=" + v, "--replace"]],
        ["the flag before the kind", store, ["host", "--token-name", v, "netlify", "--project", "p", "--url", "https://x.example", "--replace"]],
        ["an unknown kind", store, ["host", "netlfy", "--project", "p", "--url", "https://x.example", "--token-name", v, "--replace"]],
        ["no store at all", noStore, ["host", "netlify", "--project", "p", "--url", "https://x.example", "--token-name", v]],
      ]) {
        const p = perlRecorder();
        const r = run(at, args, { env: { PATH: p.PATH } });
        assert.strictEqual(r.status, 1, label + ": " + r.all);
        assert.ok(r.err.includes("revoke it and create a new one"), label + ": no revoke sentence:\n" + r.err);
        assert.ok(!r.all.includes(v), label + ": the value is printed:\n" + r.all);
        assert.strictEqual(p.got(), "", label + ": perl was started:\n" + p.got().slice(0, 300));
      }
    }
    assert.strictEqual(git(store, ["rev-parse", "HEAD"]), head);
    assert.ok(!fs.existsSync(noStore), "no store was made");
  });

  await check("--token-name given to any command but host is refused before the lock: exit 1, the value in neither stream nor perl's arguments, nothing changed", () => {
    const store = makeStore();
    const head = git(store, ["rev-parse", "HEAD"]);
    for (const args of [["deploy", "--token-name", TOKENS[0]], ["sync", "--token-name", TOKENS[1]], ["regenerate", "--token-name=" + TOKENS[2]], ["list", "--token-name", TOKENS[3]]]) {
      const p = perlRecorder();
      const r = run(store, args, { env: { PATH: p.PATH } });
      assert.strictEqual(r.status, 1, args[0] + ": " + r.all);
      assert.match(r.err, /--token-name belongs to forge host only/, args[0]);
      assert.strictEqual(p.got(), "", args[0] + ": perl was started:\n" + p.got().slice(0, 300));
      const v = args[args.length - 1].replace("--token-name=", "");
      assert.ok(!r.all.includes(v), args[0] + ": the value is printed:\n" + r.all);
    }
    assert.strictEqual(git(store, ["rev-parse", "HEAD"]), head);
  });

  await check("the lock wait message names each process by pid and program, never its command line (holder, a waiter with a distinctive argument, and the reader)", async () => {
    const store = makeStore();
    const src = makeSrc();
    src.page("alpha.html", "Alpha", "a");
    src.page("bravo.html", "Bravo", "b");
    const SECRETISH = "zq9-distinctive-argument";
    const a = start(store, ["publish", "alpha.html"], { cwd: src.dir, env: { FORGE_TEST_PAUSE: "before:6000" } });
    await a.waitFor(/forge-test: paused at before/);
    const holder = a.holder();
    const b = start(store, ["publish", "bravo.html", "--name", SECRETISH], { cwd: src.dir });
    await b.waitFor(/waiting for another forge command/);
    const waiter = b.holder(); // B's perl, waiting with the lock file open
    const c = run(store, ["publish", "alpha.html"], { cwd: src.dir, env: { FORGE_LOCK_WAIT: "0" } });
    assert.strictEqual(c.status, 75, c.all);
    assert.ok(c.err.includes("pid " + holder + ": node"), "the holder by pid and program:\n" + c.err);
    assert.ok(c.err.includes("pid " + waiter + ": perl"), "the waiter by pid and program:\n" + c.err);
    assert.ok(!c.err.includes(SECRETISH), "a waiting command's argument is printed:\n" + c.err);
    assert.ok(!/bin\/forge|alpha\.html|bravo\.html/.test(c.err.split("processes with the store lock file open:")[1] || ""), "a command line is printed:\n" + c.err);
    assert.ok(!/MainThread/.test(c.err), c.err);
    assert.strictEqual((await a.closed).status, 0);
    assert.strictEqual((await b.closed).status, 0);
  });

  await check("recover --set-aside, refused over a process holding git's index lock, names it by pid and program only", async () => {
    const store = makeStore();
    const SECRETISH = "zq9IndexLockArgument";
    const lockFile = path.join(store, ".git", "index.lock");
    fs.writeFileSync(lockFile, "");
    const h = spawn(process.execPath, ["-e", "require('node:fs').openSync(process.argv[1], 'r'); console.log('open'); setTimeout(() => {}, 30000)", lockFile, SECRETISH], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      await new Promise((ok) => h.stdout.once("data", ok));
      const r = run(store, ["recover", "--set-aside"]);
      assert.strictEqual(r.status, 1, r.all);
      assert.ok(r.err.includes("pid " + h.pid + ": node)"), "pid and program:\n" + r.err);
      assert.ok(!r.err.includes(SECRETISH), "the command line is printed:\n" + r.err);
      assert.ok(fs.existsSync(lockFile), "the lock stays");
    } finally {
      h.kill("SIGKILL");
    }
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
