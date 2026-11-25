# Roadmap

Where Forge is going, as a board: each item moves from **Later** to **Next**
to **Now** to **Done**. One line says why it matters. Items are not promises
of a date. Open an issue to suggest one, or to say which you need first.

## Now

- [ ] **First real deploys on Vercel and Netlify.** Both adapters pass every
  test against a stand-in host; neither has deployed to a real account yet.
- [ ] **macOS checks in CI.** The test suite runs on macOS runners; the store
  lock's wait message (through `lsof`), `forge init`'s rename and `forge open`
  are the parts most likely to differ there.

## Next

- [ ] **Comments on shared pages.** Readers leave notes on a page and you read
  them in one place. Needs Forge's own small optional service on your host (for
  example a Cloudflare Worker with storage) to keep the comments; the pages
  themselves stay static.
- [ ] **A logo and a favicon** for Forge and for the generated pages.
- [ ] **Deck template.** A page made of slides: arrow keys to move, full screen,
  speaker notes kept out of the page.
- [ ] **A second machine, end to end.** A guided path for using one store from
  two machines, tested from a fresh clone.
- [ ] **Source hashes for imported pages.** Pages moved in with `forge import`
  lack them, so republishing one unchanged makes a new version instead of
  saying "unchanged".
- [ ] **Clearer refusal when another machine set the host.** `forge host`
  without `--replace` should say when the host it names came from another
  machine, and suggest `forge sync` before any replace.

- [ ] **Keep a version off the link site before a host is set.** Today
  `forge unshare <name> --version N` needs a host; it should also mark a
  version on a store that has none yet.
- [ ] **A sturdier release script.** Honour the repository's own commit
  signing and hooks in the release copy, read origin back when a push
  answer is lost, push to every push address, bring the checked-out branch
  up only when it is main, and say "kept off the link site" in `forge list`
  for a version marked before sharing.

## Later

- [ ] **Pages behind a sign-in, with named people and roles.** Today privacy
  is the unguessable link; some pages need a login (for example a recipe for
  Cloudflare Access).
- [ ] **Custom domain helper** for each host.
- [ ] **Install with a package manager** (Homebrew, npm) besides `git clone`.
- [ ] **Search across your pages** from the command line and the master index.
- [ ] **Links that expire** after a date you choose.
- [ ] **View counts**, opt-in, kept on your own host.
- [ ] **Windows support.** The store lock uses `flock` through perl today.

## Not planned

- **Pages that run server code or call a model.** Forge publishes static pages
  on hosts you own; interactive apps that need a backend are a different tool.

## Done

- [x] **0.1.0, first public release** (2026-11-25): publish privately, share at
  a link on your own host (Cloudflare Pages, Vercel, Netlify; Vercel and
  Netlify tested against a stand-in host so far), frozen versions,
  `--live` for shared pages, rename, `forgee` beside another `forge`, the store
  anywhere you choose, an agent-guided setup, versioned releases with
  `forge update`. See [CHANGELOG.md](CHANGELOG.md).
