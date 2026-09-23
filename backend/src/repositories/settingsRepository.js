import { db, one, run } from '../integrations/supabase/db.js';

export async function getAll() {
  return run(db.from('app_settings').select('key, value, description, updated_at').order('key'));
}

export async function get(key) {
  return one(db.from('app_settings').select('key, value').eq('key', key).maybeSingle());
}

export async function set(key, value, updatedBy) {
  return one(
    db.from('app_settings').update({ value, updated_by: updatedBy, updated_at: new Date().toISOString() })
      .eq('key', key).select('key, value, description, updated_at').maybeSingle(),
  );
}
