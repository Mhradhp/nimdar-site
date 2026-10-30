import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build, searchKey } from "../build.mjs";

const data = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const out = mkdtempSync(join(tmpdir(), "site-"));
build(data, { baseUrl: "https://mhradhp.github.io/dast2dast-site/", outDir: out });
const read = (p) => readFileSync(join(out, p), "utf8");

test("همه‌ی فایل‌ها ساخته می‌شوند", () => {
  for (const p of ["index.html", "404.html", "b/1/index.html", "b/7/index.html", "sitemap.xml", "robots.txt", ".nojekyll", "assets/style.css", "assets/search.js", "assets/fonts/Vazirmatn.woff2", "googlefe73b4db30c39f30.html", "scan/index.html", "scan/scan.js", "assets/vendor/zxing.min.js", "assets/vendor/ZXING-LICENSE.txt"]) {
    assert.ok(existsSync(join(out, p)), p);
  }
});

test("صفحه‌ی کتاب: آمار، قیمت معمول، آگهی‌ها و لینک ربات", () => {
  const html = read("b/1/index.html");
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /<title>المپیاد ریاضی - هندسه دست‌دوم \| دست‌به‌دست<\/title>/);
  assert.match(html, /<b>۳<\/b><span>نسخه موجود/);
  assert.match(html, /<b>۲<\/b><span>نفر منتظرند/);
  assert.match(html, /قیمت معمول/);
  assert.match(html, /۱۲۰٬۰۰۰ تومان/); // میانه‌ی ۱۰۰ و ۱۴۰ هزار
  assert.match(html, /۱۴۰٬۰۰۰ تومان یا تبادل/);
  assert.match(html, /فقط تبادل/);
  assert.match(html, /★۴٫۵ \(۲\)/);
  assert.match(html, /href="https:\/\/t\.me\/dast2dast_bot\?start=b_1"/);
  assert.match(html, /href="https:\/\/t\.me\/dast2dast_bot\?start=sell"/);
  assert.doesNotMatch(html, /ble\.ir/); // ربات بله تنظیم نشده
  assert.match(html, /<link rel="canonical" href="https:\/\/mhradhp\.github\.io\/dast2dast-site\/b\/1\/">/);
  assert.match(html, /href="\/dast2dast-site\/assets\/style\.css"/);
});

test("JSON-LD کتاب با قیمت به ریال", () => {
  const html = read("b/1/index.html");
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(ld["@type"], "Book");
  assert.equal(ld.offers.lowPrice, 1_000_000);
  assert.equal(ld.offers.highPrice, 1_400_000);
  assert.equal(ld.offers.offerCount, 3);
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
  assert.match(html, /۳ نسخه · از ۱۰۰٬۰۰۰ تومان · ۲ منتظر/);
  assert.match(html, /هنوز کسی نداره · ۵ منتظر/);
  assert.match(html, /data-cat="olympiad"/);
  assert.match(html, /<button class="chip" data-cat="konkur">کنکور<\/button>/);
  assert.match(html, new RegExp(`data-q="${searchKey("المپیاد ریاضی - هندسه خوشخوان")}"`));
});

test("sitemap و robots", () => {
  const sm = read("sitemap.xml");
  assert.match(sm, /<loc>https:\/\/mhradhp\.github\.io\/dast2dast-site\/b\/7\/<\/loc>/);
  assert.match(sm, /<lastmod>2026-10-30<\/lastmod>/);
  assert.match(read("robots.txt"), /Sitemap: https:\/\/mhradhp\.github\.io\/dast2dast-site\/sitemap\.xml/);
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
