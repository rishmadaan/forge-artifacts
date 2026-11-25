// Git for the store. Every call runs in the store's own folder; nothing here
// resets or rebases, and only setAside (forge recover --set-aside, run when the
// owner asks) stashes, into a commit pinned under a named ref.
//
// Writes never happen in the live copy (the store folder): a change is made in
// a throwaway worktree in the OS temp folder, at the remote's head, checked and
// committed there, and pushed. The push is the commit point; the live copy only
// ever fast-forwards to what was pushed. An interrupted command therefore
// leaves nothing to put back, only a temporary folder (forge recover removes it).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const cmd = require("./command.js");

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { ok: r.status === 0 && !r.error, out: (r.stdout || "").trimEnd(), err: ((r.stderr || "") + (r.error ? r.error.message : "")).trim() };
}

function must(root, args, what) {
  const r = git(root, args);
  if (!r.ok) throw new Error(what + " failed (git " + args.join(" ") + "):\n" + r.err + (r.out ? "\n" + r.out : ""));
  return r.out;
}

// Uncommitted changes anywhere in the store, untracked files included.
function dirty(root) {
  return must(root, ["status", "--porcelain", "--untracked-files=all"], "reading the store's git status");
}

function hasRemote(root) {
  return must(root, ["remote"], "listing the store's remotes") !== "";
}

function head(root) {
  return must(root, ["rev-parse", "HEAD"], "reading the store's HEAD");
}

// A refusal about the store's remote: kind "unreachable" (try again later,
// nothing changed) or "diverged" (stop and tell the owner). No message asks
// anyone to run git in the store: a model following it could bake a half-made
// change into history, and the owner should not have to.
class RemoteError extends Error {
  constructor(kind, msg) { super(msg); this.kind = kind; }
}
const STOP = "Do not edit the store or run git in it; tell the owner and quote this message.";
const unreachable = (err) => Object.assign(new RemoteError("unreachable", "refusing: the store's remote could not be reached, so nothing changed; try again when online:\n" + err), { err });

// The commit a change starts from: the remote's head (fetched now) when the
// store has a remote, else this copy's head.
function upstream(root) {
  const branch = must(root, ["symbolic-ref", "--short", "HEAD"], "reading the store's branch");
  const remote = git(root, ["config", "branch." + branch + ".remote"]).out;
  const merge = git(root, ["config", "branch." + branch + ".merge"]).out;
  if (!remote || !merge) {
    throw new RemoteError("diverged", "STOP: the store's branch has no upstream branch on its remote, so changes cannot be pushed to it. Nothing was changed. " + STOP);
  }
  return { remote, merge };
}
function base(root) {
  if (!hasRemote(root)) return head(root);
  const f = git(root, ["fetch", "-q"]);
  if (!f.ok) throw unreachable(f.err);
  upstream(root);
  return must(root, ["rev-parse", "@{u}"], "reading the remote's head");
}

// Temporary worktrees live in the OS temp folder, in folders named forge-wt-*,
// which is how forge recover knows them. The commit a worktree started from is
// written beside it (base), so recover can tell whether a commit was made in
// it, and the store it belongs to (root), so recover can remove a folder git no
// longer lists.
const WT_MARK = "forge-wt-";
function addWorktree(root, rev) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), WT_MARK));
  const dir = path.join(parent, "store");
  fs.writeFileSync(path.join(parent, "base"), rev + "\n");
  fs.writeFileSync(path.join(parent, "root"), fs.realpathSync(root) + "\n");
  const r = git(root, ["worktree", "add", "-q", "--detach", dir, rev]);
  if (!r.ok) {
    fs.rmSync(parent, { recursive: true, force: true });
    throw new Error("making a temporary copy of the store failed (git worktree add):\n" + r.err);
  }
  return dir;
}
// Never throws: it runs after the push too, where a cleanup failure must not
// replace the command's outcome. Returns false when the folder is left.
function removeWorktree(root, dir) {
  git(root, ["worktree", "remove", "--force", dir]);
  let gone = true;
  try {
    if (path.basename(path.dirname(dir)).startsWith(WT_MARK)) fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  } catch (e) {
    gone = false;
    console.error("left a temporary folder " + path.dirname(dir) + " (" + (e.code || e.message) + "); " + cmd() + " recover removes it");
  }
  git(root, ["worktree", "prune"]);
  return gone;
}
// forge-wt-* folders of this store that git no longer lists (a removal that
// failed after git dropped the worktree): nothing in them is needed.
function strayFolders(root, listed) {
  const me = fs.realpathSync(root);
  const known = new Set(listed.map((p) => path.dirname(p)));
  return fs.readdirSync(os.tmpdir()).filter((e) => e.startsWith(WT_MARK)).map((e) => path.join(os.tmpdir(), e))
    .filter((p) => !known.has(p) && (() => { try { return fs.readFileSync(path.join(p, "root"), "utf8").trim() === me; } catch { return false; } })());
}

