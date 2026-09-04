const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' });

export const formatDate = (value) => (value ? dateFmt.format(new Date(value)) : '—');
export const formatDateTime = (value) => (value ? dateTimeFmt.format(new Date(value)) : '—');
export const formatMonth = (value) => (value ? monthFmt.format(new Date(value)) : '');

export function formatRelative(value) {
  if (!value) return 'never';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return formatDate(value);
}

// mockups/mobile_screens.html:462 shows "PREM-00842". No such column exists —
// customer_premises has an integer id, an address, and an optional
// customer_account_id. This is a pure function of the id and stays
// presentation-only: NEVER send it to the API.
//
// If the operator has real premises codes from a billing/OSS system, those
// belong in customer_account_id (which is already searchable), not here.
export const formatPremisesCode = (id) => `PREM-${String(id).padStart(5, '0')}`;

// Accepting the code as search input turns a cosmetic label into a real feature
// for one extra function: a tech reads it off a dispatch note and lands on the
// right premises.
export function parsePremisesCode(value) {
  const match = /^\s*(?:PREM-)0*(\d+)\s*$/i.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

export const formatQuantity = (value, unit) => {
  if (value === null || value === undefined) return '—';
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(2));
  return unit ? `${rounded} ${unit}` : String(rounded);
};

export const formatDateInput = (value) =>
  value ? new Date(value).toISOString().slice(0, 10) : '';

// Today, and today minus N days, as YYYY-MM-DD for date inputs and query params.
export const isoDay = (date = new Date()) => date.toISOString().slice(0, 10);
export function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoDay(d);
}
export function startOfMonth() {
  const d = new Date();
  return isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
}
