// Designed templates for the publisher's generated pages. The design tokens
// are the engine's; the brand (wordmark, name, header tag, footer line) comes
// from the workspace's config.json, so the engine names no owner. Pure functions:
// plain data in, complete HTML document out. No runtime dependencies and no
// network fetch: the default look is neutral colours and the system's own
// fonts. A store may set brand.accent (one colour) and brand.fontStylesheet
// (a stylesheet the generated pages load, for its own fonts).
//
// Privacy shape: the master index links out to every deliverable, but a
// deliverable's own pages never link back to the index, so a shared doc link
// stays its own capability and cannot lead a recipient to the full gallery.
// The per-document history page is public (one guess from any document link),
// so it carries no share notes, no source paths and no link anywhere else.

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The accent when the store sets none: a neutral blue that reads as a link.
const DEFAULT_ACCENT = "#3451b2";
const accentOf = (brand) => (brand && brand.accent) || DEFAULT_ACCENT;
// A pale wash of the accent, for hover and highlight backgrounds.
const tintOf = (a) => "color-mix(in srgb," + a + " 9%,#fff)";
// The store's own stylesheet, when it names one; else no outside request.
const fontsOf = (brand) => (brand && brand.fontStylesheet ? '<link rel="stylesheet" href="' + esc(brand.fontStylesheet) + '">' : "");

// brand.accent is checked by the loader (#rrggbb), so it is safe inside CSS.
const tokens = (a) => `:root{--ink:#2a2f45;--head:#1b2238;--slate:#5b6478;--line:#e7e7ef;--canvas:#faf9fc;--paper:#fff;
--forge-accent:${a};--forge-accent-bright:${a};--on-purple:#fff;--tint:${tintOf(a)}}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.6 "Inter",-apple-system,system-ui,sans-serif}
a{color:var(--forge-accent);text-decoration:none}
.forge-accent{height:4px;background:linear-gradient(90deg,var(--forge-accent),var(--forge-accent-bright))}
.forge-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:20px 0 14px;border-bottom:1px solid var(--line)}
.forge-logo{color:var(--forge-accent);display:inline-flex;align-items:center}
.forge-logo svg{height:19px;width:auto;display:block}
.forge-tag{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--slate);border:1px solid var(--line);border-radius:999px;padding:5px 11px;white-space:nowrap}
.forge-footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);color:var(--slate);font-size:13px}
.forge-footer .mark{font-family:"Space Grotesk","Inter",system-ui,sans-serif;font-weight:700;font-size:15px;color:var(--forge-accent);margin:0}
.forge-footer p{margin:4px 0 0}
.eyebrow{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--slate)}
h1{font-family:"Space Grotesk","Inter",system-ui,sans-serif;color:var(--head);font-weight:700;letter-spacing:-.015em}
:focus-visible{outline:2px solid var(--forge-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`;

// The owner's wordmark comes from the workspace (config.json brand.wordmarkFile),
// embedded fill-only so it takes the accent colour; with no wordmark file the
// brand name is shown as text. The engine itself carries no brand.
function wordmark(brand) {
  return brand.wordmarkSvg
    ? '<span class="forge-logo" role="img" aria-label="' + brand.name + '">' + brand.wordmarkSvg + "</span>"
    : '<span class="forge-logo">' + brand.name + "</span>";
}
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

// ---------------------------------------------------------------------------
// Dark mode. One look everywhere: a whole-page lightness flip (invert +
// hue-rotate + saturate) with the brand accents rendered as warm gold. The
// generated pages (index, history) carry the control as a labelled pill in
// their own header; published documents get it stamped in by
// injectDarkToggle as a labelled pill fixed bottom-right. Default follows the
// device; a press overrides and is remembered per browser (localStorage).
//
// Dark mode flips the brand accents to warm gold (lighter accents read
// better on dark; true saturated yellow is outside the
// filter's renderable gamut, apricot-gold is its brightest warm point).
// The var values are pre-compensated: solved against the invert+hue-rotate
// sRGB matrix so the filter renders them as the intended colors
// (#743200 -> gold #f3b586, #3c1800 -> cream #f7d6bf, on-accent text
// renders near-black). invert(.97) over .93 deepens the canvas and
// brightens body text (measured 10.1:1 -> 12.0:1). Neutrals invert cleanly
// and need no compensation. scrollbar-color keeps the scrollbar dark: the
// browser draws it outside the page filter, so its colours are given as seen
// (a browser without scrollbar-color shows a light one). The stamp sets no
// colour scheme on the page: a forced dark one turned default text white,
// then black on black once inverted, and a forced light one broke pages
// whose own dark styles pair system text with their own background
// (test/dark-mode.test.py). The re-inverted embeds are asked for dark
// through a zero-specificity rule that an author's own color-scheme on the
// element beats, so an embedded page gets its dark styles and a frame whose
// page sets no background stays an opaque light box instead of going
// transparent and black on black.
// shortcut: a page with no colours of its own that declares "light dark" still reads black on black on a dark device, as in 0.1.1; a body background derived from currentColor (:where(html.forge-dark) :where(body){background-color:oklch(from currentColor calc((.6 - l)*1000) 0 0)}) fixed it in Chromium, unchecked elsewhere; add it if such pages turn up.
// shortcut: an embed that had its colour scheme only from an ancestor's color-scheme (not a rule on the element) is now asked for dark; only scheme-dependent images notice (a light-dark() background), and a rule on the element still wins; revisit if such pages turn up.
// saturate(1.3) re-vivifies the hardcoded semantic colors (role colors,
// status reds/greens/blues/ambers) that the lightness flip washes out, so
// they stand out in dark like they do in light; neutrals have no
// saturation to amplify. Var values re-solved against the full
// invert+hue-rotate+saturate chain. Images get the approximate inverse
// chain so photos stay true.
// Everything dark sits inside @media screen, so paper always gets the light
// page: no filter, no gold variables, nobody prints a black page.
// Safe on the root element only: filter on <html> does not break
// position:fixed (the root is exempt from the filter containing-block rule).
const DARK_CORE_CSS =
  "@media screen{" +
  "html.forge-dark{filter:invert(.97) hue-rotate(180deg) saturate(1.3);background:#fff;scrollbar-color:#6b6b6b #1c1c1c;--forge-accent:#603200;--forge-accent-bright:#301800;--purple:#603200;--on-purple:#f8ecde;--tint:#eae2d8}" +
  "html.forge-dark img,html.forge-dark video,html.forge-dark iframe{filter:saturate(.77) invert(1) hue-rotate(180deg)}" +
  ":where(html.forge-dark) :where(img,video,iframe){color-scheme:dark}" +
  "}";