// Processes that have a file open (/proc on Linux, lsof on macOS):
// { pids }, or { failed: why, comm } when absence could not be established (the
// caller then refuses; comm is the process's name when one was read). FORGE_TEST_PROC points the /proc read at a test's tree.
function openBy(file) {
  const proc = process.env.FORGE_TEST_PROC || "/proc";
  if (!fs.existsSync(path.join(proc, "self", "fd"))) {
    const r = spawnSync("lsof", ["-w", "-t", "--", file], { encoding: "utf8" });
    const err = (r.stderr || "").trim();
    // lsof exits 1 both when no process has the file open and on an error; only a silent 1 means none.
    if (r.error || (r.status !== 0 && !(r.status === 1 && !err))) {
      return { failed: "lsof " + (r.error ? "could not be run (" + (r.error.code || r.error.message) + ")" : "failed (exit " + r.status + (err ? ": " + err : "") + ")") };
    }
    return { pids: (r.stdout || "").split("\n").filter(Boolean) };
  }
  const real = fs.realpathSync(file);
  let entries;
  try {
    entries = fs.readdirSync(proc).filter((x) => /^\d+$/.test(x));
  } catch (e) {
    return { failed: "the process list in " + proc + " could not be read (" + e.code + ")" };
  }
  const pids = [];
  for (const p of entries) {
    let fds;
    try {
      fds = fs.readdirSync(path.join(proc, p, "fd"));
    } catch (e) {
      if (e.code === "ENOENT") continue; // it ended
      let comm;
      try {
        comm = fs.readFileSync(path.join(proc, p, "comm"), "utf8").trim();
      } catch (c) {
        if (c.code === "ENOENT") continue;
        return { failed: "process " + p + " could not be inspected (" + e.code + ")" };
      }
      // shortcut: without root, other users' and protected processes (sshd, ssh-agent) are always unreadable; only a git among them blocks. Another program holding the lock that way is a named limit (README).
      if (e.code === "EACCES" && comm !== "git") continue;
      return { failed: "process " + p + " (" + comm + ") could not be inspected (" + e.code + ")", comm };
    }
    let hidden = null; // a descriptor whose target could not be read (ENOENT: it closed)
    if (fds.some((f) => { try { return fs.readlinkSync(path.join(proc, p, "fd", f)) === real; } catch (e) { if (e.code !== "ENOENT") hidden = e.code; return false; } })) pids.push(p);
    else if (hidden) {
      let comm;
      try {
        comm = fs.readFileSync(path.join(proc, p, "comm"), "utf8").trim();
      } catch (c) {
        if (c.code === "ENOENT") continue;
        return { failed: "process " + p + " could not be inspected (" + hidden + ")" };
      }
      if (!(hidden === "EACCES" && comm !== "git")) return { failed: "process " + p + " (" + comm + ") could not be inspected (" + hidden + ")", comm };
    }
  }
  return { pids };
}

