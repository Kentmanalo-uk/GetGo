import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Bell, Bike, ChevronRight, Download, FileText, LifeBuoy, LogOut, MapPin, Shield, Store, Trash2 } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { VerifyEmailBanner } from '@/features/auth/VerifyEmailBanner';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { EmptyState, ErrorState, FormError, Notice, PageLoading } from '@/components/ui/Feedback';
import { PageHeader, timeAgo } from '@/components/ui/Display';
import { ConfirmDialog, Sheet } from '@/components/ui/Sheet';
import { cx } from '@/components/ui/cx';
import { useToast } from '@/components/ui/Toast';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/Avatar';
import { AvatarPicker } from '@/features/profile/AvatarPicker';
import { useInstallApp } from '@/lib/install';
import { unwrap, userMessage } from '@/lib/errors';
import { useMarkNotificationsRead, useNotifications } from '@/features/notifications/api';
import type { Address } from '@/types/models';
import { useAddresses, useDeleteAddress } from './api';
import { AddressForm } from './AddressForm';
import { useExportMyData, useRequestAccountDeletion } from '@/features/legal/legal';

const profileSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter your name.').max(120),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .refine((v) => /^(\+63|0)9\d{9}$/.test(v), 'Enter a mobile number like 0917 123 4567.'),
});

function ProfileForm({ onDone }: { onDone: () => void }) {
  const { profile, userId, refreshIdentity } = useAuth();
  const save = useMutation({
    mutationFn: async (values: z.output<typeof profileSchema>) => unwrap(await supabase.from('profiles').update(values).eq('id', userId!)),
    onSuccess: async () => {
      await refreshIdentity();
      onDone();
    },
  });
  const form = useForm<z.input<typeof profileSchema>, unknown, z.output<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: profile?.full_name ?? '', phone: profile?.phone ?? '' },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      <FormError error={save.error} />
      <AvatarPicker />
      <Field label="Full name" error={form.formState.errors.full_name?.message}>
        {(p) => <Input {...p} autoComplete="name" {...form.register('full_name')} />}
      </Field>
      <Field label="Mobile number" error={form.formState.errors.phone?.message}>
        {(p) => <Input {...p} type="tel" autoComplete="tel" {...form.register('phone')} />}
      </Field>
      <Button type="submit" block loading={save.isPending}>
        Save
      </Button>
    </form>
  );
}

/** Name, email and number as a card, with the profile picture (changed under Edit). */
function ProfileCard({ onEdit }: { onEdit: () => void }) {
  const { profile } = useAuth();
  if (!profile) return null;
  return (
    <section aria-label="Your profile" className="mt-5 mb-6 rounded-sheet bg-surface p-5 shadow-card lg:mt-8">
      <div className="flex items-center gap-4">
        <Avatar name={profile.full_name} path={profile.avatar_path} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-title font-bold">{profile.full_name ?? 'Your account'}</h1>
          {profile.email && <p className="truncate text-small text-ink-3">{profile.email}</p>}
          {profile.phone && <p className="tabular text-small text-ink-3">{profile.phone}</p>}
        </div>
        <Button variant="secondary" size="sm" className="shrink-0 self-start" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </section>
  );
}

/** Shown when the app can be installed (Android/desktop prompt, or a hint on iPhone). */
function InstallAppRow() {
  const app = useInstallApp();
  const [hint, setHint] = useState(false);
  if (app.installed || (!app.canPrompt && !app.needsIosHint)) return null;
  return (
    <li>
      <button
        type="button"
        onClick={() => (app.canPrompt ? void app.install() : setHint((v) => !v))}
        className="flex w-full items-center gap-4 py-3.5 text-left hover:bg-canvas sm:-mx-3 sm:w-[calc(100%+1.5rem)] sm:rounded-control sm:px-3"
      >
        <Download className="size-5 shrink-0 text-ink-2" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Install GETGO app</span>
          <span className="block text-small text-ink-3">
            {hint ? 'Tap the Share button in Safari, then “Add to Home Screen”.' : 'Open GETGO from your home screen'}
          </span>
        </span>
      </button>
    </li>
  );
}

function MenuLink({ to, icon: Icon, label, detail }: { to: string; icon: typeof Bell; label: string; detail?: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-4 py-3.5 hover:bg-canvas sm:-mx-3 sm:rounded-control sm:px-3">
        <Icon className="size-5 shrink-0 text-ink-2" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{label}</span>
          {detail && <span className="block truncate text-small text-ink-3">{detail}</span>}
        </span>
        <ChevronRight className="size-4 text-ink-4" aria-hidden />
      </Link>
    </li>
  );
}

