# Browser test for the dark switch the publisher stamps into every page
# (lib/pages.js injectDarkToggle). Dark mode inverts the whole page with a
# filter, so the computed colours never change: this test reads the rendered
# pixels instead, and requires light text on a dark background for a page with
# no author colours, a page with its own colours, a plain link and a form
# field, and for a page with no colours that declares it supports both schemes
# (by meta and by CSS), where the browser would pick its dark defaults. It uses only made-up pages, because the engine carries no owner data.
# Runnable: python3 test/dark-mode.test.py
# Needs Python Playwright. Runs in every browser Playwright has installed
# (Chromium, Firefox, WebKit) and prints a SKIPPED line for each one it cannot
# start. Serves pages from a temp dir on a port the OS picks, inside this
# process: nothing else to kill.
import functools
import http.server
import os
import pathlib
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import zlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]

STAMP_JS = """
const pages = require(process.argv[1] + "/lib/pages.js");
let src = ""; process.stdin.on("data", (c) => (src += c)).on("end", () => {
  process.stdout.write(pages.injectMarkdownExport(pages.injectDarkToggle(src), null));
});
"""

# No author colours at all: the browser's defaults decide the text, the link and
# the field.
PLAIN = """<!doctype html><html><head><meta charset="utf-8"><title>Plain</title></head><body>
<h1 id="h">Plain heading</h1>
<p id="p">A paragraph of plain text with no colour set by its author.</p>
<p id="a"><a href="#x">A plain link with no colour</a></p>
<p><input id="i" size="34" value="Typed text in a plain field"></p>
</body></html>"""

# The same plain page declaring it supports both schemes, once by meta and once
# by CSS: on a dark device the browser would pick its dark defaults (white
# text), which the inversion turns black on black.
DECLARED = {
    "meta": PLAIN.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="color-scheme" content="light dark">'),
    "css": PLAIN.replace("<title>Plain</title>", "<title>Plain</title><style>:root{color-scheme:light dark}</style>"),
}

# The author sets their own light colours, as most pages do.
AUTHORED = """<!doctype html><html><head><meta charset="utf-8"><title>Authored</title>
<style>body{background:#fbfaf7;color:#1d1d1f}</style></head><body>
<h1 id="h">Authored heading</h1>
<p id="p">A paragraph whose author set a dark text colour on a light page.</p>
</body></html>"""

# Taller than the window, so the window has a scrollbar.
LONG = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Long</title></head><body>" + "<p>A line of a long page.</p>" * 120 + "</body></html>"

passed = 0
failed = 0


