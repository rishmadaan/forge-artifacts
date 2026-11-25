// Runnable test: node test/install.test.js
// bin/install against a scratch HOME only; the real home folder is never touched.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { check, done, tmp, ENGINE } = require("./helpers.js");

const INSTALL = path.join(ENGINE, "bin", "install");
// pathDirs: folders put before /usr/bin:/bin on PATH (where a test's other "forge" lives).
function install(home, ...args) {
  const pathDirs = Array.isArray(args[0]) ? args.shift() : [];
  const r = spawnSync(process.execPath, [INSTALL, ...args], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), PATH: [...pathDirs, "/usr/bin", "/bin"].join(":") }, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
const settingsOf = (home) => {
  const f = path.join(home, ".config", "forge", "settings.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
};
// A folder holding a program named forge that answers --version with the given line.
function otherForge(line) {
  const dir = tmp("other");
  fs.writeFileSync(path.join(dir, "forge"), "#!/bin/sh\necho '" + line + "'\n", { mode: 0o755 });
  return dir;
}
const forgee = (home) => path.join(home, ".local", "bin", "forgee");
const P = (home) => ({
  forge: path.join(home, ".local", "bin", "forge"),
  agents: path.join(home, ".agents", "skills", "publish"),
  claude: path.join(home, ".claude", "skills", "publish"),
});
// What is at each path: the link's target, "file", "dir", or absent.
function state(home) {
  const out = {};
  for (const [k, p] of Object.entries(P(home))) {
    let st;
    try { st = fs.lstatSync(p); } catch { out[k] = null; continue; }
    out[k] = st.isSymbolicLink() ? "-> " + fs.readlinkSync(p) : st.isDirectory() ? "dir" : "file";
  }
  return out;
}
const OURS = {
  forge: "-> " + path.join(ENGINE, "bin", "forge"),
  agents: "-> " + path.join(ENGINE, "skills", "publish"),
  claude: "-> ../../.agents/skills/publish",
};

(async () => {
  await check("install links all three, idempotently; the links resolve to the engine", () => {
    const home = tmp("home");
    let r = install(home);
    assert.strictEqual(r.status, 0, r.err);
    assert.deepStrictEqual(state(home), OURS);
    assert.ok(fs.existsSync(path.join(P(home).claude, "SKILL.md")), "the claude link resolves to the skill");
    assert.strictEqual(fs.realpathSync(P(home).forge), path.join(ENGINE, "bin", "forge"));
    r = install(home);
    assert.strictEqual(r.status, 0);
    assert.strictEqual((r.out.match(/already linked/g) || []).length, 3);
    assert.deepStrictEqual(state(home), OURS);
  });

  await check("install says when its bin folder is not on PATH (under the name it installed), and not when it is", () => {
    const home = tmp("home");
    const bin = path.join(home, ".local", "bin");
    let r = install(home);
    assert.strictEqual(r.status, 0, r.err);
    assert.strictEqual(r.out.split("\n").filter((l) => l.startsWith("note: ")).join("\n"), "note: " + bin + " is not on PATH; add it so `forge` runs from any folder");
    const home2 = tmp("home");
    r = install(home2, [otherForge("another forge 1.0")]);
    assert.ok(r.out.includes("note: " + path.join(home2, ".local", "bin") + " is not on PATH; add it so `forgee` runs from any folder"), r.out);
    const home3 = tmp("home");
    r = install(home3, [path.join(home3, ".local", "bin")]);
    assert.strictEqual(r.status, 0, r.err);
    assert.ok(!/^note: /m.test(r.out), "no note when the folder is on PATH:\n" + r.out);
  });

  await check("--check reports and changes nothing; exit 1 until installed", () => {
    const home = tmp("home");
    let r = install(home, "--check");
    assert.strictEqual(r.status, 1);
    assert.strictEqual((r.out.match(/^MISSING: /gm) || []).length, 3);
    assert.match(r.out, /is not on PATH/);
    assert.deepStrictEqual(state(home), { forge: null, agents: null, claude: null });
    install(home);
    r = install(home, "--check");
    assert.strictEqual(r.status, 0, r.out);
    assert.ok(r.out.includes("ok: " + P(home).forge + " -> "), r.out);
    assert.ok(r.out.includes("linked: " + P(home).agents + " -> ") && r.out.includes("linked: " + P(home).claude + " -> "), "each skill link is labelled linked:\n" + r.out);
  });

  await check("refuses to replace a command path it did not create, and then changes nothing at all", () => {
    const home = tmp("home");
    fs.mkdirSync(P(home).claude, { recursive: true });
    fs.writeFileSync(path.join(P(home).claude, "SKILL.md"), "someone else's skill");
    fs.mkdirSync(path.dirname(P(home).forge), { recursive: true });
    fs.symlinkSync("/usr/bin/true", P(home).forge);
    const r = install(home);
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /refusing: .*\.local\/bin\/forge is a link to \/usr\/bin\/true, not made by this installer/);
    assert.match(r.err, /nothing was changed/);
    assert.deepStrictEqual(state(home), { forge: "-> /usr/bin/true", agents: null, claude: "dir" }, "the free path was not linked either");
    assert.strictEqual(fs.readFileSync(path.join(P(home).claude, "SKILL.md"), "utf8"), "someone else's skill");
  });

  await check("a skill path another tool already uses is skipped with a note, and the command still installs", () => {
    for (const taken of ["claude", "agents"]) {
      const home = tmp("home");
      fs.mkdirSync(P(home)[taken], { recursive: true });
      fs.writeFileSync(path.join(P(home)[taken], "SKILL.md"), "someone else's skill");
      const r = install(home);
      assert.strictEqual(r.status, 0, taken + ": " + r.out + r.err);
      assert.ok(r.out.includes("skipped: " + P(home)[taken] + " is a file or folder, not made by this installer"), taken + ": " + r.out);
      const st = state(home);
      assert.strictEqual(st.forge, OURS.forge, taken + ": the command is installed");
      assert.strictEqual(st[taken], "dir", taken + ": left as it was");
      // The claude link points through the agents path, so it is skipped too when that one is taken.
      assert.strictEqual(st.agents, taken === "agents" ? "dir" : OURS.agents, taken);
      assert.strictEqual(st.claude, taken === "claude" ? "dir" : null, taken);
      assert.strictEqual(fs.readFileSync(path.join(P(home)[taken], "SKILL.md"), "utf8"), "someone else's skill");
      const c = install(home, "--check");
      assert.strictEqual(c.status, 0, taken + ": --check passes with the command installed: " + c.out);
      // --check labels each skill link, so SETUP can branch on "skipped:" and
      // point agents at Forge's own skill file.
      assert.ok(c.out.includes("skipped: " + P(home)[taken]), taken + ": --check labels the taken skill link skipped:\n" + c.out);
      assert.ok(c.out.includes(path.join(ENGINE, "skills", "publish", "SKILL.md")), taken + ": --check names Forge's skill file:\n" + c.out);
      if (taken === "claude") assert.ok(c.out.includes("linked: " + P(home).agents + " -> "), c.out);
    }
  });

  await check("another tool's agents folder, and the same relative claude link through it (the realistic pair): --check says skipped for both, --uninstall leaves both", () => {
    const home = tmp("home");
    const p = P(home);
    fs.mkdirSync(p.agents, { recursive: true });
    fs.writeFileSync(path.join(p.agents, "SKILL.md"), "another tool's publish skill\n");
    fs.mkdirSync(path.dirname(p.claude), { recursive: true });
    fs.symlinkSync(path.join("..", "..", ".agents", "skills", "publish"), p.claude);
    let r = install(home, "--check");
    assert.ok(!/^linked: .*\.claude/m.test(r.out), "the claude link reads as Forge's:\n" + r.out);
    assert.match(r.out, new RegExp("^skipped: " + p.claude.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " ", "m"));
    r = install(home, "--uninstall");
    assert.strictEqual(r.status, 0, r.err);
    assert.ok(r.out.includes("left alone (not made by this installer, or it points through another tool's folder): " + p.claude), r.out);
    assert.strictEqual(fs.readlinkSync(p.claude), path.join("..", "..", ".agents", "skills", "publish"), "the other tool's claude link is still there");
    assert.strictEqual(fs.readFileSync(path.join(p.agents, "SKILL.md"), "utf8"), "another tool's publish skill\n");
  });

  await check("install over the realistic pair: the claude link is labelled as pointing through another tool's folder, never as not made by this installer; both are left as they were", () => {
    const home = tmp("home");
    const p = P(home);
    fs.mkdirSync(p.agents, { recursive: true });
    fs.writeFileSync(path.join(p.agents, "SKILL.md"), "another tool's publish skill\n");
    fs.mkdirSync(path.dirname(p.claude), { recursive: true });
    fs.symlinkSync(path.join("..", "..", ".agents", "skills", "publish"), p.claude);
    const r = install(home);
    assert.strictEqual(r.status, 0, r.err);
    const line = r.out.split("\n").find((l) => l.startsWith("skipped: " + p.claude + " "));
    assert.ok(line, "no skipped line for the claude link:\n" + r.out);
    assert.ok(line.startsWith("skipped: " + p.claude + " points through " + p.agents + ", which another tool uses"), "the label:\n" + line);
    assert.ok(!line.includes("not made by this installer"), "the claude link is this installer's text:\n" + line);
    assert.strictEqual(fs.readlinkSync(p.claude), path.join("..", "..", ".agents", "skills", "publish"), "the claude link is still there");
    assert.strictEqual(fs.readFileSync(path.join(p.agents, "SKILL.md"), "utf8"), "another tool's publish skill\n");
  });

  await check("--uninstall removes only its own links and leaves anything else", () => {
    const home = tmp("home");
    install(home);
    fs.unlinkSync(P(home).forge);
    fs.symlinkSync("/usr/bin/true", P(home).forge);
    const r = install(home, "--uninstall");
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(state(home), { forge: "-> /usr/bin/true", agents: null, claude: null });
    assert.match(r.out, /left alone \(not made by this installer, or it points through another tool's folder\): .*forge/);
    assert.ok(fs.existsSync(path.join(ENGINE, "skills", "publish", "SKILL.md")), "the engine's own skill is untouched");
  });

  await check("forge --version prints Forge <version>", () => {
    const r = spawnSync(process.execPath, [path.join(ENGINE, "bin", "forge"), "--version"], { encoding: "utf8" });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /^Forge \d+\.\d+\.\d+\n$/);
  });

  await check("another program named forge on PATH: installs as forgee, names that program, records the choice; reruns, --check and --uninstall follow it", () => {
    const home = tmp("home");
    const other = otherForge("Laravel Forge 3.1.0");
    let r = install(home, [other]);
    assert.strictEqual(r.status, 0, r.err);
    assert.ok(r.out.includes(path.join(other, "forge")), r.out);
    assert.match(r.out, /forgee/);
    assert.strictEqual(fs.readlinkSync(forgee(home)), path.join(ENGINE, "bin", "forge"));
    assert.strictEqual(state(home).forge, null, "the forge name is left to the other program");
    assert.deepStrictEqual(settingsOf(home), { command: "forgee" });
    const v = spawnSync(forgee(home), ["--version"], { encoding: "utf8" });
    assert.match(v.stdout, /^Forge /);
    r = install(home);
    assert.strictEqual(r.status, 0, r.err);
    assert.ok(fs.existsSync(forgee(home)) && state(home).forge === null, "the recorded choice holds without the other program on PATH");
    r = install(home, "--check");
    assert.strictEqual(r.status, 0, r.out);
    assert.ok(r.out.includes(forgee(home)), r.out);
    r = install(home, "--uninstall");
    assert.strictEqual(r.status, 0);
    assert.ok(!fs.existsSync(forgee(home)));
  });

  await check("a forge on PATH that is this tool (its --version says Forge) is not another program: installs as forge", () => {
    const home = tmp("home");
    let r = install(home, [otherForge("Forge 0.9.0"), path.join(ENGINE, "bin")]);
    assert.strictEqual(r.status, 0, r.err);
    assert.deepStrictEqual(state(home), OURS);
    assert.ok(!fs.existsSync(forgee(home)));
    assert.strictEqual(settingsOf(home), null, "nothing to record");
  });

  await check("--command forge|forgee chooses explicitly and is recorded; anything else is refused", () => {
    let home = tmp("home");
    let r = install(home, "--command", "forgee");
    assert.strictEqual(r.status, 0, r.err);
    assert.ok(fs.existsSync(forgee(home)) && state(home).forge === null);
    assert.deepStrictEqual(settingsOf(home), { command: "forgee" });
    home = tmp("home");
    r = install(home, [otherForge("something else")], "--command", "forge");
    assert.strictEqual(r.status, 0, r.err);
    assert.deepStrictEqual(state(home), OURS);
    assert.deepStrictEqual(settingsOf(home), { command: "forge" });
    r = install(tmp("home"), "--command", "fg");
    assert.strictEqual(r.status, 1);
    assert.match(r.err, /usage/);
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
