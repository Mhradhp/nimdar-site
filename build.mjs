#!/usr/bin/env node
// سایت ثابت دست‌به‌دست: از داده‌ی عمومی ربات (/api/catalog.json) برای هر کتاب یک صفحه می‌سازد.
// استفاده:
//   CATALOG_URL=https://.../api/catalog.json BASE_URL=https://user.github.io/repo node build.mjs
//   node build.mjs --in test/fixture.json --out dist   (بدون شبکه)
// هیچ وابستگی خارجی ندارد تا روی هر سرور (حتی داخل ایران) با یک Node ساده ساخته شود.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// همان فهرست‌های src/bot/taxonomy.ts در مخزن ربات؛ کلیدها باید یکی بمانند
export const CATEGORIES = {
  olympiad: "المپیاد",
  konkur: "کنکور",
  school: "درسی (مدرسه)",
  helper: "کمک‌درسی",
  university: "دانشگاهی",
  language: "زبان خارجی",
  novel: "رمان و داستان",
  literature: "شعر و ادبیات",
  history: "تاریخ و جامعه",
  philosophy: "فلسفه و روان‌شناسی",
  selfhelp: "خودیاری و موفقیت",
  kids: "کودک و نوجوان",
  science: "علمی و عمومی",
  art: "هنر",
  computer: "کامپیوتر و برنامه‌نویسی",
  general: "سایر",
};
const CONDITIONS = {
  new: "نو (آکبند)",
  like_new: "در حد نو",
  clean: "تمیز",
  used: "کارکرده",
  marked: "نوشته‌دار یا هایلایت‌شده",
  worn: "فرسوده",
};
/** کد عمومی کاربر (همان کد معرف)؛ قبل از ساختن مسیر فایل چک می‌شود */
const CODE_RE = /^[A-Z0-9]{4,12}$/;

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

