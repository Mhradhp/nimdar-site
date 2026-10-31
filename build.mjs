#!/usr/bin/env node
// سایت ثابت نیمدار: از داده‌ی عمومی ربات (/api/catalog.json) برای هر کتاب یک صفحه می‌سازد.
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

/** تصویر نیمو، سنجاب نیمدار (assets/mascot/<name>.webp)؛ تا تصویرهای نیمو آماده نشده‌اند (ctx.mascot خاموش) چیزی نشان داده نمی‌شود. متن alt برای دسترس‌پذیری و گوگل */
function mascot(ctx, name, alt, cls = "mascot", size = 160) {
  if (!ctx.mascot) return "";
  return `<img class="${cls}" src="${ctx.base}/assets/mascot/${name}.webp" width="${size}" height="${size}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}

/** لوگوی نوشتاری با فونت لاله‌زار؛ «به» نارنجی */
function wordmark() {
  return `<span class="wm"><span class="wm-be">نیم</span>دار</span>`;
}

/** دکمه‌ی «ثبت کتاب» در سربرگ (به ربات تلگرام) */
function navCta(ctx) {
  const l = botLinks(ctx.bots, "sell")[0];
  return l ? `<a class="nav-cta" href="${esc(l.url)}" rel="nofollow">📚 ثبت رایگان کتاب</a>` : "";
}

/** لینک کانال (فقط آیدی عمومی، مثل @dastbedast_org) */
function channelLinks(ctx) {
  const out = [];
  const tg = String(ctx.channels.tg ?? "");
  if (/^@[A-Za-z0-9_]{4,64}$/.test(tg)) out.push({ label: "کانال تلگرام", url: `https://t.me/${tg.slice(1)}` });
  const bale = String(ctx.channels.bale ?? "");
  if (/^@[A-Za-z0-9_]{4,64}$/.test(bale)) out.push({ label: "کانال بله", url: `https://ble.ir/${bale.slice(1)}` });
  return out;
}

/** سربرگ صفحه‌های داخلی: نوار تمام‌عرض با مسیر و عنوان */
function pageHead(ctx, { crumbs = [], title, sub = "", art = "", h1Class = "" }) {
  const trail = [`<a href="${ctx.base}/">خانه</a>`, ...crumbs.map((c) => (c.href ? `<a href="${c.href}">${esc(c.label)}</a>` : `<span>${esc(c.label)}</span>`))];
  return `<section class="page-head"><div class="wrap page-head-in">
<div>
<nav class="crumbs" aria-label="مسیر">${trail.join('<span class="sep">‹</span>')}</nav>
<h1${h1Class ? ` class="${h1Class}"` : ""}>${title}</h1>
${sub}
</div>
${art}
</div></section>`;
}

