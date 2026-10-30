#!/usr/bin/env node
// سایت ثابت دست‌به‌دست: از داده‌ی عمومی ربات (/api/catalog.json) برای هر کتاب یک صفحه می‌سازد.
// استفاده:
//   CATALOG_URL=https://.../api/catalog.json BASE_URL=https://user.github.io/repo node build.mjs
//   node build.mjs --in test/fixture.json --out dist   (بدون شبکه)
// هیچ وابستگی خارجی ندارد تا روی هر سرور (حتی داخل ایران) با یک Node ساده ساخته شود.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const CATEGORIES = { olympiad: "المپیاد", konkur: "کنکور", school: "درسی", helper: "کمک‌درسی", general: "عمومی" };
const CONDITIONS = { new: "نو", like_new: "در حد نو", clean: "تمیز", marked: "نوشته‌دار" };

// ---------- helpers ----------

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
export const fa = (s) => String(s).replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
export const price = (t) => fa(t.toLocaleString("en-US")).replace(/,/g, "٬") + " تومان";

/** همان نرمال‌سازی ساده‌ای که search.js در مرورگر انجام می‌دهد */
export const searchKey = (s) =>
  String(s ?? "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[آأإ]/g, "ا")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u200C\s]+/g, "")
    .toLowerCase();

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return Math.round(m / 1000) * 1000;
}

const persianDate = (iso) =>
  new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "long", timeZone: "Asia/Tehran" }).format(new Date(iso));

function botLinks(bots, start) {
  const links = [];
  if (bots.tg) links.push({ label: "تلگرام", url: `https://t.me/${bots.tg}?start=${start}` });
  if (bots.bale) links.push({ label: "بله", url: `https://ble.ir/${bots.bale}?start=${start}` });
  return links;
}

// ---------- pages ----------

