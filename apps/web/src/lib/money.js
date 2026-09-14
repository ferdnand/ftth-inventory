// Money, in shillings.
//
// Every amount the API sends is KES with two decimals, and the currency travels
// in the response next to the figures rather than being assumed here — but
// there is only one, so the formatter is not parameterised until there is a
// second.
//
// Whole shillings by default: cents on a job that came to 7,285 are noise, and
// every rate in the catalog is quoted in whole shillings anyway. A fractional
// amount still shows its cents, because hiding them would make the column stop
// adding up.
const shillings = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });
const withCents = new Intl.NumberFormat('en-KE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const asNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// An unpriced line is not a free line, so it reads as a dash rather than as
// "KES 0" — which would be a claim nobody has made.
export function formatMoney(value) {
  const n = asNumber(value);
  if (n === null) return '—';
  return `KES ${Number.isInteger(n) ? shillings.format(n) : withCents.format(n)}`;
}

// Just the number, for a column already headed in shillings.
export function formatAmount(value) {
  const n = asNumber(value);
  if (n === null) return '—';
  return Number.isInteger(n) ? shillings.format(n) : withCents.format(n);
}

// What was typed, as something the API will accept. An empty box is not zero:
// it means the amount has not been given, and sending 0 would record a real
// claim that something cost nothing.
export function parseAmount(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
