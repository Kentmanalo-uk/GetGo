import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { useAuth } from '@/features/auth/AuthProvider';
import { userMessage } from '@/lib/errors';
import { useAcceptLegal, useMyAcceptances, type LegalDocument } from './legal';

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
          I am 18 or older, and I agree to the <DocLinks documents={documents} />. I understand that stores listed on GETGO are independent and that I
          pay my rider directly by GCash.
        </span>
      </label>
      {error && <p className={cx('mt-1 pl-8 text-small text-danger')}>{error}</p>}
    </div>
  );
}

/**
 * Asks signed-in people who haven't accepted the current Terms and Privacy
 * Policy (e.g. accounts created before they were published, or after an
 * update) to review and accept them.
 */
export function AcceptTermsBanner() {
  const { status } = useAuth();
  const accepted = useMyAcceptances();
  const accept = useAcceptLegal();
  if (status !== 'signed_in' || !accepted.data) return null;
  const missing = (['terms', 'privacy'] as LegalDocument[]).filter((d) => !accepted.data.includes(d));
  if (missing.length === 0) return null;
  return (
    <div role="region" aria-label="Updated terms" className="border-b border-accent/30 bg-accent-soft">
      <div className="page-x mx-auto flex max-w-7xl flex-col gap-3 py-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-small text-ink-2">
          Please review our <DocLinks documents={missing} />. They explain that stores on GETGO are independent, how GCash payments to riders work, and
          how we protect your data.
          {accept.error && <span className="block text-danger">{userMessage(accept.error)}</span>}
        </p>
        <Button size="sm" variant="dark" loading={accept.isPending} onClick={() => accept.mutate(missing)} className="self-start sm:self-auto">
          I agree
        </Button>
      </div>
    </div>
  );
}
