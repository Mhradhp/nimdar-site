// اسکن بارکد شابک در Mini App تلگرام. همه‌ی پردازش در خود گوشی است؛ هیچ تصویری جایی فرستاده نمی‌شود.
// نتیجه با web_app_data_send (همان sendData) به ربات برمی‌گردد، پس به هیچ سروری نیاز نیست.
// اسکریپت telegram-web-app.js بارگذاری نمی‌شود (ممکن است در ایران باز نشود)؛ پروتکل مستند
// https://core.telegram.org/api/web-events مستقیم پیاده شده است.
(function () {
  "use strict";

  // ---------- شابک (همان الگوریتم parseIsbn در ربات) ----------
  function latinDigits(s) {
    return String(s)
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06f0); })
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
  }
  function ean13Ok(s) {
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === Number(s[12]);
  }
  function parseIsbn(input) {
    var s = latinDigits(input).toUpperCase().replace(/^\s*ISBN[:\s-]*/, "").replace(/[\s-]/g, "");
    if (/^97[89]\d{10}$/.test(s)) return ean13Ok(s) ? s : null;
    if (/^\d{9}[\dX]$/.test(s)) {
      var sum = 0;
      for (var i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
      if (sum % 11 !== 0) return null;
      var core = "978" + s.slice(0, 9);
      var s13 = 0;
      for (var j = 0; j < 12; j++) s13 += Number(core[j]) * (j % 2 ? 3 : 1);
      return core + ((10 - (s13 % 10)) % 10);
    }
    return null;
  }

  // ---------- پل تلگرام ----------
  var inTelegram = /tgWebApp(Version|Platform|Data)=/.test(location.hash + location.search);
  function postEvent(type, data) {
    var payload = data === undefined ? "" : JSON.stringify(data);
    try {
      if (window.TelegramWebviewProxy && window.TelegramWebviewProxy.postEvent) {
        window.TelegramWebviewProxy.postEvent(type, payload); // اندروید و iOS
      } else if (window.external && "notify" in window.external) {
        window.external.notify(JSON.stringify({ eventType: type, eventData: data })); // Windows Phone قدیمی
      } else if (window.parent !== window) {
        window.parent.postMessage(JSON.stringify({ eventType: type, eventData: data }), "*"); // تلگرام وب و دسکتاپ
      }
    } catch (e) {
      /* بیرون از تلگرام */
    }
  }
  if (inTelegram) {
    postEvent("web_app_ready");
    postEvent("web_app_expand");
  }

  // ---------- UI ----------
  var $ = function (id) { return document.getElementById(id); };
  var video = $("video");
  var statusEl = $("status");
  var stream = null;
  var done = false;
  var setStatus = function (t, isErr) {
    statusEl.textContent = t;
    statusEl.className = isErr ? "err" : "muted";
  };

  function stopCamera() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
  }

  function finish(isbn) {
    if (done) return;
    done = true;
    stopCamera();
    if (navigator.vibrate) navigator.vibrate(80);
    window.__scannedIsbn = isbn; // برای تست
    if (inTelegram) {
      setStatus("پیدا شد! برمی‌گردیم به ربات…");
      postEvent("web_app_data_send", { data: isbn }); // تلگرام بعد از این Mini App را می‌بندد
    } else {
      $("viewer").hidden = true;
      setStatus("");
      $("result-isbn").textContent = isbn;
      $("result").hidden = false;
    }
  }

  $("manual").addEventListener("submit", function (e) {
    e.preventDefault();
    var isbn = parseIsbn($("isbn").value);
    $("manual-err").hidden = !!isbn;
    if (isbn) finish(isbn);
  });

  // ---------- تشخیص بارکد ----------
  // ۱) BarcodeDetector داخلی (اندروید/کروم)  ۲) ZXing روی همین سایت (آیفون و بقیه)
  function nativeDetector() {
    if (!("BarcodeDetector" in window)) return Promise.resolve(null);
    return window.BarcodeDetector.getSupportedFormats()
      .then(function (f) {
        if (f.indexOf("ean_13") < 0) return null;
        var d = new window.BarcodeDetector({ formats: ["ean_13"] });
        return function (src) {
          return d.detect(src).then(function (codes) { return codes.length ? codes[0].rawValue : null; });
        };
      })
      .catch(function () { return null; });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function zxingDetector() {
    return loadScript("../assets/vendor/zxing.min.js").then(function () {
      var Z = window.ZXing;
      var hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13]);
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
      var reader = new Z.MultiFormatReader();
      reader.setHints(hints);
      var canvas = document.createElement("canvas");
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      return function (src) {
        var w = src.videoWidth || src.width;
        var h = src.videoHeight || src.height;
        if (!w || !h) return Promise.resolve(null);
        // نوار وسط تصویر کافی است و پردازش را سبک نگه می‌دارد
        var bandH = Math.max(80, Math.round(h * 0.4));
        canvas.width = w;
        canvas.height = bandH;
        ctx.drawImage(src, 0, Math.round((h - bandH) / 2), w, bandH, 0, 0, w, bandH);
        try {
          var bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
          return Promise.resolve(reader.decode(bmp).getText());
        } catch (e) {
          return Promise.resolve(null); // NotFoundException: هنوز بارکدی در تصویر نیست
        }
      };
    });
  }

  function getDetector() {
    return nativeDetector().then(function (d) { return d || zxingDetector(); });
  }

  function loop(detect) {
    if (done) return;
    detect(video)
      .catch(function () { return null; })
      .then(function (raw) {
        var isbn = raw && parseIsbn(raw);
        if (isbn) return finish(isbn);
        setTimeout(function () { loop(detect); }, 150);
      });
  }

  function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("این دستگاه به دوربین دسترسی نمی‌ده. شابک رو پایین تایپ کن.", true);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(getDetector)
      .then(function (detect) {
        setStatus("دوربین روشنه؛ بارکد رو نگه دار.");
        loop(detect);
      })
      .catch(function () {
        stopCamera();
        setStatus("دسترسی به دوربین نشد. اجازه‌ی دوربین رو بده، یا شابک رو پایین تایپ کن.", true);
      });
  }

  window.__dast2dast = { parseIsbn: parseIsbn, zxingDetector: zxingDetector }; // برای تست
  start();
})();
