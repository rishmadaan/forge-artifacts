# Browser test for the "Copy as Markdown" / "Download .md" block the publisher
# stamps into every page (lib/pages.js injectMarkdownExport). It uses only
# made-up pages, because the engine carries no owner data.
# Runnable: python3 test/publish-md-export.test.py
# Needs Python Playwright with Chromium. Serves pages from a temp dir on a
# port the OS picks (port 0), inside this process: nothing else to kill.
import functools
import http.server
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]

STAMP_JS = """
const pages = require(process.argv[1] + "/lib/pages.js");
const meta = JSON.parse(process.argv[2]);
let src = ""; process.stdin.on("data", (c) => (src += c)).on("end", () => {
  process.stdout.write(pages.injectMarkdownExport(pages.injectDarkToggle(src), meta));
});
"""


def stamp(html, meta):
    """The page exactly as publish writes it: dark toggle, then the export block."""
    r = subprocess.run(["node", "-e", STAMP_JS, str(ROOT), json.dumps(meta)],
                       input=html, capture_output=True, text=True, check=True)
    return r.stdout


FIXTURE = """<!doctype html><html><head><meta charset="utf-8"><title>Fixture | Export</title></head><body>
<header><p>Banner outside main, kept.</p></header>
<main>
<nav><a href="/x">Nav link</a></nav>
<h1>Main title</h1>
<p>Intro with <strong>bold</strong>, <em>em</em>, a <a href="/docs/page?q=1">relative link</a>, a <a href="#sec">same-page link</a> and <code>a`b</code>.<span aria-hidden="true">HIDDEN</span><script>var x = 1;</script><input value="field"></p>
<p>1. not a list, and a line<br>break.</p>
<ul><li>Alpha<ul><li>Nested one</li><li>Nested two</li></ul></li><li>Beta</li></ul>
<ol start="3"><li>Third</li><li>Fourth</li></ol>
<table><tr><th>Name</th><th>Value</th></tr><tr><td>Pipe</td><td>a | b</td></tr><tr><td colspan="2">Wide</td></tr><tr><td><span style="display:none">Label</span>Mobile</td><td aria-hidden="true">gone</td></tr></table>
<pre>line one
  indented `tick`

last</pre>
<details><summary>More</summary><p>Hidden body text.</p></details>
<div class="tabs"><section>Visible tab.</section><section style="display:none">Inactive tab panel.</section><section hidden>Hidden attribute panel.</section></div>
<svg aria-label="Funnel: 99 to 7" viewBox="0 0 10 10"><rect width="1" height="1"/><text>99</text></svg>
<svg viewBox="0 0 10 10"><text>a</text><text>b</text><text>c</text></svg>
<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>
<p>Count: <button class="dd" type="button">99</button> <button type="button" aria-label="Close">x</button></p>
<blockquote><p>Quoted line.</p></blockquote>
<dl><dt>Term</dt><dd>Definition.</dd></dl>
<hr>
<footer><p style="margin:0">Footer note, GST excluded.</p></footer>
</main>
</body></html>"""

FIXTURE_META = {"title": "Fixture | Export", "version": 7, "date": "2026-10-14",
                "url": "https://pub.example/d/abc123/v7/", "slug": "abc123"}

FIXTURE_BODY = """Banner outside main, kept.

# Main title

Intro with **bold**, *em*, a [relative link]({base}/docs/page?q=1), a same-page link and ``a`b``.

1\\. not a list, and a line\\
break.

- Alpha
  - Nested one
  - Nested two
- Beta

3. Third
4. Fourth

| Name | Value |
|---|---|
| Pipe | a \\| b |
| Wide | |
| Mobile | |

```
line one
  indented `tick`

last
```

**More**

Hidden body text.

Visible tab.

**Chart:** Funnel: 99 to 7

*Diagram (no text description), view it on the page: https://pub.example/d/abc123/v7/*

Count: 99

> Quoted line.

**Term**

Definition.

---

Footer note, GST excluded.
"""

HEADER = "> Source: Fixture | Export\n> Version 7, published 2026-10-14\n> https://pub.example/d/abc123/v7/\n\n"

passed = 0


def ok(name):
    global passed
    passed += 1
    print("  ok -", name)


