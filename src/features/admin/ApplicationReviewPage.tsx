import { useState } from 'react';
import { useParams } from 'react-router';
import { FileText } from '@/components/icons';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, FormError, Notice, PageLoading } from '@/components/ui/Feedback';
import { MediaImage, PageHeader, SectionHeading, StatusText, formatDateTime } from '@/components/ui/Display';
import { ConfirmDialog } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { formatMoney } from '@/domain/money';
import { summarizeHours } from '@/domain/hours';
import { userMessage } from '@/lib/errors';
import { CATEGORY_LABELS, type ApplicationStatus } from '@/types/models';
import { openDocument, personLabel, useApplication, usePermissions, useProfiles, useReviewApplication } from './api';
import { APPLICATION_LABELS, DOCUMENT_LABELS, Detail, RoleNote, applicationTone, formatBytes } from './ui';

type Decision = Extract<ApplicationStatus, 'under_review' | 'needs_changes' | 'rejected' | 'approved'>;

const DECISIONS: Record<Decision, { title: string; confirm: string; body: string; tone: 'danger' | 'primary'; reason?: { label: string; placeholder: string; required: boolean } }> = {
  approved: {
    title: 'Approve this partner?',
    confirm: 'Approve and create store',
    body: 'This creates the store, makes the applicant its owner and copies their menu as draft products to review. The store stays hidden until the owner publishes it.',
    tone: 'primary',
    reason: { label: 'Note to the applicant', placeholder: 'Welcome to GETGO!', required: false },
  },
  under_review: {
    title: 'Start reviewing?',
    confirm: 'Mark under review',
    body: 'The application moves to “Under review” so other staff know someone is on it.',
    tone: 'primary',
  },
  needs_changes: {
    title: 'Ask for changes?',
    confirm: 'Send to applicant',
    body: 'The applicant is notified and can edit and resubmit their application.',
    tone: 'primary',
    reason: { label: 'What needs to change', placeholder: 'The business permit photo is blurry. Upload a clearer copy.', required: true },
  },
  rejected: {
    title: 'Reject this application?',
    confirm: 'Reject application',
    body: 'The applicant is notified with your note. They can apply again later.',
    tone: 'danger',
    reason: { label: 'Reason shared with the applicant', placeholder: 'We don’t serve this area yet.', required: true },
  },
};

const TOASTS: Record<Decision, string> = {
  approved: 'Partner approved — store created',
  under_review: 'Marked under review',
  needs_changes: 'Changes requested',
  rejected: 'Application rejected',
};

function DocumentRow({ doc }: { doc: { storage_path: string; file_name: string; doc_type: keyof typeof DOCUMENT_LABELS; size_bytes: number; created_at: string } }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="flex items-center gap-3 py-3">
      <FileText className="size-5 shrink-0 text-ink-3" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{DOCUMENT_LABELS[doc.doc_type]}</p>
        <p className="truncate text-small text-ink-3">
          {doc.file_name} · {formatBytes(doc.size_bytes)} · {formatDateTime(doc.created_at)}
        </p>
        {error && <p className="text-small text-danger">{error}</p>}
      </div>
      <Button
        variant="secondary"
        size="sm"
        loading={opening}
        onClick={async () => {
          setError(null);
          setOpening(true);
          try {
            await openDocument(doc.storage_path);
          } catch (e) {
            setError(userMessage(e));
          } finally {
            setOpening(false);
          }
        }}
      >
        View
      </Button>
    </li>
  );
}

