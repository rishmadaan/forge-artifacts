# Forge reference

Everything the README leaves out: each command in full, exit codes, the safety
rules every writing command follows, deploys and the live marker, what a tool
built on forge can rely on, the access model, and the tests. The README is the
short version; `SETUP.md` is the setup guide.

## Commands

| Command | What it does |
|---|---|
| `forge publish <file.html \| folder> [--name <name>] [--live]` | Publish or update a page. A new page is private. An update keeps the page's visibility. A new version of a **shared** page is refused unless the command carries `--live`, however the name was chosen (derived, `--name`, a `-vN` sibling, the same file with new content): with `--live` it goes to the link site at once. The refusal names the page, its public link, and the two ways on (`--live`, or a new `--name` to keep it private); it writes nothing. Ask the owner first: "<name> is public at <link>; update the public page now?" Skip the question only if the owner's own request already named that public page or its link (for example "update the public <name>", or the link pasted): then the request is the yes. Never infer it from "update" alone. Naming the page without calling it the public or sent one (for example "update the plan") is not a yes: ask. On yes, add --live. On no, or if you cannot ask, keep it private with --name '<new-name>' and say a new private page was made. If the shared page was made from a different file (for example `--name` onto it from another file that is not a `-vN` sibling), the refusal asks the replace question described below instead, since naming the page is not a yes to replacing it with a different file. Unchanged content (the same source bytes as the last version: the file, or every file of a folder) is a no-op, even after an engine update changes what forge stamps into pages. `--name` onto an existing private page fed by a different file is allowed, and the output says on its own line which source the page followed before and which it follows now. With no `--name`, a source that already feeds one link republishes there; one that feeds several is refused until you pick with `--name`. Otherwise the name comes from the filename (`.html` and any `-vN` dropped); if that name already belongs to a page fed by a different file, it is refused (the message names both files: usually this is a new page, published with `--name '<new-name>'`, and the owner is told a new private page was made, not an update of that page; only if the owner wants this file to replace that page, the owner is asked first, even if the request named that page, since that is not a yes to replacing it with a different file, and the message prints the command that does it) unless the two are `-vN` siblings in the same folder (`plan.html`, `plan-v2.html`). |
| `forge share <name> [note]` | Put a private page on the link site and record the share (date, note, which version was latest). On a page already shared, it only records the share. Either way it makes sure the link site shows the page. |
| `forge unshare <name>` | Take the whole page off the link site: it moves back to private and its public link returns not found. On a page that is already private it changes nothing and makes sure the link site does not serve it (`plan was already private; the link site is confirmed not to serve it`), so a take-down that was interrupted after it was saved is finished by running it again. |
| `forge unshare <name> --version N` | Take one old version off the link site and off its public history page. The latest version is refused (the stable link shows it): publish a new version first, or unshare the whole page. A version already taken down changes nothing and the link site is checked, as above. On a page that is not shared yet (the store needs a host set), it marks the version instead (`v1 will stay off the link site when report is shared`), so a later `forge share` keeps that version in `private/` and off the public history page; the latest version is refused there too. |
| `forge rename <old> <new>` | Change a page's name (the word `forge share`, `unshare` and `publish --name` take) and nothing else: its slug, so every private and public link, its versions, visibility, shares, take-downs and sources stay exactly as they are, and it keeps its place in `forge list`. The generated pages are rebuilt: a page with no `<title>` shows its name on its history page, and the master index carries shared pages' names for its search, so renaming a shared page updates the link site (no `--live`: no new version of the page is published); when no generated file names the page, only `manifest.json` changes and nothing is deployed. Refused, changing nothing (exit 1): `<old>` is not a page; `<new>` is empty; `<new>` is already a page; `<old>` and `<new>` are the same. The stamped Markdown export inside the page's existing versions keeps the old name as its download file name (frozen versions are never rewritten); the next publish stamps the new one. |
| `forge list [--json] [--live]` | Every page: name, title, visibility, latest version and date, private link, public link when shared, source. The master index address, then a `link site:` line. Without `--live` it reads nothing over the network: the link-site line reports this machine's last live read, with its time. `--live` reads the link site now (short timeout; "not known" when unreachable). |
| `forge check [--sources]` | Verify this machine's copy of the store; one line per problem and exit 1, or `forge check OK`. Before `OK` it reads the link site now and adds a `note:` when it is behind or cannot be read. `--sources` also lists sources that are not on this machine, as information. |
| `forge regenerate` | Rebuild only the generated pages (history pages, master index), for example after a template change. |
| `forge deploy` | Make the link site show the store's remote head (this copy's head when there is no remote): check that commit, upload its `public/` with the marker, and read the marker back. Uploads nothing when the link site already shows it. Never reads this machine's working folder. The way to finish after `NOT FINISHED`. |
| `forge sync` | Fast-forward this machine's copy of the store from its remote, refusing hand edits in it, saved changes the remote lacks, or a file git does not track at a path the update would write (it names the paths and changes nothing), then run the check. Other tools call this before reading the store. |
| `forge recover [--set-aside]` | After an interrupted command. For each temporary copy of the store (a git worktree in the OS temp folder) an interrupted command left, it says what that command was (its commit and the commit's subject, for example `unshare: plan (whole document)`) and whether its change was saved (its commit is on the store's remote: `the change was saved (commit X: <subject>); run forge deploy to finish`) or not (`nothing was committed in it, so nothing was saved; run the interrupted command again`), then removes it. It also removes this store's temporary folders that a failed cleanup left behind. When the remote cannot be read, it keeps that copy and exits 4: run `forge recover` again when online. forge's changes only ever happen in those temporary copies, so there is nothing to put back. A copy of the store left half-updated by an interrupted fast-forward, and hand edits, are reported and never touched (exit 1). With `--set-aside`, only when the owner asks, it keeps them instead and clears the copy (see "Setting changes aside" below). Runs even when the store no longer loads. |
| `forge import <old-site-dir> <old-manifest.json> --source-root <dir>` | Fill an empty store from a site already published in this layout: a folder holding the published `public/` files (pages at `d/<slug>/`, frozen versions at `d/<slug>/vN/`) and the manifest that lists them, whose page sources are paths relative to one folder (`--source-root`). Every page comes in as shared, with its links unchanged; `public/` comes out byte-identical to the old folder. A one-time move, for example from another copy of Forge; it refuses a store that already has pages. An imported page has no recorded source hashes, so it gets one new version the next time it is republished, even unchanged; after that an unchanged republish is a no-op. |
| `forge host <kind> --project <p> [--account <id>] --url <https://...> [--token-name <NAME>] [--replace]` | Set the link site's host (`cloudflare-pages`, `vercel` or `netlify`), so pages can be shared. It deploys the link site and reads it back (exit 3 when not proven); a host already set needs `--replace` (see [forge host](#forge-host) below for its rules). |
| `forge init [<path>]` | Create a new store from the template, at `~/.forge` by default; it works at once for private pages (no host, neutral look). Checks git's name and email first; builds the store in a temporary folder beside the target and renames it onto the target, so a failure leaves no half-made store; a failure removes that temporary folder and nothing else (an empty parent folder it made may stay; a killed init can leave its `.<name>.forge-init-*` folder, which holds nothing else); a target that something else filled meanwhile is refused, naming it, and left as it is; branch `main`. A path that is not the default is recorded in your setting file (unless `FORGE_WORKSPACE` is set, which comes first); when that write fails after the store was made, exit 3 says the store exists and how to use it (`forge store <path>`). Refuses a folder that exists and is not empty. |
| `forge store [<path>]` | Print the store in use and where that came from (`FORGE_WORKSPACE`, the setting file, or the default). With a path: use that store from now on (recorded in your setting file); the folder must hold a store. |
| `forge open <name>` | Print a page's private link and open it in the default browser (`open` on macOS, `xdg-open` elsewhere), waiting up to 5 seconds for that opener's answer. Exit 1 when the opener cannot be started or reports a failure; the link is printed to open by hand. Exit 0 when it reports success, or is still running after 5 seconds (some openers wait for the browser to close): then stderr says it is not known whether a browser opened. |
| `forge update [--check]` | Update this copy of Forge to the latest release, when it is a git checkout (the folder `bin/forge` lives in). Needs no store: it never loads, locks or changes one; when it finds one, it only looks whether another forge command holds that store's lock. It fetches the tags of the remote it was cloned from (`git remote origin`) and takes the highest `vX.Y.Z` whose `bin/forge` at that tag says that version (a tag that says another is not a release: it is skipped, and `--check` names it on its own line); when none is newer than this copy, it says `Forge <version> is the latest release`. `--check` says `Forge <new> is available (you have <old>); update with: forge update` and lists the newer CHANGELOG headings, changing nothing. Without it, forge fast-forwards the checkout to the release tag, asks the updated `forge --version` for its version, and only when it prints the new one says `updated Forge <old> -> <new>` and the newer CHANGELOG sections (otherwise it says what it found and the `git reset --keep` line that goes back, exit 1), then what `bin/install --check` says (the command and the skill are links into this folder, so they update with it). Refused, changing nothing (exit 1): this copy is not its own git checkout (clone it again, or download a release); the remote it was cloned from (`git remote origin`) cannot be reached (the message ends with git's own first line, after `git said: `); a tracked file has an uncommitted change; this checkout has commits the release lacks; another forge command holds the store lock (run `forge update` again when it finishes). A command started in the second the files change may still load a mix of the two versions, so run `forge update` when no forge command is running. Exit codes: 0 up to date, checked or updated; 1 refused, the remote not reachable, or the updated copy not answering with its new version (above). |
| `forge --version` | Print `Forge <version>`; how `bin/install` tells this tool from another program named `forge`. Not how an agent learns the command's name (see "The command's name" below). |