function layout(ctx, { title, description, path, body, jsonld, noindex, full }) {
  const canonical = ctx.baseUrl + path;
  const ch = channelLinks(ctx);
  const bot = botLinks(ctx.bots, "start")[0];
  const cats = Object.entries(CATEGORIES).filter(([k]) => ctx.catCounts.get(k));
  const cities = ctx.topCities;
  const navLinks = `<a href="${ctx.base}/#books">کتاب‌ها</a><a href="${ctx.base}/#cats">دسته‌ها</a><a href="${ctx.base}/wanted/">الان کسی می‌خواد</a><a href="${ctx.base}/#gift">کتاب معلق</a><a href="${ctx.base}/#faq">سؤالات</a><a href="${ctx.base}/help/">راهنما</a>`;
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
<meta property="og:site_name" content="نیمدار">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ctx.baseUrl)}/assets/brand/og.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="${ctx.base}/assets/brand/favicon.png">
<link rel="apple-touch-icon" href="${ctx.base}/assets/brand/apple-touch-icon.png">
<meta name="theme-color" content="#1F5C46">
<link rel="preload" href="${ctx.base}/assets/fonts/Vazirmatn.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${ctx.base}/assets/fonts/Lalezar.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${ctx.base}/assets/style.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
</head>
<body>
<a class="skip" href="#main">رفتن به محتوا</a>
<div class="topline"><div class="wrap">⚡ ثبت آگهی همیشه رایگانه · 🔔 کتابت نبود؟ درخواست بده، به محض اومدنش خبرت می‌کنیم${ch[0] ? ` · <a href="${esc(ch[0].url)}" rel="noopener">📣 ${esc(ch[0].label)}</a>` : ""}</div></div>
<header class="bar"><div class="wrap top">
<a class="brand" href="${ctx.base}/" aria-label="نیمدار، صفحه‌ی اصلی">${wordmark()}</a>
<nav class="nav" aria-label="اصلی">${navLinks}</nav>
<div class="bar-end">${navCta(ctx)}
<details class="menu"><summary aria-label="منو"><span></span><span></span><span></span></summary><nav class="menu-panel" aria-label="منوی موبایل">${navLinks}${ch.map((c) => `<a href="${esc(c.url)}" rel="noopener">📣 ${esc(c.label)}</a>`).join("")}</nav></details>
</div>
</div></header>
<main id="main">
${full ? body : `<div class="wrap page">${body}</div>`}
</main>
<footer class="foot">
<div class="wrap foot-cta">
${ctx.mascot ? `<img src="${ctx.base}/assets/mascot/hello.webp" width="120" height="120" alt="نیمو، سنجاب نیمدار" loading="lazy">` : ""}
<div><b>کتابی داری که دیگه لازمش نداری؟</b><p>زیر یک دقیقه ثبتش کن؛ کسی که منتظرشه همون لحظه خبردار می‌شه.</p></div>
${ctaButtons(ctx, "sell", "ثبت رایگان کتاب")}
</div>
<div class="wrap foot-grid">
<div class="foot-brand">${wordmark()}<p class="tagline">کتاب دست‌به‌دست</p><p>بازار کتاب دست‌دوم المپیاد، کنکور، درسی و هر کتاب دیگه. یک صفحه برای هر کتاب، نه یک پست برای هر آگهی.</p>
<p class="socials">${bot ? `<a href="${esc(bot.url)}" rel="nofollow">🤖 ربات ${esc(bot.label)}</a>` : ""}${ch.map((c) => `<a href="${esc(c.url)}" rel="noopener">📣 ${esc(c.label)}</a>`).join("")}</p></div>
${cats.length ? `<div><h3>دسته‌ها</h3><ul>${cats.slice(0, 8).map(([k, v]) => `<li><a href="${ctx.base}/c/${k}/">${esc(v)}</a></li>`).join("")}</ul></div>` : ""}
${cities.length ? `<div><h3>شهرها</h3><ul>${cities.slice(0, 8).map((c) => `<li><a href="${ctx.base}${encodeURI(`/city/${slug(c)}/`)}">${esc(c)}</a></li>`).join("")}</ul></div>` : ""}
<div><h3>نیمدار</h3><ul><li><a href="${ctx.base}/wanted/">کتاب‌هایی که خریدار دارن</a></li><li><a href="${ctx.base}/#how">چطور کار می‌کنه</a></li><li><a href="${ctx.base}/#gift">کتاب معلق</a></li><li><a href="${ctx.base}/#safe">معامله‌ی امن</a></li><li><a href="${ctx.base}/help/">راهنمای کامل</a></li>${botLinks(ctx.bots, "support")[0] ? `<li><a href="${esc(botLinks(ctx.bots, "support")[0].url)}" rel="nofollow">✉️ نظر، پیشنهاد یا سؤال</a></li>` : ""}<li><a href="${ctx.base}/#faq">سؤالات پرتکرار</a></li><li><a href="${ctx.base}/scan/">اسکن بارکد</a></li></ul></div>
</div>
<div class="foot-bottom"><div class="wrap">
<p class="foot-note">⚠️ قبل از دیدن کتاب، پیش‌پرداخت کارت‌به‌کارت نکنید. · فایل PDF کتاب ممنوعه. · به‌روزرسانی: ${esc(persianDate(ctx.generatedAt))}</p>
</div></div>
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
  const star = l.featured ? `<span class="featured">⭐ ویژه</span> ` : "";
  return `<li class="listing${l.featured ? " is-featured" : ""}"><span class="num">${fa(i + 1)}</span><div>${star}<strong>${esc(p)}</strong> ${rating}${held}<br><span class="muted">${esc(parts.join(" · "))}</span>${sellerHtml}</div></li>`;
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
  const art = mascot(ctx, "thinking", "نیمو، سنجاب نیمدار، فکر می‌کند", "mascot side", 110);
  const ask = ctaButtons(ctx, `b_${b.id}`, "سؤال بپرس");
  if (!qa.length) return `<h2>پرسش و پاسخ</h2>${art}<p class="muted">هنوز سؤالی پرسیده نشده. سؤالت رو از ربات بپرس تا کسانی که این کتاب رو داشتن جواب بدن.</p>${ask}`;
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
      }. خرید، فروش و تبادل کتاب دست‌دوم در نیمدار.`
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

  const catLink = b.category && CATEGORIES[b.category] ? [{ label: CATEGORIES[b.category], href: `${ctx.base}/c/${b.category}/` }] : [];
  const sub = `${meta ? `<p class="muted">${esc(meta)}</p>` : ""}
${tags.length ? `<p class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join("")}</p>` : ""}`;
  const body = `
