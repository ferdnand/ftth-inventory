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

export const formatDate = (value) => (value ? dateFmt.format(new Date(value)) : '—');
export const formatDateTime = (value) => (value ? dateTimeFmt.format(new Date(value)) : '—');

// The mockup's "last synced 2 min ago" line, driven off TanStack Query's
// dataUpdatedAt rather than a bespoke timestamp system.
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

// mockups/mobile_screens.html:462 shows "PREM-00842". No such column exists;
// customer_premises has an integer id, an address, and an optional
// customer_account_id. This is a pure function of the id and stays
// presentation-only — NEVER send it to the API.
//
// It earns its keep because a tech reads it aloud to dispatch.
export const formatPremisesCode = (id) => `PREM-${String(id).padStart(5, '0')}`;

// Accepting the code as search input turns a cosmetic label into a real
// feature: a tech types what is on the dispatch note and lands on the premises.
export function parsePremisesCode(value) {
  const match = /^\s*(?:PREM-)0*(\d+)\s*$/i.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

// pg returns NUMERIC as a string ("180"). Coerce at the boundary so nothing
// downstream compares numbers lexically ('180' < '90' is true).
export const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export const formatQuantity = (value) => {
  const n = num(value);
  if (n === null) return '—';
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
};

// "40 m" for measured work, just the name for flat-rate work — a bare "1" next
// to Splicing is noise, because a splice is always one splice.
export const formatServiceLine = (line) =>
  line.unit_of_measure === 'job'
    ? line.name
    : `${line.name} — ${formatQuantity(line.quantity)} ${line.unit_of_measure === 'meter' ? 'm' : line.unit_of_measure}`;
