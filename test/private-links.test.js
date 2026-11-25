// Runnable test: node test/private-links.test.js
// Private links without a dashboard: with no privateBaseUrl in config.json the
// private link is the page's file URL in this machine's copy of the store
// (private/ for a private page, public/ for a shared one), and forge open
// <name> opens it in the default browser. A fake xdg-open (and open) first on
// PATH stands in for the browser, recording what it was asked to open.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { check, done, run, tmp, makeStore, makeSrc, manifest, CONFIG } = require("./helpers.js");

const NO_SHELF = { ...CONFIG };
delete NO_SHELF.privateBaseUrl;

// A fake opener: records its argument, exits with the code in <dir>/code (0 by default).
function fakeOpener() {
  const dir = tmp("opener");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const script = "#!/bin/sh\nprintf '%s\\n' \"$1\" >> '" + dir + "/opened'\nexit $(cat '" + dir + "/code' 2>/dev/null || echo 0)\n";
  for (const n of ["xdg-open", "open"]) fs.writeFileSync(path.join(bin, n), script, { mode: 0o755 });
  return {
    env: { PATH: bin + path.delimiter + process.env.PATH },
    opened: () => (fs.existsSync(path.join(dir, "opened")) ? fs.readFileSync(path.join(dir, "opened"), "utf8").trim().split("\n") : []),
    fail: (code) => fs.writeFileSync(path.join(dir, "code"), String(code)),
  };
}
const fileUrl = (store, tree, slug) => pathToFileURL(path.join(store, tree, "d", slug, "index.html")).href;
const privLine = (r) => (r.out.match(/^private: (.*)$/m) || [])[1];

(async () => {
  await check("no privateBaseUrl: the store loads, and every private: line is the page's file URL in its own tree", () => {
    const store = makeStore(NO_SHELF);
    const src = makeSrc();
    let r = run(store, ["publish", src.page("plan.html", "Plan", "p")]);
    assert.strictEqual(r.status, 0, r.all);
    const slug = manifest(store).deliverables.plan.slug;
    assert.strictEqual(privLine(r), fileUrl(store, "private", slug), r.out);
    assert.ok(fs.existsSync(path.join(store, "private", "d", slug, "index.html")), "the link points at a real file");
    r = run(store, ["share", "plan"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(privLine(r), fileUrl(store, "public", slug), r.out);
    assert.ok(fs.existsSync(path.join(store, "public", "d", slug, "index.html")));
    r = run(store, ["list", "--json"]);
    const j = JSON.parse(r.out);
    assert.strictEqual(j.privateBaseUrl, null);
    assert.strictEqual(j.documents[0].privateUrl, fileUrl(store, "public", slug));
    r = run(store, ["list"]);
    assert.ok(r.out.includes("  private: " + fileUrl(store, "public", slug)), r.out);
    r = run(store, ["unshare", "plan"]);
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(privLine(r), fileUrl(store, "private", slug), r.out);
    r = run(store, ["rename", "plan", "plan2"]);
    assert.strictEqual(privLine(r), fileUrl(store, "private", slug), r.out);
  });

  await check("a set privateBaseUrl keeps its links; a bad one is still refused", () => {
    const store = makeStore();
    const src = makeSrc();
    const r = run(store, ["publish", src.page("plan.html", "Plan", "p")]);
    assert.strictEqual(privLine(r), CONFIG.privateBaseUrl + "/d/" + manifest(store).deliverables.plan.slug + "/");
    const bad = makeStore();
    fs.writeFileSync(path.join(bad, "config.json"), JSON.stringify({ ...CONFIG, privateBaseUrl: "not a url" }));
    const b = run(bad, ["list"]);
    assert.strictEqual(b.status, 1, b.all);
    assert.match(b.err, /privateBaseUrl/);
  });

  await check("forge open <name> opens the private link in the default browser and prints it; an unknown name or a failed opener is exit 1", () => {
    const op = fakeOpener();
    const store = makeStore(NO_SHELF);
    const src = makeSrc();
    assert.strictEqual(run(store, ["publish", src.page("plan.html", "Plan", "p")]).status, 0);
    const slug = manifest(store).deliverables.plan.slug;
    let r = run(store, ["open", "plan"], { env: op.env });
    assert.strictEqual(r.status, 0, r.all);
    assert.strictEqual(privLine(r), fileUrl(store, "private", slug), r.out);
    assert.deepStrictEqual(op.opened(), [fileUrl(store, "private", slug)]);
    r = run(store, ["open", "nope"], { env: op.env });
    assert.strictEqual(r.status, 1, r.all);
    assert.match(r.err, /unknown document: nope/);
    assert.strictEqual(op.opened().length, 1, "nothing opened for an unknown name");
    op.fail(4);
    r = run(store, ["open", "plan"], { env: op.env });
    assert.strictEqual(r.status, 1, r.all);
    assert.ok(privLine(r), "the link is still printed, to open by hand");
    assert.match(r.err, /could not open/);
    r = run(store, ["open", "plan"], { env: { ...op.env, PATH: "/nonexistent" } });
    assert.strictEqual(r.status, 1, "no opener at all: " + r.all);
    assert.match(r.err, /could not open a browser \((xdg-)?open: ENOENT\)/);
  });

  await check("forge open with an opener still running after 5 s: exit 0, and stderr says it is not known whether a browser opened", () => {
    const store = makeStore();
    const src = makeSrc();
    assert.strictEqual(run(store, ["publish", src.page("plan.html", "Plan", "p")]).status, 0);
    const bin = tmp("slowopener");
    for (const n of ["xdg-open", "open"]) fs.writeFileSync(path.join(bin, n), "#!/bin/sh\nsleep 8\n", { mode: 0o755 });
    const r = run(store, ["open", "plan"], { env: { PATH: bin + path.delimiter + process.env.PATH } });
    assert.strictEqual(r.status, 0, r.all);
    assert.ok(privLine(r), r.all);
    assert.match(r.err, /still running after 5 s, so it is not known whether a browser opened; if none did, open the link above by hand/);
  });

  await check("forge open with a privateBaseUrl opens that address", () => {
    const op = fakeOpener();
    const store = makeStore();
    const src = makeSrc();
    assert.strictEqual(run(store, ["publish", src.page("plan.html", "Plan", "p")]).status, 0);
    const r = run(store, ["open", "plan"], { env: op.env });
    assert.strictEqual(r.status, 0, r.all);
    assert.deepStrictEqual(op.opened(), [CONFIG.privateBaseUrl + "/d/" + manifest(store).deliverables.plan.slug + "/"]);
  });

  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
