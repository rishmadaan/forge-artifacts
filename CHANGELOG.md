# Changelog

What changed in each release of Forge, written for the people who use it.

Forge follows [Semantic Versioning](https://semver.org/) and this file follows
[Keep a Changelog](https://keepachangelog.com/). While the version starts with
0, a minor release (0.1 to 0.2) may carry a breaking change; this file says
so under that release. To update a copy cloned with git, run `forge update`
(`forge update --check` only says whether a newer release exists).

## [Unreleased]

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

[Unreleased]: https://github.com/rishmadaan/forge-artifacts/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rishmadaan/forge-artifacts/releases/tag/v0.1.0
