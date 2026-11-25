// The host adapters, one small file per host, behind one interface:
//
//   name           how messages name the host
//   needsAccount   true when host.accountId is required in config.json
//   tokenName      the name forge host saves when --token-name is not given
//   headers(dir)   write the host's own header file into the upload folder, so
//                  /_forge/revision.json is served Cache-Control: no-store
//                  (the read-back must never see a cached marker) and every
//                  path is noindex. The upload folder is a throwaway export:
//                  nothing here is ever written into the store.
//   command(dir, host, token)
//                  the upload through the host's official CLI:
//                  { pkg, args, env }, run as npx --yes <pkg>@latest <args>,
//                  with env added to the environment (the token goes there,
//                  never on the command line).
//
// An adapter only uploads. Whether the site is live is decided by the
// engine's read-back of the marker (bin/forge ensureLive), the same for every
// host. A host that cannot serve the marker with no-store is not offered.
// docs/adding-a-host.md says how to add one.
const fs = require("node:fs");
const path = require("node:path");

const ADAPTERS = {
  "cloudflare-pages": require("./cloudflare-pages.js"),
  vercel: require("./vercel.js"),
  netlify: require("./netlify.js"),
};

// The no-store rule for hosts that read a _headers file in the uploaded
// folder (Cloudflare Pages and Netlify use the same format). Appended after
// the store's own rules; those never set Cache-Control, so the values are not
// joined into conflicting directives.
const MARKER_RULE = "\n/_forge/*\n  Cache-Control: no-store\n";
function appendMarkerRule(dir) {
  fs.appendFileSync(path.join(dir, "_headers"), MARKER_RULE);
}

module.exports = {
  kinds: Object.keys(ADAPTERS),
  get: (kind) => (Object.hasOwn(ADAPTERS, kind) ? ADAPTERS[kind] : null),
  appendMarkerRule,
};
