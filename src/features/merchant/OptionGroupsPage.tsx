import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from '@/components/icons';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, Notice, PageLoading } from '@/components/ui/Feedback';
import { Field, Input, Switch } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/Display';
import { ConfirmDialog, Sheet } from '@/components/ui/Sheet';
import { cx } from '@/components/ui/cx';
import { useToast } from '@/components/ui/Toast';
import { describeGroupRule } from '@/domain/customization';
import { formatDelta, parsePesos, toPesoInput } from '@/domain/money';
import { userMessage } from '@/lib/errors';
import type { OptionGroupRow } from '@/types/models';
import { useMerchantContext } from './MerchantLayout';
import { useDeleteOptionGroup, useMerchantCatalog, useSaveOptionGroup, useSetOptionAvailability } from './api';

interface ValueDraft {
  id?: string;
  name: string;
  price: string;
  max_quantity: string;
  is_available: boolean;
}

function GroupEditor({ group, onDone }: { group: OptionGroupRow | null; onDone: () => void }) {
  const { merchantId } = useMerchantContext();
  const save = useSaveOptionGroup(merchantId);
  const toast = useToast();
  const [name, setName] = useState(group?.name ?? '');
  const [required, setRequired] = useState((group?.min_select ?? 0) > 0);
  const [min, setMin] = useState(String(Math.max(group?.min_select ?? 1, 1)));
  const [max, setMax] = useState(String(group?.max_select ?? 1));
  const [values, setValues] = useState<ValueDraft[]>(
    group?.option_values.map((v) => ({ id: v.id, name: v.name, price: toPesoInput(v.price_delta_minor), max_quantity: String(v.max_quantity), is_available: v.is_available })) ?? [
      { name: '', price: '0', max_quantity: '1', is_available: true },
    ],
  );
  const [error, setError] = useState<string | null>(null);
  const setValue = (i: number, patch: Partial<ValueDraft>) => setValues((list) => list.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const move = (i: number, dir: -1 | 1) =>
    setValues((list) => {
      const next = [...list];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const minSelect = required ? Number(min) : 0;
    const maxSelect = Number(max);
    if (!name.trim()) return setError('Give the group a name.');
    if (!Number.isInteger(maxSelect) || maxSelect < 1) return setError('Customers must be able to choose at least 1.');
    if (required && (!Number.isInteger(minSelect) || minSelect < 1 || minSelect > maxSelect)) return setError('The minimum must be between 1 and the maximum.');
    const parsed = [];
    for (const v of values) {
      const price = parsePesos(v.price || '0');
      const qty = Number(v.max_quantity);
      if (!v.name.trim() || price === null) return setError('Each choice needs a name and a price (0 for free).');
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) return setError('“Up to” must be 1 to 20.');
      parsed.push({ id: v.id, name: v.name.trim(), price_delta_minor: price, max_quantity: qty, is_available: v.is_available });
    }
    setError(null);
    try {
      await save.mutateAsync({ id: group?.id, name: name.trim(), min_select: minSelect, max_select: maxSelect, values: parsed });
      toast('Option group saved');
      onDone();
    } catch {
      /* shown below */
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
      <Field label="Group name" hint="Shown to customers, e.g. “Choice of drink” or “Add-ons”.">
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}
      </Field>
      <Switch label="Customers must choose" description="Required groups block adding to cart until a choice is made." checked={required} onChange={setRequired} />
      <div className="flex gap-4">
        {required && (
          <Field label="At least">{(p) => <Input {...p} type="number" min={1} value={min} onChange={(e) => setMin(e.target.value)} className="w-24" />}</Field>
        )}
        <Field label="At most">{(p) => <Input {...p} type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} className="w-24" />}</Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-small font-semibold">Choices</legend>
        <div className="hidden grid-cols-[1fr_7rem_4.5rem_auto] gap-2 text-micro text-ink-3 sm:grid">
          <span>Name</span>
          <span>Extra charge</span>
          <span>Up to</span>
          <span />
        </div>
        {values.map((v, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem] gap-2 border-b border-line pb-2 sm:grid-cols-[1fr_7rem_4.5rem_auto] sm:border-0 sm:pb-0">
            <Input aria-label={`Choice ${i + 1} name`} value={v.name} onChange={(e) => setValue(i, { name: e.target.value })} placeholder="Iced tea" maxLength={60} />
            <Input aria-label={`Choice ${i + 1} extra charge`} prefix="₱" inputMode="decimal" value={v.price} onChange={(e) => setValue(i, { price: e.target.value })} />
            <Input aria-label={`Choice ${i + 1} maximum quantity`} type="number" min={1} max={20} value={v.max_quantity} onChange={(e) => setValue(i, { max_quantity: e.target.value })} />
            <div className="flex items-center">
              <IconButton label={`Move choice ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton label={`Move choice ${i + 1} down`} disabled={i === values.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" />
              </IconButton>
              <IconButton label={`Remove choice ${i + 1}`} disabled={values.length === 1} onClick={() => setValues((l) => l.filter((_, j) => j !== i))}>
                <X className="size-4" />
              </IconButton>
            </div>
          </div>
        ))}
        <Button variant="ghost" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setValues((l) => [...l, { name: '', price: '0', max_quantity: '1', is_available: true }])}>
          Add choice
        </Button>
        <p className="text-small text-ink-3">“Up to” lets customers pick the same choice more than once, like 2× extra rice.</p>
      </fieldset>

      {(error || save.error) && <Notice tone="danger">{error ?? userMessage(save.error)}</Notice>}
      <Button type="submit" block size="lg" loading={save.isPending}>
        Save group
      </Button>
    </form>
  );
}

export default function OptionGroupsPage() {
  const { merchantId, canManage } = useMerchantContext();
  const catalog = useMerchantCatalog(merchantId);
  const setAvailability = useSetOptionAvailability(merchantId);
  const remove = useDeleteOptionGroup(merchantId);
  const [editing, setEditing] = useState<OptionGroupRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<OptionGroupRow | null>(null);

  if (catalog.isPending) return <PageLoading />;
  if (catalog.isError) return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />;
  const usage = (groupId: string) => catalog.data.products.filter((p) => p.product_option_groups.some((g) => g.group_id === groupId));

  return (
    <div>
      <PageHeader title="Choices" actions={canManage && <Button size="sm" onClick={() => setEditing('new')}>New choice group</Button>}>
        Choices customers pick from, like drinks or add-ons. Attach them to products from the product editor.
      </PageHeader>
      {setAvailability.error && <Notice tone="danger">{userMessage(setAvailability.error)}</Notice>}
      {catalog.data.groups.length === 0 ? (
        <EmptyState title="No option groups yet" action={canManage && <Button onClick={() => setEditing('new')}>Create a group</Button>}>
          Example: “Choice of drink” — required, pick 1: Iced tea (free), Coke (+₱15).
        </EmptyState>
      ) : (
        <div className="divide-y divide-line border-y border-line">
          {catalog.data.groups.map((g) => {
            const used = usage(g.id);
            return (
              <section key={g.id} aria-labelledby={`g-${g.id}`} className="py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 id={`g-${g.id}`} className="font-semibold">
                      {g.name}
                    </h2>
                    <p className="text-small text-ink-3">
                      {describeGroupRule({ ...g, values: [] })} · {used.length ? `Used by ${used.length} item${used.length > 1 ? 's' : ''}` : 'Not attached to any item'}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(g)}>
                        Edit
                      </Button>
                      <Button variant="danger-quiet" size="sm" onClick={() => setDeleting(g)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
                <ul className="mt-2 grid gap-x-8 sm:grid-cols-2">
                  {g.option_values.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 py-1.5 text-small">
                      <span className={cx(!v.is_available && 'text-ink-4 line-through')}>
                        {v.name}
                        <span className="tabular text-ink-3"> {formatDelta(v.price_delta_minor) || 'Free'}</span>
                        {v.max_quantity > 1 && <span className="text-ink-3"> · up to {v.max_quantity}</span>}
                      </span>
                      <label className="flex shrink-0 items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="size-4 accent-ink"
                          checked={v.is_available}
                          disabled={setAvailability.isPending}
                          onChange={(e) => setAvailability.mutate({ valueId: v.id, available: e.target.checked })}
                        />
                        In stock
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New option group' : 'Edit option group'} size="lg">
        {editing && <GroupEditor key={editing === 'new' ? 'new' : editing.id} group={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        body={
          deleting && usage(deleting.id).length > 0
            ? `It will be removed from ${usage(deleting.id).map((p) => p.name).join(', ')}. Past orders keep their records.`
            : 'Past orders keep their records.'
        }
        confirmLabel="Delete group"
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