${pageHead(ctx, { crumbs: [...catLink, { label: b.title }], title: esc(b.title), sub, art: `<div class="head-cover">${cover(b)}</div>` })}
<div class="wrap page book-layout">
<article class="book">
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
    : `<div class="say">${mascot(ctx, "notfound", "نیمو، سنجاب نیمدار، شانه بالا می‌اندازد")}<p class="empty">فعلاً کسی این کتاب رو نداره. درخواست بده تا به محض ثبت شدنش خبرت کنیم.</p></div>
${ctaButtons(ctx, `b_${b.id}`, "دنبال این کتابم")}`
}
${readerTags(b)}
${qaSection(ctx, b)}
</article>
<aside class="side">
<div class="side-card">
<b>${has ? "این کتاب رو می‌خوای؟" : "دنبال این کتابی؟"}</b>
<p>${has ? "از ربات به فروشنده پیام بده یا پیشنهاد قیمت بده." : "درخواست بده؛ به محض ثبت شدنش خبرت می‌کنیم."}</p>
${ctaButtons(ctx, `b_${b.id}`, has ? "خرید" : "درخواست")}
</div>
<section class="sell">
${mascot(ctx, "handoff", "نیمو، سنجاب نیمدار، کتابی را به دست دیگری می‌دهد", "mascot", 120)}
<p>این کتاب رو داری؟ ثبت آگهی رایگانه${b.waiting ? ` و ${fa(b.waiting)} نفر همین الان منتظرشن` : ""}.</p>
${ctaButtons(ctx, "sell", "ثبت کتاب")}
</section>
<div class="side-card safe-card"><b>⚠️ معامله‌ی امن</b><p>قبل از دیدن کتاب، پیش‌پرداخت کارت‌به‌کارت نکنید.</p></div>
</aside>
</div>`;

  return layout(ctx, { title: `${b.title} دست‌دوم | نیمدار`, description, path: `/b/${b.id}/`, body, jsonld, full: true });
}

const CAT_ICON = {
  olympiad: "🏅", konkur: "🎯", school: "🏫", helper: "📝", university: "🎓", language: "🌍", novel: "📖", literature: "🪶",
  history: "🏛", philosophy: "🧠", selfhelp: "🌱", kids: "🧸", science: "🔬", art: "🎨", computer: "💻", general: "📚",
};

/** جلد ساختگی کارت کتاب: رنگ از دسته، اسم کتاب با لاله‌زار */
function cover(b) {
  return `<span class="cover cv-${esc(b.category ?? "general")}" aria-hidden="true"><i>${CAT_ICON[b.category] ?? "📚"}</i><em>${esc(b.title.length > 42 ? b.title.slice(0, 40) + "…" : b.title)}</em></span>`;
}

function bookCard(ctx, b) {
  const prices = b.listings.filter((l) => l.price !== null).map((l) => l.price);
  const gifts = b.listings.filter((l) => l.gift).length;
  const supply = b.listings.length
    ? `${fa(b.listings.length)} نسخه${prices.length ? ` · از ${price(Math.min(...prices))}` : ""}${gifts ? " · کتاب معلق" : ""}`
    : "هنوز کسی نداره";
  const key = searchKey([b.title, b.author, b.publisher].filter(Boolean).join(" "));
  const badge = gifts ? `<span class="badge gift">🎁 رایگان</span>` : !b.listings.length && b.waiting ? `<span class="badge want">🔔 خریدار داره</span>` : "";
  return `<li class="card" data-q="${esc(key)}" data-cat="${esc(b.category ?? "")}"><a href="${ctx.base}/b/${b.id}/">
${cover(b)}${badge}
<span class="card-body">
<strong>${esc(b.title)}</strong>
<span class="muted">${esc([b.publisher, CATEGORIES[b.category]].filter(Boolean).join(" · "))}</span>
<span class="supply${b.listings.length ? "" : " none"}">${esc(supply)}${b.waiting ? ` · ${fa(b.waiting)} منتظر` : ""}</span>
</span>
</a></li>`;
}

const FAQ = [
  ["ثبت آگهی پول داره؟", "نه. ثبت آگهی همیشه رایگانه و هیچ کارمزدی از فروش گرفته نمی‌شه."],
  ["چطور با فروشنده حرف بزنم؟", "از صفحه‌ی کتاب «پیام به فروشنده» رو بزن. گفتگو از طریق ربات انجام می‌شه و آیدی و شماره‌ی هیچ‌کس به طرف مقابل نشون داده نمی‌شه."],
  ["کتابی که می‌خوام نیست؛ چی کار کنم؟", "توی ربات درخواستش رو ثبت کن (می‌تونی سقف قیمت هم بذاری). به محض اینکه کسی ثبتش کنه، همون لحظه خبرت می‌کنیم."],
  ["کتاب معلق چیه؟", "کتابی که صاحبش رایگان هدیه می‌ده. هر کی لازمش داره یه جمله می‌نویسه و خود اهداکننده انتخاب می‌کنه کتاب به کی برسه."],
  ["پول رو چطور بدم؟", "معامله مستقیم بین خودتونه، حضوری یا پستی. قبل از دیدن کتاب، پیش‌پرداخت کارت‌به‌کارت نکنید."],
  ["قیمت مناسب رو از کجا بفهمم؟", "هر صفحه‌ی کتاب «قیمت معمول» رو از روی آگهی‌های واقعی نشون می‌ده. موقع ثبت هم ربات قیمت پیشنهادی می‌ده."],
  ["سؤال، نظر یا پیشنهاد دارم؛ کجا بگم؟", "توی ربات «✉️ پیام به پشتیبانی» رو بزن (یا از پانویس همین سایت). پیامت مستقیم به تیم نیمدار می‌رسه و جوابش رو توی ربات می‌گیری، حتی اگه هنوز ثبت‌نام نکرده باشی."],
  ["فایل PDF کتاب هم می‌شه گذاشت؟", "نه. اینجا فقط کتاب کاغذی واقعی دست‌به‌دست می‌شه؛ آگهی و درخواست PDF حذف می‌شه."],
];

export function indexPage(ctx, books) {
  // کتاب‌های دارای آگهی اول، بعد پرتقاضاها
  const sorted = [...books].sort((a, b) => b.listings.length - a.listings.length || b.waiting - a.waiting || a.id - b.id);
  const cats = Object.entries(CATEGORIES).filter(([k]) => books.some((b) => b.category === k));
  const copies = books.reduce((s, b) => s + b.listings.length, 0);
  const waiting = books.reduce((s, b) => s + b.waiting, 0);
  const giftCount = books.reduce((s, b) => s + b.listings.filter((l) => l.gift).length, 0);
  const wanted = books.filter((b) => b.waiting > 0 && !b.listings.length).sort((a, b) => b.waiting - a.waiting || a.id - b.id).slice(0, 6);
  const ch = channelLinks(ctx);
  const sticker = (n, alt = "") => !ctx.mascot ? "" : `<img src="${ctx.base}/assets/mascot/${n}.webp" width="96" height="96" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  const body = `
<section class="hero"><div class="wrap hero-in">
<div class="hero-text">
<p class="eyebrow">📚 المپیاد · کنکور · درسی · کمک‌درسی · هر کتاب دیگه</p>
<h1>کتاب دست‌دوم <span>بخر، بفروش، عوض کن</span></h1>
<p class="lead">برای هر کتاب یک صفحه: چند نفر دارن، چند نفر منتظرن، قیمت معمول چقدره. کتابت نبود؟ درخواست بده تا به محض اومدنش خبرت کنیم.</p>
<form class="hero-search" action="#books" role="search"><input id="hq" type="search" placeholder="دنبال چه کتابی هستی؟" aria-label="جستجوی کتاب" autocomplete="off"><button type="submit">جستجو</button></form>
${ctaButtons(ctx, "sell", "ثبت رایگان کتاب")}
</div>
<div class="hero-art-wrap">
${ctx.mascot ? `<img class="hero-art" src="${ctx.base}/assets/mascot/banner.webp" width="825" height="397" alt="نیمو، سنجاب نیمدار، در کتابخانه دست تکان می‌دهد">` : `<div class="hero-logo">${wordmark()}<span class="hero-tag">کتاب دست‌به‌دست</span></div>`}
<div class="float f1">🔔 یه نفر منتظر همین کتابه!</div>
<div class="float f2">✅ معامله انجام شد</div>
</div>
</div>
<div class="wrap"><ul class="hero-stats">
<li><b>${fa(copies)}</b>نسخه‌ی موجود</li><li><b>${fa(books.length)}</b>کتاب</li><li><b>${fa(waiting)}</b>نفر منتظر</li><li><b>${fa(giftCount)}</b>کتاب معلق</li>
</ul></div>
<svg class="wave" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30 C 240 70 480 0 720 25 S 1200 60 1440 20 V60 H0Z"/></svg>
</section>

<section class="trust"><div class="wrap trust-in">
<div><i>💸</i><b>همیشه رایگان</b><span>ثبت آگهی بدون هیچ هزینه</span></div>
<div><i>🕶</i><b>گفتگوی ناشناس</b><span>شماره و آیدی کسی دیده نمی‌شه</span></div>
<div><i>🔔</i><b>هشدار خودکار</b><span>کتابت که اومد، خبرت می‌کنیم</span></div>
<div><i>🛡</i><b>بررسی همه‌ی آگهی‌ها</b><span>هر آگهی قبل از انتشار دیده می‌شه</span></div>
</div></section>

${
  cats.length
    ? `<section class="band" id="cats"><div class="wrap">