function layout(ctx, { title, description, path, body, jsonld, noindex }) {
  const canonical = ctx.baseUrl + path;
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex">' : ""}
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

function listingItem(ctx, l, i) {
  const parts = [
    CONDITIONS[l.condition] ?? l.condition,
    l.edition_year ? `چاپ ${fa(l.edition_year)}` : null,
    l.has_answers === 1 ? "با پاسخنامه" : l.has_answers === 0 ? "بدون پاسخنامه" : null,
    [l.city, l.district].filter(Boolean).join("، ") || null,
    l.in_person && l.by_post ? "حضوری و پستی" : l.by_post ? "پستی" : "حضوری",
  ].filter(Boolean);
  const p = l.gift
    ? "رایگان (کتاب معلق)"
    : l.price === null
      ? "فقط تبادل"
      : l.swappable
        ? `${price(l.price)} یا تبادل`
        : price(l.price);
  const rating = l.seller_rating
    ? `<span class="rating" title="امتیاز فروشنده">★${fa(String(l.seller_rating.avg).replace(".", "٫"))} (${fa(l.seller_rating.count)})</span>`
    : "";
  // فقط فروشنده‌ای که خودش پروفایل عمومی خواسته و تأیید شده لینک دارد
  const seller = l.seller && ctx.profiles.get(l.seller);
  const sellerHtml = seller
    ? `<br><span class="muted small">فروشنده: <a href="${ctx.base}/u/${esc(seller.code)}/">«${esc(seller.nickname)}»</a></span>`
    : "";
  const held = l.reserved ? ` <span class="reserved">رزرو شده</span>` : "";
  return `<li class="listing"><span class="num">${fa(i + 1)}</span><div><strong>${esc(p)}</strong> ${rating}${held}<br><span class="muted">${esc(parts.join(" · "))}</span>${sellerHtml}</div></li>`;
}

/** نظر برچسبی خواننده‌ها (برچسب‌های ثابت؛ متن آزاد نیست) */
function readerTags(b) {
  const tags = (b.tags ?? []).slice(0, 6);
  if (!tags.length) return "";
  return `<h2>نظر ${fa(b.tag_voters ?? 0)} خواننده</h2>
<p class="reader-tags">${tags.map((t) => `<span>${esc(t.label)} <b>${fa(t.n)}</b></span>`).join("")}</p>`;
}

/** پرسش و پاسخ‌هایی که ادمین تأیید کرده؛ پرسیدن و جواب دادن فقط از راه ربات */
function qaSection(ctx, b) {
  const qa = b.qa ?? [];
  const ask = ctaButtons(ctx, `b_${b.id}`, "سؤال بپرس");
  if (!qa.length) return `<h2>پرسش و پاسخ</h2><p class="muted">هنوز سؤالی پرسیده نشده. سؤالت رو از ربات بپرس تا کسانی که این کتاب رو داشتن جواب بدن.</p>${ask}`;
  return `<h2>پرسش و پاسخ</h2>
<dl class="qa">${qa.map((x) => `<dt>${esc(x.q)}</dt><dd>${esc(x.a)}</dd>`).join("")}</dl>
<p class="muted small">جواب‌ها از کسانی است که این کتاب رو دارن یا داشتن.</p>${ask}`;
}

export function bookPage(ctx, b) {
  const prices = b.listings.filter((l) => l.price !== null && !l.gift).map((l) => l.price);
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
    ...(b.isbn ? { isbn: b.isbn } : {}),
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
    ? `<h2>آگهی‌ها</h2><ol class="listings">${b.listings.map((l, i) => listingItem(ctx, l, i)).join("")}</ol>
${ctaButtons(ctx, `b_${b.id}`, "پیام به فروشنده")}
<p class="muted small">گفتگو با فروشنده از طریق ربات انجام می‌شه؛ آیدی و شماره‌ی کسی نمایش داده نمی‌شه.</p>`
    : `<p class="empty">فعلاً کسی این کتاب رو نداره. درخواست بده تا به محض ثبت شدنش خبرت کنیم.</p>
${ctaButtons(ctx, `b_${b.id}`, "دنبال این کتابم")}`
}
${readerTags(b)}
${qaSection(ctx, b)}
<section class="sell">
<p>این کتاب رو داری؟ ثبت آگهی رایگانه${b.waiting ? ` و ${fa(b.waiting)} نفر همین الان منتظرشن` : ""}.</p>
${ctaButtons(ctx, "sell", "ثبت کتاب")}
</section>
</article>`;

  return layout(ctx, { title: `${b.title} دست‌دوم | دست‌به‌دست`, description, path: `/b/${b.id}/`, body, jsonld });
}

function bookCard(ctx, b) {
  const prices = b.listings.filter((l) => l.price !== null).map((l) => l.price);
  const gifts = b.listings.filter((l) => l.gift).length;
  const supply = b.listings.length
    ? `${fa(b.listings.length)} نسخه${prices.length ? ` · از ${price(Math.min(...prices))}` : ""}${gifts ? " · کتاب معلق" : ""}`
    : "هنوز کسی نداره";
  const key = searchKey([b.title, b.author, b.publisher].filter(Boolean).join(" "));
  return `<li class="card" data-q="${esc(key)}" data-cat="${esc(b.category ?? "")}"><a href="${ctx.base}/b/${b.id}/">
<strong>${esc(b.title)}</strong>
<span class="muted">${esc([b.publisher, CATEGORIES[b.category]].filter(Boolean).join(" · "))}</span>
<span class="supply${b.listings.length ? "" : " none"}">${esc(supply)}${b.waiting ? ` · ${fa(b.waiting)} منتظر` : ""}</span>
</a></li>`;
}

export function indexPage(ctx, books) {
  // کتاب‌های دارای آگهی اول، بعد پرتقاضاها
  const sorted = [...books].sort((a, b) => b.listings.length - a.listings.length || b.waiting - a.waiting || a.id - b.id);
  const cats = Object.entries(CATEGORIES).filter(([k]) => books.some((b) => b.category === k));
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
<ul id="books" class="cards">${sorted.map((b) => bookCard(ctx, b)).join("")}</ul>
</section>
${browseNav(ctx, books)}
<script src="${ctx.base}/assets/search.js" defer></script>`;
  return layout(ctx, {
    title: "دست‌به‌دست | خرید، فروش و تبادل کتاب دست‌دوم",
    description: `${fa(books.length)} کتاب دست‌دوم المپیاد، کنکور، درسی و عمومی. ثبت آگهی رایگان، گفتگوی امن با فروشنده.`,
    path: "/",
    body,
    jsonld: { "@context": "https://schema.org", "@type": "WebSite", name: "دست‌به‌دست", url: ctx.baseUrl + "/", inLanguage: "fa" },
  });
}

