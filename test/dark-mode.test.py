# Browser test for the dark switch the publisher stamps into every page
# (lib/pages.js injectDarkToggle). Dark mode inverts the whole page with a
# filter, so the computed colours never change: this test reads the rendered
# pixels instead. Every page runs twice: on a dark device (the page turns dark
# by itself) and on a light device with the switch pressed. The bar: a page
# with no author colours, its plain link and its form field read light on
# dark; no kind of page reads worse than it did in 0.1.1 (some read
# dark on light with dark mode on, as they always did, and that is what is
# asserted for them); frames and images keep the look they had; and the stamp
# forces no colour scheme on the page. It uses only made-up pages, because
# the engine carries no owner data.
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

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

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


def head(extra):
    """The plain page with extra markup in its head."""
    return PLAIN.replace("<title>Plain</title>", "<title>Plain</title>" + extra)


# The plain page declaring it supports both schemes, once by meta and once by
# CSS. On a dark device the browser picks its dark defaults (white text), which
# the inversion turns black on black: the known limit, unchanged from
# 0.1.1, so that state is not asserted. With the switch pressed on a light
# device it reads light on dark.
DECLARED = {
    "meta": head('<meta name="color-scheme" content="light dark">'),
    "css": head("<style>:root{color-scheme:light dark}</style>"),
}

PAGES = {
    "plain": PLAIN,
    # The author sets their own light colours, as most pages do.
    "authored": head("<style>body{background:#fbfaf7;color:#1d1d1f}</style>"),
    # Dark-only by its own CSS, with system text colour on an author background:
    # it gets the switch, and the inversion turns it dark on light, as before.
    # A forced light scheme would make CanvasText black on #111.
    "dark-css": head("<style>:root{color-scheme:dark}body{background:#111;color:CanvasText}</style>"),
    # The same, after another rule: a page is never judged by its CSS text.
    "dark-css-after-rule": head("<style>html{font-size:100%}:root{color-scheme:dark}body{background:#111;color:CanvasText}</style>"),
    # Declares light dark and pairs system text with its own dark background in
    # its dark-device styles (by CSS), or sets only that background (by meta).
    # On a dark device it reads dark on light, as before; on a light device it
    # reads light on dark.
    "pairs-css": head("<style>:root{color-scheme:light dark}@media (prefers-color-scheme:dark){body{background:#111;color:CanvasText}}</style>"),
    "pairs-meta": head('<meta name="color-scheme" content="light dark"><style>@media (prefers-color-scheme:dark){body{background:#111}}</style>'),
    # Adaptive colours of its own that also set color-scheme:dark on a dark
    # device: dark on light there, light on dark on a light device, as before.
    "adaptive": head("<style>:root{--bg:#fff;--fg:#1a1a1a}@media (prefers-color-scheme: dark){:root{color-scheme:dark;--bg:#14161a;--fg:#e8e8e8}}"
                     "body{background:var(--bg);color:var(--fg)}a{color:inherit}</style>"),
    # Declares light dark and sets only its text colour.
    "text-colour-only": head('<meta name="color-scheme" content="light dark"><style>body{color:#333}a{color:#0645ad}</style>'),
    # A transparent image with black lettering whose author asks for the light
    # scheme on it: the author's scheme must win over the stamp's.
    "image-author-light": head("<style>img{color-scheme:light;background:light-dark(white,black)}</style>").replace(
        '<p><input id="i" size="34" value="Typed text in a plain field"></p>',
        "<img id=\"m\" src=\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='420' height='70'>"
        "<text x='10' y='48' font-size='40' font-family='sans-serif' fill='black'>IMAGE LETTERING</text></svg>\">"),
    # A field whose text has its background's colour: the field check must fail
    # on it, or a field's border could pass for its text.
    "hidden-field": PLAIN.replace('<input id="i"', '<input id="i" style="color:#fff;background:#fff"'),
    # Taller than the window, so the window has a scrollbar.
    "long": "<!doctype html><html><head><meta charset=\"utf-8\"><title>Long</title></head><body>" + "<p>A line of a long page.</p>" * 120 + "</body></html>",
}
for how, html in DECLARED.items():
    PAGES["declared-" + how] = html


# Frames are re-inverted, so they show as authored. A frame whose page sets no
# background must read as a light box with dark text, as it always has; a
# frame whose page styles itself for a dark device must be asked for dark and
# get those styles. Chromium (156) does not pass the frame element's scheme on
# to the frame's prefers-color-scheme (it follows the device), so there the
# second check holds either way on a dark device, and on a light device the
# frame shows its light styles; the check guards browsers that do (the
# standard says a frame follows its embedding element's scheme).
def framed(inner):
    return ("<!doctype html><html><head><meta charset=\"utf-8\"><title>Framed</title></head><body>"
            "<h1>Outer heading</h1><iframe id=\"f\" style=\"width:640px;height:200px\" srcdoc=\"%s\"></iframe></body></html>"
            % inner.replace("&", "&amp;").replace('"', "&quot;"))