<div class="sec-head"><div><p class="kicker">دسته‌ها</p><h2>از کجا شروع کنیم؟</h2></div></div>
<div class="tiles">${cats
        .map(([k, v]) => `<a class="tile cv-${k}" href="${ctx.base}/c/${k}/"><i>${CAT_ICON[k]}</i><b>${esc(v)}</b><span>${fa(books.filter((b) => b.category === k).length)} کتاب</span></a>`)
        .join("")}</div>
</div></section>`
    : ""
}

<section class="band band-white" id="books"><div class="wrap finder">
<div class="sec-head"><div><p class="kicker">کتاب‌ها</p><h2>همه‌ی کتاب‌ها</h2></div><a class="more" href="${ctx.base}/wanted/">الان کسی می‌خواد ←</a></div>
<input id="q" type="search" placeholder="اسم کتاب، نویسنده یا ناشر…" aria-label="جستجو" autocomplete="off">
${
  cats.length > 1
    ? `<div class="chips" role="group" aria-label="دسته"><button class="chip on" data-cat="">همه</button>${cats
        .map(([k, v]) => `<button class="chip" data-cat="${k}">${esc(v)}</button>`)
        .join("")}</div>`
    : ""
}
<p id="none" class="empty" hidden>چیزی پیدا نشد. توی ربات «کتابم نیست؟» رو بزن تا به محض ثبت شدنش خبرت کنیم.</p>
${
  sorted.length
    ? `<ul id="books-list" class="cards">${sorted.map((b) => bookCard(ctx, b)).join("")}</ul>`
    : `<div class="say first">${mascot(ctx, "hello", "نیمو دست تکان می‌دهد")}<div><p><b>هنوز کتابی ثبت نشده؛ اولین نفر تو باش!</b><br>کتابت رو زیر یک دقیقه ثبت کن تا اولین آگهی نیمدار مال تو باشه.</p>${ctaButtons(ctx, "sell", "ثبت اولین کتاب")}</div></div>`
}
</div></section>

${
  wanted.length
    ? `<section class="band band-orange"><div class="wrap wanted-in">
