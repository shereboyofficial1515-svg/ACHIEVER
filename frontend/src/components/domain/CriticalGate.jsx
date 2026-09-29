import { useState } from 'react';
import { Button } from '../ui/index.js';
import { useConfirm } from '../ui/ConfirmProvider.jsx';
import { criticalAction } from '../../security/criticalActions.js';

/**
 * Review → warning → verification: the verification form (password + emailed
 * security code) only appears after the person confirms the warning for this
 * action type. Nothing sensitive happens on a single click.
 */
export default function CriticalGate({ type, startLabel, description, children, confirmOptions }) {
  const confirmAction = useConfirm();
  const [open, setOpen] = useState(false);
  const meta = criticalAction(type);
  if (open) return children({ close: () => setOpen(false) });
  return (
    <div className="stack">
      {description && <p className="small muted">{description}</p>}
      <div>
        <Button variant={meta.severity === 'danger' ? 'danger' : 'secondary'}
          onClick={async () => { if (await confirmAction({ type, ...confirmOptions })) setOpen(true); }}>
          {startLabel}
        </Button>
      </div>
    </div>
  );
}
