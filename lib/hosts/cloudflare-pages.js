// Cloudflare Pages, through wrangler.
//   Command: wrangler pages deploy <dir> --project-name <name> --branch <branch> --commit-dirty
//     https://developers.cloudflare.com/workers/wrangler/commands/pages/
//   Token and account: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
//     https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
//   Token permission: Account, Cloudflare Pages, Edit
//     https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
//   Header file: _headers in the uploaded folder; its headers "override what
//   Cloudflare ordinarily sends", and a splat (/_forge/*) is allowed.
//     https://developers.cloudflare.com/pages/configuration/headers/
// The branch is "main", the project's production branch when it was made by
// direct upload.
module.exports = {
  name: "Cloudflare Pages",
  needsAccount: true,
  tokenName: "FORGE_CLOUDFLARE_TOKEN",
  headers(dir) {
    require("./index.js").appendMarkerRule(dir);
  },
  command(dir, host, token) {
    return {
      pkg: "wrangler",
      args: ["pages", "deploy", dir, "--project-name", host.project, "--branch", "main", "--commit-dirty=true"],
      env: { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: host.accountId },
    };
  },
};