<div class="wanted-text">${sticker("search", "نیمو با ذره‌بین")}
<p class="kicker">تقاضای واقعی</p><h2>این کتاب‌ها خریدار دارن، ولی هنوز کسی نداره</h2>
<p>اگه یکی‌شون رو داری، همین الان ثبتش کن؛ منتظرها همون لحظه خبردار می‌شن.</p>
${ctaButtons(ctx, "sell", "کتاب دارم، ثبتش می‌کنم")}
<a class="more" href="${ctx.base}/wanted/">همه‌ی کتاب‌هایی که خریدار دارن ←</a></div>
<ol class="wanted-list">${wanted.map((b) => `<li><span class="w-n">${fa(b.waiting)}<small>منتظر</small></span><a class="w-t" href="${ctx.base}/b/${b.id}/">${esc(b.title)}</a></li>`).join("")}</ol>
</div></section>`
    : ""
}

<section class="band" id="how"><div class="wrap">
<div class="sec-head center"><div><p class="kicker">چطور کار می‌کنه</p><h2>چهار قدم تا کتابی که می‌خوای</h2></div></div>
<ol class="steps">
<li>${sticker("handoff")}<b>کتابت رو ثبت کن</b><span>اسم یا بارکد کتاب رو بده، وضعیت و قیمت رو بزن. زیر یک دقیقه.</span></li>
<li>${sticker("found")}<b>دنبال کتابی؟ درخواست بده</b><span>نبود؟ ثبتش کن؛ به محض اینکه کسی بذاره، خبرت می‌کنیم.</span></li>
<li>${sticker("chat")}<b>ناشناس گفتگو کن</b><span>از طریق ربات با فروشنده حرف بزن و حضوری یا پستی معامله کن.</span></li>
<li>${sticker("deal")}<b>امتیاز بده</b><span>بعد از معامله به هم امتیاز بدید تا بقیه به فروشنده‌های خوب اعتماد کنن.</span></li>
</ol>
</div></section>

<section class="band band-white"><div class="wrap">
<div class="sec-head center"><div><p class="kicker">امکانات</p><h2>هر چی برای یه معامله‌ی خوب لازمه</h2></div></div>
<div class="features">
<div><i>💰</i><b>قیمت‌یاب</b><span>قیمت معمول هر کتاب از روی آگهی‌ها و فروش‌های واقعی.</span></div>
<div><i>📷</i><b>اسکن بارکد</b><span>بارکد پشت جلد رو اسکن کن؛ کتاب خودش پیدا می‌شه.</span></div>
<div><i>⭐</i><b>امتیاز فروشنده</b><span>امتیاز هر فروشنده کنار آگهی‌ش دیده می‌شه.</span></div>
<div><i>💬</i><b>پیشنهاد قیمت و رزرو</b><span>قیمت پیشنهاد بده؛ فروشنده می‌تونه کتاب رو برات نگه داره.</span></div>
<div><i>🏷</i><b>نظر خواننده‌ها</b><span>کسانی که کتاب رو داشتن می‌گن به درد کی می‌خوره.</span></div>
<div><i>📚</i><b>باشگاه کتاب و چالش</b><span>کتاب ماه، چالش سالانه‌ی کتاب‌خوانی و نشان‌ها.</span></div>
</div>
</div></section>

<section class="band band-green" id="gift"><div class="wrap split">
${ctx.mascot ? `<img class="split-art" src="${ctx.base}/assets/mascot/gift.webp" width="320" height="320" alt="نیمو کتابی را هدیه می‌دهد" loading="lazy">` : `<div class="split-icon">🎁</div>`}
<div>
<p class="kicker">کتاب معلق</p>
<h2>کتابی که دیگه لازم نداری، می‌تونه آینده‌ی یکی دیگه رو بسازه</h2>
<p>کتابت رو رایگان هدیه بده. کسی که لازمش داره یه جمله برات می‌نویسه و خودت انتخاب می‌کنی به کی برسه. هر نسخه یه برچسب QR می‌گیره و می‌شه دید از دست چند نفر گذشته.</p>
${ctaButtons(ctx, "sell", "اهدای کتاب")}
</div>
</div></section>

<section class="band" id="safe"><div class="wrap split rev">
${ctx.mascot ? `<img class="split-art" src="${ctx.base}/assets/mascot/thinking.webp" width="320" height="320" alt="نیمو فکر می‌کند" loading="lazy">` : `<div class="split-icon">🛡</div>`}
<div>
<p class="kicker">معامله‌ی امن</p>
<h2>چند نکته که همیشه یادت باشه</h2>
<ul class="checks">
<li>قبل از دیدن کتاب، پیش‌پرداخت کارت‌به‌کارت نکن.</li>
<li>برای کتاب معلق هیچ پولی، حتی هزینه‌ی پست، از قبل نده.</li>
<li>تحویل حضوری رو جای شلوغ و عمومی بذار.</li>
<li>تخلف دیدی؟ از دکمه‌ی «گزارش تخلف» توی ربات خبر بده.</li>
</ul>
</div>
</div></section>

${ctx.mascot ? `<section class="band band-ink"><div class="wrap buddy">
<div class="buddy-text">
<p class="kicker">با نیمو آشنا شو</p>
<h2>نیمو، سنجابِ کتاب‌جمع‌کنِ نیمدار</h2>
<p>سنجاب‌ها فندق جمع می‌کنن، نیمو کتاب! توی ربات و کانال همراهته: کتاب پیدا شد خبرت می‌کنه، معامله که شد باهات جشن می‌گیره.</p>
<div class="cta">${botLinks(ctx.bots, "start").map((l) => `<a class="btn" href="${esc(l.url)}" rel="nofollow">شروع در ${l.label}</a>`).join("")}${ch.map((c) => `<a class="btn btn-ghost" href="${esc(c.url)}" rel="noopener">📣 ${esc(c.label)}</a>`).join("")}</div>
</div>
<div class="buddy-row">${["hello", "found", "deal", "reading", "magic", "price"].map((n) => sticker(n)).join("")}</div>
</div></section>` : ""}

<section class="band band-white" id="faq"><div class="wrap faq-wrap">
<div class="sec-head"><div><p class="kicker">سؤالات پرتکرار</p><h2>هر چی باید بدونی</h2></div></div>
<div class="faq">${FAQ.map(([q, a], i) => `<details${i ? "" : " open"}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
</div></section>