export default function ApplicationReviewPage() {
  const { applicationId } = useParams();
  const perms = usePermissions();
  const query = useApplication(perms.canReviewApplications ? applicationId : undefined);
  const applicant = useProfiles([query.data?.application?.applicant_id]);
  const review = useReviewApplication();
  const toast = useToast();
  const [decision, setDecision] = useState<Decision | null>(null);

  if (!perms.canReviewApplications) {
    return (
      <div>
        <PageHeader title="Application" back="/admin" />
        <Notice>Partner applications are reviewed by admin and support staff.</Notice>
      </div>
    );
  }
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const { application: app, documents, missing } = query.data;
  if (!app) {
    return <EmptyState title="Application not found" action={<ButtonLink to="/admin/applications" variant="secondary">All applications</ButtonLink>} />;
  }

  const name = app.business_name || 'Untitled application';
  const actionable = app.status === 'submitted' || app.status === 'under_review';
  const hours = summarizeHours(app.hours ?? []);
  const owner = applicant.data?.[app.applicant_id];
  const active = decision ? DECISIONS[decision] : null;

  return (
    <div>
      <PageHeader title={name} back="/admin/applications">
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <StatusText tone={applicationTone(app.status)}>{APPLICATION_LABELS[app.status]}</StatusText>
          {app.submitted_at && (
            <>
              <span aria-hidden>·</span> Submitted {formatDateTime(app.submitted_at)}
            </>
          )}
        </span>
      </PageHeader>

      <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-12 lg:space-y-0">
        <div className="space-y-10">
          {app.status === 'approved' && app.merchant_id && (
            <Notice tone="success" title="Approved" action={<ButtonLink to={`/admin/merchants/${app.merchant_id}`} size="sm" variant="secondary">View merchant</ButtonLink>}>
              The store was created{app.reviewed_at ? ` on ${formatDateTime(app.reviewed_at)}` : ''}.
            </Notice>
          )}
          {missing.length > 0 && app.status !== 'approved' && app.status !== 'rejected' && (
            <Notice tone="warning" title="Missing from this application">
              <ul className="list-disc pl-4">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Notice>
          )}
          {app.review_notes && (
            <Notice title="Review notes">
              <p className="whitespace-pre-wrap">{app.review_notes}</p>
            </Notice>
          )}

          <section>
            <SectionHeading title="Business" />
            <dl className="divide-y divide-line border-y border-line text-small">
              <Detail label="Name">{app.business_name || '—'}</Detail>
              <Detail label="Category">{app.category ? CATEGORY_LABELS[app.category] : '—'}</Detail>
              <Detail label="Description">{app.description ? <span className="whitespace-pre-wrap">{app.description}</span> : '—'}</Detail>
              <Detail label="Business phone">{app.business_phone || '—'}</Detail>
              <Detail label="Address">{[app.address_line, app.barangay, app.city].filter(Boolean).join(', ') || '—'}</Detail>
              <Detail label="Service area">
                {app.service_areas ? (
                  <>
                    {app.service_areas.name}
                    {!app.service_areas.is_active && <span className="text-danger"> · area is turned off</span>}
                  </>
                ) : (
                  '—'
                )}
              </Detail>
            </dl>
          </section>

          <section>
            <SectionHeading title="Owner" />
            <dl className="divide-y divide-line border-y border-line text-small">
              <Detail label="Name">{app.owner_name || '—'}</Detail>
              <Detail label="Mobile">{app.owner_phone || '—'}</Detail>
              <Detail label="Email">{app.owner_email || '—'}</Detail>
              <Detail label="GETGO account">{owner ? `${personLabel(owner)}${owner.email && owner.full_name ? ` · ${owner.email}` : ''}` : '—'}</Detail>
            </dl>
          </section>

          <section>
            <SectionHeading title="Opening hours" />
            {app.hours?.length ? (
              <dl className="divide-y divide-line border-y border-line text-small">
                {hours.map((h) => (
                  <Detail key={h.days} label={h.days}>
                    <span className={h.hours === 'Closed' ? 'text-ink-3' : undefined}>{h.hours}</span>
                  </Detail>
                ))}
              </dl>
            ) : (
              <p className="text-small text-ink-3">No hours provided.</p>
            )}
          </section>

          <section>
            <SectionHeading title={`Menu (${app.menu_items?.length ?? 0})`} />
            {app.menu_items?.length ? (
              <ul className="divide-y divide-line border-y border-line">
                {app.menu_items.map((item, i) => (
                  <li key={i} className="flex gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{item.name}</p>
                      {(item.category || item.description) && (
                        <p className="text-small text-ink-3">{[item.category, item.description].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                    <span className="tabular shrink-0">{formatMoney(item.price_minor)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-ink-3">No menu items provided.</p>
            )}
          </section>

          <section>
            <SectionHeading title="Branding" />
            {app.logo_path || app.cover_path ? (
              <div className="flex flex-wrap items-end gap-4">
                {app.logo_path && (
                  <figure>
                    <MediaImage path={app.logo_path} alt={`${name} logo`} className="size-24 rounded-media" />
                    <figcaption className="mt-1 text-micro text-ink-3">Logo</figcaption>
                  </figure>
                )}
                {app.cover_path && (
                  <figure className="min-w-0 flex-1">
                    <MediaImage path={app.cover_path} alt={`${name} cover photo`} className="aspect-[3/1] w-full max-w-md rounded-media" />
                    <figcaption className="mt-1 text-micro text-ink-3">Cover photo</figcaption>
                  </figure>
                )}
              </div>
            ) : (
              <p className="text-small text-ink-3">No logo or cover photo uploaded.</p>
            )}
          </section>

          <section>
            <SectionHeading title="Documents" />
            {documents.length ? (
              <ul className="divide-y divide-line border-y border-line">
                {documents.map((d) => (
                  <DocumentRow key={d.id} doc={d} />
                ))}
              </ul>
            ) : (
              <p className="text-small text-ink-3">No documents uploaded.</p>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <h2 className="mb-3 text-heading font-semibold">Decision</h2>
          {!actionable ? (
            <p className="text-small text-ink-3">
              {app.status === 'needs_changes'
                ? 'Waiting for the applicant to update and resubmit.'
                : app.status === 'draft'
                  ? 'The applicant hasn’t submitted this yet.'
                  : `This application is ${APPLICATION_LABELS[app.status].toLowerCase()}. No further review actions.`}
            </p>
          ) : (
            <div className="space-y-3">
              <Button block disabled={!perms.canDecideApplications} onClick={() => setDecision('approved')}>
                Approve
              </Button>
              {app.status === 'submitted' && (
                <Button block variant="secondary" onClick={() => setDecision('under_review')}>
                  Mark under review
                </Button>
              )}
              <Button block variant="secondary" onClick={() => setDecision('needs_changes')}>
                Request changes
              </Button>
              <Button block variant="danger-quiet" disabled={!perms.canDecideApplications} onClick={() => setDecision('rejected')}>
                Reject
              </Button>
              {!perms.canDecideApplications && <RoleNote>Only administrators can approve or reject partners.</RoleNote>}
            </div>
          )}
        </aside>
      </div>

      {active && (
        <ConfirmDialog
          open
          onClose={() => {
            setDecision(null);
            review.reset();
          }}
          title={active.title}
          body={active.body}
          confirmLabel={active.confirm}
          tone={active.tone}
          reason={active.reason}
          loading={review.isPending}
          error={review.error ? <FormError error={review.error} /> : null}
          onConfirm={async (notes) => {
            await review.mutateAsync({ applicationId: app.id, decision: decision!, notes });
            toast(TOASTS[decision!]);
            setDecision(null);
          }}
        />
      )}
    </div>
  );
}
