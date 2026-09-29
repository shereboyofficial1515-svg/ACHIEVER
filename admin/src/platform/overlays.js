/**
 * Stack of open dismissible overlays (dialogs, drawers). The Android back
 * button closes the top one before it ever navigates, so "back" can never
 * trigger an action hidden behind a dialog.
 */
const stack = [];

export function pushOverlay(close) {
  const entry = { close };
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
  };
}

/** Close the top overlay; true when one was open. */
export function closeTopOverlay() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close?.();
  return true;
}

export function hasOverlay() {
  return stack.length > 0;
}
