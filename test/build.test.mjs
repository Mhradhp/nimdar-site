import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build, searchKey } from "../build.mjs";

const data = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const out = mkdtempSync(join(tmpdir(), "site-"));
build(data, { baseUrl: "https://mhradhp.github.io/nimdar-site/", outDir: out });
const read = (p) => readFileSync(join(out, p), "utf8");

test("همه‌ی فایل‌ها ساخته می‌شوند", () => {
  for (const p of ["index.html", "404.html", "b/1/index.html", "b/7/index.html", "sitemap.xml", "robots.txt", ".nojekyll", "assets/style.css", "assets/search.js", "assets/fonts/Vazirmatn.woff2", "googlefe73b4db30c39f30.html", "google6c5612fff7391cf5.html", "scan/index.html", "scan/scan.js", "assets/vendor/zxing.min.js", "assets/vendor/ZXING-LICENSE.txt"]) {
    assert.ok(existsSync(join(out, p)), p);
  }
});

test("صفحه‌ی کتاب: آمار، قیمت معمول، آگهی‌ها و لینک ربات", () => {
  const html = read("b/1/index.html");
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /<title>المپیاد ریاضی - هندسه دست‌دوم \| نیمدار<\/title>/);
  assert.match(html, /<b>۴<\/b><span>نسخه موجود/);
  assert.match(html, /رایگان \(کتاب معلق\)/);
  assert.match(html, /<b>۲<\/b><span>نفر منتظرند/);
  assert.match(html, /قیمت معمول/);
  assert.match(html, /۱۲۰٬۰۰۰ تومان/); // میانه‌ی ۱۰۰ و ۱۴۰ هزار
  assert.match(html, /۱۴۰٬۰۰۰ تومان یا تبادل/);
  assert.match(html, /فقط تبادل/);
  assert.match(html, /★۴٫۵ \(۲\)/);
  assert.match(html, /href="https:\/\/t\.me\/dast2dast_bot\?start=b_1"/);
  assert.match(html, /href="https:\/\/t\.me\/dast2dast_bot\?start=sell"/);
  assert.doesNotMatch(html, /ble\.ir/); // ربات بله تنظیم نشده
  assert.match(html, /<link rel="canonical" href="https:\/\/mhradhp\.github\.io\/nimdar-site\/b\/1\/">/);
  assert.match(html, /href="\/nimdar-site\/assets\/style\.css"/);
});

test("JSON-LD کتاب با قیمت به ریال", () => {
  const html = read("b/1/index.html");
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(ld["@type"], "Book");
  assert.equal(ld.offers.lowPrice, 1_000_000);
  assert.equal(ld.offers.highPrice, 1_400_000);
  assert.equal(ld.offers.offerCount, 4);
  assert.equal(ld.offers.priceCurrency, "IRR");
  assert.equal(ld.isbn, "9789643116446");
});

test("کتاب بدون آگهی: دعوت به درخواست، بدون offers", () => {
  const html = read("b/7/index.html");
  assert.match(html, /فعلاً کسی این کتاب رو نداره/);
  assert.match(html, /دنبال این کتابم در تلگرام/);
  assert.match(html, /معتبر برای کنکور ۱۴۰۶/);
  assert.match(html, /۵ نفر همین الان منتظرشن/);
  assert.doesNotMatch(html, /"offers"/);
});

test("متن کاربر escape می‌شود (XSS)", () => {
  const html = read("b/7/index.html") + read("index.html");
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /علی &quot;رضایی&quot;/);
});

test("صفحه‌ی اصلی: کتاب دارای آگهی اول، کلید جستجو، فیلتر دسته", () => {
  const html = read("index.html");
  assert.ok(html.indexOf("/b/1/") < html.indexOf("/b/7/"));
  assert.match(html, /۴ نسخه · از ۱۰۰٬۰۰۰ تومان · کتاب معلق · ۲ منتظر/);
  assert.match(html, /هنوز کسی نداره · ۵ منتظر/);
  assert.match(html, /data-cat="olympiad"/);
  assert.match(html, /<button class="chip" data-cat="konkur">کنکور<\/button>/);
  assert.match(html, new RegExp(`data-q="${searchKey("المپیاد ریاضی - هندسه خوشخوان")}"`));
});