// The button's own wiring, shared by documents and generated pages. The
// visible text names the action ("Dark" while the page is light), and so does
// the spoken name; no aria-pressed, because the label already flips.
const THEME_SCRIPT =
  "<script>(function(){" +
  'var KEY="forge-theme",root=document.documentElement,btn=document.getElementById("forge-dark-toggle");if(!btn)return;' +
  'function apply(dark){root.classList.toggle("forge-dark",dark);btn.textContent=dark?"\\u2600\\uFE0E Light":"\\u263E\\uFE0E Dark";' +
  'btn.setAttribute("aria-label",dark?"Switch to light mode":"Switch to dark mode");}' +
  "var saved=null;try{saved=localStorage.getItem(KEY)}catch(e){}" +
  'var dark=saved?saved==="dark":matchMedia("(prefers-color-scheme: dark)").matches;' +
  "apply(dark);" +
  'btn.addEventListener("click",function(){dark=!dark;apply(dark);try{localStorage.setItem(KEY,dark?"dark":"light")}catch(e){}});' +
  "})()</script>";

// Generated pages apply the remembered theme in <head>, before first paint.
const THEME_EARLY =
  "<script>(function(){var s=null;try{s=localStorage.getItem(\"forge-theme\")}catch(e){}" +
  'if(s?s==="dark":matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.classList.add("forge-dark")})()</script>';

// The header pill on generated pages. Same id as the stamped document button,
// so injectDarkToggle recognises these pages as already carrying a control.
const HEADER_TOGGLE =
  '<button id="forge-dark-toggle" class="tpill" type="button" aria-label="Switch to dark mode">&#9790;&#65038; Dark</button>';

// Dark-mode control stamped into every published document at publish time,
// so no deliverable has to be authored with a dark theme. A labelled pill
// fixed bottom-right at every width (a top corner collides with a document's
// own header tag). The page reserves room for it with bottom padding on
// <body>, so at the end of the scroll it sits in empty space and never covers
// the last line or a footer button. `all:initial` first, so a document's own
// button styles cannot reshape it. Hidden on paper.
const docToggleCss = (a) =>
  "#forge-dark-toggle{all:initial;position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147483647;box-sizing:border-box;display:inline-block;" +
  "font:12px/1.2 " + MONO + ";letter-spacing:.09em;text-transform:uppercase;white-space:nowrap;color:" + a + ";background:#fff;border:1px solid " + a + ";border-radius:999px;padding:8px 13px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.18)}" +
  "#forge-dark-toggle:hover{background:" + tintOf(a) + "}" +
  "#forge-dark-toggle:focus-visible{outline:2px solid " + a + ";outline-offset:2px}" +
  "@media screen{body{padding-bottom:calc(72px + env(safe-area-inset-bottom,0px))!important}" +
  // Pre-compensated like the vars above: #603200 renders gold, and a light
  // shadow renders as a dark one once the page is inverted.
  "html.forge-dark #forge-dark-toggle{color:#603200;border-color:#603200;box-shadow:0 6px 18px rgba(255,255,255,.35)}" +
  "html.forge-dark #forge-dark-toggle:hover{background:#eae2d8}" +
  "html.forge-dark #forge-dark-toggle:focus-visible{outline-color:#603200}}" +
  "@media print{#forge-dark-toggle{display:none!important}}";

const darkToggle = (a) =>
  '<style id="forge-dark-toggle-css">' + DARK_CORE_CSS + docToggleCss(a) + "</style>" +
  '<button id="forge-dark-toggle" type="button" aria-label="Switch to dark mode">&#9790;&#65038; Dark</button>' +
  THEME_SCRIPT;