// forge recover --set-aside, only when the owner asks: keep every uncommitted
// version (working, staged, untracked, deletions) in one stash commit pinned
// under refs/forge/hand-edits/<time>, then the copy is clean. A git index lock
// no process has open (left by a git that was stopped) is moved first into
// .git/forge-hand-edits/<time>/, beside the record. Nothing is discarded.
function setAside(root) {
  const time = new Date().toISOString().replace(/[:.]/g, "-");
  const ref = "refs/forge/hand-edits/" + time;
  const lock = path.join(root, ".git", "index.lock");
  let movedLock = null;
  if (fs.existsSync(lock)) {
    const users = openBy(lock);
    if (users.failed) {
      // A git the check cannot read is usually a short-lived run, so the refusal names a step the owner can take.
      const next = users.comm === "git" ? "this is usually a short-lived git run: run " + cmd() + " recover --set-aside again in a minute." : "tell the owner.";
      return { refused: "could not check whether a process has git's index lock open in this copy of the store: " + users.failed + ". Nothing was set aside and the lock was not moved; " + next };
    }
    if (users.pids.length) {
      // The program only, never the command line, which may carry a typed value.
      const who = users.pids.map((p) => "pid " + p + ": " + path.basename((spawnSync("ps", ["-o", "args=", "-p", p], { encoding: "utf8" }).stdout || "").trim().split(/\s+/)[0] || "ended")).join("; ");
      return { refused: "a process has git's index lock open in this copy of the store (" + who + "); nothing was set aside. Run " + cmd() + " recover --set-aside again when it has ended." };
    }
    movedLock = path.join(root, ".git", "forge-hand-edits", time, "index.lock");
    fs.mkdirSync(path.dirname(movedLock), { recursive: true });
    fs.renameSync(lock, movedLock);
  }
  if (!dirty(root)) return { ref: null, movedLock };
  must(root, ["stash", "push", "--include-untracked", "-m", "forge-hand-edits-" + time], "setting the changes aside (git stash)");
  // Stashed: the copy has changed, so a failed pin is reported, never thrown
  // as "nothing changed"; the edits stay in git's stash list.
  const entry = git(root, ["rev-parse", "refs/stash"]).out;
  const pin = git(root, ["update-ref", ref, "refs/stash"]);
  if (!pin.ok) return { unpinned: entry || "stash@{0}", why: pin.err, movedLock };
  return { ref, movedLock, left: dirty(root) };
}
// Worktrees an interrupted forge command left behind: { path, head, base }
// (base is null when its record is gone).
function leftoverWorktrees(root) {
  return must(root, ["worktree", "list", "--porcelain"], "listing the store's worktrees").split("\n\n")
    .map((b) => ({ path: (b.match(/^worktree (.*)$/m) || [])[1], head: (b.match(/^HEAD (\w+)$/m) || [])[1] || null }))
    .filter((w) => w.path && path.basename(path.dirname(w.path)).startsWith(WT_MARK))
    .map((w) => {
      let base = null;
      try { base = fs.readFileSync(path.join(path.dirname(w.path), "base"), "utf8").trim(); } catch { /* record gone */ }
      return { ...w, base };
    });
}

// Is commit rev contained in commit inRev (inRev itself or a descendant of it)?
function contains(root, rev, inRev) {
  return git(root, ["merge-base", "--is-ancestor", rev, inRev]).ok;
}

// Push a commit made in a worktree to the store's remote branch. Returns
// { ok } (the remote has rev), or { ok: false, kind, err }: "moved" (another
// change landed first; retry), "refused" (the remote does not have rev and has
// nothing new either: permissions, a hook), or "unknown" (the push did not
// say yes and the remote could not be read afterwards, so whether it holds
// rev is not known). A failed push is never taken as "not saved" without
// reading the remote: the push may have landed and only its answer been lost.
function pushRev(root, rev) {
  const { remote, merge } = upstream(root);
  const p = git(root, ["push", "-q", remote, rev + ":" + merge]);
  const f = git(root, ["fetch", "-q"]); // so @{u} names the remote's head now
  if (p.ok) return { ok: true };
  if (!f.ok) return { ok: false, kind: "unknown", err: p.err + "\n" + f.err };
  if (contains(root, rev, "@{u}")) return { ok: true, lostAnswer: true };
  // Refused although the remote still has nothing this commit lacks: not a
  // race, something else (permissions, a hook); say so instead of retrying.
  if (contains(root, "@{u}", rev)) return { ok: false, kind: "refused", err: p.err };
  return { ok: false, kind: "moved", err: p.err };
}

