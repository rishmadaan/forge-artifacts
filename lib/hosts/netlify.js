// Netlify, through netlify-cli.
//   Command: netlify deploy --dir <dir> --prod --no-build --site <id>
//   (--no-build: without it the CLI runs a local build first)
//     https://cli.netlify.com/commands/deploy/
//   Token and site: NETLIFY_AUTH_TOKEN; the site is the project's "Project ID"
//   (what NETLIFY_SITE_ID expects), passed with --site
//     https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/
//   Header file: _headers in the publish folder, the same format as
//   Cloudflare's, with wildcards; the docs' own example sets no-store.
//     https://docs.netlify.com/manage/routing/headers/
//   Every deploy invalidates Netlify's edge cache, and Cache-Control is
//   passed downstream: https://docs.netlify.com/build/caching/caching-overview/
module.exports = {
  name: "Netlify",
  needsAccount: false,
  tokenName: "FORGE_NETLIFY_TOKEN",
  headers(dir) {
    require("./index.js").appendMarkerRule(dir);
  },
  command(dir, host, token) {
    return {
      pkg: "netlify-cli",
      args: ["deploy", "--dir", dir, "--prod", "--no-build", "--site", host.project],
      env: { NETLIFY_AUTH_TOKEN: token },
    };
  },
};
