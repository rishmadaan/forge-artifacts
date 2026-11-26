# AGENTS.md

Rules for any agent (any model, any harness) working on the Forge
engine. `CLAUDE.md` only imports this file; this is the single source.

## What this repo is

Forge: a private-by-default page publisher any AI agent can use. The engine
only: the `forge` command (`bin/forge`), its library (`lib/`, with one
adapter per host in `lib/hosts/` and the user setting file in
`lib/settings.js`), the installer (`bin/install`), the `publish` skill,
tests, and the store template (`workspace-template/`). `README.md` is the short
introduction and `docs/reference.md` describes every command in full; `SETUP.md` walks a person through setup; `docs/adding-a-host.md`
says how to add a host. MIT (`LICENSE`).

The owner's data lives in the store (`~/.forge` by default, or wherever the
setting file or `FORGE_WORKSPACE` says), never here. `workspace/` stays
gitignored so a store inside this folder remains possible; do not create, read
or change a real store, or the real setting file, while working on the engine.
Tests make scratch stores and a scratch home folder under the OS temp folder.

## Rules

- **No owner data in the engine.** No names of people or companies, no account
  ids, no domains, no slugs, no machine names, no secret names, no paths into
  anyone's home folder. Brand, addresses, host project and the secret's name
  come from the store's `config.json`. Grep for them before every commit.
- **Tests before commit.** Run `node test/run.js` and make it pass. A change to a
  guard (the lock, the throwaway worktree and the push as the commit point,
  the outcome record and its exit codes, the privacy check, the folder
  refusals, the loader, the installer's refusal) also runs `node test/mutate.js`:
  every guard removed must fail its test. A new guard gets a mutant there.
- **Tests never reach out.** `FORGE_DEPLOY=0`, or the fake link site in
  `test/fakehost.js` (a fake `npx` on `PATH` and a local server), never a real
  deploy; scratch stores, scratch `HOME` and temp folders only, removed when
  the test ends; and a scratch `XDG_CONFIG_HOME`, so no test deploys, runs a
  real secret command, or touches the real home folder. State a must-never as a rule
  over every route into the bad state (`test/state-rules.test.js`), not one
  scenario per guard.
- **Path-limited commits**, message first: `git commit -m "<msg>" -- <paths>`.
  Never `git add -A` at the repo root.
- **No em dashes** in anything written here: code, comments, docs, messages.
- **Keep comments that explain why.** They carry decisions. Keep them; keep
  names of people, companies and review rounds out of them.
- **No new npm dependencies.** Node standard library only (the Markdown export
  browser test may use Python Playwright).
- **Frozen means frozen.** Never rewrite a `v<N>` folder in a store. A
  republish is a new version only when its source bytes differ from the last
  version's (`sourceHashes`; `workspace-template/schema.md` owns the rule), so
  changing the stamps (dark toggle, Markdown export) does not version a page;
  it changes what every page written from then on carries. The exception is a
  version without `sourceHashes` (an imported one): it is compared on the
  stamped page's hash, so a stamp change makes its next republish a new
  version. Do it only on purpose. `mdExportMain` in `lib/pages.js` is embedded
  into pages with `toString()`, so its comments are page bytes too: do not
  edit any line inside it, not even a comment, unless you mean that change.
  `test/pages.test.js` pins the hash.
- **The template is versioned.** A change to the store's shape bumps
  `workspace-template/TEMPLATE_VERSION`, the loader's supported version, and
  says in `workspace-template/schema.md` what to migrate. An optional,
  additive manifest field that older stores can omit (like `stableExtras`)
  does not bump it; a required field or a changed meaning does.

## Releasing

CI has no browser, so it skips the browser tests: before every release, run them
locally with Python Playwright and Chromium installed
(`python3 test/dark-mode.test.py` and `python3 test/publish-md-export.test.py`).
The Markdown export test must pass, and the dark-mode test must list Chromium
under `browsers run` with no failed check. A `SKIPPED <browser>: it does not
start` line means only that that browser could not start, usually because it is
not installed (`python3 -m playwright install <browser>` adds it), and a skipped
scrollbar check is expected where scrollbars overlay or `scrollbar-color` is
unsupported. If the dark-mode test prints `browsers run: none`, it tested
nothing.

1. Write the release in `CHANGELOG.md` first: move what is under
   `## [Unreleased]` into a new `## [X.Y.Z] - YYYY-MM-DD` section (SemVer:
   while on 0.x, a minor release may break; say so there), written for the
   people who use Forge, and add its link reference at the bottom. Commit it.
2. On `main`, with nothing uncommitted or untracked, run
   `scripts/release.sh X.Y.Z`. It refuses, changing nothing, unless X.Y.Z has
   no leading zeros and is higher than `VERSION` and every release tag on
   origin (only the first release tags `VERSION` as it is), the tag is new
   here and on origin, and the CHANGELOG section has notes. Then it works in
   a temporary copy of the checkout: sets `VERSION` in `bin/forge` and the
   version in `gemini-extension.json`, and makes the `Release X.Y.Z` commit (checking a commit hook did not change it), runs
   the tests on that commit (they must leave its tracked and untracked files
   as they were),
   tags `vX.Y.Z` and pushes `main` and the tag together. Any failure before
   the push removes the copy and changes nothing anywhere. Only after the
   push is this checkout brought up to the release, fast-forward only; if
   it cannot be (a change made meanwhile), the release is still out and the
   script prints the one line that brings the checkout up later; if a commit
   was made meanwhile, rebase it onto the release (`git pull --rebase`)
   instead.
3. The tag starts `.github/workflows/release.yml`: it tests again, checks the
   tag against `VERSION`, and makes the GitHub Release from the CHANGELOG
   section (`scripts/changelog-section.sh`).

A change to `skills/publish/SKILL.md` that needs unreleased command behaviour
lands with the release, since the copies Claude Code's plugin store and
skills.sh install follow `main`.
