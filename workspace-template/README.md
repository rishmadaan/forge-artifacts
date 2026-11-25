# Forge store

This folder is a Forge store: every page published with `forge`, every
version of it, and the record of every share and take-down. It is its own git
repository, separate from the engine, and holds all of the owner's data.

- `public/` is exactly what the link site serves. Only shared pages live here.
- `private/` is never deployed. New pages, and pages taken down, live here.
- `manifest.json` is the record: names, slugs, versions, shares, take-downs.
- `config.json` says where the link site and the private address are, which host
  serves the link site, and the brand shown on the generated pages.

Change it only through `forge`. A hand edit leaves uncommitted changes, and
every `forge` command refuses to write while they are there; forge never discards
them. When the owner asks to clear them, run `forge recover --set-aside`: it
keeps every version under a named git ref, then clears this copy (the engine's
`docs/reference.md`, section "Setting changes aside", explains it). Do not commit hand
edits here, with one exception: a change to `config.json` (the look), committed
by hand and then pushed at once with `git -C <store> push`; forge refuses to
write while this copy has commits its remote lacks.

The full field-by-field description is `schema.md`.
