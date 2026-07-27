(function () {
  const params = new URLSearchParams(location.search);
  const reason = params.get("reason");
  if (!reason) return;
  const el = document.getElementById("reason-text");
  if (el) el.textContent = reason;
})();