test("sitemap و robots", () => {
  const sm = read("sitemap.xml");
  assert.match(sm, /<loc>https:\/\/mhradhp\.github\.io\/nimdar-site\/b\/7\/<\/loc>/);
  assert.match(sm, /<lastmod>2026-10-30<\/lastmod>/);
  assert.match(read("robots.txt"), /Sitemap: https:\/\/mhradhp\.github\.io\/nimdar-site\/sitemap\.xml/);
});

test("کلید جستجو: ی/ک عربی، نیم‌فاصله و فاصله", () => {
  assert.equal(searchKey("شيمي دهم"), searchKey("شیمی‌دهم"));
  assert.equal(searchKey("آمار"), searchKey("امار"));
});

test("داده‌ی نامعتبر خطا می‌دهد", () => {
  assert.throws(() => build({ version: 2 }, { baseUrl: "https://x.y", outDir: join(out, "bad") }));
});

test("سایت روی ریشه‌ی دامنه هم درست ساخته می‌شود", () => {
  const out2 = mkdtempSync(join(tmpdir(), "site-"));
  build(data, { baseUrl: "https://dastbedast.ir", outDir: out2 });
  const html = readFileSync(join(out2, "b/1/index.html"), "utf8");
  assert.match(html, /href="\/assets\/style\.css"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/dastbedast\.ir\/b\/1\/">/);
});

test("دسته‌ها، وضعیت‌ها و پاسخنامه‌ی تازه", () => {
  const html = read("b/1/index.html");
  assert.match(html, /با پاسخنامه/);
  assert.match(read("b/7/index.html"), /<span>کنکور<\/span><span>شیمی<\/span><span>دهم<\/span>/);
});

test("پروفایل عمومی: صفحه‌ی قفسه با noindex، لینک از آگهی، بیرون از sitemap", () => {
  const html = read("u/ABC234/index.html");
  assert.match(html, /قفسه‌ی «سارا &lt;b&gt;»/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /دوازدهم تجربی/);
  assert.match(html, /<span>پیشگام<\/span>/);
  assert.match(html, /★۴٫۵ \(۲ رأی\)/);
  assert.match(html, /href="\/nimdar-site\/b\/1\/"/);
  assert.match(html, /start=u_ABC234/);
  assert.match(read("b/1/index.html"), /فروشنده: <a href="\/nimdar-site\/u\/ABC234\/">«سارا &lt;b&gt;»<\/a>/);
  assert.doesNotMatch(read("sitemap.xml"), /\/u\//);
  // کد نامعتبر هیچ فایلی بیرون از پوشه نمی‌سازد
  assert.ok(!existsSync(join(out, "u", "../evil")));
  assert.ok(!existsSync(join(out, "evil")));
});

test("نظر برچسبی و پرسش و پاسخ روی صفحه‌ی کتاب، با escape", () => {
  const html = read("b/1/index.html");
  assert.match(html, /نظر ۴ خواننده/);
  assert.match(html, /برای جمع‌بندی عالیه <b>۳<\/b>/);
  assert.match(html, /<dt>برای کنکور ۱۴۰۶ هم خوبه؟<\/dt><dd>آره &lt;b&gt;کاملاً&lt;\/b&gt;<\/dd>/);
  const other = read("b/7/index.html");
  assert.doesNotMatch(other, /خواننده<\/h2>/);
  assert.match(other, /هنوز سؤالی پرسیده نشده/);
});

test("صفحه‌های فهرست: دسته، پایه، شهر و تابلوی تقاضا؛ در sitemap و صفحه‌ی اصلی", () => {
  for (const p of ["c/olympiad", "c/konkur", "g/دهم", "city/تهران", "city/مشهد", "wanted"]) {
    assert.ok(existsSync(join(out, p, "index.html")), p);
  }
  assert.ok(!existsSync(join(out, "c", "novel")), "دسته‌ی بدون کتاب صفحه ندارد");
  const tehran = read("city/تهران/index.html");
  assert.match(tehran, /<h1>کتاب دست‌دوم در تهران<\/h1>/);
  assert.match(tehran, /href="\/nimdar-site\/b\/1\/"/);
  assert.doesNotMatch(tehran, /\/b\/7\//);
  const wanted = read("wanted/index.html");
  assert.ok(wanted.indexOf("/b/7/") < wanted.indexOf("/b/1/"), "بیشترین منتظر اول");
  assert.match(wanted, /start=sell/);
  const sm = read("sitemap.xml");
  assert.match(sm, /\/c\/olympiad\//);
  assert.match(sm, /\/city\/%D8%AA%D9%87%D8%B1%D8%A7%D9%86\//);
  const home = read("index.html");
  assert.match(home, /مرور کتاب‌ها/);
  assert.match(home, /href="\/nimdar-site\/city\/%D9%85%D8%B4%D9%87%D8%AF\/">مشهد<\/a>/);
});

test("slug فقط حرف و عدد نگه می‌دارد", async () => {
  const { slug } = await import("../build.mjs");
  assert.equal(slug("یازدهم تجربی"), "یازدهم-تجربی");
  assert.equal(slug("../../etc"), "etc");
  assert.equal(slug("<script>"), "script");
  assert.equal(slug("  "), "");
});

test("صفحه‌ی برچسب سفر کتاب: noindex، QR محلی، و بدون درج مستقیم ورودی آدرس در HTML", () => {
  const html = read("sticker/index.html");
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /data-bot="dast2dast_bot"/);
  assert.match(html, /assets\/vendor\/qrcode\.min\.js/);
  assert.ok(existsSync(join(out, "assets/vendor/QRCODE-LICENSE.txt")));
  const js = read("assets/sticker.js");
  assert.match(js, /textContent = title/); // اسم کتاب از آدرس فقط به‌صورت متن
  assert.match(js, /\^\[A-Z0-9\]\{4,12\}\$/); // کد اعتبارسنجی می‌شود
  assert.doesNotMatch(read("sitemap.xml"), /sticker/);
});

test("آگهی رزروشده برچسب دارد", () => {
  assert.equal((read("b/1/index.html").match(/class="reserved"/g) ?? []).length, 1);
});

test("پروفایل عمومی تعداد کتاب‌های خوانده‌شده‌ی امسال را نشان می‌دهد", () => {
  const code = data.profiles[0].code;
  assert.match(read(`u/${code}/index.html`), /امسال ۷ کتاب خونده/);
});

test("نیمو و لوگوی نیمدار: تصویر اشتراک، favicon، و تصویر در ۴۰۴ و صفحه‌ی بدون آگهی", () => {
  const home = read("index.html");
  assert.match(home, /og:image" content="https:\/\/mhradhp\.github\.io\/nimdar-site\/assets\/brand\/og\.jpg"/);
  assert.match(home, /rel="icon" type="image\/png" href="\/nimdar-site\/assets\/brand\/favicon\.png"/);
  assert.match(home, /class="wm"><span class="wm-be">نیم<\/span>دار/);
  assert.match(home, /assets\/mascot\/banner\.webp/);
  assert.match(read("404.html"), /assets\/mascot\/oops\.webp/);
  assert.match(read("b/7/index.html"), /assets\/mascot\/notfound\.webp/);
  for (const f of ["mascot/banner.webp", "mascot/oops.webp", "mascot/sticker/hello.webp", "brand/og.jpg", "brand/favicon.png", "fonts/Lalezar.woff2"]) assert.ok(existsSync(join(out, "assets", f)), f);
});

test("کاتالوگ خالی: صفحه‌ی اصلی پیام «اولین نفر تو باش» دارد", () => {
  const dir = mkdtempSync(join(tmpdir(), "site-empty-"));
  build({ version: 1, generated_at: "2026-10-31T00:00:00Z", bots: { tg: "x_bot" }, books: [] }, { baseUrl: "https://a.b/", outDir: dir });
  const html = readFileSync(join(dir, "index.html"), "utf8");
  assert.match(html, /اولین نفر تو باش/);
  assert.match(html, /start=sell/);
});

test("آگهی ویژه برچسب «⭐ ویژه» دارد", () => {
  const html = read("b/1/index.html");
  assert.equal((html.match(/class="featured"/g) ?? []).length, 1);
  assert.match(html, /listing is-featured/);
});

test("تا تصویرهای نیمو آماده نیستند (mascot: false) هیچ تصویر شخصیتی در سایت نیست", () => {
  const dir = mkdtempSync(join(tmpdir(), "site-nomascot-"));
  build({ ...data, mascot: false }, { baseUrl: "https://a.b/", outDir: dir });
  for (const f of ["index.html", "404.html", "b/7/index.html", "wanted/index.html"]) {
    assert.doesNotMatch(readFileSync(join(dir, f), "utf8"), /assets\/mascot/, f);
  }
  assert.match(readFileSync(join(dir, "index.html"), "utf8"), /class="hero-logo"/);
});