function layout(ctx, { title, description, path, body, jsonld }) {
  const canonical = ctx.baseUrl + path;
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="fa_IR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="theme-color" content="#1F5C46">
<link rel="preload" href="${ctx.base}/assets/fonts/Vazirmatn.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${ctx.base}/assets/style.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
</head>
<body>
<header class="top"><a class="brand" href="${ctx.base}/">دست‌به‌دست</a><span class="tag">کتاب دست‌دوم، از دست به دست</span></header>
<main>
${body}
</main>
<footer>
<p>به‌روزرسانی: ${esc(persianDate(ctx.generatedAt))}</p>
<p>ثبت آگهی رایگانه. قبل از دیدن کتاب، پیش‌پرداخت کارت‌به‌کارت نکنید.</p>
</footer>
</body>
</html>
`;
}

function ctaButtons(ctx, start, label) {
  const links = botLinks(ctx.bots, start);
  if (!links.length) return "";
  return `<div class="cta">${links
    .map((l, i) => `<a class="btn${i ? " btn-alt" : ""}" href="${esc(l.url)}" rel="nofollow">${esc(label)} در ${l.label}</a>`)
    .join("")}</div>`;
}

function listingItem(l, i) {
  const parts = [
    CONDITIONS[l.condition] ?? l.condition,
    l.edition_year ? `چاپ ${fa(l.edition_year)}` : null,
    [l.city, l.district].filter(Boolean).join("، ") || null,
    l.in_person && l.by_post ? "حضوری و پستی" : l.by_post ? "پستی" : "حضوری",
  ].filter(Boolean);
  const p = l.price === null ? "فقط تبادل" : l.swappable ? `${price(l.price)} یا تبادل` : price(l.price);
  const rating = l.seller_rating
    ? `<span class="rating" title="امتیاز فروشنده">★${fa(String(l.seller_rating.avg).replace(".", "٫"))} (${fa(l.seller_rating.count)})</span>`
    : "";
  return `<li class="listing"><span class="num">${fa(i + 1)}</span><div><strong>${esc(p)}</strong> ${rating}<br><span class="muted">${esc(parts.join(" · "))}</span></div></li>`;
}

export function bookPage(ctx, b) {
  const prices = b.listings.filter((l) => l.price !== null).map((l) => l.price);
  const typical = median(prices);
  const meta = [b.author && `نویسنده: ${b.author}`, b.publisher && `ناشر: ${b.publisher}`].filter(Boolean).join(" · ");
  const tags = [CATEGORIES[b.category], b.subject, b.grade].filter(Boolean);
  const has = b.listings.length > 0;

  const description = has
    ? `${b.title}${b.publisher ? ` (${b.publisher})` : ""} دست‌دوم: ${fa(b.listings.length)} نسخه${
        prices.length ? ` از ${price(Math.min(...prices))}` : ""
      }. خرید، فروش و تبادل کتاب دست‌دوم در دست‌به‌دست.`
    : `${b.title}${b.publisher ? ` (${b.publisher})` : ""} دست‌دوم: ${fa(b.waiting)} نفر منتظر این کتاب‌اند. اگر داری، رایگان ثبتش کن.`;

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "Book",
    name: b.title,
    ...(b.author ? { author: { "@type": "Person", name: b.author } } : {}),
    ...(b.publisher ? { publisher: { "@type": "Organization", name: b.publisher } } : {}),
    inLanguage: "fa",
    ...(prices.length
      ? {
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "IRR", // تومان در schema.org کد ندارد؛ ریال = تومان × ۱۰
            lowPrice: Math.min(...prices) * 10,
            highPrice: Math.max(...prices) * 10,
            offerCount: b.listings.length,
            itemCondition: "https://schema.org/UsedCondition",
            availability: "https://schema.org/InStock",
          },
        }
      : {}),
  };

  const body = `
<nav class="crumbs"><a href="${ctx.base}/">همه‌ی کتاب‌ها</a></nav>
<article class="book">
<h1>${esc(b.title)}</h1>
${meta ? `<p class="muted">${esc(meta)}</p>` : ""}
${tags.length ? `<p class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join("")}</p>` : ""}
${b.validity_note ? `<p class="note">${esc(b.validity_note)}</p>` : ""}
<div class="stats">
<div><b>${fa(b.listings.length)}</b><span>نسخه موجود</span></div>
<div><b>${fa(b.waiting)}</b><span>نفر منتظرند</span></div>
${typical !== null ? `<div><b>${esc(price(typical))}</b><span>قیمت معمول</span></div>` : ""}
</div>
${
  has
    ? `<h2>آگهی‌ها</h2><ol class="listings">${b.listings.map(listingItem).join("")}</ol>
${ctaButtons(ctx, `b_${b.id}`, "پیام به فروشنده")}
<p class="muted small">گفتگو با فروشنده از طریق ربات انجام می‌شه؛ آیدی و شماره‌ی کسی نمایش داده نمی‌شه.</p>`
    : `<p class="empty">فعلاً کسی این کتاب رو نداره. درخواست بده تا به محض ثبت شدنش خبرت کنیم.</p>
${ctaButtons(ctx, `b_${b.id}`, "دنبال این کتابم")}`
}
<section class="sell">
<p>این کتاب رو داری؟ ثبت آگهی رایگانه${b.waiting ? ` و ${fa(b.waiting)} نفر همین الان منتظرشن` : ""}.</p>
${ctaButtons(ctx, "sell", "ثبت کتاب")}
</section>
</article>`;

  return layout(ctx, { title: `${b.title} دست‌دوم | دست‌به‌دست`, description, path: `/b/${b.id}/`, body, jsonld });
}

export function indexPage(ctx, books) {
  // کتاب‌های دارای آگهی اول، بعد پرتقاضاها
  const sorted = [...books].sort((a, b) => b.listings.length - a.listings.length || b.waiting - a.waiting || a.id - b.id);
  const cats = Object.entries(CATEGORIES).filter(([k]) => books.some((b) => b.category === k));
  const card = (b) => {
    const prices = b.listings.filter((l) => l.price !== null).map((l) => l.price);
    const supply = b.listings.length
      ? `${fa(b.listings.length)} نسخه${prices.length ? ` · از ${price(Math.min(...prices))}` : ""}`
      : "هنوز کسی نداره";
    const key = searchKey([b.title, b.author, b.publisher].filter(Boolean).join(" "));
    return `<li class="card" data-q="${esc(key)}" data-cat="${esc(b.category ?? "")}"><a href="${ctx.base}/b/${b.id}/">
<strong>${esc(b.title)}</strong>
<span class="muted">${esc([b.publisher, CATEGORIES[b.category]].filter(Boolean).join(" · "))}</span>
<span class="supply${b.listings.length ? "" : " none"}">${esc(supply)}${b.waiting ? ` · ${fa(b.waiting)} منتظر` : ""}</span>
</a></li>`;
  };
  const body = `
<section class="hero">
<h1>کتاب دست‌دوم بخر، بفروش، عوض کن</h1>
<p>المپیاد، کنکور، درسی، کمک‌درسی و عمومی. برای هر کتاب یک صفحه: چند نفر دارن، چند نفر منتظرن، قیمت معمول چقدره.</p>
${ctaButtons(ctx, "sell", "ثبت رایگان کتاب")}
</section>
<section class="finder">
<input id="q" type="search" placeholder="اسم کتاب، نویسنده یا ناشر…" aria-label="جستجو" autocomplete="off">
${
  cats.length > 1
    ? `<div class="chips" role="group" aria-label="دسته"><button class="chip on" data-cat="">همه</button>${cats
        .map(([k, v]) => `<button class="chip" data-cat="${k}">${esc(v)}</button>`)
        .join("")}</div>`
    : ""
}
<p id="none" class="empty" hidden>چیزی پیدا نشد. توی ربات «کتابم نیست؟» رو بزن تا به محض ثبت شدنش خبرت کنیم.</p>
<ul id="books" class="cards">${sorted.map(card).join("")}</ul>
</section>
<script src="${ctx.base}/assets/search.js" defer></script>`;
  return layout(ctx, {
    title: "دست‌به‌دست | خرید، فروش و تبادل کتاب دست‌دوم",
    description: `${fa(books.length)} کتاب دست‌دوم المپیاد، کنکور، درسی و عمومی. ثبت آگهی رایگان، گفتگوی امن با فروشنده.`,
    path: "/",
    body,
    jsonld: { "@context": "https://schema.org", "@type": "WebSite", name: "دست‌به‌دست", url: ctx.baseUrl + "/", inLanguage: "fa" },
  });
}

function notFound(ctx) {
  return layout(ctx, {
    title: "صفحه پیدا نشد | دست‌به‌دست",
    description: "این صفحه وجود نداره.",
    path: "/404.html",
    body: `<p class="empty">این صفحه وجود نداره، یا آگهی‌های این کتاب تموم شدن. <a href="${ctx.base}/">همه‌ی کتاب‌ها</a></p>`,
  });
}

function sitemap(ctx, books) {
  const urls = ["/", ...books.map((b) => `/b/${b.id}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(ctx.baseUrl + u)}</loc><lastmod>${ctx.generatedAt.slice(0, 10)}</lastmod></url>`).join("\n")}
</urlset>
`;
}

