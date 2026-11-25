// Read one secret by NAME: the process environment first, then, only when the
// user setting "secretCommand" is set (lib/settings.js), that command's
// stdout; else null. Forge calls no secret store of its own: the user names
// the command for theirs, for example "fnox get {name}" or
// "op read op://Private/{name}/credential".
//
// The command runs without a shell: it is split on spaces, and every {name}
// is replaced by the secret's name inside its own argument, so a name can
// never become shell syntax. Its stderr is discarded and its stdout is never
// printed or logged here; callers must not print the value either. Callers
// hand it only names forge already holds (a host's default name, or the
// committed tokenSecret), never a value typed on the command line: the name
// goes on the command's argument list, and a pasted token would too.
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const settings = require("./settings.js");

const TIMEOUT_MS = 5000;

function commandEnv() {
  const env = { ...process.env };
  // cron has no session bus, and a Linux keyring is reached over it
  if (process.platform === "linux" && !env.DBUS_SESSION_BUS_ADDRESS && process.getuid) {
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=/run/user/${process.getuid()}/bus`;
  }
  return env;
}

// { value } or { value: null, why }: why says what the secret command did
// (exited N, timed out, could not start, printed nothing), never its output.
function readSecret(name) {
  const v = (process.env[name] || "").trim();
  if (v) return { value: v };
  const cmd = settings.read().secretCommand;
  if (!cmd) return { value: null, why: null };
  const [bin, ...args] = cmd.trim().split(/\s+/).map((a) => a.split("{name}").join(name));
  // cwd: a neutral folder, so a project config in the caller's tree cannot shadow the user's.
  // SIGKILL: a hung keyring prompt that ignores SIGTERM still cannot hold the caller past the timeout.
  const r = spawnSync(bin, args, {
    env: commandEnv(), cwd: os.tmpdir(), encoding: "utf8", timeout: TIMEOUT_MS, killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.error && r.error.code === "ETIMEDOUT") return { value: null, why: "timed out after " + TIMEOUT_MS / 1000 + " s" };
  if (r.error) return { value: null, why: "could not be started (" + (r.error.code || r.error.message) + ")" };
  if (r.status !== 0) return { value: null, why: r.status === null ? "was stopped by " + r.signal : "exited " + r.status };
  const out = (r.stdout || "").trim();
  return out ? { value: out } : { value: null, why: "printed nothing" };
}

function getSecret(name) {
  return readSecret(name).value;
}

module.exports = { getSecret, readSecret };
