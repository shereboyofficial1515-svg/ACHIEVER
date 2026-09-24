import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { prefersReducedMotion } from '../contexts/PreferencesContext.jsx';

gsap.registerPlugin(useGSAP);

/**
 * Purposeful, subtle motion for ACHIEVER. All helpers:
 *  - are short (≤ 0.35s) and never block interaction (elements stay clickable)
 *  - are cleaned up automatically by useGSAP when the component unmounts
 *  - do nothing when reduced motion is on (ACHIEVER setting or OS preference)
 */
export const MOTION = { duration: 0.32, ease: 'power2.out', stagger: 0.05, distance: 10 };

/** Skip animation entirely when motion is reduced or the page is not visible. */
function skip() {
  return prefersReducedMotion() || (typeof document !== 'undefined' && document.visibilityState !== 'visible');
}

/**
 * Content must never stay hidden: if animation frames stop (background tab,
 * throttled device), a timer forces the tween to its final state.
 */
function guard(tween) {
  const id = setTimeout(() => tween.progress(1), 1000);
  tween.eventCallback('onComplete', () => clearTimeout(id));
  return tween;
}

/** Fade/slide an element (or its children with `stagger`) in on mount. */
export function useReveal({ children = false, deps = [] } = {}) {
  const ref = useRef(null);
  useGSAP(() => {
    if (!ref.current || skip()) return;
    const targets = children ? ref.current.children : ref.current;
    guard(gsap.from(targets, {
      opacity: 0, y: MOTION.distance, duration: MOTION.duration, ease: MOTION.ease,
      stagger: children ? MOTION.stagger : 0, clearProps: 'opacity,transform',
    }));
  }, { scope: ref, dependencies: deps });
  return ref;
}

/** Page transition for the main outlet: re-runs whenever `key` (the path) changes. */
export function usePageTransition(key) {
  const ref = useRef(null);
  useGSAP(() => {
    if (!ref.current || skip()) return;
    guard(gsap.fromTo(ref.current, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.22, ease: MOTION.ease, clearProps: 'opacity,transform' }));
  }, { dependencies: [key] });
  return ref;
}

/** Modal / panel entrance (scale is kept very small on purpose). */
export function useDialogMotion(open) {
  const ref = useRef(null);
  useGSAP(() => {
    if (!open || !ref.current || skip()) return;
    guard(gsap.fromTo(ref.current, { opacity: 0, y: 8, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.2, ease: MOTION.ease, clearProps: 'opacity,transform' }));
  }, { dependencies: [open] });
  return ref;
}

/** Status change emphasis (e.g. payment confirmed): a single gentle pop. */
export function useStatusMotion(status) {
  const ref = useRef(null);
  useGSAP(() => {
    if (!ref.current || !status || skip()) return;
    guard(gsap.fromTo(ref.current, { scale: 0.92, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.6)', clearProps: 'opacity,transform' }));
  }, { dependencies: [status] });
  return ref;
}