<div class="wrap">${browseNav(ctx, books)}</div>
<script src="${ctx.base}/assets/search.js" defer></script>`;
  return layout(ctx, {
    title: "نیمدار | خرید، فروش و تبادل کتاب دست‌دوم",
    description: `${fa(books.length)} کتاب دست‌دوم المپیاد، کنکور، درسی و عمومی. ثبت آگهی رایگان، گفتگوی امن با فروشنده.`,
    path: "/",
    body,
    full: true,
    jsonld: {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "نیمدار", url: ctx.baseUrl + "/", inLanguage: "fa" },
        { "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
      ],
    },
  });
}

/** صفحه‌ی عمومی قفسه‌ی یک کاربر (فقط کسی که خودش خواسته و ادمین تأیید کرده) */
export function profilePage(ctx, p, books) {
  const mine = [];
  for (const b of books) for (const l of b.listings) if (l.seller === p.code) mine.push({ b, l });
  const rating = p.rating ? `★${fa(String(p.rating.avg).replace(".", "٫"))} (${fa(p.rating.count)} رأی)` : null;
  const facts = [p.city, rating, p.stats?.sold ? `${fa(p.stats.sold)} فروش` : null, p.stats?.given ? `${fa(p.stats.given)} اهدا` : null, p.stats?.read_this_year ? `امسال ${fa(p.stats.read_this_year)} کتاب خونده` : null].filter(Boolean);
  const body = `
${pageHead(ctx, {
  crumbs: [{ label: "قفسه" }],
  title: `قفسه‌ی «${esc(p.nickname)}»`,
  sub: `${facts.length ? `<p class="muted">${esc(facts.join(" · "))}</p>` : ""}
${p.badges?.length ? `<p class="tags">${p.badges.map((x) => `<span>${esc(x)}</span>`).join("")}</p>` : ""}`,
  art: mascot(ctx, "reading", "نیمو کتاب می‌خواند", "mascot head-art", 140),
})}
<div class="wrap page">
<article class="book">
${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ""}
<h2>کتاب‌ها</h2>
${
  mine.length
    ? `<ul class="cards">${mine
        .map(
          ({ b, l }) =>
            `<li class="card"><a href="${ctx.base}/b/${b.id}/">${cover(b)}<span class="card-body"><strong>${esc(b.title)}</strong><span class="muted">${esc(
              [CONDITIONS[l.condition], l.city].filter(Boolean).join(" · "),
            )}</span><span class="supply">${esc(l.gift ? "رایگان (کتاب معلق)" : l.price === null ? "فقط تبادل" : price(l.price))}</span></span></a></li>`,
        )
        .join("")}</ul>`
    : `<p class="empty">فعلاً کتابی توی این قفسه نیست.</p>`
}
${ctaButtons(ctx, `u_${p.code}`, "دیدن قفسه")}
</article>
</div>`;
  return layout(ctx, {
    title: `قفسه‌ی «${p.nickname}» | نیمدار`,
    description: `کتاب‌های دست‌دوم «${p.nickname}» در نیمدار.`,
    path: `/u/${p.code}/`,
    body,
    full: true,
    noindex: true, // برای اشتراک‌گذاری است، نه گوگل؛ بیشتر کاربرها دانش‌آموزند
  });
}

/** راهنمای کامل (همان متن /help ربات و پست پین‌شده‌ی کانال) */
const GUIDE = [
  ["🚀", "شروع", "ربات رو باز کن و «شروع» رو بزن. شماره‌ت رو با دکمه به اشتراک بذار (به هیچ‌کس نشون داده نمی‌شه) و شهرت رو بگو. تمام!", []],
  ["📚", "فروش یا اهدای کتاب", "«ثبت کتاب» رو بزن، اسم کتاب رو بنویس (یا بارکد پشت جلد رو با «اسکن بارکد» بزن)، وضعیت و قیمت رو انتخاب کن، عکس بذار و «ثبت کن». زیر یک دقیقه!", [
    "تا ۳ آگهی فروشی همزمان رایگانه. اهدا (کتاب معلق) سقف نداره.",
    "آگهی همون لحظه توی ربات دیده می‌شه و به کسایی که منتظرش بودن خبر می‌ره.",
    "بعد از بررسی، هر روز ساعت ۱۹ توی پست «آگهی‌های تازه» کانال میاد.",
    "آگهی ویژه ⭐: پست جدا با عکس توی کانال و ۷ روز بالای صفحه‌ی کتاب.",
  ]],
  ["🔍", "خرید", "اسم کتاب، نویسنده یا ناشر رو توی ربات یا همین سایت جستجو کن. صفحه‌ی کتاب همه‌ی آگهی‌ها رو با قیمت، شهر و امتیاز فروشنده نشون می‌ده.", [
    "«پیام به فروشنده»: گفتگو از داخل ربات، بدون اینکه آیدی یا شماره‌ی کسی دیده بشه.",
    "می‌تونی پیشنهاد قیمت بدی؛ فروشنده می‌تونه کتاب رو چند روز برات رزرو کنه.",
    "«ذخیره»: اگه قیمت پایین اومد یا فروخته شد، خبرت می‌کنیم.",
  ]],
  ["🔔", "کتابت نبود؟", "«دنبال این کتابم» یا «کتابم نیست؟» رو بزن (سقف قیمت هم می‌تونی بذاری). به محض اینکه کسی ثبتش کنه، همون لحظه خبرت می‌کنیم. فهرستش توی «درخواست‌های من» هست.", []],
  ["🎁", "کتاب معلق", "کتابی که لازم نداری رو رایگان هدیه بده. هر کی لازمش داره یه جمله برات می‌نویسه و خودت انتخاب می‌کنی به کی برسه. کتاب‌های اهدایی توی «کتاب‌های معلق» هستن.", []],
  ["🤝", "بعد از معامله", "فروشنده «فروختم به همین نفر» رو می‌زنه و هر دو طرف به هم امتیاز می‌دن. امتیاز خوب یعنی اعتماد بیشتر.", []],
  ["🗂", "بخش‌های دیگه‌ی ربات", "", [
    "قفسه‌ی من: آگهی‌هات (فروخته شد، تغییر قیمت، حذف، ویژه کردن) و کتابخونه‌ی شخصیت",
    "پروفایل من: اسم مستعار، شهر، نشان‌ها، تنظیمات اعلان، باشگاه کتاب و چالش کتاب‌خوانی",
    "دعوت از دوستان: لینک دعوت خودت",
    "توی هر چت تلگرام آیدی ربات و بعد اسم کتاب رو بنویس، تا کارت کتاب رو برای دوستت بفرستی",
  ]],
  ["📣", "کانال", "هر روز ۱۹:۰۰ آگهی‌های تازه، هر شب ۲۱:۰۰ «کی داره؟» (کتاب‌هایی که خریدار دارن ولی کسی نداره) و پنجشنبه‌ها «کتاب‌های پرتقاضا». دکمه‌ی زیر هر پست صفحه‌ی همون کتاب رو توی ربات باز می‌کنه.", []],
  ["🌐", "سایت", "همه‌ی کتاب‌ها با جستجو و دسته‌بندی، بدون نیاز به تلگرام. برای پیام دادن یا ثبت کتاب، دکمه‌های سایت تو رو به ربات می‌برن.", []],
  ["✉️", "سؤال، نظر یا پیشنهاد", "توی ربات «پیام به پشتیبانی» رو بزن (از «پروفایل من» یا زیر «راهنما»). پیامت مستقیم به تیم نیمدار می‌رسه و جواب رو همون‌جا می‌گیری، حتی پیش از ثبت‌نام.", []],
];
const SAFETY = [
  "قبل از دیدن کتاب، پیش‌پرداخت کارت‌به‌کارت نکن.",
  "برای کتاب معلق هیچ پولی، حتی هزینه‌ی پست، از قبل نده.",
  "تحویل حضوری رو جای شلوغ و عمومی بذار.",
  "پرداخت به نیمدار (مثلاً آگهی ویژه) فقط از داخل ربات انجام می‌شه؛ ادمین هیچ‌وقت پیام خصوصی نمی‌ده.",
  "تخلف دیدی؟ «گزارش تخلف» رو توی ربات بزن.",
  "فایل PDF کتاب ممنوعه.",
];

function guidePage(ctx) {
  const bot = botLinks(ctx.bots, "start")[0];
  const ch = channelLinks(ctx);
  const body = `
