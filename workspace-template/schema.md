# Store schema, template version 1

`TEMPLATE_VERSION` holds the template version this store was made from. The
engine refuses a store whose version it does not read; when the version
changes, this file says what to migrate.

## config.json

| Field | Meaning |
|---|---|
| `baseUrl` | Optional, set with `host` by `forge host`: the public link site, for example `https://pages.example.org`. No trailing slash. With neither, the store is private-only (sharing refuses until a host is set). |
| `privateBaseUrl` | Optional. An address where something serves this store privately, for example `http://127.0.0.1:8080/forge`. No trailing slash. Without it, a private link is the page's file in this machine's copy of the store. It serves `private/` and `public/` together at the same paths (no slug is in both, except a shared page's taken-down versions, which sit in `private/` under the page's slug). |
| `host` | Optional, set with `baseUrl` by `forge host`. Required once any page is shared. |
| `host.kind` | `"cloudflare-pages"`, `"vercel"` or `"netlify"` (one adapter each in the engine's `lib/hosts/`). |
| `host.project` | Cloudflare Pages: the project name. Vercel: the project ID. Netlify: the site's Project ID. |
| `host.accountId` | Cloudflare Pages: the account ID. Vercel: the team ID. Not used by Netlify. |
| `host.tokenSecret` | The NAME of the secret holding the deploy token. It is read from the environment, then from the user's `secretCommand` setting when one is set (README, "Secrets"). Never the token itself. |
| `brand.name` | Shown in the footer of the generated pages and as the wordmark's spoken name. A leading `<name> ·` is dropped from titles on the generated pages. |
| `brand.wordmarkFile` | Path, inside the store, to an SVG wordmark drawn with `currentColor`; or `null` to show `brand.name` as text. Its real path (symlinks followed) must be inside the store. |
| `brand.indexTagHtml` | The tag in the master index's header (trusted HTML). |
| `brand.historyFooterHtml` | The line in each history page's footer (trusted HTML). |
| `brand.accent` | Optional. One colour, `#rrggbb`, for links, the accent bar and the stamped buttons. Without it, a neutral blue. |
| `brand.fontStylesheet` | Optional. An `https` address of a stylesheet the generated pages load (for the store's own fonts). Without it they use the system's fonts and request nothing from another site. |

A new store's `config.json` needs no editing: neutral `brand` values, no
`host`. A value reading `CHANGE-ME` stops every command (it marks a value
someone meant to fill in).

## manifest.json

```
{
  "indexSlug": "<12 chars>" | null,       // the secret slug of the master index, made on the first publish
  "deliverables": {
    "<name>": {
      "slug": "<12 chars>",               // assigned once, never changes
      "source": "~/path/page.html",       // the home folder is written as ~, so both machines agree
      "visibility": "private" | "shared",
      "versions": [
        { "n": 1, "date": "YYYY-MM-DD", "source": "~/...", "sha256": "<hash>",
          "sourceHashes": [ "<sha256>" ],  // optional; see below
          "takenDown": "YYYY-MM-DD" }      // only on a version kept off the link site (taken down, or marked before sharing)
      ],
      "shared": [ { "date": "YYYY-MM-DD", "note": "...", "latestAtShare": 1 } ],
      "takedowns": [ { "date": "YYYY-MM-DD", "version": 3 | "all" } ],
      "stableExtras": [ "preview.jpg" ]      // optional; only import writes it (see below)
    }
  }
}
```

Version numbers are positive and increasing; gaps are allowed. A publish
writes the last number plus one and refuses if that folder already exists.

`stableExtras` lists files that sit in the stable folder but in no version:
files a site's owner put there by hand before an import, found by `forge import`. They
are kept across republishes; `forge check` names any other such file. Optional,
so a version 1 store without it needs no migration.

`sourceHashes` (optional) lists the plain sha256 of every source HTML file
the version was published from: the file itself, or every `.html` file of a
folder. `forge check` uses them to recognise a copy of a private page's source on
the link site. Versions published before the field existed (imported ones)
have none and are covered by their stored page bytes only. Optional, so a
version 1 store without it needs no migration.

A republish is a new version only when its source bytes differ from the last
version's: `sourceHashes` and, for a folder, every other file's bytes against
that version's frozen copy. So a change in what the engine stamps into pages
never makes a new version. A version without `sourceHashes` (an imported one)
is compared on `sha256` instead: the hash of the stamped page with its
version metadata left blank, not the hash of the written file (the written
page carries its version number and date).

## Folders

```
public/_headers, public/index.html, public/404.html    served as-is
public/d/<indexSlug>/index.html                         master index (shared pages only)
<tree>/d/<slug>/index.html (+ the page's other files)  the stable link, always the latest version
<tree>/d/<slug>/v<N>/                                   frozen version N, never rewritten
<tree>/d/<slug>/versions/index.html                     the page's history page
```

`<tree>` is `public` for a shared page and `private` for a private one.
