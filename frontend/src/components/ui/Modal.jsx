import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Button.jsx';
import { useDialogMotion } from '../../hooks/useMotion.js';
import { pushOverlay } from '../../platform/overlays.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog: labelled, focus moves in and is trapped inside, Escape
 * (and the Android back button) closes it when dismissible, and focus returns
 * to the element that opened it.
 */
export function Modal({ open, onClose, title, children, footer, wide, dismissible = true, describedBy, initialFocus }) {
  const ref = useRef(null);
  const motionRef = useDialogMotion(open);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const target = (initialFocus && ref.current?.querySelector(initialFocus))
      || ref.current?.querySelector('input, select, textarea, button:not([aria-label="Close"])');
    target?.focus();
    const pop = dismissible ? pushOverlay(() => closeRef.current?.()) : () => {};
    return () => {
      pop();
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [open, dismissible, initialFocus]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose?.()}>
      <div
        ref={(el) => {
          ref.current = el;
          motionRef.current = el;
        }}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          {dismissible && (
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'primary', pending, children }) {
  return (
    <Modal
      open={open}
      onClose={pending ? undefined : onClose}
      title={title}
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <p className="muted">{message}</p>}
        {children}
      </div>
    </Modal>
  );
}
