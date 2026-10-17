import { Link } from 'react-router';
import { cx } from '@/components/ui/cx';
import type { LegalDocument } from './legal';

const LABELS: Record<LegalDocument, { label: string; to: string }> = {
  terms: { label: 'Terms of Service', to: '/legal/terms' },
  privacy: { label: 'Privacy Policy', to: '/legal/privacy' },
  rider_terms: { label: 'Rider Terms', to: '/legal/riders' },
  store_terms: { label: 'Store Listing Terms', to: '/legal/stores' },
};

function DocLinks({ documents }: { documents: LegalDocument[] }) {
  return (
    <>
      {documents.map((d, i) => (
        <span key={d}>
          {i > 0 && (i === documents.length - 1 ? ' and ' : ', ')}
          <Link to={LABELS[d].to} target="_blank" className="font-semibold text-ink underline underline-offset-4">
            {LABELS[d].label}
          </Link>
        </span>
      ))}
    </>
  );
}

/** Required agreement checkbox for sign-up and application forms. */
export function LegalConsent({
  documents,
  checked,
  onChange,
  error,
}: {
  documents: LegalDocument[];
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
}) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3 text-small text-ink-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-ink"
          aria-invalid={Boolean(error) || undefined}
        />
        <span>
          I agree to the <DocLinks documents={documents} />.
        </span>
      </label>
      {error && <p className={cx('mt-1 pl-8 text-small text-danger')}>{error}</p>}
    </div>
  );
}
