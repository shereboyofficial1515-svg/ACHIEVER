/**
 * Minimal RFC 4180 CSV writer with spreadsheet formula-injection protection.
 */
function cell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows, columns) {
  const header = columns.map((c) => cell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => cell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','));
  return [header, ...lines].join('\r\n');
}
