import { useEffect, useState } from 'react';
import { Select } from '../ui/index.js';
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
      <Select
        label="State"
        placeholder="Choose a state"
        value={stateCode || ''}
        onChange={(e) => onChange({ stateCode: e.target.value, lgaId: '' })}
        options={states.map((s) => ({ value: s.code, label: s.name }))}
        error={errors.stateCode || loadError}
        disabled={disabled}
        required
      />
      <Select
        label="Local government area"
        placeholder={stateCode ? 'Choose an LGA' : 'Choose a state first'}
        value={lgaId ? String(lgaId) : ''}
        onChange={(e) => onChange({ stateCode, lgaId: e.target.value })}
        options={lgas.map((l) => ({ value: String(l.id), label: l.name }))}
        error={errors.lgaId}
        disabled={disabled || !stateCode}
        required
      />
    </div>
  );
}
