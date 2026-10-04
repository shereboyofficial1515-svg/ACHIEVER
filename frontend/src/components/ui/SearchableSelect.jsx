import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { pushOverlay } from '../../platform/overlays.js';

const PAGE = 60;   // rows rendered at a time; more appear as you scroll (long bank lists stay fast)

/** Two-letter badge used when there is no logo or it fails to load (never a broken image). */
export function OptionBadge({ label, logo, size = 32 }) {
  const [failed, setFailed] = useState(false);
  const words = String(label || '?').replace(/\b(bank|plc|limited|ltd|microfinance|mfb|of|nigeria|the)\b/gi, '').trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0] || String(label || '?')).slice(0, 2)).toUpperCase();
  let hue = 0;
  for (const ch of String(label)) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  if (logo && !failed) {
    return <img className="option-logo" src={logo} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  }
  return <span className="option-badge" style={{ width: size, height: size, background: `hsl(${hue} 45% 92%)`, color: `hsl(${hue} 55% 28%)` }} aria-hidden>{initials}</span>;
}

/**
 * A select with search, for long lists (banks, states, LGAs, providers).
 *   options: [{ value, label, logo?, description?, disabled? }]
 *   onChange(value)  — the value, not an event
 * Full-screen sheet on phones, a dropdown panel on larger screens. Keyboard: type to filter,
 * ↑/↓ to move, Enter to choose, Esc (or Android back) to close.
 */
export function SearchableSelect({
  label, value, onChange, options = [], placeholder = 'Select', searchPlaceholder = 'Search…', hint, error, disabled, loading,
  emptyText = 'No matches', showBadges = false, id: idProp, required,
}) {
  const auto = useId();
  const id = idProp || auto;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const sentinel = useRef(null);
  const triggerRef = useRef(null);
  const selected = options.find((o) => String(o.value) === String(value));

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const starts = [];
    const contains = [];
    for (const o of options) {
      const l = o.label.toLowerCase();
      if (l.startsWith(q) || l.split(/\s+/).some((w) => w.startsWith(q))) starts.push(o);
      else if (l.includes(q) || String(o.description || '').toLowerCase().includes(q)) contains.push(o);
    }
    return [...starts, ...contains];
  }, [options, query]);
  const visible = matches.slice(0, limit);

  useEffect(() => { setLimit(PAGE); setActive(0); }, [query, open]);
  useEffect(() => (open ? pushOverlay(() => setOpen(false)) : undefined), [open]);
  // Render more rows when the end of the list scrolls into view.
  useEffect(() => {
    if (!open || !sentinel.current || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) setLimit((n) => n + PAGE); }, { root: listRef.current });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [open, visible.length]);

  const choose = (o) => {
    if (o.disabled) return;
    onChange(o.value);
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, visible.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (visible[active]) choose(visible[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [active]);

  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}{required ? <span aria-hidden> *</span> : null}</label>}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`select searchable-trigger${selected ? '' : ' is-placeholder'}`}
        onClick={() => setOpen(true)}
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={error ? 'true' : undefined}
      >
        {selected && showBadges && <OptionBadge label={selected.label} logo={selected.logo} size={24} />}
        <span className="truncate">{loading ? 'Loading…' : selected ? selected.label : placeholder}</span>
        <ChevronDown size={18} aria-hidden className="searchable-chevron" />
      </button>
      {error ? <span className="error" role="alert">{error}</span> : hint && <span className="hint">{hint}</span>}

      {open && createPortal(
        <div className="sheet-backdrop searchable-backdrop" onClick={() => setOpen(false)}>
          <div className="searchable-panel" role="dialog" aria-modal="true" aria-label={label || placeholder} onClick={(e) => e.stopPropagation()}>
            <div className="searchable-head">
              <strong>{label || placeholder}</strong>
              <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="searchable-search">
              <Search size={18} aria-hidden />
              <input
                className="input"
                type="search"
                autoFocus
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={onKeyDown}
                aria-controls={`${id}-list`}
                aria-activedescendant={visible[active] ? `${id}-opt-${active}` : undefined}
                aria-label={searchPlaceholder}
              />
            </div>
            <ul className="searchable-list" id={`${id}-list`} role="listbox" ref={listRef} aria-label={label}>
              {visible.map((o, i) => {
                const isSel = String(o.value) === String(value);
                return (
                  <li
                    key={o.value}
                    id={`${id}-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={isSel}
                    aria-disabled={o.disabled || undefined}
                    className={`searchable-option${i === active ? ' is-active' : ''}${isSel ? ' is-selected' : ''}${o.disabled ? ' is-disabled' : ''}`}
                    onClick={() => choose(o)}
                    onMouseEnter={() => setActive(i)}
                  >
                    {showBadges && <OptionBadge label={o.label} logo={o.logo} />}
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="truncate" style={{ display: 'block' }}>{o.label}</span>
                      {o.description && <span className="xsmall muted">{o.description}</span>}
                    </span>
                    {isSel && <Check size={18} aria-hidden />}
                  </li>
                );
              })}
              {!matches.length && <li className="searchable-empty">{emptyText}</li>}
              {visible.length < matches.length && <li ref={sentinel} className="searchable-more" aria-hidden>Loading more…</li>}
            </ul>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Banks from the payment provider (backend list). Initial badges; no third-party logos. */
export function BankSelect({ banks = [], loading, ...props }) {
  const options = useMemo(() => banks.map((b) => ({ value: b.code, label: b.name, logo: b.logo })), [banks]);
  return <SearchableSelect label="Bank" placeholder="Select bank" searchPlaceholder="Search banks…" emptyText="No bank matches that name" showBadges options={options} loading={loading} {...props} />;
}

export function StateSelect({ states = [], ...props }) {
  const options = useMemo(() => states.map((s) => ({ value: s.code, label: s.name })), [states]);
  return <SearchableSelect label="State" placeholder="Choose a state" searchPlaceholder="Search states…" options={options} {...props} />;
}
