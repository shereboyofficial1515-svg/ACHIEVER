/* Apply the saved theme and accessibility settings (Settings → Appearance and
   Accessibility) before first paint, so the wrong theme never flashes.
   Loaded as a normal blocking script in <head>, kept in a file (not inline) so
   the Content-Security-Policy can forbid inline scripts. */
(function () {
  var r = document.documentElement;
  var a = {};
  try {
    a = JSON.parse(localStorage.getItem('achiever.a11y') || '{}') || {};
  } catch (e) {
    /* storage unavailable: defaults apply */
  }
  var pref = a.theme === 'light' || a.theme === 'dark' ? a.theme : 'system';
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  r.dataset.themePref = pref;
  r.dataset.theme = dark ? 'dark' : 'light';
  if (a.fontScale) r.style.fontSize = Math.round(a.fontScale * 100) + '%';
  r.dataset.motion = a.reducedMotion || 'system';
  r.dataset.contrast = a.highContrast ? 'high' : 'normal';
  r.dataset.targets = a.largerTargets ? 'large' : 'normal';
  r.dataset.links = a.underlineLinks ? 'underline' : 'normal';
  r.dataset.focus = a.strongFocus ? 'strong' : 'normal';
  // Public pages have no React: follow device changes while on "System".
  if (pref === 'system' && window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var on = function () { if ((r.dataset.themePref || 'system') === 'system') r.dataset.theme = mq.matches ? 'dark' : 'light'; };
    if (mq.addEventListener) mq.addEventListener('change', on);
  }
})();
