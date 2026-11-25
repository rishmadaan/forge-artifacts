// Runnable test: node test/manifests.test.js
// The store listings: gemini-extension.json, and the Claude Code plugin and
// marketplace files when present. A manifest that carries a version says
// bin/forge's VERSION (scripts/release.sh sets both in the Release commit);
// the Claude files carry none, so a plugin update follows the git commit.
// Nothing at the root loads into an agent's session or runs that the
// listings do not mean to bring: the publish skill only.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, done, ENGINE } = require("./helpers.js");

const NAME = "forge-artifacts";
const at = (f) => path.join(ENGINE, f);
const json = (f) => JSON.parse(fs.readFileSync(at(f), "utf8"));
const VERSION = /^const VERSION = "(\d+\.\d+\.\d+)";$/m.exec(fs.readFileSync(at("bin/forge"), "utf8"))[1];

(async () => {
  await check("gemini-extension.json: the repository's name, bin/forge's VERSION on its one version line, a description, and no context file", () => {
    const g = json("gemini-extension.json");
    assert.strictEqual(g.name, NAME);
    assert.strictEqual(g.version, VERSION, "gemini-extension.json says " + g.version + ", bin/forge says " + VERSION);
    assert.ok(typeof g.description === "string" && g.description.length > 20);
    assert.strictEqual(g.contextFileName, undefined, "no file is loaded into every Gemini session");
    // scripts/release.sh edits this exact line shape.
    const lines = fs.readFileSync(at("gemini-extension.json"), "utf8").split("\n").filter((l) => /"version"/.test(l));
    assert.deepStrictEqual(lines.map((l) => /^ {2}"version": "\d+\.\d+\.\d+",?$/.test(l)), [true], "one top-level version line:\n" + lines.join("\n"));
  });

  await check("the Claude Code plugin and marketplace files, when present: the repository's name, one entry with the same name, and no version anywhere", () => {
    const dir = at(".claude-plugin");
    if (!fs.existsSync(dir)) return;
    const plugin = fs.existsSync(path.join(dir, "plugin.json")) ? json(".claude-plugin/plugin.json") : null;
    const market = json(".claude-plugin/marketplace.json");
    assert.strictEqual(market.name, NAME);
    assert.strictEqual(market.plugins.length, 1);
    assert.strictEqual(market.plugins[0].name, NAME);
    if (plugin) assert.strictEqual(plugin.name, NAME);
    for (const [f, o] of [["plugin.json", plugin], ["marketplace.json", market], ["the marketplace entry", market.plugins[0]]]) {
      assert.ok(!o || (o.version === undefined && (o.metadata || {}).version === undefined), f + " carries a version, so updates would stop following the commit");
    }
  });

  await check("no root file or folder that a store install would load or run beyond the skill: no GEMINI.md, hooks, MCP or LSP servers, commands, agents, policies, monitors", () => {
    const found = ["GEMINI.md", "hooks", ".mcp.json", ".lsp.json", "commands", "agents", "policies", "monitors", "output-styles", "themes", "workflows"].filter((f) => fs.existsSync(at(f)));
    assert.deepStrictEqual(found, []);
    assert.ok(fs.existsSync(at("skills/publish/SKILL.md")), "the skill the listings bring");
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