def check(name, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print("  ok -", name)
    except AssertionError as e:
        failed += 1
        print("  not ok -", name)
        print("    " + str(e))


def stamp(html):
    """The page exactly as publish writes it: dark toggle, then the export block."""
    r = subprocess.run(["node", "-e", STAMP_JS, str(ROOT)], input=html, capture_output=True, text=True, check=True)
    return r.stdout


def png_pixels(data):
    """(width, height, rows of (r, g, b)) from an 8-bit RGB or RGBA PNG, the
    only kinds a browser screenshot is. Standard library only."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat, w = 8, b"", 0
    while pos < len(data):
        n, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
            assert depth == 8 and ctype in (2, 6) and interlace == 0, "unexpected PNG format"
            bpp = 4 if ctype == 6 else 3
        elif kind == b"IDAT":
            idat += body
        pos += 12 + n
    raw, stride, rows, prev = zlib.decompress(idat), w * bpp, [], bytearray(w * bpp)
    for y in range(h):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b, c = prev[x], prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append([tuple(line[i:i + 3]) for i in range(0, stride, bpp)])
        prev = line
    return w, h, rows


def luminance(rgb):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def text_on_background(page, selector, min_ratio):
    """Screenshot the element as rendered (the filter included). Most of a text
    box is background, so the median pixel is the background; the text is the
    pixels furthest from it. Requires a dark background, text lighter than it,
    and their contrast at least min_ratio."""
    box = page.locator(selector).bounding_box()
    shot = page.screenshot(clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": box["height"]})
    _, _, rows = png_pixels(shot)
    lum = sorted(luminance(px) for row in rows for px in row)
    bg = lum[len(lum) // 2]
    text = lum[-max(1, len(lum) // 200)]  # the brightest half percent: the text's cores
    ratio = (text + 0.05) / (bg + 0.05)
    where = "%s: background luminance %.3f, text luminance %.3f, contrast %.1f:1" % (selector, bg, text, ratio)
    assert bg < 0.05, "the background is not dark; " + where
    assert ratio >= min_ratio, "the text is not light on the dark background; " + where


def dark_strip(page, width):
    """The scrollbar is the strip at the window's right edge. Its track and its
    thumb must both be dark."""
    view = page.viewport_size
    shot = page.screenshot(clip={"x": view["width"] - width, "y": 0, "width": width, "height": view["height"]})
    _, _, rows = png_pixels(shot)
    lum = sorted(luminance(px) for row in rows for px in row)
    where = "track luminance %.3f, brightest %.3f" % (lum[len(lum) // 2], lum[-1])
    assert lum[len(lum) // 2] < 0.05 and lum[-1] < 0.5, "the scrollbar is not dark; " + where


def run_browser(kind, browser, base):
    # The reader's device is in dark mode, and nothing is remembered: the page
    # turns dark by itself, as for most readers.
    ctx = browser.new_context(color_scheme="dark", viewport={"width": 900, "height": 700})
    page = ctx.new_page()
    page.goto(base + "/plain.html")
    page.wait_for_function("document.documentElement.classList.contains('forge-dark')")
    check(kind + ": a page with no author colours shows light text on a dark page (heading and paragraph)",
          lambda: (text_on_background(page, "#h", 7), text_on_background(page, "#p", 7)))
    check(kind + ": a plain link with no colour is light on the dark page", lambda: text_on_background(page, "#a a", 7))
    check(kind + ": a plain form field is dark with light text", lambda: text_on_background(page, "#i", 4.5))
    for how in DECLARED:
        page.goto(base + "/declared-%s.html" % how)
        page.wait_for_function("document.documentElement.classList.contains('forge-dark')")
        check(kind + ": a page with no colours that declares light dark (by %s) shows light text, link and field on a dark page" % how,
              lambda: (text_on_background(page, "#h", 7), text_on_background(page, "#p", 7),
                       text_on_background(page, "#a a", 7), text_on_background(page, "#i", 4.5)))
    page.goto(base + "/authored.html")
    page.wait_for_function("document.documentElement.classList.contains('forge-dark')")
    check(kind + ": a page with its own colours shows light text on a dark page",
          lambda: (text_on_background(page, "#h", 7), text_on_background(page, "#p", 7)))
    if kind == "webkit":
        print("SKIPPED webkit: the scrollbar check (WebKit has no scrollbar-color; a light scrollbar there is accepted)")
    else:
        page.goto(base + "/long.html")
        page.wait_for_function("document.documentElement.classList.contains('forge-dark')")
        width = page.evaluate("window.innerWidth - document.documentElement.clientWidth")
        if width == 0:
            print("SKIPPED %s: the scrollbar check (this browser draws overlay scrollbars here)" % kind)
        else:
            check(kind + ": the window's scrollbar stays dark (drawn outside the page filter)", lambda: dark_strip(page, width))
    if os.environ.get("FORGE_DARK_SHOTS"):
        # For a person to look at: the plain pages as a dark-mode reader sees them.
        for name in ["plain"] + ["declared-" + how for how in DECLARED]:
            page.goto(base + "/%s.html" % name)
            page.wait_for_function("document.documentElement.classList.contains('forge-dark')")
            page.screenshot(path=os.path.join(os.environ["FORGE_DARK_SHOTS"], "%s-dark-%s.png" % (name, kind)))
    ctx.close()


def own_environment(tmp):
    """A HOME, caches and temp folder this test owns, like the Node tests. Only
    the installed browser binaries are read from where Playwright put them,
    located before HOME changes."""
    real_home = pathlib.Path.home()
    default = real_home / ("Library/Caches/ms-playwright" if sys.platform == "darwin" else ".cache/ms-playwright")
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or str(default)
    for name, sub in (("HOME", "home"), ("XDG_CACHE_HOME", "cache"), ("XDG_CONFIG_HOME", "config"), ("TMPDIR", "tmp")):
        (tmp / sub).mkdir()
        os.environ[name] = str(tmp / sub)
    tempfile.tempdir = None  # re-read TMPDIR


def main():
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="forge-test-dark-"))
    try:
        own_environment(tmp)
        (tmp / "plain.html").write_text(stamp(PLAIN), encoding="utf-8")
        (tmp / "authored.html").write_text(stamp(AUTHORED), encoding="utf-8")
        for how, html in DECLARED.items():
            (tmp / ("declared-%s.html" % how)).write_text(stamp(html), encoding="utf-8")
        (tmp / "long.html").write_text(stamp(LONG), encoding="utf-8")

        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *a):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(tmp)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = "http://127.0.0.1:%d" % server.server_address[1]
        ran = []
        try:
            with sync_playwright() as p:
                for kind in ("chromium", "firefox", "webkit"):
                    try:
                        # Chromium hides scrollbars when headless unless told not to.
                        browser = getattr(p, kind).launch(**({"ignore_default_args": ["--hide-scrollbars"]} if kind == "chromium" else {}))
                    except Exception as e:
                        print("SKIPPED %s: it does not start (%s)" % (kind, str(e).strip().splitlines()[0][:120]))
                        continue
                    ran.append(kind)
                    try:
                        run_browser(kind, browser, base)
                    finally:
                        browser.close()
        finally:
            server.shutdown()
        print("browsers run: " + (", ".join(ran) or "none"))
        if not ran:
            print("SKIPPED dark-mode.test.py: no browser could start")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("%d checks passed, %d failed" % (passed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