export function AccountPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const toast = useToast();

  if (auth.status === 'signed_out') {
    return (
      <div className="page-x mx-auto max-w-3xl">
        <PageHeader title="Account" />
        <EmptyState
          title="Sign in to GETGO"
          action={
            <div className="flex gap-2">
              <ButtonLink to="/sign-in?next=/account">Sign in</ButtonLink>
              <ButtonLink to="/sign-up?next=/account" variant="secondary">
                Create account
              </ButtonLink>
            </div>
          }
        >
          Save addresses, track orders and reorder from your favorite stores.
        </EmptyState>
        <ul className="divide-y divide-line border-t border-line">
          <MenuLink to="/partner" icon={Store} label="List your store" detail="Free and optional" />
          <MenuLink to="/legal" icon={FileText} label="Terms and privacy" />
        </ul>
      </div>
    );
  }
  if (!auth.profile && auth.identityError) {
    return (
      <div className="page-x mx-auto max-w-3xl">
        <PageHeader title="Account" />
        <ErrorState error={auth.identityError} onRetry={() => auth.refreshIdentity()} />
        <Button variant="ghost" className="-ml-4" icon={<LogOut className="size-4" aria-hidden />} onClick={() => auth.signOut().then(() => navigate('/'))}>
          Sign out
        </Button>
      </div>
    );
  }
  if (auth.status === 'loading' || !auth.profile) {
    return (
      <div className="page-x mx-auto max-w-3xl">
        <PageLoading rows={2} />
      </div>
    );
  }

  const p = auth.profile;
  return (
    <div className="page-x mx-auto max-w-3xl pb-10">
      <ProfileCard onEdit={() => setEditing(true)} />
      <VerifyEmailBanner />
      {!p.phone && (
        <Notice tone="warning" className="mb-4" action={<Button size="sm" variant="dark" onClick={() => setEditing(true)}>Add</Button>}>
          Add a mobile number so stores and riders can reach you.
        </Notice>
      )}

      <ul className="divide-y divide-line border-y border-line">
        <MenuLink to="/account/addresses" icon={MapPin} label="Addresses" />
        <MenuLink to="/notifications" icon={Bell} label="Notifications" />
        <MenuLink to="/account/support" icon={LifeBuoy} label="Help and support requests" />
        <MenuLink to="/account/privacy" icon={Shield} label="Privacy and legal" detail="Terms, privacy policy and your data" />
        <InstallAppRow />
      </ul>

      <h2 className="mt-8 mb-1 text-small font-semibold text-ink-3">GETGO for work</h2>
      <ul className="divide-y divide-line border-y border-line">
        {auth.memberships.length > 0 ? (
          <MenuLink to="/merchant" icon={Store} label="Store dashboard" detail={auth.memberships.map((m) => m.merchant.name).join(', ')} />
        ) : (
          <MenuLink to="/partner" icon={Store} label="List your store" detail="Free and optional — not a partnership" />
        )}
        {auth.hasRole('rider') ? (
          <MenuLink to="/rider" icon={Bike} label="Rider deliveries" />
        ) : (
          <MenuLink to="/rider" icon={Bike} label="Deliver with GETGO" detail="Apply or check your rider application" />
        )}
        {auth.isStaff && <MenuLink to="/admin" icon={Shield} label="GETGO Admin" />}
      </ul>

      <Button
        variant="ghost"
        className="mt-6 -ml-4"
        icon={<LogOut className="size-4" aria-hidden />}
        onClick={async () => {
          await auth.signOut();
          toast('Signed out');
          navigate('/');
        }}
      >
        Sign out
      </Button>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Your details" size="sm">
        <ProfileForm onDone={() => setEditing(false)} />
      </Sheet>
    </div>
  );
}

function ActionRow({ icon: Icon, label, detail, onClick, loading, danger }: { icon: typeof Bell; label: string; detail?: string; onClick: () => void; loading?: boolean; danger?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="flex w-full items-center gap-4 py-3.5 text-left hover:bg-canvas disabled:opacity-60 sm:-mx-3 sm:w-[calc(100%+1.5rem)] sm:rounded-control sm:px-3"
      >
        <Icon className={cx('size-5 shrink-0', danger ? 'text-danger' : 'text-ink-2')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cx('block font-medium', danger && 'text-danger')}>{loading ? 'Preparing…' : label}</span>
          {detail && <span className="block truncate text-small text-ink-3">{detail}</span>}
        </span>
      </button>
    </li>
  );
}

