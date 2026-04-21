/**
 * transition.js — page wipe transition overlay
 * Dark panel slides in from left on exit, retracts to the right on entrance.
 * Gold edge accent matches the Paraval UI theme.
 * Drop this script into any page to get wipe transitions for all same-origin links.
 */
(function () {
  var DURATION = 460;
  var EASE = 'cubic-bezier(0.76, 0, 0.24, 1)';

  // Create the full-viewport wipe panel
  var wipe = document.createElement('div');
  wipe.id = 'page-wipe';
  var s = wipe.style;
  s.position = 'fixed';
  s.inset = '0';
  s.zIndex = '9999';
  s.background = '#05080f';
  // Gold accent on the leading edge as the panel extends
  s.boxShadow = 'inset -3px 0 14px rgba(210,175,70,0.35)';
  // Start fully covering the page
  s.transform = 'scaleX(1)';
  s.transformOrigin = 'right center';
  s.transition = 'transform ' + DURATION + 'ms ' + EASE;
  s.pointerEvents = 'none';
  s.willChange = 'transform';
  document.body.appendChild(wipe);

  // Entrance: retract the wipe panel to reveal the page
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      wipe.style.transform = 'scaleX(0)';
    });
  });

  // Exit: extend the wipe panel then navigate
  function transitionTo(href) {
    if (wipe._busy) return;
    wipe._busy = true;
    wipe.style.pointerEvents = 'all';
    wipe.style.transformOrigin = 'left center';
    wipe.style.transform = 'scaleX(1)';
    setTimeout(function () {
      window.location.href = href;
    }, DURATION + 30);
  }

  // Expose for programmatic navigation (e.g. after async operations)
  window.pageTransitionTo = transitionTo;

  // Intercept all same-origin anchor clicks automatically
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    if (a.hasAttribute('data-no-transition')) return;
    if (a.target === '_blank') return;

    var href = a.getAttribute('href');
    if (!href) return;
    if (href.startsWith('#')) return;
    if (href.startsWith('javascript')) return;
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return;

    // Only intercept same-origin navigations
    try {
      var resolved = new URL(href, window.location.origin);
      if (resolved.origin !== window.location.origin) return;
    } catch (_) {
      return;
    }

    e.preventDefault();
    transitionTo(a.href);
  });
})();
