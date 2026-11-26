// Runnable test: node test/docs.test.js
// The documents a stranger or an agent starts from say what they must: the
// README (install, store, hosts tested honestly, forgee, limits, platforms),
// SETUP.md (every step an agent walks a person through), the skill and the
// agent rule (forge or forgee, and how to tell), AGENTS.md as the single
// source with CLAUDE.md importing it, and an MIT LICENSE.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { check, done, ENGINE } = require("./helpers.js");

const read = (f) => fs.readFileSync(path.join(ENGINE, f), "utf8");
const flat = (s) => s.replace(/\s+/g, " ");

(async () => {
  await check("README: what and why, install, where the store lives, hosts tested honestly, forgee, limits, macOS and Linux only", () => {
    const r = flat(read("README.md"));
    for (const s of [
      "a private-by-default page publisher any AI agent can use",
      "## Install", "macOS and Linux only", "bin/install",
      "## Where the store lives", "FORGE_WORKSPACE", "~/.forge", "forge store <path>",
      "### `forge` or `forgee`", "bin/install --command forgee", "prints `Forge <version>`",
      "| `cloudflare-pages` |", "| `vercel` |", "| `netlify` |", "for real", "against a stand-in host only",
      "secretCommand", "## Page names", "^[a-z0-9][a-z0-9._-]*$",
      "forge open <name>", "## Limits", "SETUP.md", "docs/adding-a-host.md",
    ]) assert.ok(r.includes(s), "README lacks: " + s);
    assert.ok(!/<engine>\/workspace/.test(r), "the old default store location is gone");
  });

  await check("README is for a first-time reader: an example, a short command table, the clone address; the detail is in docs/reference.md", () => {
    const raw = read("README.md");
    // A landing page: pictures, badges, the comparison and the store install lines add markup, not reading; the detail stays in the reference.
    assert.ok(raw.split("\n").length < 320, "README is short: " + raw.split("\n").length + " lines");
    assert.ok(raw.includes("$ forge publish report.html\npublished report v1 (private)\nprivate: "), "a short example of a publish and its result");
    assert.ok(raw.includes("git clone https://github.com/rishmadaan/forge-artifacts"), "the clone address");
    const rows = raw.split("\n").filter((l) => l.startsWith("| `forge "));
    assert.ok(rows.length >= 8 && rows.every((l) => l.length < 300), "one short row per command");
    const rename = rows.find((l) => l.startsWith("| `forge rename")) || "";
    assert.ok(/breaks the name rule/.test(rename), "the rename row names the name-rule refusal: " + rename);
    assert.ok(raw.includes("[docs/reference.md](docs/reference.md)"), "points to the reference");
    assert.ok(!/Ask the owner first/.test(raw), "the agent rules live in the skill, not the README");
    const ref = flat(read("docs/reference.md"));
    for (const x of ["## Exit codes", "## Safety rules every writing command follows", "## Setting changes aside (only when the owner asks)", "## For a tool built on forge", "## Access model", "| `forge import "]) assert.ok(ref.includes(x), "reference lacks: " + x);
    assert.ok(!ref.includes("of the same layout"), "import is described plainly, not by a layout only an old tool had");
  });

  await check("SETUP.md walks an agent through every step, in order", () => {
    const s = flat(read("SETUP.md"));
    const steps = ["## 1. Check the prerequisites", "## 2. Install the command", "## 3. Choose where the pages live", "## 4. A first private page (no host needed)", "## 5. Pick a host and create its project and token", "## 6. Make every agent use Forge"];
    let at = -1;
    for (const h of steps) {
      const i = s.indexOf(h);
      assert.ok(i > at, "SETUP.md step missing or out of order: " + h);
      at = i;
    }
    for (const x of ["### Cloudflare Pages", "### Vercel", "### Netlify", "private repository", "secretCommand", "bin/install --check", "forgee", "forge open hello", "Never print a token", "forge host cloudflare-pages --project", "forge host vercel --project", "forge host netlify --project"]) assert.ok(s.includes(x), "SETUP.md lacks: " + x);
  });

  await check("the command's name comes from the owner's instructions, else the setting file's command key, else bin/install --check; the reference owns the rule and no document has an agent run forge to find out", () => {
    const ref = flat(read("docs/reference.md"));
    const i = ref.indexOf("## The command's name");
    assert.ok(i >= 0, "the reference owns the rule");
    const rule = ref.slice(i, ref.indexOf("## ", i + 5));
    let at = -1;
    for (const x of ["the owner's instructions", "the `command` key", "`bin/install --check`"]) {
      const j = rule.indexOf(x);
      assert.ok(j > at, "the rule names, in order: " + x + "\n" + rule);
      at = j;
    }
    assert.ok(rule.includes("Never find out by running `forge`"), rule);
    const skill = flat(read("skills/publish/SKILL.md"));
    assert.ok(skill.includes("`forgee`"), "the skill names forgee");
    for (const [f, s] of [["skills/publish/SKILL.md", skill], ["README.md", flat(read("README.md"))], ["SETUP.md", flat(read("SETUP.md"))]]) {
      assert.ok(!s.includes("`forge --version` prints `Forge <version>` for this tool") && !s.includes("`forgee --version`") && !/To tell[^.]*`forge --version`/.test(s), f + " has an agent run forge --version to learn the name");
      assert.ok(s.includes("The command's name"), f + " points to the reference's rule");
    }
    assert.ok(!skill.includes("forge --version"), "the skill never runs forge --version");
  });

  await check("the skill sends an agent to SETUP.md when forge is not installed or has no store, and says printed commands already use the right name", () => {
    const s = flat(read("skills/publish/SKILL.md"));
    assert.ok(s.includes("**Not installed, or no store?**"), s.slice(0, 600));
    assert.ok(s.includes("`SETUP.md`") && s.includes("no store at"), "names SETUP.md and the no-store stop");
    assert.ok(s.includes("forge's own messages print the name it was started as"), "printed commands are already right");
    assert.ok(!s.includes("every message the tool prints says `forge`"), "the old instruction to retype forge's messages is gone");
  });

  await check("no message or document uses one owner's vocabulary, and the skill carries no owner status field", () => {
    // Both words are spelled in pieces so this file does not carry them either.
    const ownerWords = new RegExp("bo" + "ard card|" + "sh" + "elf", "i");
    const hits = [];
    for (const f of ["bin/forge", "bin/install", ...fs.readdirSync(path.join(ENGINE, "lib")).filter((x) => x.endsWith(".js")).map((x) => "lib/" + x), "README.md", "SETUP.md", "AGENTS.md", "docs/reference.md", "docs/adding-a-host.md", "skills/publish/SKILL.md", "workspace-template/README.md", "workspace-template/schema.md"]) {
      read(f).split("\n").forEach((l, i) => { if (ownerWords.test(l)) hits.push(f + ":" + (i + 1) + ": " + l.trim()); });
    }
    assert.deepStrictEqual(hits, [], "found:\n" + hits.join("\n"));
    assert.ok(!/^status:/m.test(read("skills/publish/SKILL.md").split("---")[1]), "the skill's front matter has no status field");
  });

  await check("no file carries a build-review label (a letter and number, with or without a letter or number after it); messages say the reason instead", () => {
    const hits = [];
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!rel && ["workspace", ".git", "node_modules", ".tmp"].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        const r = rel ? rel + "/" + e.name : e.name;
        if (e.isDirectory()) walk(p, r);
        else if (e.isFile() && !/\.(gif|png)$/.test(e.name)) { // images are bytes, not text
          fs.readFileSync(p, "utf8").split("\n").forEach((l, i) => {
            if (/\b[CFNPRS][0-9]+(-[0-9]+)?[a-z]?\b/.test(l)) hits.push(r + ":" + (i + 1) + ": " + l.trim());
          });
        }
      }
    };
    walk(ENGINE, "");
    assert.deepStrictEqual(hits, [], "labels found:\n" + hits.join("\n"));
  });

  await check("SETUP never has an agent run forge --version to learn the name (another program may own it): the installer's line or bin/install --check says it", () => {
    const s = flat(read("SETUP.md"));
    assert.ok(!s.includes("forge --version") && !s.includes("forgee --version"), "SETUP runs --version");
    assert.ok(s.includes("`command: <name>`"), "names the line bin/install --check prints");
  });

  await check("SETUP step 6 branches on the installer's skipped: label, and the pasted paragraph names Forge's SKILL.md path when its skill was skipped", () => {
    const raw = read("SETUP.md");
    const s6 = flat(raw.slice(raw.indexOf("## 6. Make every agent use Forge")));
    assert.ok(s6.includes("`linked:`") && s6.includes("`skipped:`"), "step 6 reads both labels:\n" + s6.slice(0, 600));
    assert.ok(s6.includes("skills/publish/SKILL.md"), "names the skill file");
    assert.ok(s6.includes("Follow <skill> for everything else"), "the paragraph's skill is a filled-in value");
    assert.ok(!s6.includes("Follow the `publish` skill for everything else"), "never the bare name another tool's skill may answer to");
  });

  await check("SETUP step 5 in order: project, token, the token stored under a name and checked by length, then forge host, then share", () => {
    const s = flat(read("SETUP.md"));
    const order = ["## 5. Pick a host", "### Cloudflare Pages", "### Store the token under a name", "wc -c", "### Set the host", "forge host cloudflare-pages --project", "### Try sharing", "forge share hello"];
    let at = -1;
    for (const x of order) {
      const i = s.indexOf(x, at + 1);
      assert.ok(i > at, "SETUP.md step 5 out of order or missing: " + x);
      at = i;
    }
    for (const [name, kind] of [["FORGE_CLOUDFLARE_TOKEN", "cloudflare-pages"], ["FORGE_VERCEL_TOKEN", "vercel"], ["FORGE_NETLIFY_TOKEN", "netlify"]]) {
      assert.ok(read("lib/hosts/" + kind + ".js").includes('tokenName: "' + name + '"'), kind + " default token name");
      assert.ok(s.includes(name), "SETUP names " + name);
    }
  });

  await check("the reference's forge host row is two sentences and a pointer; the rest is its own section below the table", () => {
    const raw = read("docs/reference.md");
    const row = raw.split("\n").find((l) => l.startsWith("| `forge host "));
    const cell = row.split(" | ").slice(1).join(" | ").replace(/ \|$/, "");
    const sentences = cell.replace(/\(see [^)]*\)/g, "").split(/[.!?](?:\s|$)/).filter((x) => x.trim());
    assert.strictEqual(sentences.length, 2, "the row holds " + sentences.length + " sentences:\n" + cell);
    assert.ok(cell.includes("](#forge-host)"), "the row points to the section:\n" + cell);
    const parts = raw.split("\n### forge host\n");
    assert.strictEqual(parts.length, 2, "one ### forge host section");
    assert.ok(parts[0].lastIndexOf("| `forge host ") > parts[0].lastIndexOf("\n## "), "the section follows the command table");
    const sec = flat(parts[1].split(/\n## /)[0]);
    for (const x of ["--replace", "resolves to no secret", "host saved, not proven", "every public link moves to the new address", "Once replaced, about the host in use now", "which another machine set: a token problem"]) assert.ok(sec.includes(x), "the section lacks: " + x);
  });

  await check("no document says forge host prints a host's setup steps; the reference owns forge host's rules, --replace and the default token names", () => {
    for (const f of ["README.md", "SETUP.md", "docs/reference.md", "docs/adding-a-host.md", "skills/publish/SKILL.md"]) {
      assert.ok(!/prints that host's|host's (setup )?steps|setup steps/i.test(flat(read(f))), f);
    }
    const ref = flat(read("docs/reference.md"));
    for (const x of ["--replace", "every public link moves to the new address", "frozen versions keep the old address in their Markdown export", "the old address keeps serving what was deployed to it", "if forge deployed pages to that project, every page shared until then stays public there", "If that project is used for something else, forge's upload replaced what it served there: redeploy it from its own source", "FORGE_CLOUDFLARE_TOKEN", "resolves to no secret"]) assert.ok(ref.includes(x), "reference lacks: " + x);
  });

  await check("a config.json change committed by hand: SETUP, the store README and the skill each say to push it", () => {
    for (const f of ["SETUP.md", "workspace-template/README.md", "skills/publish/SKILL.md", "docs/reference.md"]) assert.ok(flat(read(f)).includes("git -C <store> push"), f + " lacks the push");
  });

  await check("README and SETUP say forge adds a dark-mode switch and Markdown buttons; SETUP renames and republishes and explains the master index line; FORGE_DEPLOY=0 is a testing switch in the reference only", () => {
    for (const f of ["README.md", "SETUP.md"]) {
      const s = flat(read(f));
      assert.ok(s.includes("dark-mode switch") && /Markdown (copy and download )?buttons/.test(s), f);
      assert.ok(!s.includes("FORGE_DEPLOY"), f + " mentions the testing switch");
    }
    const s = flat(read("SETUP.md"));
    assert.ok(s.includes("forge rename hello") && s.includes("published hello v2"), "a rename and republish step");
    assert.ok(s.includes("master index:"), "the master index line");
    assert.ok(/`FORGE_DEPLOY=0` is a testing switch/.test(flat(read("docs/reference.md"))), "the reference calls it a testing switch");
  });

  await check("AGENTS.md's frozen rule says what makes a new version (the source bytes), not that a stamp change versions every page; the reference's rename note matches the result lines", () => {
    const a = flat(read("AGENTS.md"));
    assert.ok(!a.includes("the next republish of every page becomes a new version"), "stale frozen wording");
    assert.ok(a.includes("source bytes"), a.slice(a.indexOf("Frozen"), a.indexOf("Frozen") + 500));
    const ref = flat(read("docs/reference.md"));
    assert.ok(!ref.includes("cannot be built from the final manifest"), "stale rename note");
    assert.ok(ref.includes("another machine has since renamed"), "the rename note names the line the result carries");
  });

  await check("setup wording: ids are not secrets; every machine needs the token; restart the agent when its own length check reads 0; an uncommitted edit refuses too; the setting file's XDG path; how to fix a host that was not confirmed", () => {
    const s = flat(read("SETUP.md"));
    for (const x of [
      "are ids, not secrets",
      "each machine that shares or deploys needs the token too",
      "restart the agent's session",
      "an uncommitted change to the store refuses too",
      "$XDG_CONFIG_HOME/forge/settings.json",
      "a wrong project or address: run the same forge host line with the right values and --replace",
      "a token problem: fix the token, then forge deploy",
      "if forge deployed pages to that project, every page shared until then stays public there",
      "If that project is used for something else, forge's upload replaced what it served there: redeploy it from its own source",
      "host saved, not proven",
      "a later deploy needs NAME in the environment again, or a secretCommand that answers NAME",
    ]) assert.ok(s.includes(x), "SETUP.md lacks: " + x);
    // The host section is short steps, not one long block.
    const hostSection = read("SETUP.md").split("### Set the host")[1].split("### Try sharing")[0];
    for (const step of ["The default name.", "A name of your own.", "Success.", "Not proven.", "Replacing a host."]) {
      assert.ok(new RegExp("^\\d+\\. \\*\\*" + step.replace(".", "\\.") + "\\*\\*", "m").test(hostSection), "SETUP's host section lacks the step: " + step);
    }
    // The old advice told the person to delete a project forge may still deploy to.
    for (const f of ["README.md", "SETUP.md", "docs/reference.md", "skills/publish/SKILL.md", "bin/forge"]) {
      assert.ok(!/until (its|that) project is (deleted|delete)/.test(flat(read(f))), f + " still says a project keeps serving until it is deleted");
    }
    const r = flat(read("README.md"));
    for (const n of ["FORGE_CLOUDFLARE_TOKEN", "FORGE_VERCEL_TOKEN", "FORGE_NETLIFY_TOKEN"]) assert.ok(r.includes(n), "README's host table lacks the default name " + n);
  });

  await check("exit 0 on a store with no host reads no link site: the reference and bin/forge's header say so", () => {
    assert.ok(flat(read("docs/reference.md")).includes("On a store with no host, exit 0 reads no link site"), "reference");
    assert.ok(flat(read("bin/forge")).includes("on a store with no host, 0 reads no link site"), "bin/forge header");
  });

  await check("versions: the CHANGELOG's sections and links, the reference's update row and releases section, SETUP's update step, AGENTS.md's release steps, USAGE's update line", () => {
    const c = read("CHANGELOG.md");
    for (const x of ["Semantic Versioning", "Keep a Changelog", "forge update", "\n## [Unreleased]\n", "\n[Unreleased]: https://github.com/rishmadaan/forge-artifacts/compare/"]) assert.ok(c.includes(x), "CHANGELOG lacks: " + x);
    for (const m of c.matchAll(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/gm)) {
      assert.ok(c.includes("\n[" + m[1] + "]: https://github.com/rishmadaan/forge-artifacts/releases/tag/v" + m[1] + "\n"), "CHANGELOG lacks the link for " + m[1]);
    }
    const ref = flat(read("docs/reference.md"));
    for (const x of ["| `forge update [--check]` |", "## Versions and releases", "Watch, then Custom, tick Releases", "`CHANGELOG.md`"]) assert.ok(ref.includes(x), "reference lacks: " + x);
    assert.ok(flat(read("SETUP.md")).includes("## 7. Later: updating Forge"), "SETUP's update step");
    const a = flat(read("AGENTS.md"));
    assert.ok(a.indexOf("## Releasing") >= 0 && a.indexOf("CHANGELOG.md", a.indexOf("## Releasing")) < a.indexOf("scripts/release.sh X.Y.Z"), "AGENTS.md: CHANGELOG first, then the release script");
    assert.match(spawnSync(process.execPath, [path.join(ENGINE, "bin", "forge"), "--help"], { encoding: "utf8" }).stdout, /^ {2}update \[--check\] /m, "USAGE lists update");
  });

  await check("exit codes: README, USAGE, the publish skill and the reference give them as the codes of the commands that write the store, and say forge update has its own", () => {
    const readme = flat(read("README.md"));
    assert.ok(readme.includes("Every command that writes the store ends with one exit code: 0 finished; 1 refused, nothing changed;"), "README scopes the codes");
    assert.ok(readme.includes("`forge update` changes Forge itself, not the store, and has its own exit codes (in the reference): its exit 1 does not always mean nothing changed."), "README: update's own codes");
    const help = flat(spawnSync(process.execPath, [path.join(ENGINE, "bin", "forge"), "--help"], { encoding: "utf8" }).stdout);
    assert.ok(help.includes("Exit codes of the commands that write the store: 0 finished; 1 refused, nothing changed;"), "USAGE scopes the codes");
    assert.ok(help.includes("update has its own exit codes (docs/reference.md): its exit 1 can come after this copy of Forge moved."), "USAGE: update's own codes");
    const skill = flat(read("skills/publish/SKILL.md"));
    assert.ok(skill.includes("Read the exit code first (these are the codes of the commands that write the store; `forge update` has its own, in the reference's update row, and its exit 1 can come after this copy of Forge moved):"), "the skill scopes the codes");
    const ref = flat(read("docs/reference.md"));
    assert.ok(ref.includes("These are the codes of the commands that write the store, and of `forge check`. `forge update` changes Forge itself and has its own codes, in its row of the command table."), "the reference scopes its table");
  });

  await check("earlier versions: README and the publish skill say sharing shares them, and how to keep one off before sharing", () => {
    assert.ok(flat(read("README.md")).includes("- **Earlier versions**: sharing a page shares its earlier versions too; its history page lists them for anyone with the link. To keep one off the link site, run `forge unshare <name> --version N` before sharing (it needs a host set; after sharing it takes the version down, but it was public until then), or publish a clean copy under a new `--name`."), "README's bullet");
    assert.ok(flat(read("skills/publish/SKILL.md")).includes("Before sharing a page with more than one version, tell the owner its earlier versions go public too, and offer to keep one off (`forge unshare <name> --version N` before sharing, which needs a host set; after sharing it takes the version down, but it was public until then) or to publish a clean copy under a new `--name`."), "the skill's share step");
  });

  await check("AGENTS.md is the single source, CLAUDE.md imports it, LICENSE is MIT", () => {
    assert.strictEqual(read("CLAUDE.md").trim(), "@AGENTS.md");
    assert.ok(read("AGENTS.md").includes("Forge"));
    const l = read("LICENSE");
    assert.ok(l.startsWith("MIT License") && l.includes("Permission is hereby granted, free of charge"));
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
