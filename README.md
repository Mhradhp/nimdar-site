# سایت دست‌به‌دست

سایت ثابت «یک صفحه برای هر کتاب»، برای دیده شدن کتاب‌ها در گوگل.
هر شب از داده‌ی عمومی ربات (`/api/catalog.json` در Worker) ساخته و روی GitHub Pages منتشر می‌شود.

این مخزن **عمومی** است و فقط کد ساختن سایت را دارد؛ هیچ داده‌ی خصوصی یا رمزی این‌جا نیست.
کد ربات در مخزن خصوصی `dast2dast` است.

- `build.mjs`: سازنده‌ی سایت؛ بدون هیچ وابستگی خارجی (فقط Node 20 به بالا)
- `assets/`: استایل، جستجوی سمت مرورگر، و فونت وزیرمتن (مجوز OFL در `assets/fonts/OFL.txt`)
- `static/scan/`: صفحه‌ی اسکن بارکد شابک (Mini App تلگرام). پردازش در خود گوشی؛ اول `BarcodeDetector` داخلی، وگرنه ZXing از `assets/vendor/` (مجوز Apache-2.0)
- `static/`: فایل‌هایی که عیناً در ریشه‌ی سایت قرار می‌گیرند (فایل تأیید Google Search Console)
- `.github/workflows/pages.yml`: ساخت شبانه و انتشار

## اجرای محلی

```bash
npm test
npm run preview        # از داده‌ی نمونه‌ی test/fixture.json، خروجی در dist/
CATALOG_URL=https://<worker>/api/catalog.json BASE_URL=https://example.com node build.mjs
```

## مهاجرت
خروجی فقط فایل HTML ثابت است و روی هر هاست یا سرور ایرانی کار می‌کند:
`BASE_URL` را آدرس جدید بگذار، بساز و پوشه‌ی `dist/` را آپلود کن.

فونت: [Vazirmatn](https://github.com/rastikerdar/vazirmatn) از صابر راستی‌کردار، با مجوز SIL Open Font License.
