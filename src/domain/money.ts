/** Money is handled as integer minor units (centavos) everywhere. */

const pesoFormatter = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const pesoFormatterFixed = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₱120 for whole pesos, ₱120.50 otherwise. */
export function formatMoney(minor: number | null | undefined, opts: { fixed?: boolean } = {}): string {
  const value = (minor ?? 0) / 100;
  const formatter = opts.fixed || !Number.isInteger(value) ? pesoFormatterFixed : pesoFormatter;
  const sign = value < 0 ? '−' : '';
  return `${sign}₱${formatter.format(Math.abs(value))}`;
}

/** "+₱15" for option price adjustments; empty for free options. */
export function formatDelta(minor: number): string {
  return minor > 0 ? `+${formatMoney(minor)}` : '';
}

/** Parses a peso amount typed by a person ("120", "1,250.50") into minor units. */
export function parsePesos(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** Minor units to an editable peso string ("120" or "120.50"). */
export function toPesoInput(minor: number | null | undefined): string {
  if (minor == null) return '';
  const whole = Math.trunc(minor / 100);
  const fraction = minor % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}

export function formatPercentFromBps(bps: number | null | undefined): string {
  if (bps == null) return '—';
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}
