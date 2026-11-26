// Runs every test/*.test.js; prints only FAIL lines and a count.
//   node test/run.js
// The browser tests (test/*.test.py: the Markdown export and dark mode) need
// Python Playwright; they run when python3 can import playwright and are
// reported as skipped otherwise, never silently.
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
const pyFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".test.py")).sort();
const probe = pyFiles.length ? spawnSync("python3", ["-c", "import playwright"], { encoding: "utf8" }) : null;
for (const f of pyFiles) {
  if (probe.status !== 0) { console.log("SKIPPED " + f + " (python3 cannot import playwright)"); continue; }
  ran++;
  const r = spawnSync("python3", [path.join(dir, f)], { encoding: "utf8", timeout: 300000, env: { ...process.env, TMPDIR: scratch } });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  // A browser the test could not start is said, not hidden.
  for (const l of out.split("\n")) if (l.startsWith("SKIPPED ")) console.log(l + " [" + f + "]");
  if (r.status !== 0) {
    failed++;
    console.log("FAIL " + f);
    console.log(out.split("\n").slice(-15).map((l) => "    " + l).join("\n"));
  }
}
console.log("ran " + ran + " test files, " + failed + " failed");
process.exit(failed ? 1 : 0);