A folder page needs `index.html` at its top. Its regular files are copied
recursively; dot-files and dot-folders are skipped. Refused: a symlink anywhere
inside, a file over 25 MiB (the host's per-file limit), more than 1,000 files,
and a top-level entry named `versions` or `v<number>` (they would collide with
the store's version folders). Only `index.html` gets the dark-mode switch and
the Copy as Markdown / Download .md buttons.

Output: stdout carries a command's results; progress, warnings about the
store and problems go to stderr. Every write command ends by building one
record of three facts, each yes, no or unknown, and each read from durable
state, never guessed from which step failed: **saved** (is the change, or the
state it asked for, on the store's remote), **site** (do the live marker and
the remote's `public/` agree, both read in the same pass), **local** (did this
machine's copy catch up). The exit code and the words come from that record.
Result lines are built last, from the manifest at the final commit, so
when another machine changed the same page meanwhile they say so in plain
words (for example `shared plan, but another machine has since taken it down:
plan is private now, so there is no public link`). Output of `publish`, in
order: the result line (`published <name> vN (private)`, `(shared)`, or
`unchanged ...`), `private: <link>`, `public: <link>` when shared and the link
site was confirmed to show it, and for a private page `share it with: forge share
<name>` (on a store with no host yet: `to share it: set a host first with forge
host (SETUP.md step 5), then run forge share <name>`). A name taken from the
file name is fitted to the name rule (`My Plan.html` becomes `my-plan`) and a
`note:` line says so. Warnings may follow: a diagram without a text description, or a single
file that points at files beside it (publish the folder instead); they are
worked out before anything is saved, from the bytes forge read. `share` prints
the result line, `private:`, and `public:` once confirmed. `rename` prints
`renamed <old> to <new>`, `private: <link>`, `public: <link>` for a shared page
once the link site is confirmed, and a note that notes or scripts
that name `<old>` must be updated by hand.

When the change is saved but the link site is not confirmed (exit 3), the
result lines are still printed on stdout, with the `private:` line and without
`public:`, and stderr ends with a block that names the action that did not
finish:

```
NOT FINISHED: updating the link site
  done: unshare: plan (whole document) (saved and pushed, commit 1a2b3c4d5e6f)
  saved; its private link works: http://127.0.0.1:8080/forge/d/<slug>/
  separately, the link site is not confirmed: uploaded, not confirmed live; run: forge deploy
  the public link https://pages.example.org/d/<slug>/ STILL WORKS until forge deploy succeeds
finish with: forge deploy
```

`forge host` ends its block instead with the fixes it names (see
[forge host](#forge-host) below), since a deploy cannot fix a wrong project or address.

If a step after saving failed, the block starts `NOT FINISHED: a step after
saving failed` and names it (`a later step failed: ...`); the change is still
saved and the exit is still 3. So exit 3 means either that the link site is
not confirmed or that a later step failed. A `public:` line means the link
site was confirmed to show the page, whatever the exit code. When this
machine's copy of the store could not catch up, the block says
`saved; not in this machine's copy of the store until it catches up: <link>`
instead of `its private link works` (a private link is served from this
machine's copy). The same line is printed when the result lines describe a
commit this copy does not hold yet: after a failed deploy they are built at
the remote head it last read, and this copy catches up (fast-forward only)
only onto a commit the link site confirmed.

### forge host

The host's default name (`FORGE_CLOUDFLARE_TOKEN`, `FORGE_VERCEL_TOKEN`,
`FORGE_NETLIFY_TOKEN`) is resolved the way a deploy reads it (the environment,
then `secretCommand`). A name typed with `--token-name` that is not the
default is looked up in the environment only, never handed to `secretCommand`:
a value typed on the command line never goes on another program's argument
list, where a token pasted as the name would land. The argument checks and
the environment check of a typed name need no store and run before the store
is loaded and before the store lock is taken (the lock's perl program is
started with the whole argument list); the default name's lookup runs after
the store is loaded, inside the lock, and hands `secretCommand` only that
fixed name. And
`--token-name` given to any other command is refused, so a refused value
reaches no other program. A name that resolves to no secret is refused, saving
nothing, and the refusal never repeats what was typed (a token pasted as the
name is not printed or saved); for a typed name it gives the two ways on
(store the token under the default name and leave `--token-name` out, or put
it in the environment for that one run: `NAME="$(<your secret command> NAME)"
forge host ... --token-name NAME`). Every refusal of a typed `--token-name`
value (this one, the name-pattern refusal, `--token-name` given more than
once, `--token-name` given to another command, and the usage and unknown-kind
refusals of `forge host` when any argument starts with `--token-name`)
carries the same sentence: if what was typed as `--token-name` was the token
itself, it is now in the shell history (and in any chat
or log it was typed into), so revoke it and create a new one.

Once saved, the name is `tokenSecret` in `config.json`, and later deploys hand
that name to `secretCommand`. Then `host` and `baseUrl` are written into
`config.json` in one commit, and the link site is deployed and read back,
which proves the project, the token, the address and the no-store rule.

Confirmed, it prints `host set: ...` and `try: forge share <name>` (in a dry
run `host set (dry run: not proven): ...` and the same `try:` line). Not
confirmed, the host stays saved and it exits 3: the first line is `host saved,
not proven: ...`, there is no `try:` line, and the last line names both fixes:
`finish with: a wrong project or address: run the same forge host line with
the right values and --replace; a token problem: fix the token, then forge
deploy; the site not answering yet, or a network failure: forge deploy again
in a minute`.

When another machine has since set the host, it names the host in the commit
it reports (or, when that host's deploy failed, the remote head it last read),
with a note; not confirmed, its last line is then `finish with: the store now
uses <that host>, which another machine set: a token problem: make the token
named <its name> readable here, then forge deploy; the site not answering yet,
or a network failure: forge deploy again in a minute; a wrong project or
address there: ask the owner, since replacing it would undo that machine's
change`; that last line offers no `--replace`.

A store that already has a host (checked inside the write, so a host another
machine set counts) is refused unless `--replace`. When the address changes
(in the refusal, the typed `--url` differs from the address in use), it says:
every public link moves to the new address; frozen versions keep the old
address in their Markdown export; the old address keeps serving what was
deployed to it.

When the project changes (the kind, project or account, compared with the host
the result reports, or in the refusal with the values typed; a new address for
the same project is not a project change, since forge still deploys to it),
the refusal (`Once replaced, about the host in use now, <host>: ...`, since
nothing has changed yet) and the result (`note: the old host was <host>: ...`)
name that host, project and address and say: if forge deployed pages to that
project, every page shared until then stays public there, out of unshare's
reach (forge keeps no record of a former host); delete it there when nothing
should stay public. If that project is used for something else, forge's upload
replaced what it served there: redeploy it from its own source. The
links-moved note prints only when the address changed, compared with the
address in the commit the result reports.

Also refused, changing nothing: an unknown kind, a missing or extra value, a
`--url` with a trailing slash, a token name that is not a plain name; those
refusals print the usage and the path of `SETUP.md` with the step and the
host's section.

## The installer

`bin/install` links the engine into the home folder: the command into
`~/.local/bin` (`forge`, or `forgee`; see below) and the `publish` skill into
`~/.agents/skills/publish` and `~/.claude/skills/publish`. It never replaces
what it did not make there: a taken command path refuses the whole install,
changing nothing; a taken skill path is skipped with a note.

| Flag | What it does |
|---|---|
| (none) | Make the links, keeping every choice recorded earlier. |
| `--command forge\|forgee` | Choose the command's name; recorded. |
| `--no-skill` | Link the command only, for an agent that gets the skill from a plugin store (a Claude Code plugin, a Gemini CLI extension, `npx skills add`). Removes the skill links this checkout's installer made, only when it can prove them (its own link text, resolving to this checkout's `skills/publish`); anything else there is left alone and named. Recorded (`"skill": false`), so later runs keep it. |
| `--skill` | Link the skill again; recorded. |
| `--check` | Report, changing nothing: `ok:` or `MISSING:` for the command, `linked:`, `skipped:` (another tool's `publish` skill is there) or `not linked, by choice:` (`--no-skill`; it cannot tell a store's copy of Forge's skill from another tool's) for each skill link, then `command: <name>`. Exit 1 when something is missing. |
| `--uninstall` | Remove only the links this installer made; leave anything else. |

The choices are kept in the forge setting file (`$XDG_CONFIG_HOME/forge/settings.json`,
else `~/.config/forge/settings.json`). `forge update` runs `bin/install --check`
only, so it reports the links and changes none.

## The command's name

The command is `forge`, or `forgee` on a machine where another program already
owns the name `forge` (`bin/install` chooses, says which, and records it). An
agent takes the name, in this order, from:

1. the owner's instructions (the paragraph `SETUP.md` step 6 has them paste
   names it);
2. else the `command` key of the forge setting file
   (`$XDG_CONFIG_HOME/forge/settings.json`, else
   `~/.config/forge/settings.json`), which `bin/install` writes when the name
   is `forgee` or was chosen with `--command`;
3. else `bin/install --check` in the Forge repository: its line
   `command: <name>`.

Never find out by running `forge`: on a machine where another program owns
that name, that starts the other program. Every command forge prints for you
to run uses the name it was started as, so a printed line can be run as
printed. This section owns the rule; the README, `SETUP.md` and the skill
point here.

## Exit codes

These are the codes of the commands that write the store, and of `forge check`. `forge update`
changes Forge itself and has its own codes, in its row of the command table.

| Code | Meaning |
|---|---|
| 0 | Finished: saved, and the link site confirmed to show it (for a command that changed nothing public: the link site read and level). On a store with no host, exit 0 reads no link site: there is none, so saved is all it says. The result lines are on stdout. |
| 1 | Refused or failed before anything was saved, and nothing was changed (a refusal about the store, a bad argument, a change that fails the check, an unreachable remote, a push the remote refused, read back from the remote as not taken). Never once the remote has the change, or may have it: then a failure is 3 or 4. For `forge check`: problems found. For `forge recover`: hand edits or a half-updated copy are present (listed, untouched). |
| 3 | NOT FINISHED: the change is saved (and pushed when the store has a remote), but the link site is not confirmed to show it, or a step after saving failed. The result lines are still on stdout (`private:` always, `public:` only once confirmed). stderr names the step that finishes it after `finish with:` (usually `forge deploy`; the next write command also finishes a pending deploy). Also exit 3: a take-down after which another machine shared the page again (`<name> is public: another machine has since shared it; if the owner still wants it down, run: forge unshare <name>`): tell the owner first. |
| 4 | NOT KNOWN whether the change was saved: the push got no answer and the store's remote could not be read afterwards. When online, run forge sync, then forge list: if the change is there, run forge deploy to finish; if it is not, run the same command again. From `forge recover`: whether an interrupted change was saved is not known yet; run it again when online. |
| 75 | Another forge command held the store lock too long; nothing was changed; run the same command again. From `forge sync`: the store was busy; its pages can still be read, possibly slightly behind. |

## Safety rules every writing command follows

1. Take the store lock: an operating-system `flock`, taken by a small perl
   program that then becomes the command itself (`exec`), so the process
   writing is the process holding the lock, and the lock ends when it does. A
   second command waits up to `FORGE_LOCK_WAIT` seconds (default 120), then is
   refused (exit 75); while it waits it names each process that has the lock
   file open, by pid and program name (`pid <n>: <program>`), never its
   command line. A program the command starts (git, the deploy) inherits the
   lock, so one left running keeps the store locked until it exits; the
   waiting message names it.
2. Refuse when this machine's copy of the store has uncommitted changes, and
   list them. forge only ever changes its copy by fast-forward, so these are
   hand edits: forge never discards them; tell the owner. When `config.json`
   is the only one, the refusal leads with the line that commits it (and
   pushes it, when the store has a remote), for a deliberate change; when
   other files changed too, that line follows the "do not run git" sentence
   as its one exception. Every printed command with a path quotes the path
   when it needs it (a space, say), so the line works as printed. Refuse too when
   this copy has commits its remote lacks (a `config.json` change committed
   by hand and not pushed): forge only brings this copy level with the
   remote, so every write would end stuck behind them. The refusal names the
   one step that clears it, `git -C <store> push` (when git refuses the push
   because the remote moved on too: `git -C <store> pull --rebase`, then the
   push); then run the same command again. `forge sync` refuses the same way.
   A commit made here while a write runs is never lost either: the write is
   saved, and this copy keeps its commit and says it could not catch up.
3. Fetch the remote (an unreachable remote: nothing changed; try again when
   online) and make a temporary git worktree, in the OS temp folder, at the
   remote's head (this copy's head when there is no remote).
4. Make the change there, run the full `forge check` there, and commit only the
   store's own paths (`manifest.json`, `public`, `private`) there. A failure at
   any point changes nothing anywhere.
5. Push that commit to the remote branch: **the push is the commit point**, and
   the line between exit 1 and exit 3. When the push does not say yes, forge
   reads the remote before deciding: if the remote has the commit (the push
   landed and only its answer was lost), it is saved; if the remote cannot be
   read, whether it was saved is not known (exit 4). A push refused because the
   remote moved: throw the worktree away and make the change again from the new
   head, at most 3 times. If the page's visibility changed between tries
   (another machine shared it or took it down meanwhile), stop instead,
   changing nothing. forge never leaves a local commit that is not on the remote.
   With no remote, the fast-forward in step 6 is the commit point, and a failed
   one is a refusal.
6. Fast-forward this machine's copy to the pushed commit, with `--ff-only
   --no-overwrite-ignore --no-autostash`: it never overwrites a file, ignored
   or not. If something here is in the way (a hand edit, a file git does not
   track at a path the update writes, or commits this copy has that the remote
   lacks), it names the paths and says so: published and pushed, nothing lost.
7. Remove the temporary worktree, always, success or failure.
8. Make the link site show the remote's current `public/` (see below),
   uploading only when it does not already, so a repeated or unchanged command
   finishes work a failed deploy left pending.
9. Print the result from the outcome record (above).

If a command is killed partway (a timeout, a closed terminal), this machine's
copy is untouched; a temporary worktree may be left in the OS temp folder.
`forge recover` says whether the change was saved, removes the worktree, and
names the next step (`forge deploy`, or the same command again). Follow it:
run the same command again only when `forge recover` says the change was not saved.
After a saved change another machine may have published since, and repeating a
publish of the older file would save it over theirs. No message asks anyone to
edit the store or run git in it.

**A limit:** a command killed inside git's own fast-forward of this machine's
copy (step 6, a window of milliseconds) can leave that copy half-updated: some
new files written, git's index lock left behind. The change itself is safe on
the remote. forge does not repair this by guessing: `forge recover` and every
write detect it (the lock file, or changed files that are all files the
remote's head changes while this copy is behind it), say so, and touch
nothing. Tell the owner; when the owner asks to clear it, `forge recover --set-aside`
(below), then `forge sync`.

**Other named limits:**
- The note `another machine has since published vN; the stable link shows
  vN` is information: this command's own version was still saved.
- If forge cannot remove its temporary folder after a command (a permissions
  problem in the OS temp folder), the result stands and stderr names the
  folder: `left a temporary folder <path> (...); forge recover removes it`.
- The set-aside record (`forge recover --set-aside`) lives in this machine's
  `.git`, not outside the store and not on the remote.
- A repeated `share` of a page that is already shared adds a second share
  record.
- After exit 4, `forge list` shows a page's state, not which machine changed
  it: if another machine changed the same page in the meantime, a change
  that was not saved can look saved. The exit 4 message names the change it
  tried (for example `publish: plan v2`).
- Names are not locked across machines. After one machine renames a page,
  another machine still using the old name (an older note, a script) gets the
  normal refusal `unknown document: <old> (forge list shows every name)`, exit
  1, nothing changed; `forge list` there shows the new name once it catches
  up. If another machine renames a page in the instant between this command's
  save and its result lines, the change stays saved and the result lines find
  the page by its slug: they use its new name and add `note: another machine
  has since renamed <old> to <new>`.
- A repeated `import` after an exit 4 refuses if the first was saved (the
  store is no longer empty); then `forge deploy` finishes the link site.

## Setting changes aside (only when the owner asks)

forge refuses to write while this machine's copy of the store has changes no
forge command made (hand edits), or is half-updated, and never discards them.
When the owner asks to clear them, run `forge recover --set-aside`. Under the
store lock it keeps everything uncommitted in one git stash commit (the
working version of each file, the staged version, untracked files and
deletions) and pins it under a named ref, `refs/forge/hand-edits/<time>`, which
it prints; then the copy is clean. If git's index lock was left behind by a
git that was stopped (no process has it open), it is moved first to
`.git/forge-hand-edits/<time>/index.lock`, beside the record, and the output
says so. While a process has it open (named by pid and program, never its command line), or when forge cannot check (lsof
missing or failing, the process list unreadable, a git process whose open
files it may not read), nothing is set aside and the lock stays. Named limit:
without root, forge cannot read which files another user's processes, or
protected ones such as sshd and ssh-agent, have open. On Linux, among those
it refuses only for a process named `git`, so another program holding the
lock as another user is not seen; that refusal says it is usually a
short-lived git run and to run `forge recover --set-aside` again in a minute.
On macOS forge asks lsof instead, run without root, and takes what lsof
lists as the whole answer: other users' processes that lsof does not show
never block set-aside there. Then run `forge sync`. Nothing is discarded: a
developer brings the changes back with `git stash apply --index
refs/forge/hand-edits/<time>`. If the stash is made but naming it fails, the
command exits 3 and prints the stash entry's commit: the hand edits are kept
in git's stash list under it (not pinned to a name), and nothing was lost.
git's routine cleanup can drop stash entries after about 90 days
(`gc.reflogExpire`, `git help gc`), so a developer should pin or apply it
before then.
This is a deliberate stash the owner asked for, pinned to a named ref, not a
silent one.

## Deploys and the live marker

A deploy uploads an export of a pushed commit's `public/` (a temporary
worktree of that commit), never the working folder, plus one extra file,
`/_forge/revision.json`: `{ "commit", "tree", "site", "time" }`, where `tree` is the git
tree hash of `public/` at that commit and `site` a hash of the host setting it
was uploaded for (kind, project, account id, address; a hash, because the
marker is public). `site` is an addition: a reader of the marker that ignores
it is unaffected. What the link site shows is the pair (tree, site): a host
change moves the site and leaves the tree alone, so every comparison forge
makes (before an upload, at the read-back, the cached read) takes both, and a
marker or cached read without `site` (an older forge wrote it) never matches.
After an upgrade the first write uploads once for that reason; until then
`forge list` reads `not known`. The host's adapter also writes the
host's header file into the export (a `/_forge/*` rule with `Cache-Control:
no-store`). Neither is written into the store. The host and the address come from
`config.json` at that same commit, read again on every round, never from this
machine's copy: `config.json` is shared state like the manifest, and another
machine may have set or changed the host meanwhile. For the same reason result
lines take the address from the commit they report, `share` and `unshare`
check for a host inside the write (on the remote's head), `deploy` checks the
commit it would deploy, and `forge host` checks for a host already set inside
the write on every attempt. After the upload, forge reads `<baseUrl>/_forge/revision.json` back, past
caches, retrying for up to 60 seconds (`FORGE_READBACK_SECONDS`). Success only
when the live marker is served with a `Cache-Control` that includes `no-store`
(a marker with no such header may be a cached copy, so it counts as not read)
and its pair equals the remote's current pair (its `public/` tree and the host
setting in its `config.json`). If the remote moved during the deploy, a host
change included, it deploys the newer state (at most 3 times). A marker from
another host setting means the address does not show this project:
`the address answers with a site uploaded for another host setting: wrong
address, or it does not point at project <p> yet`. From `forge list --live`
and `forge check`, which read this copy's setting, the observation comes first
and the two branches after it: `the address answers with a site uploaded for
another host setting. If another machine changed the host, this copy may be
behind: run forge sync, then check again. Otherwise: wrong address, or it does
not point at project <p> yet`, since a `--replace` from a stale copy would undo
the other machine's change. `forge host` always
uploads, even to a site already level, so the project and token it sets are
used, not assumed.
If the read-back never matches or fails, or the store's remote cannot be read
to compare with: exit 3, `uploaded, not confirmed live; run: forge deploy`. A
command that changed nothing under `public/` (a private publish, for example)
reads the marker and uploads only when the site lacks it (HTTP 404) or shows
another state; when the marker cannot be read at all (the site unreachable, an
error status), it uploads nothing and reports the link site as not confirmed
(exit 3, with the private link). What this cannot give: strict ordering of two
machines' uploads (the host serves whichever finished last); the read-back is
what makes that visible instead of silent.

## Is the link site current?

`forge list` ends with a `link site:` line and `--json` carries `linkSite`. They
report this machine's last live read of the marker, labelled as such, with
its time (UTC) and the commit it showed (`forge list --live` and `forge check` read it
fresh). States: `current` (the read showed this copy's `public/` and host
setting), `behind` (a read made against this same store state showed an older
state of the same site; run `forge deploy`), `unknown` (no read on this
machine, a read made against another store state or host setting, a marker
from another host setting or from an older forge, a dry run, or the site
could not be read), and `none` (no host
is set: a private-only store has no link site). Nothing says the site is
behind unless a live read showed it.

Once a host is set, `forge list` also prints `master index: <link>`: a page
forge generates on the link site that lists every shared page (never a
private one). It is public like the pages it lists, at an unguessable link of
its own; `forge regenerate` rebuilds it.

`FORGE_DEPLOY=0` is a testing switch (the tests set it; README and SETUP do
not use it): it turns every deploy into a dry run: it says what it would upload
and reads nothing from the link site. A command's result then has no `public:`
line and never says a link now returns not found; it ends with `dry run
(FORGE_DEPLOY=0): nothing was uploaded and the link site was not read`;
`forge check` on a store with a host says `dry run (FORGE_DEPLOY=0): the link
site was not read`, and `forge host` says `host set (dry run: not proven)`.

## `forge list --json`

The interface other tools (a dashboard) read. Fast and local: it touches the
network only with `--live`. Stable; `schema` changes if the shape ever does
(2 since the live marker: `linkSite` changed shape). `privateBaseUrl` is
`null` when `config.json` has none; then every `privateUrl` is a `file://` URL.

```json
{
  "schema": 2,
  "workspace": "/path/to/store",
  "baseUrl": "https://pages.example.org",
  "privateBaseUrl": "http://127.0.0.1:8080/forge",
  "index": "https://pages.example.org/d/<indexSlug>/",
  "linkSite": {
    "state": "current | behind | unknown | none",
    "basis": "live read now | last live read on this machine | no live read on this machine | no host is set",
    "readAt": "<ISO time of that read, or null>",
    "liveCommit": "<commit the live marker showed, or null>",
    "liveTree": "<public/ tree the live marker showed, or null>",
    "storeCommit": "<this copy's commit>",
    "storeTree": "<this copy's public/ tree>",
    "error": "<why a fresh read failed, or null>"
  },
  "documents": [
    {
      "name": "plan",
      "title": "The plan",
      "visibility": "private",
      "slug": "<12 chars>",
      "latest": { "n": 2, "date": "2026-11-20" },
      "versions": 2,
      "takenDown": [],
      "privateUrl": "http://127.0.0.1:8080/forge/d/<slug>/",
      "publicUrl": null,
      "source": "~/projects/x/plan.html",
      "shares": 0
    }
  ]
}
```

`index` is `null` until the first publish. `publicUrl` is `null` for a private
page. On a private-only store (no host yet), and these values are part of
schema 2, so a tool reading it must accept them: `baseUrl` is `null`, `index`
is `null`, `linkSite.state` is `none` with `basis` `no host is set` (its read
fields `null`), and every `publicUrl` is `null`. `takenDown` lists the version numbers kept off the link site (taken down, or marked before the page was shared). `source`
writes the home folder as `~`. A reader that is not under the store lock can
meet the instant git replaces `manifest.json` during a fast-forward; on a load
error, retry once.

## For a tool built on forge (for example a dashboard listing the private pages)

- Read `forge list --json` (schema 2) and the store's files; never write the
  store. Call `forge sync` before reading when the store may be behind.
- Run `forge publish`, `forge share`, `forge unshare`, `forge rename` and read the exit code first:
  0 finished; 1 refused, nothing changed; 3 saved, but not finished: do
  the next step stderr names after `finish with:` (it is not always
  `forge deploy`); a take-down whose stderr ends `is public: another machine
  has since shared it` was undone by another machine: tell the owner, and run the printed `forge unshare` only if the owner still wants it down; 4 not known
  whether the change was saved. When online, run forge sync, then forge list: if
  the change is there, run forge deploy to finish; if it is not, run the same
  command again. 75 the store was busy, nothing changed.
- On exit 0 and exit 3 the results are on stdout: read the `private:` line
  there (it is always printed once the change is saved). A `public:` line
  means the link site was confirmed to show the page, whatever the exit
  code. On exit 1 and 4, stdout is empty.
- A tool that keeps page names (a list, a bookmark) re-reads `forge list --json`
  after a `forge rename`: the old name is no page any more, while the slug and
  both links are unchanged, so anything keyed by slug or link keeps working.
- `forge sync` takes the store lock. Exit 75 from it means the store was busy;
  its pages can still be read, possibly slightly behind.
- Updating a page that is already shared needs `--live`; without it the
  command refuses (exit 1) and changes nothing. Ask the owner first:
  "<name> is public at <link>; update the public page now?" Skip the
  question only if the owner's own request already named that public page
  or its link (for example "update the public <name>", or the link pasted):
  then the request is the yes. Never infer it from "update" alone. Naming
  the page without calling it the public or sent one (for example "update
  the plan") is not a yes: ask. On yes, add --live. On no, or if you cannot ask, keep it private with --name
  '<new-name>' and say a new private page was made. For a dashboard, the
  owner's click on an "update the public page" control is that yes.
- `forge recover` says whether an interrupted change was saved, removes
  leftover temporary copies, and reports a half-updated copy or hand edits;
  it never puts files back or discards anything. `forge recover --set-aside`
  runs only when the owner asks (see "Setting changes aside").

## Access model

- **Private address** (`privateBaseUrl`, optional): something you run serves the store's `private/` and
  `public/` folders together, at the same paths, to your own machines only. Every
  page has a private link, shared or not. The engine runs no server: whatever
  serves it reads the store's files and `forge list --json`. With no
  `privateBaseUrl`, the private link is the page's file in this machine's copy
  of the store.
- **Link site** (`baseUrl`): serves `public/` only. Privacy there is the link
  itself: 12 random characters, `noindex` on every response, nothing that lists
  pages except a master index at its own secret slug, which lists shared pages
  only. Anyone holding a link can open it, with no login; treat sending a link as
  sharing the page. A page's history page (`/d/<slug>/versions/`) is public to
  anyone holding the page's link and lists every version that is not taken down.
- `forge check` reads every file under `public/` and fails if any:
  carries a private page's slug; is an HTML page byte-for-byte equal to a page
  from one of a private page's versions (its main page or a secondary page), or
  to one of the source HTML files a private version was published from (their
  plain hashes are recorded at publish, for single files and folders alike); or is
  an HTML page whose whole title is a private page's title: its `<title>` or its
  first `<h1>` equals it, ignoring case and spacing (a title a shared page also
  uses is skipped). The word in ordinary text is no match, so a private page
  called `Budget` does not block shared pages that use the word. Images, fonts,
  scripts and styles are not compared: the same logo on a private and a shared
  page is normal.
- **The limit, plainly:** a private page's images or other files copied into a
  shared page are not detected, and neither is content copied in another form
  (retyped, reformatted, a screenshot). Versions recorded before source hashes
  existed (every imported version) are covered only by their stored page
  bytes: a copy of such a page's original source file is not detected. What the check
  guarantees is that nothing on the link site references a private page and no
  private page is uploaded as it is.

## Taking something down

- The whole page: `forge unshare <name>`. One old version:
  `forge unshare <name> --version N`. Before sharing (the store needs a host
  set), it marks the version, and sharing keeps it private; after sharing it
  takes the version down, but it was public until then.
- Nothing is deleted: the page moves to `private/`, and the store's git history
  keeps every byte. Anyone who already opened or saved the page keeps their copy.
- If a newer version removed something private and the link has not been sent
  yet, publish the clean version under a new `--name` (a fresh link whose history
  starts clean) and send that one.

## Leaving

The store is static files in git. Any static web host can serve `public/` as it
is, and every link keeps working if the domain moves with it (on a host that
ignores `_headers`, send `noindex` another way). To stop using the
engine: run `bin/install --uninstall` (removes only the links it made), delete
your setting file if you like, and keep the store repo.

## Versions and releases

Forge's version follows [Semantic Versioning](https://semver.org/): X.Y.Z,
where a patch release (0.1.1) fixes, a minor release (0.2.0) adds, and a major
release (1.0.0) breaks. While the version starts with 0, a minor release may
also carry a breaking change; `CHANGELOG.md` says so under that release.
`forge --version` prints the version of this copy; the `VERSION` line in
`bin/forge` is where it is written, and `scripts/release.sh` sets the same
version in `gemini-extension.json` (Gemini CLI requires one) in the release's
commit. A test fails whenever the two differ.

`CHANGELOG.md`, at the top of the repository, says what changed in each
release for the people who use it. Every release is a git tag `vX.Y.Z` on
`main` and a GitHub Release with that release's CHANGELOG section as its
notes, on the repository's Releases page. `forge update --check` says whether
a newer release exists; `forge update` moves a git checkout to it. To be told
of a new release without checking, open the repository on GitHub, choose
Watch, then Custom, tick Releases, and apply.

When several machines use one store, update every one of them before writing
from any: an older copy rebuilds the store's generated pages in its own style
on its next write, and the link site then serves that until a newer copy
writes again (`forge regenerate` puts them back).

## Tests

```
node test/run.js       # every test; prints only FAIL lines and a count
node test/mutate.js    # removes each guard in a scratch copy; each must fail its test
```

Tests use scratch stores, a scratch home folder and setting file, and a scratch
temp folder under the OS temp folder, removed when each test ends, and
`FORGE_DEPLOY=0` or a fake link site; they never touch a real store, the
network, a real secret, or your setting file. The fake link site
(`test/fakehost.js`) is a fake `npx` put first on `PATH` that plays each
host's CLI and "uploads" into a folder, plus a local HTTP server that serves
it with that host's header rules; it can fail before or after an upload, or
keep serving an old marker. The engine has no test mode for it, so nothing in
a store's config can select it. The Markdown export browser test
(`test/publish-md-export.test.py`) needs Python Playwright with Chromium; the
runner reports it as skipped when that is missing.
