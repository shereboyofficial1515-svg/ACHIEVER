import { useState } from 'react';
import { Check } from 'lucide-react';
import { providerLogoSrc, providerMonogram } from '../../content/providerAssets.js';

/**
 * Provider logo: fixed square box, artwork kept in proportion (object-fit:
 * contain), lazy-loaded, and replaced by an ACHIEVER monogram if the image is
 * missing or fails — never a broken-image icon.
 */
export function ProviderLogo({ provider, size = 48, eager = false }) {
  const src = providerLogoSrc(provider);
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!src || failed) {
    return <span className="provider-logo is-monogram" style={style} aria-hidden>{providerMonogram(provider)}</span>;
  }
  return (
    <span className="provider-logo" style={style}>
      <img src={src} width={size} height={size} alt={`${provider.providerName || provider.name} logo`}
        loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} />
    </span>
  );
}

/** Selectable provider card (radio semantics inside a radiogroup). */
export function ProviderCard({ provider, selected, onSelect }) {
  const unavailable = provider.maintenance;
  return (
    <button type="button" role="radio" aria-checked={selected} disabled={unavailable}
      className={`provider-card${selected ? ' is-selected' : ''}${unavailable ? ' is-disabled' : ''}`}
      onClick={() => onSelect(provider.serviceId)}>
      <ProviderLogo provider={provider} size={44} />
      <span className="provider-card-text">
        <strong>{provider.providerName}</strong>
        <span className="xsmall muted">
          {unavailable ? 'Under maintenance' : [provider.shortName !== provider.providerName && provider.shortName, provider.categoryLabel].filter(Boolean).join(' · ')}
        </span>
      </span>
      {selected && <Check size={18} className="provider-card-check" aria-hidden />}
    </button>
  );
}

export function ProviderCardSkeleton({ count = 4 }) {
  return (
    <div className="provider-grid" aria-busy="true" aria-label="Loading providers">
      {Array.from({ length: count }, (_, i) => <div key={i} className="provider-card is-skeleton"><span className="skeleton-block" /></div>)}
    </div>
  );
}

/** Plan/package card: data bundles, TV bouquets, exam PINs (prices come from the provider via the API). */
export function PlanCard({ plan, provider, selected, onSelect, naira }) {
  const size = plan.name.match(/(\d+(?:\.\d+)?\s?(?:GB|MB|TB))/i)?.[1];
  const title = size || plan.name.replace(/^(mtn|airtel|glo|9mobile|etisalat)\s*/i, '').replace(/\s*[-–]\s*\d+\s*(days?|hrs?|hours?|weeks?|months?)\s*$/i, '');
  return (
    <button type="button" role="radio" aria-checked={selected} className={`plan-card${selected ? ' is-selected' : ''}`} onClick={() => onSelect(plan.code)}>
      <ProviderLogo provider={provider} size={28} />
      <span className="plan-card-text">
        <strong>{title}</strong>
        <span className="xsmall muted">{[plan.validity, size ? plan.name : null].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="plan-card-price money">{naira(plan.amount)}</span>
    </button>
  );
}
