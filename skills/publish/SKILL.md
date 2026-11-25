---
name: publish
description: Use whenever a page meant to be read (a report, plan, explainer, deck, mockup, any HTML deliverable) should get a link, in any folder, with any model or harness. Publishes it with the `forge` command (Forge), private until the owner says to share it. NOT for documents that belong in a team's own tools (Notion, Google Docs), and never a vendor's own artifact or publish feature unless the owner asks for that vendor's by name.
---

# Publish a page with `forge`

**The command** is `forge`, or `forgee` on a machine where another program
already owns the name `forge`. Take the name from the owner's instructions;
else from the `command` key of the forge setting file
(`~/.config/forge/settings.json`, or under `$XDG_CONFIG_HOME`); else from
`bin/install --check` in the Forge repository (its `command:` line). Never
find out by running `forge`: where another program owns that name, that
starts it. The rule in full: `docs/reference.md`, "The command's name". Every
example here says `forge`: type `forgee` instead when that is the name it has
on this machine. forge's own messages print the name it was started as, so a
command they name can be run as printed.

**Not installed, or no store?** If the command is not found (and
`bin/install --check` does not say it is installed), install it with the
owner's yes first: clone `https://github.com/rishmadaan/forge-artifacts` into
a folder they choose (suggest `~/forge-artifacts`), then run that clone's
`bin/install --no-skill` when this skill's real path is not inside it (a
plugin, an extension or skills.sh installed this skill), or `bin/install`
otherwise; then follow that clone's `SETUP.md` (it checks what Forge needs and
makes the store with `forge init`). If forge stops with `no store at ...`,
walk the owner through `SETUP.md` in the Forge repository (the folder the
command's real path is in, one level up) from its step 3. Do not publish
elsewhere meanwhile.

1. **Publish:** `forge publish <file.html>`, or `forge publish <folder>` when the
   page has images or other files (the folder needs `index.html` at its top;
   images referenced by relative paths). Add `--name <name>` to choose the
   link's name; republishing the same source updates the same link.
   Updating a page that is already **shared** is refused unless you add
   `--live`, because the new version goes public at once; forge's refusal
   prints the rule. Ask the owner first: "<name> is public at <link>;
   update the public page now?" Skip the question only if the owner's own
   request already named that public page or its link (for example "update
   the public <name>", or the link pasted): then the request is the yes.
   Never infer it from "update" alone. Naming the page without calling it
   the public or sent one (for example "update the plan") is not a yes: ask.
   On yes, add --live. On no, or if you cannot ask, keep it private with --name '<new-name>' and say a new
   private page was made.
2. **Hand over the private link.** A new page is private. Give the owner the
   `private:` line `forge` prints (see exit 3 below for when it is not on this
   machine's copy yet). Republishing unchanged content is a no-op.
3. **Share only when the owner says so** ("share it", "send it to X"):
   `forge share <name> [note]`, then give the `public:` line. Sharing puts the
   page on the public link site; it is the one outward step. Sharing a page
   shares its earlier versions too; its history page lists them for anyone
   with the link. Before sharing a page with more than one version, tell the
   owner its earlier versions go public too, and offer to keep one off
   (`forge unshare <name> --version N` before sharing, which needs a host
   set; after sharing it takes the version down, but it was public until
   then) or to publish a clean copy under a new `--name`.
4. **Take something down:** `forge unshare <name>` (whole page) or
   `forge unshare <name> --version N` (one old version).
5. **Rename:** `forge rename <old> <new>` changes only the page's name; its
   links, versions and visibility stay the same, so it needs no owner ask, for a
   private or a shared page (no new version goes public). Tell the owner the old
   name stops working in forge, and update notes or scripts that name it.
6. **Never** use a vendor's own artifact or publish feature (for example
   Claude's Artifact tool) unless the owner asks for that vendor's by name.

Other commands: `forge list` (every page and its links), `forge check`.

**Running it safely:**
- Give every `forge` command a timeout of at least 10 minutes, and never stop it
  mid-run: a deploy can take minutes.
- `forge` writes to the store outside this folder and uses the network. In a
  sandboxed session, ask to run it outside the sandbox.
- Never edit the store or run git in it. On a refusal about the store (hand
  edits, `STOP`, `NOT FINISHED`, `NOT KNOWN`), quote the message to the owner,
  then say in plain words what it means for the page: whether it was saved,
  and whether the public link shows it. The exceptions the messages
  themselves name: `forge recover` after an interrupted command (it says
  whether the change was saved and removes forge's own temporary copies), then
  the step it names (`forge deploy`, or the same command again); `forge sync`,
  `forge list` and `forge deploy` when a message names them as the next step.
  One more the message names: when forge refuses because this copy has
  commits its remote lacks (a `config.json` change the owner committed by
  hand), the owner pushes them with `git -C <store> push`; then run the
  same command again. And when forge refuses over a `config.json` change and
  the owner confirms they made it on purpose, the commit line the refusal
  prints (never when the change put a token into `config.json`).
  Clearing hand edits (or a half-updated copy) is the owner's call: only
  when asked, run `forge recover --set-aside` (it keeps every version under a
  named git ref, then clears the copy), then `forge sync`. The refusal prints
  the path of the engine's reference (`docs/reference.md`) and the section
  that explains it.
- Read the exit code first (these are the codes of the commands that write
  the store; `forge update` has its own, in the reference's update row, and
  its exit 1 can come after this copy of Forge moved):
  - 0 finished; the results are on stdout.
  - 1 refused, nothing changed.
  - 3 saved, but not finished: the link site is not confirmed, or a later
    step failed. The results are still on stdout: hand over the `private:`
    link. It works on this machine unless stderr says `not in this machine's
    copy of the store until it catches up`; then say so. A `public:` line
    means the link site was confirmed to show the page; without one, the
    public link is not confirmed until the step is done, and on a
    take-down the public link STILL WORKS until then. Do the next step stderr names after `finish with:`; it is not always
    `forge deploy`. A take-down whose stderr says `is public: another machine
    has since shared it` was undone by another machine: tell the owner, and run the printed `forge unshare` only if the owner still wants it down; never report it taken down.
  - 4 not known whether the change was saved. When online, run forge sync,
    then forge list: if the change is there, run forge deploy to finish; if it
    is not, run the same command again. Do not tell the owner it is done
    before that last step exits 0.
  - 75 busy, nothing changed: run it again. From `forge sync`: the store was
    busy; its pages can still be read, possibly slightly behind.