def click_status(page, sel):
    """Click, then return the status message that click produced (never a stale one)."""
    page.evaluate("document.querySelector('.forge-md-status').textContent = ''")
    page.click(sel)
    page.wait_for_function("document.querySelector('.forge-md-status').textContent.length > 0")
    return page.text_content(".forge-md-status")


def download(page):
    with page.expect_download() as info:
        page.click("[data-md-download]")
    d = info.value
    return d.suggested_filename, pathlib.Path(d.path()).read_text(encoding="utf-8")


def own_environment(tmp):
    """Run with a HOME, caches and temp folder this test owns, like the Node
    tests: the browser's profile and caches land in tmp, never in the real
    home folder. Only the installed browser binaries are read from where
    Playwright put them, located before HOME changes."""
    real_home = pathlib.Path.home()
    default = real_home / ("Library/Caches/ms-playwright" if sys.platform == "darwin" else ".cache/ms-playwright")
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or str(default)
    for name, sub in (("HOME", "home"), ("XDG_CACHE_HOME", "cache"), ("XDG_CONFIG_HOME", "config"), ("TMPDIR", "tmp")):
        (tmp / sub).mkdir()
        os.environ[name] = str(tmp / sub)
    tempfile.tempdir = None  # re-read TMPDIR


def main():
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="forge-test-md-export-"))
    try:
        own_environment(tmp)
        run(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run(tmp):
    (tmp / "fixture.html").write_text(stamp(FIXTURE, FIXTURE_META), encoding="utf-8")

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    handler = functools.partial(Quiet, directory=str(tmp))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_address[1]
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            made = [x.name for x in (tmp / "tmp").iterdir()]
            assert any(n.startswith("playwright") for n in made), "the browser profile is not in the test's own temp folder: %r" % made
            ok("the browser runs with a profile in the test's own temp folder (test-owned HOME and caches)")
            ctx = browser.new_context(accept_downloads=True)
            ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
            page = ctx.new_page()

            # (b) + (d): exact Markdown for the fixture, header block first.
            page.goto(base + "/fixture.html")
            name, text = download(page)
            assert name == "abc123-v7.md", name
            assert page.text_content(".forge-md-status") == "Download started: abc123-v7.md."
            assert text.startswith(HEADER), text[:200]
            ok("(d) header block: source title, version and date, frozen URL")
            want = FIXTURE_BODY.format(base=base)
            got = text[len(HEADER):]
            assert got == want, "fixture Markdown differs:\n--- got ---\n" + got + "\n--- want ---\n" + want
            ok("(b) fixture converts to the exact expected Markdown (whole body; hidden panels and labels skipped; collapsed details kept)")
            assert "Copy as Markdown" not in text and "Download .md" not in text and "Dark" not in text and "\u263e" not in text
            ok("(b) the export toolbar and dark toggle are not in the export")

            # (c) Copy puts the same text on the clipboard; a blocked copy says so.
            assert click_status(page, "[data-md-copy]") == "Copied as Markdown."
            clip = page.evaluate("navigator.clipboard.readText()")
            assert clip == text, "clipboard differs from the download"
            ok("(c) Copy writes exactly the Download text to the clipboard")
            page.evaluate("""() => {
                navigator.clipboard.writeText = () => Promise.reject(new Error('blocked'));
                document.execCommand = () => false;
            }""")
            msg = click_status(page, "[data-md-copy]")
            assert msg == "Copy was blocked. Use Download instead.", msg
            ok("(c) a blocked copy says so and never claims success")

            # The pills sit above the dark toggle and do not overlap it, and at the
            # end of the page they never cover the last line, down to 320px phones.
            for width in (1280, 390, 320):
                page.set_viewport_size({"width": width, "height": 640})
                page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
                t = page.locator("#forge-dark-toggle").bounding_box()
                last = page.locator("main footer p").bounding_box()
                for sel in ("[data-md-copy]", "[data-md-download]"):
                    b = page.locator(sel).bounding_box()
                    assert b["y"] + b["height"] <= t["y"], (width, sel, b, t)
                    assert b["x"] >= 0 and b["x"] + b["width"] <= width, (width, sel, b)
                    assert last["y"] + last["height"] <= b["y"], ("last line covered", width, sel, last, b)
            ok("toolbar clears the dark toggle, fits, and leaves the last line clear at 1280, 390 and 320 px")

            browser.close()
    finally:
        server.shutdown()
    print("%d checks passed" % passed)


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print("FAIL:", e)
        sys.exit(1)
