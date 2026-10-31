// جستجو و فیلتر دسته در صفحه‌ی اصلی، کاملاً در مرورگر. نرمال‌سازی مثل searchKey در build.mjs.
(function () {
  var key = function (s) {
    return String(s || "")
      .replace(/[يى]/g, "ی")
      .replace(/ك/g, "ک")
      .replace(/[آأإ]/g, "ا")
      .replace(/[ً-ٰٟـ]/g, "")
      .replace(/[‌\s]+/g, "")
      .toLowerCase();
  };
  var input = document.getElementById("q");
  var cards = Array.prototype.slice.call(document.querySelectorAll("#books .card"));
  var chips = Array.prototype.slice.call(document.querySelectorAll(".chip"));
  var none = document.getElementById("none");
  var cat = "";

  function apply() {
    // هر کلمه باید جایی در متن کتاب باشد
    var words = String(input.value || "").split(/\s+/).map(key).filter(Boolean);
    var shown = 0;
    cards.forEach(function (c) {
      var q = c.getAttribute("data-q");
      var ok = (!cat || c.getAttribute("data-cat") === cat) && words.every(function (w) { return q.indexOf(w) >= 0; });
      c.hidden = !ok;
      if (ok) shown++;
    });
    none.hidden = shown > 0;
  }

  input.addEventListener("input", apply);
  // جستجوی بخش اصلی: متن را به جستجوی فهرست می‌دهد و به فهرست می‌رود
  var form = document.querySelector(".hero-search");
  if (form) form.addEventListener("submit", function (e) {
    e.preventDefault();
    input.value = document.getElementById("hq").value;
    apply();
    document.getElementById("books").scrollIntoView({ behavior: "smooth" });
  });
  chips.forEach(function (b) {
    b.addEventListener("click", function () {
      cat = b.getAttribute("data-cat");
      chips.forEach(function (x) { x.classList.toggle("on", x === b); });
      apply();
    });
  });
})();
