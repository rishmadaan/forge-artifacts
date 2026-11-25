# Adding a host

Forge uploads the link site through one small adapter per host, in
`lib/hosts/`. An adapter only uploads; whether the site is live is decided by
the engine, which reads `/_forge/revision.json` back after every upload, the
same way for every host. So an adapter has one hard requirement:

**The host must serve `/_forge/revision.json` with `Cache-Control: no-store`,
set by a file inside the uploaded folder.** A cached marker would make forge
report an old state as live, or a new state as not live. If the host cannot do
that, do not add it.

## Steps

1. Read the host's official documentation and find, with a link for each:
   - the CLI's npm package and the command that uploads a plain folder to
     production without prompts and without a build step;
   - the environment variable the CLI reads the token from (never put the
     token on the command line), and any other ids it needs;
   - the header file the host reads from the uploaded folder, and how it sets
     a response header on a path pattern; whether it strips or overrides
     `Cache-Control`.
2. Copy `lib/hosts/netlify.js` to `lib/hosts/<kind>.js` and fill in:
   - `name`: how messages name the host;
   - `needsAccount`: true when `host.accountId` is required;
   - `headers(dir)`: write the header file into `dir` (the upload folder, a
     throwaway export of the store's `public/`): `no-store` on `/_forge/*`,
     and `X-Robots-Tag: noindex` on every path when the host ignores the
     store's `_headers` file. Hosts that read `_headers` can call
     `appendMarkerRule(dir)` from `index.js`;
   - `command(dir, host, token)`: `{ pkg, args, env }`. The engine runs
     `npx --yes <pkg>@latest <args>` with `env` added.
   Put each documentation link in a comment beside the fact it supports.
3. Register it in `ADAPTERS` in `lib/hosts/index.js`.
4. Teach the stand-in host in `test/fakehost.js` the new CLI: the arguments
   and environment it must refuse without, and how its header file turns into
   response headers. Add the kind to `KINDS` in `test/hosts.test.js`.
5. Add a mutant to `test/mutate.js` that removes the adapter's no-store rule,
   and check that `node test/mutate.js <id>` kills it.
6. Say in the README's host table and `SETUP.md` what the host needs (the
   `forge host` flags, the token and where to make it), and that it was tested
   against the stand-in host only until someone has deployed to it for real.
   `SETUP.md` gets a section headed `### <name>` (the adapter's `name`): a
   `forge host` refusal points to it by path, step and section. Give the
   adapter a default token name (`tokenName`) and use it in that section.