/** صفحه‌ی عمومی قفسه‌ی یک کاربر (فقط کسی که خودش خواسته و ادمین تأیید کرده) */
export function profilePage(ctx, p, books) {
  const mine = [];
  for (const b of books) for (const l of b.listings) if (l.seller === p.code) mine.push({ b, l });
  const rating = p.rating ? `★${fa(String(p.rating.avg).replace(".", "٫"))} (${fa(p.rating.count)} رأی)` : null;
  const facts = [p.city, rating, p.stats?.sold ? `${fa(p.stats.sold)} فروش` : null, p.stats?.given ? `${fa(p.stats.given)} اهدا` : null].filter(Boolean);
  const body = `
<nav class="crumbs"><a href="${ctx.base}/">همه‌ی کتاب‌ها</a></nav>
<article class="book">
<h1>قفسه‌ی «${esc(p.nickname)}»</h1>
${facts.length ? `<p class="muted">${esc(facts.join(" · "))}</p>` : ""}
${p.badges?.length ? `<p class="tags">${p.badges.map((x) => `<span>${esc(x)}</span>`).join("")}</p>` : ""}
${p.bio ? `<p>${esc(p.bio)}</p>` : ""}
<h2>کتاب‌ها</h2>
${
  mine.length
    ? `<ul class="cards">${mine
        .map(
          ({ b, l }) =>
            `<li class="card"><a href="${ctx.base}/b/${b.id}/"><strong>${esc(b.title)}</strong><span class="muted">${esc(
              [CONDITIONS[l.condition], l.city].filter(Boolean).join(" · "),
            )}</span><span class="supply">${esc(l.gift ? "رایگان (کتاب معلق)" : l.price === null ? "فقط تبادل" : price(l.price))}</span></a></li>`,
        )
        .join("")}</ul>`
    : `<p class="empty">فعلاً کتابی توی این قفسه نیست.</p>`
}
${ctaButtons(ctx, `u_${p.code}`, "دیدن قفسه")}
</article>`;
  return layout(ctx, {
    title: `قفسه‌ی «${p.nickname}» | دست‌به‌دست`,
    description: `کتاب‌های دست‌دوم «${p.nickname}» در دست‌به‌دست.`,
    path: `/u/${p.code}/`,
    body,
    noindex: true, // برای اشتراک‌گذاری است، نه گوگل؛ بیشتر کاربرها دانش‌آموزند
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
  const urls = ["/", ...listPages(books).map((p) => encodeURI(p.path)), ...books.map((b) => `/b/${b.id}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(ctx.baseUrl + u)}</loc><lastmod>${ctx.generatedAt.slice(0, 10)}</lastmod></url>`).join("\n")}
</urlset>
`;
}

// ---------- صفحه‌های فهرست (برای جستجوهایی مثل «کتاب دست دوم کنکور» یا «کتاب دست دوم شیراز») ----------

/** نام فارسی به نام پوشه: فقط حرف و عدد، فاصله و نیم‌فاصله به «-» */
export function slug(s) {
  return String(s ?? "")
    .trim()
    .replace(/[\s\u200c]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const byListings = (a, b) => b.listings.length - a.listings.length || b.waiting - a.waiting || a.id - b.id;

/** همه‌ی صفحه‌های فهرست: دسته، پایه، شهر، و تابلوی تقاضا */
export function listPages(books) {
  const pages = [];
  for (const [k, v] of Object.entries(CATEGORIES)) {
    const list = books.filter((b) => b.category === k);
    if (list.length)
      pages.push({ path: `/c/${k}/`, label: v, h1: `کتاب دست‌دوم ${v}`, books: list, kind: "cat",
        intro: `خرید، فروش و تبادل کتاب دست‌دوم ${v}: ${fa(list.length)} کتاب، با قیمت معمول و تعداد منتظر هر کدوم.` });
  }
  const grades = new Map();
  for (const b of books) if (b.grade && slug(b.grade)) grades.set(b.grade, [...(grades.get(b.grade) ?? []), b]);
  for (const [g, list] of grades)
    pages.push({ path: `/g/${slug(g)}/`, label: g, h1: `کتاب دست‌دوم ${g}`, books: list, kind: "grade",
      intro: `کتاب‌های درسی، کمک‌درسی و کنکور ${g}، دست‌دوم و ارزون‌تر.` });
  const cities = new Map();
  for (const b of books) for (const c of new Set(b.listings.map((l) => l.city).filter(Boolean))) if (slug(c)) cities.set(c, [...(cities.get(c) ?? []), b]);
  for (const [c, list] of cities)
    pages.push({ path: `/city/${slug(c)}/`, label: c, h1: `کتاب دست‌دوم در ${c}`, books: list, kind: "city",
      intro: `${fa(list.length)} کتاب که در ${c} برای فروش، تبادل یا اهدا ثبت شده. تحویل حضوری یا پستی.` });
  const wanted = books.filter((b) => b.waiting > 0).sort((a, b) => b.waiting - a.waiting || a.id - b.id);
  if (wanted.length)
    pages.push({ path: "/wanted/", label: "الان کسی می‌خواد", h1: "این کتاب‌ها رو الان کسی می‌خواد", books: wanted, kind: "wanted",
      intro: "اگه یکی از این کتاب‌ها رو داری، همین الان خریدار داره. ثبت آگهی رایگانه و به محض ثبت، به منتظرها خبر داده می‌شه." });
  return pages;
}

function listPage(ctx, pg) {
  const books = pg.kind === "wanted" ? pg.books : [...pg.books].sort(byListings);
  const body = `
<nav class="crumbs"><a href="${ctx.base}/">همه‌ی کتاب‌ها</a></nav>
<h1>${esc(pg.h1)}</h1>
<p class="muted">${esc(pg.intro)}</p>
${pg.kind === "wanted" ? ctaButtons(ctx, "sell", "کتاب دارم، ثبتش می‌کنم") : ""}
<ul class="cards">${books.map((b) => bookCard(ctx, b)).join("")}</ul>
${pg.kind === "wanted" ? "" : `<section class="sell"><p>کتابت اینجا نیست؟ ثبت آگهی رایگانه.</p>${ctaButtons(ctx, "sell", "ثبت کتاب")}</section>`}`;
  const title = pg.kind === "wanted" ? "کتاب‌هایی که الان خریدار دارن | دست‌به‌دست" : `${pg.h1} | خرید و فروش | دست‌به‌دست`;
  return layout(ctx, {
    title,
    description: pg.intro,
    path: pg.path,
    body,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: pg.h1,
      itemListElement: books.slice(0, 50).map((b, i) => ({ "@type": "ListItem", position: i + 1, url: `${ctx.baseUrl}/b/${b.id}/`, name: b.title })),
    },
  });
}

/** پیوند به صفحه‌های فهرست از صفحه‌ی اصلی (برای کاربر و برای خزنده‌ی گوگل) */
function browseNav(ctx, books) {
  const pages = listPages(books);
  const group = (kind, title) => {
    const items = pages.filter((p) => p.kind === kind);
    return items.length
      ? `<h3>${title}</h3><p class="browse">${items.map((p) => `<a href="${ctx.base}${encodeURI(p.path)}">${esc(p.label)}</a>`).join("")}</p>`
      : "";
  };
  const wanted = pages.find((p) => p.kind === "wanted");
  return `<section class="browse-all">
<h2>مرور کتاب‌ها</h2>
${wanted ? `<p><a class="wanted-link" href="${ctx.base}/wanted/">${fa(wanted.books.length)} کتاب که الان کسی دنبالشه ←</a></p>` : ""}
${group("cat", "دسته‌ها")}${group("grade", "پایه‌ها")}${group("city", "شهرها")}
</section>`;
}

// ---------- برچسب سفر کتاب (QR) ----------

/** صفحه‌ی چاپ برچسب: ?c=<کد نسخه>&t=<اسم کتاب>. QR در خود مرورگر ساخته می‌شود و به ربات (?start=k_<کد>) لینک می‌دهد. */
function stickerPage(ctx) {
  const body = `
<section class="sticker-tool">
<h1>برچسب سفر کتاب</h1>
<p class="muted no-print">این برچسب رو چاپ کن و بچسبون داخل جلد کتاب. هر کی اسکنش کنه، می‌بینه این نسخه از کجاها گذشته و بعد از خوندن می‌تونه بدش به نفر بعدی.</p>
<div id="sticker" class="sticker" data-bot="${esc(ctx.bots.tg ?? "")}" hidden>
<div id="qr" class="qr"></div>
<div class="sticker-text">
<strong>این کتاب داره سفر می‌کنه!</strong>
<span id="title" class="sticker-title"></span>
<span>اسکن کن ببین از کجاها گذشته. خوندیش؟ بدش به نفر بعدی.</span>
<span class="sticker-code">کد: <b id="code"></b> · دست‌به‌دست</span>
</div>
</div>
<p id="bad" class="empty" hidden>کد برچسب درست نیست. لینک رو از ربات دوباره بگیر.</p>
<p class="no-print"><button id="print" class="btn" type="button">چاپ برچسب</button></p>
</section>
<script src="${ctx.base}/assets/vendor/qrcode.min.js"></script>
<script src="${ctx.base}/assets/sticker.js"></script>`;
  return layout(ctx, { title: "برچسب سفر کتاب | دست‌به‌دست", description: "برچسب QR برای نسخه‌ای که دست‌به‌دست می‌شود.", path: "/sticker/", body, noindex: true });
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
    profiles: new Map((data.profiles ?? []).filter((p) => CODE_RE.test(p.code ?? "")).map((p) => [p.code, p])),
  };
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "b"), { recursive: true });
  cpSync(join(HERE, "assets"), join(outDir, "assets"), { recursive: true });
  // فایل‌هایی که باید عیناً در ریشه‌ی سایت باشند (مثلاً فایل تأیید Google Search Console)
  if (existsSync(join(HERE, "static"))) cpSync(join(HERE, "static"), outDir, { recursive: true });
  writeFileSync(join(outDir, ".nojekyll"), "");
  writeFileSync(join(outDir, "index.html"), indexPage(ctx, data.books));
  writeFileSync(join(outDir, "404.html"), notFound(ctx));
  for (const b of data.books) {
    mkdirSync(join(outDir, "b", String(b.id)), { recursive: true });
    writeFileSync(join(outDir, "b", String(b.id), "index.html"), bookPage(ctx, b));
  }
  for (const p of ctx.profiles.values()) {
    mkdirSync(join(outDir, "u", p.code), { recursive: true });
    writeFileSync(join(outDir, "u", p.code, "index.html"), profilePage(ctx, p, data.books));
  }
  const lists = listPages(data.books);
  for (const pg of lists) {
    mkdirSync(join(outDir, ...pg.path.split("/").filter(Boolean)), { recursive: true });
    writeFileSync(join(outDir, ...pg.path.split("/").filter(Boolean), "index.html"), listPage(ctx, pg));
  }
  mkdirSync(join(outDir, "sticker"), { recursive: true });
  writeFileSync(join(outDir, "sticker", "index.html"), stickerPage(ctx));
  writeFileSync(join(outDir, "sitemap.xml"), sitemap(ctx, data.books));
  writeFileSync(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${ctx.baseUrl}/sitemap.xml\n`);
  return { pages: data.books.length + ctx.profiles.size + lists.length + 1 };
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
