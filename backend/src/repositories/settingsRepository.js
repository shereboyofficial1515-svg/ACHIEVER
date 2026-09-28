import { db, one, run } from '../integrations/supabase/db.js';

const COLUMNS = 'key, value, description, value_type, category, label, min_value, max_value, options, critical, updated_at, updated_by';

export async function getAll() {
  return run(db.from('app_settings').select(`${COLUMNS}, updater:profiles!app_settings_updated_by_fkey(id, full_name)`).order('category').order('key'));
}

export async function get(key) {
  return one(db.from('app_settings').select('key, value').eq('key', key).maybeSingle());
}

export async function getFull(key) {
  return one(db.from('app_settings').select(COLUMNS).eq('key', key).maybeSingle());
}

export async function set(key, value, updatedBy) {
  return one(
    db.from('app_settings').update({ value, updated_by: updatedBy, updated_at: new Date().toISOString() })
      .eq('key', key).select(COLUMNS).maybeSingle(),
  );
}
