import { useState } from 'react';
import { ErrorState } from '@/components/ui/Feedback';
import { PageHeader, Tabs, formatDate, timeAgo } from '@/components/ui/Display';
import { cx } from '@/components/ui/cx';
import { useAccounts, useVisitors, type AccountRow, type OnlineVisitor, type VisitApp, type VisitorKind } from './api';
import { DataTable, ListSkeleton, LoadMore, SearchBox } from './ui';

const APP_LABELS: Record<VisitApp, string> = { browser: 'Browser', installed: 'Installed app', android_app: 'Android app' };

const KIND_STYLES: Record<VisitorKind, string> = {
  Guest: 'bg-canvas text-ink-3',
  Customer: 'bg-accent-soft text-accent-ink',
  Rider: 'bg-success-soft text-success',
  Store: 'bg-warning-soft text-warning',
  Staff: 'bg-ink/5 text-ink-2',
  Admin: 'bg-ink text-white',
};

/** 'angel-s-burger' → "Angel's Burger". */
const fromSlug = (slug: string) =>
  decodeURIComponent(slug)
    .replace(/-s-/g, "'s-")
    .replace(/-s$/, "'s")
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** A readable name for a page path. */
export function pageLabel(path: string | null | undefined): string {
  if (!path) return '—';
  const p = path.replace(/\/+$/, '') || '/';
  const rules: Array<[RegExp, string | ((m: RegExpMatchArray) => string)]> = [
    [/^\/$/, 'Home'],
    [/^\/stores\/([^/]+)\/items\//, (m) => `Product · ${fromSlug(m[1])}`],
    [/^\/stores\/([^/]+)$/, (m) => `Store · ${fromSlug(m[1])}`],
    [/^\/checkout\//, 'Checkout'],
    [/^\/orders\/[^/]+$/, 'Order details'],
    [/^\/orders$/, 'Orders'],
    [/^\/cart$/, 'Cart'],
    [/^\/explore$/, 'Explore'],
    [/^\/search$/, 'Search'],
    [/^\/padala$/, 'Padala'],
    [/^\/errands$/, 'Errands'],
    [/^\/account/, 'Account'],
    [/^\/(sign-in|sign-up)$/, 'Sign in / sign up'],
    [/^\/rider/, 'Rider app'],
    [/^\/merchant/, 'Store dashboard'],
    [/^\/admin/, 'Admin'],
    [/^\/partner/, 'Partner with GETGO'],
    [/^\/legal/, 'Legal pages'],
  ];
  for (const [re, label] of rules) {
    const m = p.match(re);
    if (m) return typeof label === 'string' ? label : label(m);
  }
  return p;
}

function OnlineDot({ online }: { online: boolean }) {
  return <span aria-hidden className={cx('inline-block size-2.5 shrink-0 rounded-full', online ? 'bg-success ring-2 ring-success-soft' : 'bg-line-strong')} />;
}

function KindBadge({ kind }: { kind: VisitorKind }) {
  return <span className={cx('inline-flex rounded-full px-2 py-0.5 text-micro font-semibold', KIND_STYLES[kind])}>{kind}</span>;
}

function Stat({ label, value, detail, live }: { label: string; value: number | string; detail?: string; live?: boolean }) {
  return (
    <div className="rounded-sheet border border-line p-4">
      <p className="flex items-center gap-2 text-small text-ink-3">
        {live && <OnlineDot online />}
        {label}
      </p>
      <p className="tabular mt-1 text-display font-bold">{value}</p>
      {detail && <p className="text-small text-ink-3">{detail}</p>}
    </div>
  );
}

function who(v: Pick<OnlineVisitor, 'full_name' | 'email'> | AccountRow) {
  return v.full_name?.trim() || v.email || 'No name';
}

function OnlineNow({ rows }: { rows: OnlineVisitor[] }) {
  if (rows.length === 0) {
    return <p className="border-y border-line py-8 text-center text-small text-ink-3">Nobody is on GETGO right now.</p>;
  }
  return (
    <DataTable
      label="Online now"
      rows={rows}
      rowKey={(v) => v.visitor_id}
      columns={[
        {
          header: 'Who',
          cell: (v) => (
            <span className="flex items-center gap-2.5">
              <OnlineDot online />
              <span className="min-w-0">
                <span className="block font-semibold">{v.user_id ? who(v) : 'Guest'}</span>
                {v.user_id && v.email && v.full_name && <span className="block text-small text-ink-3">{v.email}</span>}
              </span>
            </span>
          ),
        },
        { header: 'Type', cell: (v) => <KindBadge kind={v.kind} /> },
        { header: 'Page', cell: (v) => <span title={v.path}>{pageLabel(v.path)}</span> },
        { header: 'Device', cell: (v) => [v.device, v.browser].filter(Boolean).join(' · ') || '—' },
        { header: 'App', cell: (v) => APP_LABELS[v.app] },
        { header: 'Active', align: 'right', cell: (v) => timeAgo(v.last_seen_at) },
      ]}
      mobile={(v) => (
        <div className="flex items-start gap-3">
          <span className="mt-1.5 flex">
            <OnlineDot online />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{v.user_id ? who(v) : 'Guest'}</span>
              <KindBadge kind={v.kind} />
            </p>
            <p className="text-small text-ink-2">{pageLabel(v.path)}</p>
            <p className="text-small text-ink-3">
              {[v.device, v.browser, APP_LABELS[v.app]].filter(Boolean).join(' · ')} · {timeAgo(v.last_seen_at)}
            </p>
          </div>
        </div>
      )}
    />
  );
}

function Accounts() {
  const [search, setSearch] = useState('');
  const accounts = useAccounts(search);
  return (
    <div className="space-y-4">
      <SearchBox value={search} onChange={setSearch} placeholder="Search by name, email or mobile" label="Search accounts" className="max-w-md" />
      {accounts.query.isPending ? (
        <ListSkeleton rows={4} />
      ) : accounts.query.isError ? (
        <ErrorState error={accounts.query.error} onRetry={() => accounts.query.refetch()} />
      ) : accounts.items.length === 0 ? (
        <p className="border-y border-line py-8 text-center text-small text-ink-3">{search ? 'No accounts match.' : 'No accounts yet.'}</p>
      ) : (
        <>
          <DataTable
            label="Accounts"
            rows={accounts.items}
            rowKey={(a) => a.id}
            columns={[
              {
                header: 'Account',
                cell: (a) => (
                  <span className="flex items-center gap-2.5">
                    <OnlineDot online={a.online} />
                    <span className="min-w-0">
                      <span className="block font-semibold">{who(a)}</span>
                      <span className="block text-small text-ink-3">{[a.email, a.phone].filter(Boolean).join(' · ')}</span>
                    </span>
                  </span>
                ),
              },
              { header: 'Type', cell: (a) => <KindBadge kind={a.kind} /> },
              {
                header: 'Last seen',
                cell: (a) => (a.online ? <span className="font-semibold text-success">Online now</span> : a.last_seen_at ? timeAgo(a.last_seen_at) : <span className="text-ink-3">Not yet</span>),
              },
              { header: 'Last page', cell: (a) => (a.last_path ? pageLabel(a.last_path) : '—') },
              { header: 'Joined', align: 'right', cell: (a) => formatDate(a.created_at) },
            ]}
            mobile={(a) => (
              <div className="flex items-start gap-3">
                <span className="mt-1.5 flex">
                  <OnlineDot online={a.online} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{who(a)}</span>
                    <KindBadge kind={a.kind} />
                  </p>
                  <p className="truncate text-small text-ink-3">{[a.email, a.phone].filter(Boolean).join(' · ')}</p>
                  <p className="text-small text-ink-2">
                    {a.online ? 'Online now' : a.last_seen_at ? `Last seen ${timeAgo(a.last_seen_at)}` : 'Not seen yet'}
                    {a.last_path && !a.online ? ` · ${pageLabel(a.last_path)}` : ''} · Joined {formatDate(a.created_at)}
                  </p>
                </div>
              </div>
            )}
          />
          <LoadMore paged={accounts} />
        </>
      )}
    </div>
  );
}

/** Admin → Visitors: who's on GETGO now, today's numbers, and every account. */
export default function VisitorsPage() {
  const visitors = useVisitors();
  const [tab, setTab] = useState<'online' | 'accounts'>('online');
  const v = visitors.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Visitors">Who’s on GETGO now. Updates every 15 seconds.</PageHeader>

      {visitors.isError && !v ? (
        <ErrorState error={visitors.error} onRetry={() => visitors.refetch()} />
      ) : !v ? (
        <ListSkeleton rows={3} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Online now" value={v.online_total} detail={`${v.online_signed_in} signed in · ${v.online_guests} guests`} live />
            <Stat label="Visitors today" value={v.today_visitors} detail="Devices since midnight" />
            <Stat label="Signed in today" value={v.today_signed_in} detail="Accounts since midnight" />
            <Stat label="Accounts" value={v.accounts_total} detail="Everyone who signed up" />
          </div>

          <Tabs
            label="Visitors"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'online', label: 'Online now', count: v.online_total },
              { value: 'accounts', label: 'All accounts' },
            ]}
          />
          {tab === 'online' ? <OnlineNow rows={v.online} /> : <Accounts />}
        </>
      )}
      <p className="text-micro text-ink-3">
        Online means active in the last 2 minutes. GETGO records the page, device type, browser and app type while someone uses it, never their IP address or
        location. Guest visits are deleted after 30 days.
      </p>
    </div>
  );
}
