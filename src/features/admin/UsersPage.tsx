import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { ErrorState, FormError, LoadingDots } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader, SectionHeading, StatusText, formatDate, timeAgo } from '@/components/ui/Display';
import { ConfirmDialog } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { cx } from '@/components/ui/cx';
import { formatMoney } from '@/domain/money';
import {
  ROLE_LABELS,
  STAFF_ROLES,
  personLabel,
  useCustomerOrders,
  useGrantRole,
  usePermissions,
  useProfileSearch,
  useProfiles,
  useRevokeRole,
  useRoleHolders,
  useUserRoles,
  type AdminProfile,
  type RoleHolder,
  type StaffRole,
} from './api';
import { DataTable, ListSkeleton, ORDER_STATUS_LABELS, RoleNote, SearchBox, orderTone } from './ui';

const ROLE_HINTS: Record<StaffRole, string> = {
  admin: 'Everything, including approvals, settings and roles.',
  support: 'Orders, rider assignment, applications review and support requests.',
  finance: 'Payment records and refunds.',
};

function PersonDetails({ person, showRoles }: { person: AdminProfile; showRoles: boolean }) {
  const orders = useCustomerOrders(person.id);
  const roles = useUserRoles(person.id, showRoles);
  return (
    <div className="space-y-3 pb-4 pl-1 text-small">
      {showRoles && (
        <p className="text-ink-2">
          <span className="text-ink-3">Roles: </span>
          {roles.isPending ? '…' : roles.data?.length ? roles.data.map((r) => ROLE_LABELS[r]).join(', ') : 'Customer only'}
        </p>
      )}
      <div>
        <p className="mb-1 text-ink-3">Recent orders</p>
        {orders.isPending ? (
          <LoadingDots />
        ) : orders.isError ? (
          <FormError error={orders.error} />
        ) : orders.data.length === 0 ? (
          <p className="text-ink-3">No orders.</p>
        ) : (
          <ul className="divide-y divide-line">
            {orders.data.map((o) => (
              <li key={o.id}>
                <Link to={`/admin/orders/${o.id}`} className="flex items-center gap-3 py-2 hover:underline">
                  <span className="font-mono font-semibold">{o.code}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{o.merchant_name}</span>
                  <StatusText tone={orderTone(o.status)} className="hidden sm:inline-flex">
                    {ORDER_STATUS_LABELS[o.status] ?? o.status}
                  </StatusText>
                  <span className="tabular shrink-0">{formatMoney(o.total_minor)}</span>
                  <span className="hidden shrink-0 text-ink-3 sm:inline">{timeAgo(o.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PeopleSearch({ showRoles }: { showRoles: boolean }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const results = useProfileSearch(search);
  const onSearch = useCallback((v: string) => setSearch(v), []);
  const term = search.trim();

  return (
    <section>
      <SectionHeading title="Find a person" />
      <SearchBox value={search} onChange={onSearch} placeholder="Name, email or phone" label="Search people" className="mb-4 sm:max-w-sm" />
      {term.length < 2 ? (
        <p className="text-small text-ink-3">Type at least 2 characters to search customer, store and staff accounts.</p>
      ) : results.isPending ? (
        <ListSkeleton rows={3} />
      ) : results.isError ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : results.data.length === 0 ? (
        <p className="text-small text-ink-3">No accounts match “{term}”.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {results.data.map((p) => {
            const expanded = open === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : p.id)}
                  className="flex w-full items-center gap-3 py-3 text-left hover:bg-canvas/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{personLabel(p)}</span>
                    <span className="block truncate text-small text-ink-3">{[p.email, p.phone].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="hidden shrink-0 text-small text-ink-3 sm:inline">Joined {formatDate(p.created_at)}</span>
                  <ChevronDown className={cx('size-4 shrink-0 text-ink-3 transition-transform', expanded && 'rotate-180')} aria-hidden />
                </button>
                {expanded && <PersonDetails person={p} showRoles={showRoles} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StaffRoles() {
  const perms = usePermissions();
  const holders = useRoleHolders(true);
  const people = useProfiles(holders.data?.map((h) => h.user_id) ?? []);
  const grant = useGrantRole();
  const revoke = useRevokeRole();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('support');
  const [confirmGrant, setConfirmGrant] = useState(false);
  const [revoking, setRevoking] = useState<RoleHolder | null>(null);
  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());

  const name = (h: RoleHolder) => personLabel(people.data?.[h.user_id], 'Unknown account');

  return (
    <section>
      <SectionHeading title="Staff roles" />
      <form
        className="mb-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          if (emailValid) setConfirmGrant(true);
        }}
      >
        <Field label="Account email" hint="They need a GETGO account first.">
          {(p) => <Input {...p} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Role" hint={ROLE_HINTS[role]}>
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="secondary" disabled={!emailValid} className="sm:mt-6">
          Grant role
        </Button>
      </form>
      <RoleNote className="-mt-3 mb-4">Riders are added from the Riders page so their vehicle and GCash details are recorded.</RoleNote>

      {holders.isPending ? (
        <ListSkeleton rows={3} />
      ) : holders.isError ? (
        <ErrorState error={holders.error} onRetry={() => holders.refetch()} />
      ) : (
        <DataTable
          label="Staff roles"
          rows={holders.data}
          rowKey={(h) => `${h.user_id}:${h.role}`}
          columns={[
            {
              header: 'Person',
              cell: (h) => (
                <span>
                  <span className="block font-semibold">
                    {name(h)}
                    {h.user_id === perms.userId && <span className="font-normal text-ink-3"> (you)</span>}
                  </span>
                  <span className="block text-small text-ink-3">{people.data?.[h.user_id]?.email}</span>
                </span>
              ),
            },
            { header: 'Role', cell: (h) => ROLE_LABELS[h.role] },
            { header: 'Since', align: 'right', cell: (h) => <span className="text-ink-2">{formatDate(h.created_at)}</span> },
            {
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (h) => (
                <Button size="sm" variant="danger-quiet" onClick={() => setRevoking(h)}>
                  Revoke
                </Button>
              ),
            },
          ]}
          mobile={(h) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {name(h)}
                  {h.user_id === perms.userId && <span className="font-normal text-ink-3"> (you)</span>}
                </p>
                <p className="truncate text-small text-ink-3">
                  {ROLE_LABELS[h.role]} · since {formatDate(h.created_at)}
                </p>
              </div>
              <Button size="sm" variant="danger-quiet" onClick={() => setRevoking(h)}>
                Revoke
              </Button>
            </div>
          )}
        />
      )}

      <ConfirmDialog
        open={confirmGrant}
        onClose={() => {
          setConfirmGrant(false);
          grant.reset();
        }}
        tone="primary"
        title={`Give ${ROLE_LABELS[role]} access?`}
        body={`${email.trim()} will be able to: ${ROLE_HINTS[role].charAt(0).toLowerCase()}${ROLE_HINTS[role].slice(1)}`}
        confirmLabel="Grant role"
        loading={grant.isPending}
        error={grant.error ? <FormError error={grant.error} /> : null}
        onConfirm={async () => {
          await grant.mutateAsync({ email, role });
          setConfirmGrant(false);
          setEmail('');
          toast(`${ROLE_LABELS[role]} role granted`);
        }}
      />
      {revoking && (
        <ConfirmDialog
          open
          onClose={() => {
            setRevoking(null);
            revoke.reset();
          }}
          title={`Remove ${ROLE_LABELS[revoking.role]} access?`}
          body={`${name(revoking)} loses ${ROLE_LABELS[revoking.role].toLowerCase()} access immediately. Their customer account is unaffected.`}
          confirmLabel="Revoke role"
          loading={revoke.isPending}
          error={revoke.error ? <FormError error={revoke.error} /> : null}
          onConfirm={async () => {
            await revoke.mutateAsync({ userId: revoking.user_id, role: revoking.role });
            toast('Role revoked');
            setRevoking(null);
          }}
        />
      )}
    </section>
  );
}

export default function UsersPage() {
  const perms = usePermissions();
  return (
    <div className="space-y-12">
      <PageHeader title="People & roles" className="!pb-0" />
      <PeopleSearch showRoles={perms.canConfigure} />
      {perms.canConfigure ? (
        <StaffRoles />
      ) : (
        <section>
          <SectionHeading title="Staff roles" />
          <RoleNote>Only administrators can see and change staff roles.</RoleNote>
        </section>
      )}
    </div>
  );
}
