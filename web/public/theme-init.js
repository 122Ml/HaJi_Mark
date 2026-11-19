(function () {
  try {
    var saved = window.localStorage.getItem("haji:theme-mode");
    document.documentElement.dataset.themeMode = saved === "dark" ? "dark" : "light";
  } catch (_err) {
    document.documentElement.dataset.themeMode = "light";
  }
})();
