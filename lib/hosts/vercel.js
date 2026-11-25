// Vercel, through the vercel CLI.
//   Command: vercel deploy <dir> --prod --yes (--yes skips set-up questions)
//     https://vercel.com/docs/cli/deploy
//   Token: VERCEL_TOKEN (recommended over --token, which would put it on the
//   command line): https://vercel.com/docs/cli/global-options
//   Project without vercel link: VERCEL_ORG_ID (the team that owns it, here
//   host.accountId) together with VERCEL_PROJECT_ID (host.project); set only
//   one and vercel deploy exits with an error.
//     https://vercel.com/docs/cli/global-options
//   Header file: vercel.json "headers" in the uploaded folder's root, which
//   applies to static files: https://vercel.com/docs/project-configuration/vercel-json
//   Only s-maxage and stale-* are stripped from Cache-Control before it
//   reaches the browser: https://vercel.com/docs/caching/cache-control-headers
//   A plain folder: framework null ("Other"), no build command, output ".";
//   without outputDirectory a public/ subfolder would be served instead.
//     https://vercel.com/docs/builds/configure-a-build
// Vercel ignores _headers, so the noindex rule the store keeps there is
// repeated here.
const fs = require("node:fs");
const path = require("node:path");

module.exports = {
  name: "Vercel",
  needsAccount: true,
  tokenName: "FORGE_VERCEL_TOKEN",
  headers(dir) {
    // The upload is an export of public/, so this replaces nothing of the store's.
    fs.writeFileSync(path.join(dir, "vercel.json"), JSON.stringify({
      framework: null,
      buildCommand: "",
      outputDirectory: ".",
      headers: [
        { source: "/_forge/(.*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
        { source: "/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      ],
    }, null, 2) + "\n");
  },
  command(dir, host, token) {
    return {
      pkg: "vercel",
      args: ["deploy", dir, "--prod", "--yes"],
      env: { VERCEL_TOKEN: token, VERCEL_ORG_ID: host.accountId, VERCEL_PROJECT_ID: host.project },
    };
  },
};
