// برچسب سفر کتاب: کد و اسم کتاب از آدرس صفحه، QR در خود مرورگر (qrcode-generator، MIT).
(function () {
  var params = new URLSearchParams(location.search);
  var code = (params.get("c") || "").toUpperCase();
  var title = (params.get("t") || "").slice(0, 80);
  var box = document.getElementById("sticker");
  var bot = box.getAttribute("data-bot");
  if (!/^[A-Z0-9]{4,12}$/.test(code) || !bot) {
    document.getElementById("bad").hidden = false;
    document.getElementById("print").hidden = true;
    return;
  }
  var qr = qrcode(0, "M");
  qr.addData("https://t.me/" + bot + "?start=k_" + code);
  qr.make();
  document.getElementById("qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  document.getElementById("title").textContent = title ? "«" + title + "»" : "";
  document.getElementById("code").textContent = code;
  box.hidden = false;
  document.getElementById("print").addEventListener("click", function () {
    window.print();
  });
})();
