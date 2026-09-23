import { forwardRef, useId } from 'react';

function FieldShell({ id, label, hint, error, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={id}>{label}</label>}
      {children}
      {error ? (
        <span className="error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : (
        hint && (
          <span className="hint" id={`${id}-hint`}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}

export const Input = forwardRef(function Input({ label, hint, error, className, id: idProp, ...rest }, ref) {
  const auto = useId();
  const id = idProp || auto;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <input
        ref={ref}
        id={id}
        className="input"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...rest}
      />
    </FieldShell>
  );
});

export function Select({ label, hint, error, options, placeholder, className, id: idProp, ...rest }) {
  const auto = useId();
  const id = idProp || auto;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <select id={id} className="select" aria-invalid={error ? 'true' : undefined} {...rest}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function Textarea({ label, hint, error, className, id: idProp, ...rest }) {
  const auto = useId();
  const id = idProp || auto;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <textarea id={id} className="textarea" aria-invalid={error ? 'true' : undefined} {...rest} />
    </FieldShell>
  );
}

/** Naira amount input. Value is the raw text; convert with parseNairaToKobo(). */
export function MoneyInput({ label, hint, error, className, id: idProp, ...rest }) {
  const auto = useId();
  const id = idProp || auto;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <div className="input-prefix">
        <span aria-hidden>₦</span>
        <input id={id} className="input" inputMode="decimal" autoComplete="off" aria-invalid={error ? 'true' : undefined} {...rest} />
      </div>
    </FieldShell>
  );
}

export function Checkbox({ label, ...rest }) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

/** Pull field-level errors out of an ApiError for display. */
export function fieldErrors(error) {
  return error?.fields || {};
}
