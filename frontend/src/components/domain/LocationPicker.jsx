import { useEffect, useState } from 'react';
import { SearchableSelect, StateSelect } from '../ui/index.js';
import { api } from '../../services/api.js';

let statesCache = null;
const lgaCache = new Map();

/** Nigerian state → LGA picker backed by the server's reference data (37 states, 774 LGAs). */
export default function LocationPicker({ stateCode, lgaId, onChange, errors = {}, disabled }) {
  const [states, setStates] = useState(statesCache || []);
  const [lgas, setLgas] = useState(stateCode ? lgaCache.get(stateCode) || [] : []);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (statesCache) return;
    api.get('/reference/states')
      .then(({ data }) => {
        statesCache = data;
        setStates(data);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    if (!stateCode) {
      setLgas([]);
      return;
    }
    if (lgaCache.has(stateCode)) {
      setLgas(lgaCache.get(stateCode));
      return;
    }
    let active = true;
    api.get(`/reference/states/${stateCode}/lgas`)
      .then(({ data }) => {
        lgaCache.set(stateCode, data);
        if (active) setLgas(data);
      })
      .catch((err) => setLoadError(err.message));
    return () => {
      active = false;
    };
  }, [stateCode]);

  return (
    <div className="grid-2">
      <StateSelect
        states={states}
        loading={!states.length && !loadError}
        value={stateCode || ''}
        onChange={(code) => onChange({ stateCode: code, lgaId: '' })}
        error={errors.stateCode || loadError}
        disabled={disabled}
        required
      />
      <SearchableSelect
        label="Local government area"
        placeholder={stateCode ? 'Choose an LGA' : 'Choose a state first'}
        searchPlaceholder="Search LGAs…"
        value={lgaId ? String(lgaId) : ''}
        onChange={(id) => onChange({ stateCode, lgaId: id })}
        options={lgas.map((l) => ({ value: String(l.id), label: l.name }))}
        error={errors.lgaId}
        disabled={disabled || !stateCode}
        required
      />
    </div>
  );
}
