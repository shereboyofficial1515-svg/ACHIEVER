/* Apply saved accessibility settings (Settings -> Accessibility) before first paint.
   Loaded as a normal blocking script in <head> so there is no flash, and kept
   in a file (not inline) so the Content-Security-Policy can forbid inline scripts. */
(function () {
  try {
    var a = JSON.parse(localStorage.getItem('achiever.a11y') || '{}');
    var r = document.documentElement;
    if (a.fontScale) r.style.fontSize = Math.round(a.fontScale * 100) + '%';
    r.dataset.motion = a.reducedMotion || 'system';
    r.dataset.contrast = a.highContrast ? 'high' : 'normal';
    r.dataset.targets = a.largerTargets ? 'large' : 'normal';
    r.dataset.links = a.underlineLinks ? 'underline' : 'normal';
    r.dataset.focus = a.strongFocus ? 'strong' : 'normal';
  } catch (e) {
    /* storage unavailable: defaults apply */
  }
})();