${pageHead(ctx, {
  crumbs: [{ label: "راهنما" }],
  title: "راهنمای نیمدار",
  sub: `<p class="muted">هر چی برای خرید، فروش، تبادل و اهدای کتاب دست‌دوم توی ربات، کانال و سایت نیمدار لازمه، یک‌جا.</p>
<div class="cta">${bot ? `<a class="btn" href="${esc(bot.url)}" rel="nofollow">شروع در ربات</a>` : ""}${botLinks(ctx.bots, "support")[0] ? `<a class="btn btn-alt" href="${esc(botLinks(ctx.bots, "support")[0].url)}" rel="nofollow">✉️ پیام به ما</a>` : ""}${ch.map((c) => `<a class="btn btn-alt" href="${esc(c.url)}" rel="noopener">📣 ${esc(c.label)}</a>`).join("")}</div>`,
  art: mascot(ctx, "reading", "نیمو کتاب می‌خواند", "mascot head-art", 140),
})}
<div class="wrap page">
<nav class="guide-toc" aria-label="فهرست">${GUIDE.map(([icon, title], i) => `<a href="#g${i + 1}">${icon} ${esc(title)}</a>`).join("")}<a href="#safe">⚠️ معامله‌ی امن</a></nav>
<ol class="guide">${GUIDE.map(
    ([icon, title, text, items], i) => `<li id="g${i + 1}"><span class="g-icon" aria-hidden="true">${icon}</span><div><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ""}${
      items.length ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""
    }</div></li>`,
  ).join("")}</ol>
