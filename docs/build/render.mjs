/**
 * Render a Goemon Global Finance strategy doc: Markdown → self-contained styled HTML → PDF.
 *
 *   node render.mjs <input.md> --title "..." --subtitle "..."
 *
 * - marked converts MD (GFM tables, heading slugs).
 * - print.css is inlined so the .html is standalone.
 * - A cover page + auto TOC (from h2/h3) are prepended.
 * - Playwright Chromium prints Letter PDF with page numbers in the footer.
 *
 * Outputs <input>.html and <input>.pdf next to the source.
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const input = argv[0];
if (!input) {
  console.error("usage: node render.mjs <input.md> --title <t> --subtitle <s>");
  process.exit(1);
}
const flag = (name, def = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const title = flag("title", basename(input).replace(/\.md$/, ""));
const subtitle = flag("subtitle", "");

const outBase = input.replace(/\.md$/, "");
const htmlPath = `${outBase}.html`;
const pdfPath = `${outBase}.pdf`;

// ---- markdown -> html -----------------------------------------------------
const md = readFileSync(input, "utf8");

const slug = (s) =>
  s.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

// Collect headings for the TOC and add anchor ids.
const toc = [];
const renderer = new marked.Renderer();
const origHeading = renderer.heading.bind(renderer);
renderer.heading = (text, level, raw) => {
  const id = slug(typeof raw === "string" ? raw : text);
  if (level === 2 || level === 3) toc.push({ level, id, text: stripTags(text) });
  return `<h${level} id="${id}">${text}</h${level}>\n`;
};
function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, "");
}

marked.setOptions({ gfm: true, breaks: false, renderer });
const body = marked.parse(md);

const tocHtml = toc.length
  ? `<nav class="toc"><h2>Contents</h2><ol>${toc
      .map(
        (t) =>
          `<li class="lvl-${t.level}"><a href="#${t.id}">${t.text}</a></li>`
      )
      .join("")}</ol></nav>`
  : "";

const css = readFileSync(join(here, "print.css"), "utf8");
const dateStr = new Date().toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const DISCLAIMER =
  "Strategic guidance only — not legal, financial, tax, or investment advice. " +
  "Securities, money-transmission, and corporate-formation decisions must be reviewed by " +
  "licensed counsel and a CPA before you act. Sections flagged “⚖ see counsel” are where this " +
  "matters most.";

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Goemon Global Finance</title>
<style>${css}</style>
</head>
<body>
<section class="cover">
  <div class="mark">B</div>
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ""}
  <div class="meta">Goemon Global Finance &nbsp;·&nbsp; Confidential — Founder &nbsp;·&nbsp; <b>${dateStr}</b></div>
  <div class="disclaimer">${DISCLAIMER}</div>
</section>
<div class="wrap">
  ${tocHtml}
  <main class="content">
${body}
  </main>
</div>
</body></html>`;

writeFileSync(htmlPath, html);
console.log(`[render] wrote ${htmlPath} (${(html.length / 1024).toFixed(0)} KB)`);

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ---- html -> pdf ----------------------------------------------------------
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve(htmlPath)).href, { waitUntil: "networkidle" });
  await page.pdf({
    path: pdfPath,
    format: "Letter",
    printBackground: true,
    margin: { top: "0", bottom: "16mm", left: "0", right: "0" },
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="width:100%;font-family:sans-serif;font-size:8px;color:#9aa1a6;padding:0 18mm;display:flex;justify-content:space-between;">' +
      `<span>Goemon Global Finance · ${escapeHtml(title)}</span>` +
      '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
} finally {
  await browser.close();
}

const bytes = statSync(pdfPath).size;
if (bytes < 5000) {
  console.error(`[render] PDF suspiciously small (${bytes} bytes) — aborting`);
  process.exit(2);
}
console.log(`[render] wrote ${pdfPath} (${(bytes / 1024).toFixed(0)} KB)`);
