import { useState } from 'react';
import { useConfirm } from '../ui/ConfirmProvider.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { newIdempotencyKey } from '../../services/api.js';
import { naira } from '../../utils/format.js';

/**
 * Review → Confirm payment → server starts the checkout → Paystack.
 * Money never moves on the first click: the person sees recipient, purpose,
 * amount, fee, method and total first. The start request carries an
 * idempotency key and runs once even if tapped repeatedly. Success is only
 * ever shown after the server verifies the payment with Paystack.
 *
 *   const { review, activeId } = usePaymentReview();
 *   review({ id, recipient, purpose, amount }, (key) => api.post(url, body, { idempotencyKey: key }));
 */
export function usePaymentReview() {
  const confirmAction = useConfirm();
  const toast = useToast();
  const [run] = useSingleFlight();
  const [activeId, setActiveId] = useState(null);

  const review = ({ id = 'payment', recipient, purpose, amount, fee = 0, reference, extra = [] }, start) => run(async () => {
    const choice = await confirmAction({
      type: 'payment',
      details: [
        ['Recipient', recipient],
        ['Purpose', purpose],
        reference && ['Reference', reference],
        ...extra,
        ['Amount', naira(amount)],
        ['ACHIEVER fee', fee ? naira(fee) : '₦0.00 (no fee)'],
        ['Payment method', 'Paystack: card, bank transfer or USSD'],
        ['Total', naira(amount + fee)],
      ],
      warning: 'Only pay into groups and collectors you know and trust. ACHIEVER never asks you to pay outside the app.',
      cancelLabel: 'Cancel',
      secondary: { label: 'Edit' },
    });
    if (choice !== true) return choice;
    setActiveId(id);
    try {
      const { data } = await start(newIdempotencyKey());
      window.location.assign(data.authorizationUrl);
      // Stay "processing" while the browser leaves for Paystack (no second start).
      await new Promise((resolve) => setTimeout(resolve, 15000));
    } catch (err) {
      toast.error(err);
    } finally {
      setActiveId(null);
    }
    return true;
  });

  return { review, activeId };
}
