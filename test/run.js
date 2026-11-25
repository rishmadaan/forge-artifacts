// Runs every test/*.test.js; prints only FAIL lines and a count.
//   node test/run.js
// The browser test for the Markdown export (publish-md-export.test.py) needs
// Python Playwright with Chromium; it runs when python3 can import playwright
// and is reported as skipped otherwise, never silently.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const os = require("node:os");
const dir = __dirname;
// Every test's scratch stores go in one folder, removed when the run ends.
// Real path: on macOS the temp folder is under /var, a link to /private/var,
// and forge prints real paths.
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "forge-run-")));
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort();
let failed = 0;
let ran = 0;
for (const f of files) {
  ran++;
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: "utf8", timeout: 300000, env: { ...process.env, FORGE_DEPLOY: "0", TMPDIR: scratch } });
  if (r.status !== 0) {
    failed++;
    console.log("FAIL " + f);
    console.log(((r.stdout || "") + (r.stderr || "")).trim().split("\n").slice(-15).map((l) => "    " + l).join("\n"));
  }
}
const py = path.join(dir, "publish-md-export.test.py");
if (fs.existsSync(py)) {
  const probe = spawnSync("python3", ["-c", "import playwright"], { encoding: "utf8" });
  if (probe.status !== 0) console.log("SKIPPED publish-md-export.test.py (python3 cannot import playwright)");
  else {
    ran++;
    const r = spawnSync("python3", [py], { encoding: "utf8", timeout: 300000, env: { ...process.env, TMPDIR: scratch } });
    if (r.status !== 0) {
      failed++;
      console.log("FAIL publish-md-export.test.py");
      console.log(((r.stdout || "") + (r.stderr || "")).trim().split("\n").slice(-15).map((l) => "    " + l).join("\n"));
    }
  }
}
console.log("ran " + ran + " test files, " + failed + " failed");
process.exit(failed ? 1 : 0);
