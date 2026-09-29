/* Admin theme (Light / Dark / System) applied before first paint. A file, not an inline script, so the CSP can forbid inline code. */
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('achiever.admin.theme') || 'system'; } catch (e) { /* storage unavailable */ }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.themePref = pref;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
