// Money, in shillings.
//
// Every amount the API sends is KES with two decimals, and the currency travels
// in the response next to the figures (see lib/jobLines.js) rather than being
// assumed here — but there is only one, so the formatter is not parameterised
// until there is a second.
//
// Whole shillings by default. Cents on a costing screen for a job that came to
// 7,285 are four characters of noise on a phone in daylight, and every rate in
// the catalog is quoted in whole shillings anyway.
const shillings = new Intl.NumberFormat('en-KE', {
  maximumFractionDigits: 0,
});

const withCents = new Intl.NumberFormat('en-KE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// An unpriced line is not a free line, so it reads as a dash rather than as
// "KES 0" — which would be a claim nobody has made.
export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const body = Number.isInteger(n) ? shillings.format(n) : withCents.format(n);
  return `KES ${body}`;
}

// Just the number, for a total sitting under its own "KES" heading.
export function formatAmount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? shillings.format(n) : withCents.format(n);
}

// What the tech typed, as something the API will accept. An empty box is not
// zero: it means the amount has not been given, and a form that sends 0 for it
// would record a real claim that the job cost nothing.
export function parseAmount(text) {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
