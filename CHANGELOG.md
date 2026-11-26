# Changelog

What changed in each release of Forge, written for the people who use it.

Forge follows [Semantic Versioning](https://semver.org/) and this file follows
[Keep a Changelog](https://keepachangelog.com/). While the version starts with
0, a minor release (0.1 to 0.2) may carry a breaking change; this file says
so under that release. To update a copy cloned with git, run `forge update`
(`forge update --check` only says whether a newer release exists).

## [Unreleased]

- Dark mode no longer shows a page that sets no colours of its own as black on black. Dark mode follows the reader's device setting by default, so every reader in dark mode saw such a page as empty. Its text, plain links and form fields now read light on dark, as on pages that set their own colours. The scrollbar stays dark where the browser supports `scrollbar-color`; elsewhere it is light.
- Pages you already published keep the dark switch they were published with: a frozen version never changes, and publishing an unchanged file again changes nothing. To give a page the fix, change its source (any change) and publish it again (with `--live` if it is shared). That makes a new version, and the page's link shows it; each older version keeps the old switch at its own link. A page brought in with `forge import` already gets one new version on its next publish, even unchanged, and that version has the fix. History pages and the master index get it on the next change to the store, or with `forge regenerate`.
- The `publish` skill also finds a Forge clone you already made through the command's own link (`~/.local/bin/forge` or `forgee`), so an agent whose skill came from a plugin store walks you through that clone instead of offering a second one.

## [0.1.1] - 2026-11-26

- Install Forge's `publish` skill from your agent's plugin store: Claude Code (`claude plugin marketplace add rishmadaan/forge-artifacts`, then `claude plugin install forge-artifacts@forge-artifacts`), Gemini CLI (`gemini extensions install https://github.com/rishmadaan/forge-artifacts`) or skills.sh (`npx skills add rishmadaan/forge-artifacts`). The `forge` command still comes from a clone of this repository. `forge update` updates the command; a skill from a plugin store updates through that store (`claude plugin update forge-artifacts@forge-artifacts`, `gemini extensions update forge-artifacts`, `npx skills update`).
- `bin/install --no-skill` links the command only, for an agent that gets the skill from a store. It removes the skill links this checkout made earlier, and only those; the choice is recorded and kept by later runs (`bin/install --skill` links the skill again). `bin/install --check` says `not linked, by choice:` for each skill path.
- The `publish` skill now tells an agent how to install the command when it is missing, with your yes first.
- The README shows Forge at work (a short recording), says that older versions stay at their own links, and answers "why not just run wrangler?".

## [0.1.0] - 2026-11-25

The first public release.

- `forge publish <file.html | folder>` publishes a page and prints a private link; a new page is private until you share it.
- Every version is frozen at its own link; republishing unchanged content changes nothing.
- `forge share` and `forge unshare` put a page on your own link site and take it down again; updating a shared page needs `--live`.
- Link sites on Cloudflare Pages, Vercel or Netlify (Vercel and Netlify tested against a stand-in host so far), set with `forge host`; every deploy is read back before forge calls it live.
- The store is a git repository you own (`~/.forge` by default); give it a remote to use the same pages from several machines.
- One exit code per store-writing command says whether the change was saved and whether the link site shows it.
- Every page gets a dark-mode switch (unless it is dark-only) and Markdown copy and download buttons; your source file is not changed.
- `bin/install` links the command and the `publish` skill for agents, as `forgee` where another program already owns the name `forge`.

[Unreleased]: https://github.com/rishmadaan/forge-artifacts/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/rishmadaan/forge-artifacts/releases/tag/v0.1.1
[0.1.0]: https://github.com/rishmadaan/forge-artifacts/releases/tag/v0.1.0
