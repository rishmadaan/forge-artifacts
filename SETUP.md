# Setting up Forge (a guide for an agent)

You are an AI agent helping a person set up Forge on their machine. Walk them
through these steps in order. Do every step you can do yourself (running
commands, editing files); stop and ask only for what only they can do (signing
in to a host, creating a token, choosing names). Explain each step in one or
two plain sentences before doing it. Never print a token, never write one into
a file in a repository, and never paste one into the chat: the person types it
into their own terminal or secret manager.

Forge publishes HTML pages to a link site the person owns. A new page is
private; one more command shares it. Read `README.md` in this repository, and
`docs/reference.md` for each command in full, if you need detail.

## 1. Check the prerequisites

macOS or Linux, with:

- Node 22 or newer: `node --version` (it brings `npx`, which runs the host's
  upload tool).
- git: `git --version`, with a name and email set, since every change to the
  store is a git commit: `git config --global user.name` and
  `git config --global user.email` must each print a value. If one is empty,
  ask for it and set it with `git config --global user.name "Their Name"`
  and `git config --global user.email "their@email"`.
- perl: `perl -v` (the store lock uses it).

If one is missing, help them install it with their system's usual package
manager, then check again.

## 2. Install the command

1. Clone this repository somewhere they will keep it, for example
   `git clone https://github.com/rishmadaan/forge-artifacts ~/forge-artifacts`.
2. Run `~/forge-artifacts/bin/install`, then `~/forge-artifacts/bin/install --check`.
   If the agent already has Forge's `publish` skill from a plugin store (a
   Claude Code plugin, a Gemini CLI extension, or `npx skills add`), run
   `~/forge-artifacts/bin/install --no-skill` instead: it links the command
   only, and records that choice so later runs keep it
   (`bin/install --skill` links the skill again).
3. If `--check` says `~/.local/bin` is not on `PATH`, add it to their shell
   profile (for example `export PATH="$HOME/.local/bin:$PATH"` in `~/.zshrc`
   or `~/.bashrc`) and open a new terminal.
4. The command's name is the one the installer printed: `bin/install --check`
   says it on its line `command: <name>`. It is `forge`, or `forgee` when
   another program already owns the name `forge`. Do not find out by running
   `forge` itself: on such a machine that starts the other program
   (`docs/reference.md`, "The command's name", owns this rule). Use that
   name in every step below (the steps say `forge`).

## 3. Choose where the pages live (the store)

The store is a folder that is its own git repository. Ask where they want it:

- The default, `~/.forge`: run `forge init`.
- Anywhere else (for example inside a folder they already back up): run
  `forge init <path>`. forge records the path in its setting file,
  `$XDG_CONFIG_HOME/forge/settings.json` (else `~/.config/forge/settings.json`),
  so every agent finds it.

Then `forge store` shows which store is in use and why.

**Optional, for several machines:** create a private repository for the
store (for example a private GitHub repository; it **must** be private, because
the store holds the private pages), then in the store:
`git -C <store> remote add origin <url>` and
`git -C <store> push -u origin HEAD`. On each other machine: clone it, then
`forge store <path-of-the-clone>` if it is not at `~/.forge`. Every forge
change is pushed there. Once a host is set (step 5), each machine that shares or
deploys needs the token too, under the same name: in its environment, or
through its own `secretCommand` in its own setting file. Without it, a command
there that must upload ends `NOT FINISHED`.

## 4. A first private page (no host needed)

A new store works at once for private pages: there is nothing to fill in and
no host account is needed yet.

1. Make a small page, for example `hello.html` with a `<title>Hello</title>`.
2. `forge publish hello.html`. It prints `published hello v1 (private)` and a
   `private:` link: the page's file on this machine. `forge open hello`
   opens it in the browser. Forge adds a dark-mode switch (unless the page is
   dark-only) and Markdown copy and download buttons ("Copy as Markdown",
   "Download .md") to every page it publishes; the source file is not changed.
3. Change the page and run `forge publish hello.html` again: it prints
   `published hello v2 (private)`. The link stays the same and shows the
   latest version; every version keeps a frozen link of its own. Publishing an
   unchanged file makes no new version.
4. `forge list` shows every page; `link site: none` there just means no host
   is set yet. To change a page's name later, `forge rename hello <new-name>`:
   only the name commands take changes, never its links (the steps below keep
   saying `hello`).

If a command ends `NOT FINISHED` or `NOT KNOWN`, read its message to them and
follow the step it names (`docs/reference.md`, "Exit codes").

