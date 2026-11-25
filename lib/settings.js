// The user setting file: one small JSON object per user, outside the engine
// and outside the store, at $XDG_CONFIG_HOME/forge/settings.json (else
// ~/.config/forge/settings.json). Keys: "store" (an absolute path) and
// "secretCommand" (lib/secrets.js). A file that cannot be read is an error
// naming the file, never a silent empty setting: a broken setting must
// not send forge to another store.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cmd = require("./command.js");

class SettingsError extends Error {}

function file() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "forge", "settings.json");
}

function read() {
  const f = file();
  // Only a file that is not there means no setting: a folder that cannot be
  // searched or a file that cannot be read is an error, never "absent".
  let text;
  try {
    text = fs.readFileSync(f, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw new SettingsError("the forge setting file " + f + " could not be read (" + (e.code || e.message) + "); fix its permissions or remove it");
  }
  let s;
  try {
    s = JSON.parse(text);
  } catch (e) {
    throw new SettingsError("the forge setting file " + f + " is not valid JSON (" + e.message + "); fix it or remove it");
  }
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new SettingsError("the forge setting file " + f + " must hold one JSON object; fix it or remove it");
  if (s.store !== undefined && !(typeof s.store === "string" && path.isAbsolute(s.store))) {
    throw new SettingsError("the forge setting file " + f + ": store must be an absolute path; set it with: " + cmd() + " store <path>");
  }
  if (s.secretCommand !== undefined && !(typeof s.secretCommand === "string" && s.secretCommand.includes("{name}"))) {
    throw new SettingsError("the forge setting file " + f + ": secretCommand must be a command that contains {name}, for example \"fnox get {name}\"");
  }
  return s;
}

// Merge keys into the file; written whole to a temporary file, then renamed,
// so a cut-short write never leaves half a file.
function write(changes) {
  const f = file();
  const next = { ...read(), ...changes };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const t = f + ".tmp-" + process.pid;
  fs.writeFileSync(t, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(t, f);
  return next;
}

module.exports = { file, read, write, SettingsError };