<section class="guide-safe" id="safe"><h2>⚠️ معامله‌ی امن</h2><ul class="checks">${SAFETY.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
<section class="sell wide">${mascot(ctx, "handoff", "نیمو کتاب را به دست نفر بعدی می‌دهد", "mascot", 110)}<div><p>آماده‌ای؟ اولین کتابت رو زیر یک دقیقه ثبت کن.</p>${ctaButtons(ctx, "sell", "ثبت رایگان کتاب")}</div></section>
</div>`;
  return layout(ctx, {
    title: "راهنمای نیمدار | خرید، فروش و اهدای کتاب دست‌دوم",
    description: "راهنمای کامل نیمدار: ثبت کتاب، خرید، درخواست کتاب و هشدار، کتاب معلق، امتیاز، کانال و سایت، و نکته‌های معامله‌ی امن.",
    path: "/help/",
    body,
    full: true,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: "راهنمای نیمدار",
      inLanguage: "fa",
      step: GUIDE.map(([, title, text, items]) => ({ "@type": "HowToStep", name: title, text: [text, ...items].filter(Boolean).join(" ") })),
    },
  });
}

function notFound(ctx) {
  return layout(ctx, {
    title: "صفحه پیدا نشد | نیمدار",
    description: "این صفحه وجود نداره.",
    path: "/404.html",
    body: `<div class="say big">${mascot(ctx, "oops", "نیمو، سنجاب نیمدار، سرش را گرفته", "mascot", 220)}<div><h1>اوه! این صفحه پیدا نشد</h1><p class="empty">این صفحه وجود نداره، یا آگهی‌های این کتاب تموم شدن.</p><div class="cta"><a class="btn" href="${ctx.base}/">همه‌ی کتاب‌ها</a><a class="btn btn-alt" href="${ctx.base}/wanted/">کتاب‌هایی که خریدار دارن</a></div></div></div>`,
  });
}

function sitemap(ctx, books) {
  const urls = ["/", "/help/", ...listPages(books).map((p) => encodeURI(p.path)), ...books.map((b) => `/b/${b.id}/`)];
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
  const art = pg.kind === "wanted" ? mascot(ctx, "search", "نیمو، سنجاب نیمدار، با ذره‌بین", "mascot head-art", 140) : pg.kind === "cat" ? `<span class="head-icon cv-${esc(pg.path.split("/")[2])}">${CAT_ICON[pg.path.split("/")[2]] ?? "📚"}</span>` : mascot(ctx, "reading", "نیمو کتاب می‌خواند", "mascot head-art", 140);
  const body = `
${pageHead(ctx, {
  crumbs: [{ label: pg.kind === "wanted" ? "الان کسی می‌خواد" : pg.kind === "cat" ? "دسته‌ها" : pg.kind === "grade" ? "پایه‌ها" : "شهرها" }],
  title: esc(pg.h1),
  sub: `<p class="muted">${esc(pg.intro)}</p>${pg.kind === "wanted" ? ctaButtons(ctx, "sell", "کتاب دارم، ثبتش می‌کنم") : ""}`,
  art,
})}
<div class="wrap page">
<ul class="cards">${books.map((b) => bookCard(ctx, b)).join("")}</ul>
${pg.kind === "wanted" ? "" : `<section class="sell wide">${mascot(ctx, "handoff", "نیمو کتاب را به دست نفر بعدی می‌دهد", "mascot", 110)}<div><p>کتابت اینجا نیست؟ ثبت آگهی رایگانه.</p>${ctaButtons(ctx, "sell", "ثبت کتاب")}</div></section>`}
${browseNav(ctx, ctx.allBooks)}
</div>`;
  const title = pg.kind === "wanted" ? "کتاب‌هایی که الان خریدار دارن | نیمدار" : `${pg.h1} | خرید و فروش | نیمدار`;
  return layout(ctx, {
    title,
    description: pg.intro,
    path: pg.path,
    body,
    full: true,
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
<span class="sticker-code">کد: <b id="code"></b> · نیمدار</span>
</div>
</div>
<p id="bad" class="empty" hidden>کد برچسب درست نیست. لینک رو از ربات دوباره بگیر.</p>
<p class="no-print"><button id="print" class="btn" type="button">چاپ برچسب</button></p>
</section>
<script src="${ctx.base}/assets/vendor/qrcode.min.js"></script>
<script src="${ctx.base}/assets/sticker.js"></script>`;
  return layout(ctx, { title: "برچسب سفر کتاب | نیمدار", description: "برچسب QR برای نسخه‌ای که دست‌به‌دست می‌شود.", path: "/sticker/", body, noindex: true });
}

// ---------- build ----------

/** شهرها به ترتیب تعداد کتاب (برای پانویس) */
function topCities(books) {
  const n = new Map();
  for (const b of books) for (const c of new Set(b.listings.map((l) => l.city).filter(Boolean))) if (slug(c)) n.set(c, (n.get(c) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export function build(data, { baseUrl, outDir }) {
  if (data?.version !== 1 || !Array.isArray(data.books)) throw new Error("catalog.json نامعتبر است");
  const url = new URL(baseUrl.replace(/\/+$/, "") + "/");
  const ctx = {
    baseUrl: url.href.replace(/\/$/, ""),
    base: url.pathname.replace(/\/$/, ""), // مثلاً /nimdar-site برای سایت پروژه‌ی گیت‌هاب
    bots: data.bots ?? {},
    generatedAt: data.generated_at,
    // تصویرهای نیمو (سنجاب) آماده‌اند؟ از Worker می‌آید (MASCOT_ART)؛ داده‌ی قدیمی بدون این فیلد یعنی آماده
    mascot: data.mascot !== false,
    profiles: new Map((data.profiles ?? []).filter((p) => CODE_RE.test(p.code ?? "")).map((p) => [p.code, p])),
    channels: data.channels ?? {},
    allBooks: data.books,
    catCounts: new Map(Object.keys(CATEGORIES).map((k) => [k, data.books.filter((b) => b.category === k).length])),
    topCities: topCities(data.books),
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
  mkdirSync(join(outDir, "help"), { recursive: true });
  writeFileSync(join(outDir, "help", "index.html"), guidePage(ctx));
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