Optional: `privateBaseUrl` in the store's `config.json`, set only if something
serves the store's `private/` and `public/` folders at one address; and the
store's own look in `brand` (`name`, an `accent` colour like `#3451b2`, a
`fontStylesheet` address for its fonts; `schema.md` in the store lists them).
Commit a change to `config.json` with
`git -C <store> commit -m "store look" config.json`, and when the store has a remote
(step 3) push it at once: `git -C <store> push`. forge refuses to write while
this copy has commits its remote lacks, and says so; an uncommitted change to the store refuses too (its
message gives the commit line for `config.json`).

## 5. Pick a host and create its project and token (to share pages)

Only when they want to share pages: a shared page goes on a public link site,
a static site on a host account the person owns. Ask which host they use or
prefer; Cloudflare Pages is the one tested for real, Vercel and Netlify are
supported but so far tested only against a stand-in host. All three have free
plans that are enough for this.

Do it in this order: the project and the token first, then the token stored
under a name and checked, then `forge host`, then a first share. `forge host`
deploys to the new link site and reads it back, so it proves the project, the
token and the address at the step where they were made. The person signs in
and creates the token; you run the commands with the ids they read out (ids
are not secrets; the token is).

### Cloudflare Pages

1. Create a Pages project for direct upload (no Git connection), named for
   example `pages-<something>`, with production branch `main`:
   https://developers.cloudflare.com/pages/get-started/direct-upload/
2. Find the account ID (shown in the Cloudflare dashboard for the account).
3. Create an API token with the permission **Account, Cloudflare Pages,
   Edit**: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
   forge looks for it under the name `FORGE_CLOUDFLARE_TOKEN`.

### Vercel

1. Create a project (an empty one is fine; Forge uploads a plain folder with
   no build). Find its **Project ID** (`prj_...`) in the project's settings and
   the **Team ID** of the team that owns it in the team's settings.
2. Create a token: https://vercel.com/account/tokens. forge looks for it under
   the name `FORGE_VERCEL_TOKEN`.
3. The link site must be public: if their deployment protection covers the
   production domain, forge will report `not confirmed live`.

### Netlify

1. Create a site (Netlify calls it a project) to deploy manually, and find its
   **Project ID** in the project's configuration.
