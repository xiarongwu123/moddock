import { motion } from './useMotion';

const animations = new Set();
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(node, frames, duration, delay = 0) {
 if (!node || reduced()) return Promise.resolve();
 const animation = node.animate(frames, { duration, delay, easing: motion.ease, fill: 'both' });
 animations.add(animation);
 return animation.finished.catch(() => {}).finally(() => { animations.delete(animation); animation.cancel(); });
}

export function enterPage(root) {
 const content = root.querySelector('.content');
 void animate(content, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], motion.panel);
 const cards = root.querySelectorAll('.game-card, .mod-card, .workshop-game, .installed-row');
 [...cards].slice(0, 8).forEach((card, index) => {
  void animate(card, [{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], motion.panel, Math.min(index * 24, 120));
 });
}

export function setModalContent(root, markup) {
 const current = root.firstElementChild;
 if (current && !current.dataset.closing) {
  // Keep the animated shell when detail requests replace a loading state.
  const template = document.createElement('template');
  template.innerHTML = markup;
  const next = template.content.querySelector('.modal');
  const dialog = current.querySelector('.modal');
  const focused = dialog.contains(document.activeElement);
  const focusId = focused ? document.activeElement.id : null;
  dialog.className = next.className;
  dialog.innerHTML = next.innerHTML;
  if (focused) (focusId && document.getElementById(focusId) || dialog.querySelector('[data-close]'))?.focus({ preventScroll: true });
  return;
 }
 root.innerHTML = markup;
 void animate(root.firstElementChild, [{ opacity: 0 }, { opacity: 1 }], motion.panel);
 void animate(root.querySelector('.modal'), [{ transform: 'translateY(16px) scale(.985)' }, { transform: 'translateY(0) scale(1)' }], motion.panel);
}

export function dismissModal(root, immediate = false) {
 const backdrop = root?.firstElementChild;
 if (!backdrop) return;
 if (immediate || reduced()) { backdrop.remove(); return; }
 if (backdrop.dataset.closing) return;
 backdrop.dataset.closing = 'true';
 backdrop.inert = true;
 backdrop.style.pointerEvents = 'none';
 const dialog = backdrop.querySelector('.modal');
 const opacity = getComputedStyle(backdrop).opacity;
 const transform = getComputedStyle(dialog).transform;
 void Promise.all([
  animate(backdrop, [{ opacity }, { opacity: 0 }], motion.fast),
  animate(dialog, [{ transform }, { transform: 'translateY(8px) scale(.99)' }], motion.fast),
 ]).then(() => backdrop.remove());
}

export function cancelDomMotion() {
 for (const animation of animations) animation.cancel();
 animations.clear();
}

window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
 if (event.matches) cancelDomMotion();
});