// ---------- build ----------

export function build(data, { baseUrl, outDir }) {
  if (data?.version !== 1 || !Array.isArray(data.books)) throw new Error("catalog.json نامعتبر است");
  const url = new URL(baseUrl.replace(/\/+$/, "") + "/");
  const ctx = {
    baseUrl: url.href.replace(/\/$/, ""),
    base: url.pathname.replace(/\/$/, ""), // مثلاً /dast2dast-site برای سایت پروژه‌ی گیت‌هاب
    bots: data.bots ?? {},
    generatedAt: data.generated_at,
  };
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "b"), { recursive: true });
  cpSync(join(HERE, "assets"), join(outDir, "assets"), { recursive: true });
  writeFileSync(join(outDir, ".nojekyll"), "");
  writeFileSync(join(outDir, "index.html"), indexPage(ctx, data.books));
  writeFileSync(join(outDir, "404.html"), notFound(ctx));
  for (const b of data.books) {
    mkdirSync(join(outDir, "b", String(b.id)), { recursive: true });
    writeFileSync(join(outDir, "b", String(b.id), "index.html"), bookPage(ctx, b));
  }
  writeFileSync(join(outDir, "sitemap.xml"), sitemap(ctx, data.books));
  writeFileSync(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${ctx.baseUrl}/sitemap.xml\n`);
  return { pages: data.books.length + 1 };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const input = arg("--in");
  const outDir = arg("--out") ?? join(HERE, "dist");
  const baseUrl = process.env.BASE_URL || "http://localhost:8080";
  let data;
  if (input) {
    data = JSON.parse(readFileSync(input, "utf8"));
  } else {
    const src = process.env.CATALOG_URL;
    if (!src) throw new Error("CATALOG_URL یا --in لازم است");
    const res = await fetch(src);
    if (!res.ok) throw new Error(`دریافت ${src} ناموفق بود: ${res.status}`);
    data = await res.json();
  }
  const { pages } = build(data, { baseUrl, outDir });
  console.log(`built ${pages} pages into ${outDir} (base ${baseUrl})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