2. Create a personal access token: Applications, Personal access tokens, New
   access token (https://app.netlify.com/user/applications#personal-access-tokens).
   It is shown once. forge looks for it under the name `FORGE_NETLIFY_TOKEN`.

### Store the token under a name

forge reads the token by its name (the host's name above): from the
environment, or from their secret manager. Offer the two:

- **Environment:** they add `export FORGE_CLOUDFLARE_TOKEN=<token>` (their
  host's name) to their shell profile themselves (you do not see the value),
  then open a new terminal: a profile change reaches only new terminals.
- **Secret manager:** they store the token there under that name, then you set
  in the setting file (`$XDG_CONFIG_HOME/forge/settings.json`, else
  `~/.config/forge/settings.json`) the key `"secretCommand"` to the command
  that prints it, with `{name}` where the name goes, for example
  `"fnox get {name}"` or `"op read op://Private/{name}/credential"`.

Check it without printing the value, by its length: `printenv
FORGE_CLOUDFLARE_TOKEN | wc -c` for the environment, or the secret command
with the real name piped to `wc -c`. A number above 1 means it is there.
If your own length check reads 0 after they changed their shell profile, your
session started before the change and does not see it: ask them to restart
the agent's session from a new terminal, then check again. For an agent, the
secret manager with the default name is the smoother route: the secret
command runs fresh every time, in any session.

### Set the host

Run the line for their host (the `--url` may be their own domain once it
points at the project). The values given to `--project` and `--account` are ids, not secrets: they are
saved in `config.json`, committed and printed. Never put a token there.

- `forge host cloudflare-pages --project <project name> --account <account id> --url https://<project name>.pages.dev`
- `forge host vercel --project <project id> --account <team id> --url https://<project>.vercel.app`
- `forge host netlify --project <project id> --url https://<site>.netlify.app`

1. **The default name.** Keep the host's default token name (above), so
   `--token-name` is not needed. If that name resolves to no secret here,
   `forge host` refuses and saves nothing.
2. **A name of your own.** A name typed with `--token-name` is looked up in
   the environment only, never handed to the secret command (a token pasted
   there by mistake would otherwise reach another program's command line).
   For a token kept in a secret manager under another name, put it in the
   environment for that one run: `NAME="$(fnox get NAME)" forge host ...
   --token-name NAME`. The name is saved, and every later share and deploy
   reads it from the environment, then from the secret command, so a
   later deploy needs NAME in the environment again, or a secretCommand that
   answers NAME. forge never prints what was typed; if what was typed was the
   token itself, the refusal says to revoke it and create a new one.
3. **Success.** It writes the host into the store's `config.json`, commits it,
   deploys the link site, reads it back, and prints `host set: ...` and
   `try: forge share <name>`.
4. **Not proven.** If it prints `host saved, not proven: ...` and ends
   `NOT FINISHED` (exit 3), the host is saved but the site was not confirmed.
   Its last line names both fixes: `finish with: a wrong project or address:
   run the same forge host line with the right values and --replace; a token
   problem: fix the token, then forge deploy; the site not answering yet, or
   a network failure: forge deploy again in a minute`. If another machine
   set the host meanwhile, the last line names that host instead and the
   same three causes; for a wrong project or address there it says to ask
   them before replacing it (that would undo the other machine's change).
5. **Replacing a host.** A store that already has a host refuses; moving to
   another host is `--replace`: when the address changes, every public link
   moves, and the old address keeps serving what was deployed to it. When the project changes, the note
   about the old one says: if forge deployed pages to that project, every
   page shared until then stays public there, out of unshare's reach; delete
   it there when nothing should stay public. If that project is used for
   something else, forge's upload replaced what it served there: redeploy it
   from its own source. (`docs/reference.md`, `forge host`, says
   what moves.)

### Try sharing

`forge share hello` uploads to the host and prints a `public:` line once the
link site was read back showing it. `forge unshare hello` takes it down again.
Once a host is set, `forge list` also prints a `master index:` line: a page
forge generates on the link site listing every shared page, never a private
one (`docs/reference.md`, "Is the link site current?").
`forge check` reads the link site too and says `forge check OK`.

## 6. Make every agent use Forge

1. Run `bin/install --check` again and read its two skill lines. `linked:`
   means agents that read skills from that folder (`~/.agents/skills` or
   `~/.claude/skills`) find Forge's `publish` skill there. `skipped:` means
   another tool's `publish` skill is there, and agents reading that folder get
   that one, not Forge's. For a folder marked `skipped:`, and for agents that
   read neither folder, point them at Forge's skill file by its full path,
   `<this repository>/skills/publish/SKILL.md` (`--check` prints it).
   `not linked, by choice:` means only that skill linking was turned off
   (`bin/install --no-skill`). It does not check that a plugin store
   installed the skill: for each agent, confirm Forge's skill is enabled
   where that agent will use it.
2. Paste this paragraph into the instructions file each agent reads (for
   example `AGENTS.md`, `CLAUDE.md`, or the agent's global instructions),
   with `<command>` replaced by the name from step 2 (`forge` or `forgee`),
   and `<skill>` by `the publish skill` when both skill lines say `linked:`;
   when they say `not linked, by choice:`, by that agent's confirmed name for
   Forge's skill (a Claude Code plugin shows it as `forge-artifacts:publish`);
   otherwise, or when either says `skipped:`, by the full path of Forge's
   `SKILL.md`:

> To publish any page meant to be read (a report, plan, explainer, deck,
> mockup), use Forge, never a vendor's own artifact or publish feature: run
> `<command> publish <file.html | folder>` and give me the `private:` link it
> prints. On this machine the command is `<command>` (another program may own
> the other name, so never run a different one). Share a page
> (`<command> share <name>`) only when I say to share or send it. Updating a
> page that is already shared needs `--live`: ask me first.
> Follow <skill> for everything else.

3. Done. Tell them, in one line each: where the store is (`forge store`),
   which host serves the link site, where the token is read from, and the
   name of the command on this machine.

## 7. Later: updating Forge

This step is for later: the setup is finished at step 6. Tell the person how
to update. When a new release is out (GitHub can say so: on the repository
page, Watch, then Custom, then Releases), run `forge update --check` to see
what it brings, then `forge update`. It fast-forwards this repository to the
release and prints what changed. It updates the command in this clone, and
skill links made by `bin/install` update with it. A skill installed through a
plugin store updates separately, through that store:
`claude plugin update forge-artifacts@forge-artifacts`,
`gemini extensions update forge-artifacts`, or `npx skills update`. It
refuses, changing nothing, when this copy is not a git checkout, has uncommitted changes or commits of its own,
or while another forge command holds the store lock; run it when no other
forge command is running. The
store is not touched. `CHANGELOG.md` lists every release.