// Bring the live copy to rev by fast-forward only. Never merges, resets,
// stashes or discards: a hand edit in the way, an ignored file at a path rev
// adds (git's default would overwrite it), or commits here that are not in
// rev, make it refuse and change nothing, and the caller says so.
function fastForward(root, rev) {
  if (head(root) === rev) return { ok: true };
  const m = git(root, ["merge", "--ff-only", "--no-overwrite-ignore", "--no-autostash", "-q", rev]);
  if (m.ok) return { ok: true };
  const edits = dirty(root);
  const inWay = m.err.split("\n").filter((l) => l.startsWith("\t")).map((l) => "  " + l.trim()).join("\n");
  const ahead = git(root, ["rev-list", "--count", rev + "..HEAD"]).out;
  return {
    ok: false,
    why: edits
      ? "hand edits in this machine's copy of the store are in the way:\n" + edits
      : inWay
        ? "files in this machine's copy of the store that git does not track are in the way, and forge does not overwrite them:\n" + inWay
        : ahead !== "0"
          ? "this machine's copy of the store has saved changes that are not on the remote (" + ahead + " commit(s))"
          : "git refused the update:\n" + m.err,
  };
}

// An interrupted fast-forward of this copy (killed inside git) leaves the
// index lock behind, or some incoming files written while HEAD is still
// behind the remote. Tell that apart from hand edits: every changed path is
// one the remote's head changes. Reads only; changes nothing.
function halfUpdated(root) {
  if (fs.existsSync(path.join(root, ".git", "index.lock"))) return true;
  const u = git(root, ["rev-parse", "-q", "--verify", "@{u}"]);
  if (!u.ok || u.out === head(root) || !contains(root, "HEAD", u.out)) return false;
  const incoming = new Set(must(root, ["diff", "--name-only", "HEAD", u.out], "listing the remote's changes").split("\n"));
  const edits = dirty(root).split("\n").filter(Boolean).map((l) => l.slice(3));
  return edits.length > 0 && edits.every((p) => incoming.has(p));
}

// How many commits this copy has that its remote (as last fetched) lacks: 0
// with no remote or no upstream branch (base() says what is wrong then).
function aheadOfRemote(root) {
  if (!hasRemote(root)) return 0;
  const u = git(root, ["rev-parse", "-q", "--verify", "@{u}"]);
  if (!u.ok) return 0;
  return Number(must(root, ["rev-list", "--count", u.out + "..HEAD"], "counting the commits the remote lacks"));
}

// The remote's head as this copy last fetched it (no network), else HEAD.
function knownRemoteHead(root) {
  const u = git(root, ["rev-parse", "-q", "--verify", "@{u}"]);
  return u.ok ? u.out : head(root);
}

// The git tree of public/ at a commit: what the link site should serve.
function publicTree(root, rev) {
  return must(root, ["rev-parse", rev + ":public"], "reading the store's public/ tree");
}

// Path-limited: stage the paths (additions, changes, deletions), then commit
// only those paths, message first. Runs in a temporary worktree.
function commit(root, paths, message, pause = () => {}) {
  must(root, ["add", "-A", "--", ...paths], "staging");
  pause("staged");
  must(root, ["commit", "-q", "-m", message, "--", ...paths], "committing");
  return head(root);
}

function changedInCommit(root, rev, paths) {
  return must(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", rev, "--", ...paths], "listing the commit's files") !== "";
}

module.exports = {
  git, must, dirty, hasRemote, head, RemoteError, STOP, commit, changedInCommit,
  base, addWorktree, removeWorktree, leftoverWorktrees, pushRev, fastForward, publicTree, WT_MARK,
  contains, halfUpdated, knownRemoteHead, strayFolders, setAside, aheadOfRemote,
};