// Stamps the control in before </body>. Idempotent: a page that already
// carries the element id (an earlier stamp, or a generated page with its
// header pill) is returned unchanged, so nothing is ever stamped twice.
// accent: the store's brand.accent, or the neutral default.
function injectDarkToggle(html, accent = DEFAULT_ACCENT) {
  const s = String(html);
  if (s.includes('id="forge-dark-toggle"')) return s;
  // A page authored dark-only (<meta name="color-scheme" content="dark">) gets no toggle: the
  // invert filter would turn it light on every dark-mode device.
  if (/<meta[^>]+name=["']color-scheme["'][^>]+content=["']\s*dark\s*["']/i.test(s)) return s;
  const i = s.toLowerCase().lastIndexOf("</body>");
  const t = darkToggle(accent);
  return i === -1 ? s + t : s.slice(0, i) + t + s.slice(i);
}

// ---------------------------------------------------------------------------
// Markdown export. Every published document gets "Copy as Markdown" and
// "Download .md", stamped in beside the dark toggle. The page converts its own
// DOM at click time (no library, no server, no stored .md), so a frozen
// snapshot also freezes its export behaviour. Metadata for the header block
// rides on data-* attributes of the injected block.
//
// Pills match the dark toggle: all:initial so a document's own styles cannot
// reshape them, stacked just above the toggle when there is one (sibling
// selector; dark-only pages have no toggle, so the pair drops to the corner),
// hidden on paper, pre-compensated colors under html.forge-dark.
const mdExportCss = (a) =>
  ".forge-md{all:initial;position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:calc(100vw - 32px)}" +
  "#forge-dark-toggle~.forge-md{bottom:calc(58px + env(safe-area-inset-bottom,0px))}" +
  ".forge-md-row{all:initial;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}" +
  ".forge-md-btn{all:initial;box-sizing:border-box;display:inline-block;font:12px/1.2 " + MONO + ";letter-spacing:.09em;text-transform:uppercase;white-space:nowrap;" +
  "color:" + a + ";background:#fff;border:1px solid " + a + ";border-radius:999px;padding:8px 13px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.18)}" +
  ".forge-md-btn:hover{background:" + tintOf(a) + "}" +
  ".forge-md-btn:focus-visible{outline:2px solid " + a + ";outline-offset:2px}" +
  ".forge-md-status{all:initial;box-sizing:border-box;font:13px/1.4 -apple-system,system-ui,sans-serif;color:#fff;background:#1b2238;border-radius:9px;padding:8px 12px;max-width:100%}" +
  ".forge-md-status:empty{display:none}" +
  // At 320px the two pills wrap to two rows and the stack top sits about 131px up.
  "@media screen{body{padding-bottom:calc(148px + env(safe-area-inset-bottom,0px))!important}" +
  "html.forge-dark .forge-md-btn{color:#603200;border-color:#603200;box-shadow:0 6px 18px rgba(255,255,255,.35)}" +
  "html.forge-dark .forge-md-btn:hover{background:#eae2d8}" +
  "html.forge-dark .forge-md-btn:focus-visible{outline-color:#603200}}" +
  "@media print{.forge-md{display:none!important}}";

// The converter, run in the browser. Written as a real function and embedded
// with toString() (not a string constant like THEME_SCRIPT) because at this
// size a string would hide syntax errors until a reader clicked; here node
// parses it on require. Must never contain a closing script tag.
function mdExportMain() {
  var box = document.querySelector("[data-forge-md-export]");
  if (!box) return;
  var status = box.querySelector(".forge-md-status");
  var SKIP = "script,style,noscript,template,nav,input,select,textarea,[data-forge-md-export],[data-md-skip],#forge-dark-toggle,[aria-hidden=true],button[aria-label]";
  var BLOCK = /^(p|div|section|article|main|header|footer|aside|figure|figcaption|h[1-6]|ul|ol|li|blockquote|pre|table|hr|dl|dt|dd|details|summary|form|fieldset|address|svg)$/;
  var frozen = box.getAttribute("data-url") || location.href;

  // Not rendered means not exported ([hidden], display:none: inactive tab
  // panels, mobile-only labels), except inside <details>, whose collapsed
  // content is real document text.
  function skip(el) {
    if (el.nodeType !== 1) return false;
    if (el.matches(SKIP)) return true;
    return !el.closest("details") && (el.hasAttribute("hidden") || getComputedStyle(el).display === "none");
  }
  function kids(el) { return Array.prototype.slice.call(el.childNodes); }
  function wrap(s, mark) {
    var m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? m[1] + mark + m[2] + mark + m[3] : s;
  }
  function ticks(s) {
    var runs = s.match(/`+/g) || [], n = 0;
    runs.forEach(function (r) { n = Math.max(n, r.length); });
    return n;
  }
  // Escape only what would turn a prose line into structure.
  // Inside a table cell only "|" can break structure, and table() escapes that.
  var inCell = false;
  function escLine(l) { return inCell ? l : l.replace(/^(#+|[-*+>]|\d+[.)])(?=\s|$)/, function (m) { return m.replace(/([#\-*+>.)])$/, "\\$1"); }); }
  function svgLine(el) {
    var t = Array.prototype.filter.call(el.children, function (c) { return c.localName === "title"; })[0];
    var label = (el.getAttribute("aria-label") || (t && t.textContent) || "").replace(/\s+/g, " ").trim();
    if (label) return "**Chart:** " + label;
    if (el.querySelectorAll("text").length >= 3) return "*Diagram (no text description), view it on the page: " + frozen + "*";
    return ""; // decorative
  }

  function inline(node) {
    if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, " ");
    if (node.nodeType !== 1 || skip(node)) return "";
    // Pages often set label and value side by side as block or pill elements
    // with no space between ("Status" + "Not linked"); the layout separates
    // them, so the text must too. (Unrendered elements never get here: skip().)
    var d = getComputedStyle(node).display, gap = d === "inline" || d === "contents" ? "" : " ";
    return gap + inlineEl(node) + gap;
  }
  function inlineEl(node) {
    var tag = node.localName, inner = function () { return kids(node).map(inline).join(""); };
    if (tag === "br") return "\\\n";
    if (tag === "strong" || tag === "b") return wrap(inner(), "**");
    if (tag === "em" || tag === "i") return wrap(inner(), "*");
    if (tag === "code") {
      var c = node.textContent, f = "`".repeat(ticks(c) + 1), pad = /^`|`$/.test(c) ? " " : "";
      return f + pad + c + pad + f;
    }
    if (tag === "a") {
      var href = node.getAttribute("href"), text = inner().trim();
      if (!href || href.charAt(0) === "#" || /^javascript:/i.test(href) || !text) return inner();
      return "[" + text + "](" + node.href + ")";
    }
    if (tag === "img") {
      var alt = node.getAttribute("alt") || "", src = node.getAttribute("src");
      if (!src) return alt;
      // ponytail: an embedded data: image would dump kilobytes of base64; name it instead.
      return /^data:/i.test(src) ? (alt ? "[image: " + alt + "]" : "") : "![" + alt + "](" + node.src + ")";
    }
    if (tag === "svg") { var s = svgLine(node); return s ? " " + s + " " : ""; }
    return inner();
  }

  // A run of inline content becomes one paragraph.
  function para(s) {
    return s.split("\n").map(function (l) { return escLine(l.replace(/ {2,}/g, " ").trim()); }).filter(Boolean).join("\n");
  }
  function indent(s, pad) { return s.split("\n").map(function (l, i) { return i && l ? pad + l : l; }).join("\n"); }

  function blocks(el) {
    var out = [], buf = "";
    function flush() { var p = para(buf); if (p) out.push(p); buf = ""; }
    kids(el).forEach(function (n) {
      if (n.nodeType === 1 && skip(n)) return;
      if (n.nodeType !== 1 || !BLOCK.test(n.localName)) { buf += inline(n); return; }
      var b = block(n);
      if (n.localName === "svg" && !b) return; // a decorative icon does not split a paragraph
      flush();
      if (b) out.push(b.replace(/^\n+|\n+$/g, ""));
    });
    flush();
    return out.filter(Boolean);
  }

  function list(el) {
    var ol = el.localName === "ol", n = ol && !isNaN(parseInt(el.getAttribute("start"), 10)) ? parseInt(el.getAttribute("start"), 10) : 1;
    return kids(el).filter(function (li) { return li.localName === "li" && !skip(li); }).map(function (li) {
      var mark = ol ? n++ + "." : "-", parts = blocks(li);
      var body = parts.map(function (p, i) { return i === 0 ? p : (/^(-|\d+\.) /.test(p) ? "\n" : "\n\n") + p; }).join("");
      return mark + " " + indent(body, " ".repeat(mark.length + 1));
    }).join("\n");
  }

  function table(el) {
    var rows = Array.prototype.map.call(el.rows, function (tr) {
      var cells = [];
      Array.prototype.forEach.call(tr.cells, function (td) {
        // A hidden cell still holds its column, or every later cell shifts left.
        var was = inCell;
        inCell = true;
        cells.push(skip(td) ? "" : blocks(td).join(" ").replace(/\\\n/g, " ").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|"));
        inCell = was;
        for (var k = 1; k < (td.colSpan || 1); k++) cells.push("");
      });
      return cells;
    });
    if (!rows.length) return "";
    var w = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var line = function (r) { while (r.length < w) r.push(""); return "|" + r.map(function (c) { return " " + (c ? c + " " : ""); }).join("|") + "|"; };
    var head = el.caption ? "**" + para(inline(el.caption)) + "**\n\n" : "";
    return head + [line(rows[0]), "|" + "---|".repeat(w)].concat(rows.slice(1).map(line)).join("\n");
  }

  function block(el) {
    var tag = el.localName;
    if (/^h[1-6]$/.test(tag)) { var h = inline(el).replace(/\\\n/g, " ").replace(/\s+/g, " ").trim(); return h && "#".repeat(+tag[1]) + " " + h; }
    if (tag === "ul" || tag === "ol") return list(el);
    if (tag === "blockquote") return blocks(el).join("\n\n").split("\n").map(function (l) { return l ? "> " + l : ">"; }).join("\n");
    if (tag === "pre") {
      var code = el.textContent.replace(/\n$/, ""), f = "`".repeat(Math.max(3, ticks(code) + 1));
      return f + "\n" + code + "\n" + f;
    }
    if (tag === "table") return table(el);
    if (tag === "hr") return "---";
    if (tag === "svg") return svgLine(el);
    if (tag === "dt" || tag === "summary") { var t = para(inline(el)); return t && "**" + t + "**"; }
    return blocks(el).join("\n\n"); // p, dl, dd, details, and plain containers
  }

  // The whole page unless the page names its root. Guessing a lone <main> lost
  // titles, intros and footers that sit outside it (2026-10-14, a long brief).
  function root() { return document.querySelector("[data-markdown-root]") || document.body; }

  function convert() {
    var d = box.dataset;
    return "> Source: " + d.title + "\n> Version " + d.version + ", published " + d.date + "\n> " + frozen + "\n\n" + blocks(root()).join("\n\n") + "\n";
  }

  var timer;
  function say(msg) { status.textContent = msg; clearTimeout(timer); timer = setTimeout(function () { status.textContent = ""; }, 4000); }
  box.querySelector("[data-md-copy]").addEventListener("click", function () {
    var md = convert();
    function fallback() {
      var ta = document.createElement("textarea"), ok = false;
      ta.value = md; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      box.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
      say(ok ? "Copied as Markdown." : "Copy was blocked. Use Download instead.");
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(md).then(function () { say("Copied as Markdown."); }, fallback);
      else fallback();
    } catch (e) { fallback(); }
  });
  box.querySelector("[data-md-download]").addEventListener("click", function () {
    var name = (box.dataset.name || box.dataset.slug) + "-v" + box.dataset.version + ".md", a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([convert()], { type: "text/markdown;charset=utf-8" }));
    a.download = name;
    box.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    say("Download started: " + name + ".");
  });
}

const MD_EXPORT_MARK = "data-forge-md-export";
// The full opening tag, so a page that merely mentions the attribute still gets the block.
const MD_EXPORT_OPEN = '<div class="forge-md" ' + MD_EXPORT_MARK;

// The converter is inlined in a <script>; any of these inside it would end or
// corrupt that element in the HTML parser. Checked once, at require time.
function assertScriptSafe(src) {
  if (/<\/script|<!--|<script/i.test(src)) throw new Error("publish-pages: inline script source contains <script, </script or <!--");
  return src;
}
const MD_EXPORT_SCRIPT = "<script>(" + assertScriptSafe(mdExportMain.toString()) + ")()</script>";

// Stamps the export block in before </body>. Idempotent on the marker, and
// deliberately not behind injectDarkToggle's early returns: dark-only pages
// get export too. meta = { title, version, date, url, slug, name }; null stamps
// empty placeholders, which is what publish hashes (see publish-core).
function injectMarkdownExport(html, meta, accent = DEFAULT_ACCENT) {
  const s = String(html);
  if (s.includes(MD_EXPORT_OPEN)) return s;
  const m = meta || {};
  const attr = (k) => " data-" + k + '="' + esc(m[k] == null ? "" : m[k]) + '"';
  const block =
    MD_EXPORT_OPEN + attr("title") + attr("version") + attr("date") + attr("url") + attr("slug") + attr("name") + ">" +
    "<style>" + mdExportCss(accent) + "</style>" +
    '<div class="forge-md-status" role="status" aria-live="polite"></div>' +
    '<div class="forge-md-row">' +
    '<button class="forge-md-btn" type="button" data-md-copy>Copy as Markdown</button>' +
    '<button class="forge-md-btn" type="button" data-md-download>Download .md</button>' +
    "</div>" +
    MD_EXPORT_SCRIPT + "</div>";
  const i = s.toLowerCase().lastIndexOf("</body>");
  return i === -1 ? s + block : s.slice(0, i) + block + s.slice(i);
}

// Publish-time lint, matching the converter's rule: SVGs that read as
// diagrams (3+ <text>) with no aria-label and no direct-child <title>.
// aria-hidden svgs are skipped by the export, so they are ignored here too.
// ponytail: regex, not a parser; a nested <svg> inside an svg ends the match early.
function hasDirectTitle(svg) {
  let depth = 0;
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (m[1]) depth--;
    else if (depth === 1 && m[2].toLowerCase() === "title") return true;
    else if (!m[3]) depth++;
  }
  return false;
}
function unlabelledDiagrams(html) {
  return (String(html).match(/<svg[\s>][\s\S]*?<\/svg>/gi) || []).filter((svg) => {
    const open = svg.match(/<svg[^>]*>/i)[0];
    if (/\saria-hidden=["']?true/i.test(open)) return false;
    return (svg.match(/<text[\s>]/gi) || []).length >= 3 && !/\saria-label=/i.test(open) && !hasDirectTitle(svg);
  }).length;
}

// ---------------------------------------------------------------------------
// Shared pieces of the two generated pages.

function head(title, css, brand) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="robots" content="noindex">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" + esc(title) + "</title>" + fontsOf(brand) +
    "<style>" + tokens(accentOf(brand)) + GEN_CSS + css + DARK_CORE_CSS + "</style>" + THEME_EARLY + "</head>"
  );
}

function header(tag, brand) {
  return (
    '<div class="forge-accent"></div><header class="forge-header">' + wordmark(brand) +
    '<div class="hright"><span class="forge-tag">' + tag + "</span>" + HEADER_TOGGLE + "</div></header>"
  );
}

function footer(fine, brand) {
  return '<footer class="forge-footer"><p class="mark">' + brand.name + "</p><p>" + fine + "</p></footer>";
}

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function monthLabel(iso) {
  const d = new Date(String(iso).slice(0, 7) + "-01T00:00:00Z");
  if (isNaN(d)) return "an unknown month";
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function plural(n, word) {
  return '<span class="num">' + n + "</span> " + word + (n === 1 ? "" : "s");
}

// The doc's own page already announces the brand loudly; the generated pages
// drop a leading "<brand name> ·" from display titles so rows do not chant it.
function displayTitle(title, brand) {
  if (!brand || !brand.name) return String(title);
  const name = brand.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(title).replace(new RegExp("^" + name + "\\s*·\\s*", "i"), "");
}

const GEN_CSS = `
html,:root.forge-dark{background:var(--canvas)}
.forge-header{padding:18px 24px 14px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.num{font-family:${MONO};font-variant-numeric:tabular-nums}
.hright{display:flex;gap:8px;align-items:center}
.tpill{font:11px/1.2 ${MONO};letter-spacing:.09em;text-transform:uppercase;color:var(--forge-accent);background:var(--paper);border:1px solid var(--forge-accent);border-radius:999px;padding:5px 11px;cursor:pointer;white-space:nowrap}
.tpill:hover{background:var(--tint)}
.btn{display:inline-block;background:var(--forge-accent);color:var(--on-purple);padding:7px 14px;border-radius:9px;font:600 13px "Inter",system-ui,sans-serif;border:0;cursor:pointer}
.btn:hover{background:var(--forge-accent-bright)}
.linkbtn{font:13px "Inter",system-ui,sans-serif;color:var(--forge-accent);background:none;border:0;padding:0;cursor:pointer}
.linkbtn:hover{text-decoration:underline}
.acts{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
.acts a,.acts button{font:12.5px "Inter",system-ui,sans-serif;color:var(--forge-accent);background:none;border:0;padding:0;cursor:pointer;white-space:nowrap}
.acts a:hover,.acts button:hover{text-decoration:underline}
.acts .done,.linkbtn.done{color:var(--slate)}
.status{font-size:12.5px;color:var(--ink);margin:6px 0 0}
.status:not(.show){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.copyout{background:#fff4e5;border:1px solid #e8c38a;border-radius:8px;padding:8px 12px;margin-top:8px;font-size:13px;color:var(--ink)}
.copyout label{display:block;font-weight:600}
.copyout input{display:block;width:100%;margin-top:4px;font:13px ${MONO};padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)}
.empty{padding:36px 16px;text-align:center;color:var(--slate);font-size:14px}
.empty b{color:var(--head);font-weight:600;display:block;font-size:15px;margin-bottom:4px}
.empty .btn{margin-top:12px}
@media (max-width:600px){.forge-header{padding:16px 16px 12px}.forge-tag{display:none}}
@media print{.tpill{display:none}}`;

// Copy, with a truthful outcome: "Copied" only after the browser confirms the
// write; otherwise the exact absolute address appears in a selectable field
// under the row. Both outcomes are shown and spoken (polite live region).
const COPY_SCRIPT = `<script>(function(){
var st=document.getElementById('status');
function say(m){if(!st)return;st.textContent=m;st.classList.add('show');}
function copy(btn){
var url=new URL(btn.getAttribute('data-url'),location.href).href;
if(!btn.getAttribute('data-text'))btn.setAttribute('data-text',btn.textContent);
var text=btn.getAttribute('data-text'),label=btn.getAttribute('aria-label')||text;
function ok(){btn.textContent='Copied';btn.classList.add('done');say(label.replace(/^Copy /,'Copied the ')+'.');
clearTimeout(btn._t);btn._t=setTimeout(function(){btn.textContent=text;btn.classList.remove('done');},2500);}
function fail(){var host=btn.closest('.row,.vrow,.cta')||btn.parentNode,out=host.querySelector('.copyout');
if(!out){out=document.createElement('div');out.className='copyout';host.appendChild(out);}
out.innerHTML='<label>Copy this address manually<input type="text" readonly spellcheck="false"></label>';
var inp=out.querySelector('input');inp.value=url;
say('Could not copy automatically. The address is shown under the button; select it and copy.');
inp.focus();inp.select();}
try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(ok,fail);}else{fail();}}catch(e){fail();}}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('button.copy');if(b)copy(b);});
})();</script>`;

// ---------------------------------------------------------------------------
// The master index (owner-only, at the secret index slug).

const INDEX_CSS = `
.wrap{max-width:900px;margin:0 auto;padding:0 24px 48px}
.hero{margin:28px 0 4px}
h1{font-size:28px;margin:0 0 6px}
h2{margin:0}
.counts{color:var(--slate);font-size:14px;margin:0}
.qlabel{display:block;font-size:13px;font-weight:500;color:var(--ink);margin:20px 0 6px}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0}
#q{flex:1;min-width:200px;padding:9px 13px;border:1px solid var(--line);border-radius:10px;font:15px "Inter",system-ui,sans-serif;color:var(--ink);background:var(--paper)}
#q::placeholder{color:var(--slate)}
#q:focus{border-color:var(--forge-accent);outline:none;box-shadow:0 0 0 3px var(--tint)}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--paper)}
.seg button{font:13px "Inter",system-ui,sans-serif;color:var(--slate);background:none;border:0;padding:8px 12px;cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--tint);color:var(--forge-accent);font-weight:600}
.qcount{font:12px ${MONO};color:var(--slate);white-space:nowrap}
.copyhint{font-size:12.5px;color:var(--slate);margin:8px 0 0;max-width:70ch}
.colhead{display:grid;grid-template-columns:1fr 56px 112px 206px;gap:18px;padding:6px 10px;margin-top:12px;font:11px ${MONO};letter-spacing:.08em;text-transform:uppercase;color:var(--slate);border-bottom:1px solid var(--line)}
.colhead .r{text-align:right}
.month{display:flex;align-items:baseline;gap:10px;font-family:"Space Grotesk","Inter",system-ui,sans-serif;font-size:14px;font-weight:600;letter-spacing:0;color:var(--head);margin:22px 0 2px;padding:0 10px}
.gcount{font:400 12px ${MONO};color:var(--slate)}
ol.rows{list-style:none;margin:0;padding:0}
.row{display:grid;grid-template-columns:1fr 56px 112px 206px;gap:4px 18px;align-items:baseline;padding:12px 10px;border-bottom:1px solid var(--line)}
.row[hidden],.grp[hidden]{display:none}
.meta{display:contents}
.title{font-family:"Space Grotesk","Inter",system-ui,sans-serif;font-weight:600;font-size:15.5px;color:var(--head);line-height:1.35}
.title:hover{text-decoration:underline;color:var(--forge-accent)}
.ver,.date{font:13px ${MONO};font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.ver{font-weight:600;color:var(--head)}
.date{color:var(--slate)}
.date .lbl{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.row .acts{justify-content:flex-end}
.row .copyout{grid-column:1/-1}
@media (max-width:600px){
.wrap{padding:0 16px 40px}
.hero{margin:20px 0 2px}h1{font-size:24px}
.colhead{display:none}
.row{grid-template-columns:1fr;gap:5px;padding:11px 4px}
.meta{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.ver,.date{text-align:left}
.date .lbl{position:static;width:auto;height:auto;overflow:visible;clip:auto;font:13px "Inter",system-ui,sans-serif}
.row .acts{justify-content:flex-start;width:100%}
.month{padding:0 4px;margin-top:18px}
}`;

// Server-rendered in the "Recently updated" order (latest version date, newest
// first; title breaks ties), grouped by month, so the HTML is right with
// scripts off. The script only re-groups on sort and filters on search.
function renderIndexPage(data) {
  const brand = data.brand;
  const items = data.items
    .map((it) => ({ ...it, shown: displayTitle(it.title, brand), latestDate: it.latestDate || "" }))
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.shown.localeCompare(b.shown));
  const total = items.length;

  let list = "";
  let open = null;
  items.forEach((it, i) => {
    const month = it.latestDate.slice(0, 7);
    if (month !== open) {
      if (open !== null) list += "</ol></section>";
      const n = items.filter((x) => x.latestDate.slice(0, 7) === month).length;
      list +=
        '<section class="grp"><h2 class="month">Last updated in ' + esc(monthLabel(it.latestDate)) +
        ' <span class="gcount">' + plural(n, "page") + "</span></h2><ol class=\"rows\">";
      open = month;
    }
    const stable = "/d/" + it.slug + "/";
    list +=
      '<li class="row" data-i="' + i + '" data-text="' + esc((it.name + " " + it.title).toLowerCase()) +
      '" data-title="' + esc(it.shown.toLowerCase()) + '" data-month="' + esc(month) +
      '" data-mlabel="' + esc(monthLabel(it.latestDate)) + '">' +
      '<div class="tcell"><a class="title" href="' + stable + '">' + esc(it.shown) + "</a></div>" +
      '<div class="meta"><span class="ver">v' + it.latestN + "</span>" +
      '<span class="date"><span class="lbl">Updated </span>' + esc(fmtDate(it.latestDate)) + "</span>" +
      '<span class="acts"><a href="' + stable + 'versions/" aria-label="Versions of ' + esc(it.shown) + '">Versions</a>' +
      '<button type="button" class="copy" data-url="' + stable + '" aria-label="Copy latest link for ' + esc(it.shown) + '">Copy latest link</button>' +
      "</span></div></li>";
  });
  if (open !== null) list += "</ol></section>";

  const counts = total
    ? plural(total, "page") + " &middot; " + plural(data.versionsTotal, "version") + " &middot; last updated " +
      '<span class="num">' + esc(fmtDate(items[0].latestDate)) + "</span>"
    : plural(0, "page");

  let body;
  if (!total) {
    body =
      '<div class="empty"><b>No shared pages yet.</b>Share a page and it will appear here.</div>';
  } else {
    body =
      '<label class="qlabel" for="q">Find a page by title or file name</label>' +
      '<form class="toolbar" role="search" onsubmit="return false">' +
      '<input id="q" type="search" placeholder="Words in any order" autocomplete="off" spellcheck="false">' +
      '<div class="seg" role="group" aria-label="Sort order">' +
      '<button type="button" data-sort="recent" aria-pressed="true">Recently updated</button>' +
      '<button type="button" data-sort="az" aria-pressed="false">A to Z</button></div>' +
      '<span class="qcount" aria-hidden="true"><span class="num" id="shown">' + total + '</span> of <span class="num">' + total + "</span></span>" +
      "</form>" +
      '<p class="copyhint">&ldquo;Copy latest link&rdquo; copies the address that always shows the newest version, including any you publish later. For a link frozen at one version, open Versions.</p>' +
      '<p class="status" id="status" role="status" aria-live="polite"></p>' +
      '<div class="colhead" aria-hidden="true"><span>Page</span><span class="r">Version</span><span class="r">Updated</span><span></span></div>' +
      '<div id="list">' + list + "</div>" +
      '<div class="empty" id="nomatch" hidden><b>No page matches &ldquo;<span id="nmq"></span>&rdquo;.</b>Try one word from the title or the file name.<br>' +
      '<button type="button" class="btn" id="clear">Clear search</button></div>';
  }

  const script = `<script>(function(){
var list=document.getElementById('list');if(!list)return;
var rows=[].slice.call(list.querySelectorAll('li.row')),total=rows.length;
var q=document.getElementById('q'),shown=document.getElementById('shown'),st=document.getElementById('status'),
nomatch=document.getElementById('nomatch'),nmq=document.getElementById('nmq'),sorts=[].slice.call(document.querySelectorAll('[data-sort]')),mode='recent';
function words(){return q.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);}
function hit(r,w){var t=r.getAttribute('data-text');return w.every(function(x){return t.indexOf(x)>-1;});}
function num(n){return '<span class="num">'+n+'</span>';}
function pages(n){return num(n)+' page'+(n===1?'':'s');}
function render(speak){
var w=words(),order=rows.slice(),groups=[],map={},n=0;
if(mode==='az')order.sort(function(a,b){return a.getAttribute('data-title').localeCompare(b.getAttribute('data-title'))||a.getAttribute('data-i')-b.getAttribute('data-i');});
else order.sort(function(a,b){return a.getAttribute('data-i')-b.getAttribute('data-i');});
order.forEach(function(r){var k=mode==='recent'?r.getAttribute('data-month'):'all',g=map[k];
if(!g){g=map[k]={label:r.getAttribute('data-mlabel'),rows:[],hits:0};groups.push(g);}
var h=hit(r,w);r.hidden=!h;if(h){g.hits++;n++;}g.rows.push(r);});
var frag=document.createDocumentFragment();
groups.forEach(function(g){var sec=document.createElement('section');sec.className='grp';sec.hidden=!g.hits;
if(mode==='recent'){var h2=document.createElement('h2');h2.className='month';h2.appendChild(document.createTextNode('Last updated in '+g.label+' '));
var c=document.createElement('span');c.className='gcount';c.innerHTML=w.length?num(g.hits)+' of '+pages(g.rows.length):pages(g.rows.length);h2.appendChild(c);sec.appendChild(h2);}
var ol=document.createElement('ol');ol.className='rows';g.rows.forEach(function(r){ol.appendChild(r);});sec.appendChild(ol);frag.appendChild(sec);});
list.innerHTML='';list.appendChild(frag);
shown.textContent=n;nomatch.hidden=n>0;if(!n)nmq.textContent=q.value.trim();
if(speak){st.classList.remove('show');st.textContent=n?n+' of '+total+' pages shown.':'No pages match. Use Clear search to see them all.';}}
q.addEventListener('input',function(){render(true);});
sorts.forEach(function(b){b.addEventListener('click',function(){mode=b.getAttribute('data-sort');
sorts.forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});render(true);});});
document.getElementById('clear').addEventListener('click',function(){q.value='';render(true);q.focus();});
if(q.value)render(false);
if(window.matchMedia&&matchMedia('(hover:hover) and (pointer:fine)').matches)q.focus({preventScroll:true});
})();</script>`;

  return (
    head("Published pages", INDEX_CSS, brand) +
    "<body>" + header(brand.indexTagHtml, brand) +
    '<main class="wrap">' +
    '<div class="hero"><h1>Published pages</h1><p class="counts">' + counts + "</p></div>" +
    body +
    footer("Every publish updates this page. Links are unguessable; treat sending one as sharing the page.", brand) +
    "</main>" + THEME_SCRIPT + (total ? script + COPY_SCRIPT : "") + "</body></html>"
  );
}

// ---------------------------------------------------------------------------
// The per-document history page. PUBLIC: anyone holding a document link can
// reach /d/<slug>/versions/, so it carries only what the document link already
// implies: the title, the version numbers and their dates. No share notes, no
// share log, no source paths or file names, and no link to the index or to any
// other document. It takes no other data, so nothing private can leak in.

const VERSIONS_CSS = `
.wrap{max-width:800px;margin:0 auto;padding:0 24px 48px}
.hero{margin:28px 0 22px}
h1{font-size:28px;margin:0 0 6px}
.idline{font:12px ${MONO};color:var(--slate);letter-spacing:.03em}
.cta{display:flex;gap:18px;align-items:center;margin-top:18px;flex-wrap:wrap}
.cta .btn{font-size:15px;padding:10px 18px;border-radius:11px}
.cta .copyout{flex-basis:100%;margin-top:0}
.hint{color:var(--slate);font-size:13px;margin:10px 0 0;max-width:64ch}
h2{font-size:16px;margin:32px 0 6px;display:flex;gap:10px;align-items:baseline}
h2 .num{font-size:12px;color:var(--slate);font-weight:400}
.vhead{display:grid;grid-template-columns:56px 1fr auto;gap:16px;padding:6px 10px;font:11px ${MONO};letter-spacing:.08em;text-transform:uppercase;color:var(--slate);border-bottom:1px solid var(--line)}
ol.versions{list-style:none;margin:0;padding:0}
.vrow{display:grid;grid-template-columns:56px 1fr auto;gap:2px 16px;align-items:baseline;padding:10px;border-bottom:1px solid var(--line)}
.vrow.latest{background:var(--tint);border-radius:8px}
.vrow .v{font:600 13px ${MONO};color:var(--head);white-space:nowrap}
.vrow .d{font:13px ${MONO};color:var(--ink);white-space:nowrap}
.vrow .d .lbl{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.latesttag{display:block;font:600 12px "Inter",system-ui,sans-serif;color:var(--forge-accent);white-space:normal}
/* Fixed action column, left-aligned: "Open" sits at the same x on every row
   whether the copy label reads v9 or v12. */
.vrow .acts{justify-content:flex-start;width:13em}
.vrow .copyout{grid-column:1/-1}
@media (max-width:600px){
.wrap{padding:0 16px 40px}
.hero{margin:20px 0 18px}h1{font-size:24px}
.vhead{display:none}
.vrow{grid-template-columns:56px 1fr;padding:10px 6px}
.vrow .acts{grid-column:1/-1;justify-content:flex-start;width:auto}
}`;

function renderVersionsPage(data) {
  const brand = data.brand;
  const shown = displayTitle(data.title, brand);
  const versions = data.versions.map((v) => ({ n: v.n, date: v.date }));
  const latest = versions[versions.length - 1];
  const first = versions[0];
  const rows = versions
    .slice()
    .reverse()
    .map((v) => {
      const isLatest = latest && v.n === latest.n;
      return (
        '<li class="vrow' + (isLatest ? " latest" : "") + '"><span class="v">v' + v.n + "</span>" +
        '<span class="d"><span class="lbl">Updated </span>' + esc(fmtDate(v.date)) +
        (isLatest ? '<span class="latesttag">latest, what the latest link shows</span>' : "") + "</span>" +
        '<span class="acts"><a href="../v' + v.n + '/" aria-label="Open v' + v.n + " of " + esc(shown) + '">Open</a>' +
        '<button type="button" class="copy" data-url="../v' + v.n + '/" aria-label="Copy v' + v.n + " link for " + esc(shown) + '">Copy v' + v.n + " link</button>" +
        "</span></li>"
      );
    })
    .join("");
  const idline = versions.length
    ? plural(versions.length, "version") + " &middot; first published " + esc(fmtDate(first.date))
    : plural(0, "version");
  return (
    head(shown + ": version history", VERSIONS_CSS, brand) +
    "<body>" + header("Version history", brand) +
    '<main class="wrap">' +
    '<div class="hero"><h1>' + esc(shown) + "</h1>" +
    '<div class="idline">' + idline + "</div>" +
    '<div class="cta"><a class="btn" href="../">Open latest' + (latest ? " (v" + latest.n + ")" : "") + "</a>" +
    '<button type="button" class="linkbtn copy" data-url="../" aria-label="Copy latest link for ' + esc(shown) + '">Copy latest link</button></div>' +
    '<p class="status" id="status" role="status" aria-live="polite"></p>' +
    '<p class="hint">The latest link always shows the newest version, including any published later. The numbered links below stay frozen on their version.</p></div>' +
    '<h2>Versions <span class="num">newest first</span></h2>' +
    '<div class="vhead" aria-hidden="true"><span>Version</span><span>Updated</span><span></span></div>' +
    '<ol class="versions">' + rows + "</ol>" +
    footer(brand.historyFooterHtml, brand) +
    "</main>" + THEME_SCRIPT + COPY_SCRIPT + "</body></html>"
  );
}

module.exports = { DEFAULT_ACCENT, renderIndexPage, renderVersionsPage, injectDarkToggle, injectMarkdownExport, unlabelledDiagrams, assertScriptSafe, displayTitle, esc };
