// The store lock: an operating-system lock (flock, through perl, which Forge
// requires on every machine), held by the write command itself.
//
// How it is held: bin/forge re-launches itself through a small perl program.
// Perl opens <store>/.git/forge.lock, waits for flock(LOCK_EX), clears the
// descriptor's close-on-exec flag, and then REPLACES itself with the real
// command (exec, same process). So the process that holds the lock is the
// process that writes: if it dies, by any signal, the lock goes with it, and
// no writer can ever run on after its lock is gone.
//
// What it costs: a program the command starts (git, the deploy) inherits the
// descriptor too, so one left running after the command ends keeps the store
// locked until it exits. A command that has to wait names each process that
// has the lock file open, by pid and program name (never its command line,
// which may carry a typed value), so such a leftover shows as a pid and a program name.
//
// Inside, the command proves it holds the lock (the descriptor it was handed
// is the lock file, and a second, non-blocking flock attempt from outside
// fails) before it touches anything.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HOLDER = String.raw`
use strict; use Fcntl qw(:flock F_GETFD F_SETFD FD_CLOEXEC); use Cwd qw(abs_path);
my $file = shift @ARGV;
open(my $fh, ">>", $file) or die "forge: cannot open the store lock $file: $!\n";
my $real = abs_path($file);
# Every other process with the lock file open: the holder, and any command
# waiting like this one. /proc on Linux, lsof on macOS.
sub holders {
  my @p;
  if (-d "/proc/self/fd") {
    for my $d (glob "/proc/[0-9]*/fd/*") { my $l = readlink $d; push @p, (split m{/}, $d)[2] if defined $l && $l eq $real }
  } elsif (open(my $l, "-|", "lsof", "-t", "--", $file)) { chomp(@p = <$l>); close $l }
  my %seen; @p = grep { $_ != $$ && !$seen{$_}++ } @p;
  return "" unless @p;
  # The program only (the first word of its arguments, folder stripped), never
  # the command line, which may carry a value typed by the person.
  my @who = map { my ($w) = split " ", (qx(ps -o args= -p $_ 2>/dev/null) // ""); $w = defined $w ? $w =~ s{.*/}{}r : "ended"; "pid $_: $w" } @p;
  return "\nprocesses with the store lock file open: " . join("; ", @who);
}
my $wait = defined $ENV{FORGE_LOCK_WAIT} ? $ENV{FORGE_LOCK_WAIT} : 120;
my $t0 = time; my $said = 0;
until (flock($fh, LOCK_EX | LOCK_NB)) {
  if (time - $t0 >= $wait) { print STDERR "forge: refused: another forge command has held the store lock for $wait seconds; nothing was changed; run the same command again" . holders() . "\n"; exit 75 }
  print STDERR "forge: waiting for another forge command on this store to finish" . holders() . "\n" unless $said++;
  select(undef, undef, undef, 0.1);
}
my $flags = fcntl($fh, F_GETFD, 0) or die "forge: cannot read the store lock's flags: $!\n";
fcntl($fh, F_SETFD, $flags & ~FD_CLOEXEC) or die "forge: cannot hand the store lock to the command: $!\n";
$ENV{FORGE_LOCK_HELD} = $file;
$ENV{FORGE_LOCK_FD} = fileno($fh);
exec { $ARGV[0] } @ARGV or die "forge: could not start the command: $!\n";
`;

// Exit 0 when SOMEONE holds the lock (our non-blocking attempt fails).
const PROBE = String.raw`
use Fcntl qw(:flock);
open(my $fh, ">>", $ARGV[0]) or exit 2;
exit(flock($fh, LOCK_EX | LOCK_NB) ? 1 : 0);
`;

function lockFile(root) {
  return path.join(root, ".git", "forge.lock");
}

// Run argv (node + script + args) under the lock; returns the exit status.
function runLocked(root, argv) {
  const r = spawnSync("perl", ["-e", HOLDER, lockFile(root), ...argv], { stdio: "inherit" });
  if (r.error) throw new Error("could not start perl to take the store lock: " + r.error.message);
  if (r.status != null) return r.status;
  return 128 + (os.constants.signals[r.signal] || 0);
}

function isHeld(root) {
  const r = spawnSync("perl", ["-e", PROBE, lockFile(root)], { stdio: "ignore" });
  return r.status === 0;
}

// True when this process was handed the lock for THIS store (its descriptor is
// that lock file) and the lock is held right now.
function weHoldIt(root) {
  const fd = Number(process.env.FORGE_LOCK_FD);
  if (process.env.FORGE_LOCK_HELD !== lockFile(root) || !Number.isInteger(fd) || fd < 3) return false;
  try {
    const a = fs.fstatSync(fd);
    const b = fs.statSync(lockFile(root));
    if (a.ino !== b.ino || a.dev !== b.dev) return false;
  } catch {
    return false;
  }
  return isHeld(root);
}

module.exports = { runLocked, isHeld, weHoldIt, lockFile };