/** Legal documents and Data Privacy Act tools: a copy of your data, and account deletion. */
export function PrivacyCenterPage() {
  const exportData = useExportMyData();
  const deletion = useRequestAccountDeletion();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="page-x mx-auto max-w-3xl pb-10">
      <PageHeader title="Privacy and legal" back="/account" />
      <ul className="divide-y divide-line border-y border-line">
        <MenuLink to="/legal/terms" icon={FileText} label="Terms of Service" />
        <MenuLink to="/legal/privacy" icon={Shield} label="Privacy Policy" />
        <MenuLink to="/legal/stores" icon={Store} label="Store listings" />
      </ul>

      <h2 className="mt-8 mb-1 text-small font-semibold text-ink-3">Your data</h2>
      <ul className="divide-y divide-line border-y border-line">
        <ActionRow
          icon={Download}
          label="Download my data"
          detail="A copy of your account, addresses and orders"
          loading={exportData.isPending}
          onClick={() => exportData.mutateAsync().then(() => toast('Your data was downloaded'), () => undefined)}
        />
        <ActionRow icon={Trash2} label="Delete my account" detail="Sends a deletion request to GETGO support" danger onClick={() => setConfirmDelete(true)} />
      </ul>
      {exportData.error && (
        <Notice tone="danger" className="mt-3">
          {userMessage(exportData.error)}
        </Notice>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
          deletion.reset();
        }}
        title="Delete your GETGO account?"
        body="We’ll delete your account and personal data after checking there’s nothing left to settle. Records the law requires us to keep, such as completed order and payment records, are kept securely until no longer required. GETGO support will confirm by message."
        confirmLabel="Request deletion"
        reason={{ label: 'Why are you leaving?', placeholder: 'Optional' }}
        loading={deletion.isPending}
        error={deletion.error ? <Notice tone="danger">{userMessage(deletion.error)}</Notice> : null}
        onConfirm={async (reason) => {
          const ticketId = await deletion.mutateAsync(reason ?? '');
          setConfirmDelete(false);
          toast('Deletion request sent');
          navigate(`/account/support/${ticketId}`);
        }}
      />
    </div>
  );
}

export function AddressesPage() {
  const addresses = useAddresses();
  const remove = useDeleteAddress();
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Address | null>(null);
  return (
    <div className="page-x mx-auto max-w-3xl pb-10">
      <PageHeader title="Addresses" back="/account" actions={<Button size="sm" onClick={() => setEditing('new')}>Add</Button>} />
      {addresses.isPending ? (
        <PageLoading rows={2} />
      ) : addresses.data?.length === 0 ? (
        <EmptyState title="No saved addresses" action={<Button onClick={() => setEditing('new')}>Add an address</Button>} />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {addresses.data?.map((a) => (
            <li key={a.id} className="flex items-start gap-4 py-4">
              <MapPin className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {a.label}
                  {a.is_default && <span className="ml-2 text-small font-normal text-ink-3">Default</span>}
                </p>
                <p className="text-small text-ink-2">
                  {a.line1}, {a.barangay}, {a.city}
                </p>
                <p className="text-small text-ink-3">
                  {a.recipient_name} · {a.phone}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
                  Edit
                </Button>
                <Button variant="danger-quiet" size="sm" onClick={() => setDeleting(a)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New address' : 'Edit address'}>
        {editing && <AddressForm address={editing === 'new' ? undefined : editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Sheet>
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this address?"
        body={deleting ? `${deleting.label}: ${deleting.line1}, ${deleting.barangay}` : null}
        confirmLabel="Delete"
        loading={remove.isPending}
        error={remove.error ? <Notice tone="danger">{userMessage(remove.error)}</Notice> : null}
        onConfirm={async () => {
          await remove.mutateAsync(deleting!.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

/** `embedded`: inside a layout that already pads the page (the rider app). */
export function NotificationsPage({ embedded }: { embedded?: boolean } = {}) {
  const list = useNotifications();
  const mark = useMarkNotificationsRead();
  const navigate = useNavigate();
  const unread = list.data?.filter((n) => !n.read_at) ?? [];
  return (
    <div className={cx('mx-auto max-w-3xl pb-10', !embedded && 'page-x')}>
      <PageHeader
        title="Notifications"
        actions={
          unread.length > 0 && (
            <Button variant="secondary" size="sm" loading={mark.isPending} onClick={() => mark.mutate(unread.map((n) => n.id))}>
              Mark all read
            </Button>
          )
        }
      />
      {list.isPending ? (
        <PageLoading rows={4} />
      ) : list.data?.length === 0 ? (
        <EmptyState title="You’re all caught up" icon={<Bell className="size-8" />}>
          Order updates and account messages will appear here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.data?.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => {
                  if (!n.read_at) mark.mutate([n.id]);
                  if (n.link) navigate(n.link);
                }}
                className="flex w-full gap-3 py-4 text-left"
              >
                <span className={cx('mt-2 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-accent-strong')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cx('block', !n.read_at && 'font-semibold')}>{n.title}</span>
                  {n.body && <span className="block text-small text-ink-2">{n.body}</span>}
                  <span className="block text-micro text-ink-3">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