PAGES["framed-plain"] = framed('<h1 id="h">Inner heading</h1><p id="p">A paragraph inside a frame whose page sets no colours.</p>')
PAGES["framed-prefers-dark"] = framed('<style>body{background:#fff;color:#111}@media (prefers-color-scheme: dark){body{background:#111;color:#eee}}</style>'
                                      '<h1 id="h">Inner heading</h1><p id="p">A paragraph inside a frame whose page has its own dark styles.</p>')

# (name, the device's scheme, press the switch?). Nothing is remembered between
# pages: each page loads as a first visit.
STATES = [("dark device", "dark", False), ("light device, switch pressed", "light", True)]

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


def text_on_background(page, selector, min_ratio, dark=True, frame=None, inside=False):
    """Screenshot the element as rendered (the filter included). Most of a text
    box is background, so the median pixel is the background; the text is the
    pixels furthest from it. With dark, requires a dark background, text
    lighter than it, and their contrast at least min_ratio; with dark=False, a
    light background and darker text; with dark=None, either. frame: the
    selector of the iframe the element is in. inside: measure only the content
    box, inside the border and padding, so a field's border cannot pass for its
    text."""
    loc = page.frame_locator(frame).locator(selector) if frame else page.locator(selector)
    box = loc.bounding_box()
    if inside:
        edge = loc.evaluate("""e => { const c = getComputedStyle(e), n = (k) => parseFloat(c[k]) || 0;
            return [n("borderLeftWidth") + n("paddingLeft"), n("borderTopWidth") + n("paddingTop"),
                    n("borderRightWidth") + n("paddingRight"), n("borderBottomWidth") + n("paddingBottom")]; }""")
        box = {"x": box["x"] + edge[0], "y": box["y"] + edge[1],
               "width": box["width"] - edge[0] - edge[2], "height": box["height"] - edge[1] - edge[3]}
    shot = page.screenshot(clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": box["height"]})
    _, _, rows = png_pixels(shot)
    lum = sorted(luminance(px) for row in rows for px in row)
    bg = lum[len(lum) // 2]
    if dark is None:
        dark = bg < 0.18
    n = max(1, len(lum) // 200)  # the half percent furthest from the background: the text's cores
    text = lum[-n] if dark else lum[n - 1]
    ratio = (max(text, bg) + 0.05) / (min(text, bg) + 0.05)
    where = "%s%s: background luminance %.3f, text luminance %.3f, contrast %.1f:1" % (frame + " " if frame else "", selector, bg, text, ratio)
    if dark:
        assert bg < 0.05, "the background is not dark; " + where
        assert text > bg and ratio >= min_ratio, "the text is not light on the dark background; " + where
    else:
        assert bg > 0.5, "the background is not light; " + where
        assert text < bg and ratio >= min_ratio, "the text is not dark on the light background; " + where


def light_on_dark(page, ratio=7):
    text_on_background(page, "#h", ratio)
    text_on_background(page, "#p", ratio)


def dark_on_light(page, ratio=7):
    text_on_background(page, "#h", ratio, dark=False)
    text_on_background(page, "#p", ratio, dark=False)


def fails(fn):
    try:
        fn()
    except AssertionError:
        return
    raise AssertionError("the check passed on a field with no visible text")


def schemes(page):
    return page.evaluate("[getComputedStyle(document.documentElement).colorScheme, getComputedStyle(document.body).colorScheme]")


def same_scheme(page):
    """The computed color-scheme of html and body with dark mode on equals the
    value with it off: the stamp forces no colour scheme on the page."""
    on = schemes(page)
    page.evaluate("document.documentElement.classList.remove('forge-dark')")
    off = schemes(page)
    page.evaluate("document.documentElement.classList.add('forge-dark')")
    assert on == off, "html and body compute color-scheme %s with dark mode on, %s with it off" % (on, off)


def dark_strip(page, width):
    """The scrollbar is the strip at the window's right edge. Its track and its
    thumb must both be dark."""
    view = page.viewport_size
    shot = page.screenshot(clip={"x": view["width"] - width, "y": 0, "width": width, "height": view["height"]})
    _, _, rows = png_pixels(shot)
    lum = sorted(luminance(px) for row in rows for px in row)
    where = "track luminance %.3f, brightest %.3f" % (lum[len(lum) // 2], lum[-1])
    assert lum[len(lum) // 2] < 0.05 and lum[-1] < 0.5, "the scrollbar is not dark; " + where


def run_state(kind, browser, base, state, scheme, press):
    ctx = browser.new_context(color_scheme=scheme, viewport={"width": 900, "height": 700})
    # Each page loads as a first visit: a press is remembered per browser.
    ctx.add_init_script("try{localStorage.clear()}catch(e){}")
    page = ctx.new_page()

    def show(name):
        """Open a page, check it got the switch, press it if this state does,
        and wait for dark mode to be on."""
        page.goto(base + "/%s.html" % name)
        assert page.locator("#forge-dark-toggle").count() == 1, "the page got no dark switch"
        if press:
            page.locator("#forge-dark-toggle").click()
        try:
            page.wait_for_function("document.documentElement.classList.contains('forge-dark')", timeout=5000)
            if name.startswith("framed-"):
                page.frame_locator("#f").locator("#p").wait_for(timeout=5000)
        except PlaywrightTimeout:
            raise AssertionError("dark mode did not turn on")

    def on(name, fn):
        return lambda: (show(name), fn())

    dark_device = not press
    k = "%s, %s: " % (kind, state)
    check(k + "a page with no author colours shows light text on a dark page (heading and paragraph)", on("plain", lambda: light_on_dark(page)))
    check(k + "a plain link with no colour is light on the dark page", on("plain", lambda: text_on_background(page, "#a a", 7)))
    check(k + "a plain form field is dark with light text", on("plain", lambda: text_on_background(page, "#i", 4.5, inside=True)))
    for how in ("css", "meta"):
        if dark_device:
            check(k + "a page declaring light dark whose dark styles pair system text with its own dark background (by %s) reads dark on light, as before" % how,
                  on("pairs-" + how, lambda: dark_on_light(page)))
        else:
            check(k + "a page declaring light dark whose dark styles pair system text with its own dark background (by %s) reads light on dark" % how,
                  on("pairs-" + how, lambda: light_on_dark(page)))
    for name in ("plain", "declared-css"):
        check(k + "the stamp forces no colour scheme: html and body compute the same color-scheme with dark mode on and off (%s page)" % name,
              on(name, lambda: same_scheme(page)))
    if not dark_device:
        # On a dark device these read black on black, as before (the known limit).
        for how in DECLARED:
            check(k + "a page with no colours that declares light dark (by %s) shows light text, link and field on a dark page" % how,
                  on("declared-" + how, lambda: (light_on_dark(page), text_on_background(page, "#a a", 7),
                                                 text_on_background(page, "#i", 4.5, inside=True))))
    check(k + "a page declaring itself dark-only in its own CSS gets the switch and reads dark on light, as before", on("dark-css", lambda: dark_on_light(page)))
    check(k + "the same page with another rule before its dark-only rule gets the switch and reads dark on light, as before",
          on("dark-css-after-rule", lambda: dark_on_light(page)))
    if dark_device:
        check(k + "a page whose dark styles set color-scheme:dark gets the switch and reads dark on light, as before", on("adaptive", lambda: dark_on_light(page)))
    else:
        check(k + "a page whose dark styles set color-scheme:dark gets the switch and reads light on dark", on("adaptive", lambda: light_on_dark(page)))
    check(k + "a frame whose page sets no background reads as a light box with dark text, as before",
          on("framed-plain", lambda: (text_on_background(page, "#h", 7, dark=False, frame="#f"), text_on_background(page, "#p", 7, dark=False, frame="#f"))))
    if dark_device:
        check(k + "a frame whose page has its own dark styles gets them (light text on its dark background)",
              on("framed-prefers-dark", lambda: (text_on_background(page, "#h", 7, frame="#f"), text_on_background(page, "#p", 7, frame="#f"))))
    else:
        check(k + "a frame whose page has its own dark styles reads (its dark styles, or in Chromium its light ones on a light device)",
              on("framed-prefers-dark", lambda: (text_on_background(page, "#h", 7, dark=None, frame="#f"), text_on_background(page, "#p", 7, dark=None, frame="#f"))))
    check(k + "an image whose author set color-scheme:light keeps it: its lettering reads dark on its light background",
          on("image-author-light", lambda: text_on_background(page, "#m", 7, dark=False)))
    check(k + "a page with its own colours shows light text on a dark page", on("authored", lambda: light_on_dark(page)))
    check(k + "a page declaring light dark that sets only its text colour shows light text on a dark page", on("text-colour-only", lambda: light_on_dark(page)))
    check(k + "the field check reads the field's text, not its border: it fails on a field whose text matches its background",
          on("hidden-field", lambda: fails(lambda: text_on_background(page, "#i", 4.5, inside=True))))
    show("long")
    if not page.evaluate('CSS.supports("scrollbar-color", "#6b6b6b #1c1c1c")'):
        # Safari before 26.2: a light scrollbar there is accepted.
        print("SKIPPED %s, %s: the scrollbar check (this browser does not support scrollbar-color)" % (kind, state))
    else:
        width = page.evaluate("window.innerWidth - document.documentElement.clientWidth")
        if width == 0:
            print("SKIPPED %s, %s: the scrollbar check (this browser draws overlay scrollbars here)" % (kind, state))
        else:
            check(k + "the window's scrollbar stays dark (drawn outside the page filter)", lambda: dark_strip(page, width))
    if os.environ.get("FORGE_DARK_SHOTS"):
        # For a person to look at: each page as this state's reader sees it.
        for name in PAGES:
            if name != "long":
                show(name)
                page.screenshot(path=os.path.join(os.environ["FORGE_DARK_SHOTS"], "%s-%s-%s.png" % (name, "darkdev" if dark_device else "lightdev-on", kind)))
    ctx.close()


def run_browser(kind, browser, base):
    for state, scheme, press in STATES:
        run_state(kind, browser, base, state, scheme, press)


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
        for name, html in PAGES.items():
            (tmp / (name + ".html")).write_text(stamp(html), encoding="utf-8")

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
