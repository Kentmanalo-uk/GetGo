import { useState } from 'react';
import { LoadingDots } from '@/components/ui/Feedback';
import { Link } from 'react-router';
import { Check, MapPin, Plus } from '@/components/icons';
import { Sheet } from '@/components/ui/Sheet';
import { cx } from '@/components/ui/cx';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocationContext } from './LocationProvider';
import { AddressForm } from '@/features/consumer/AddressForm';

export function AddressSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status } = useAuth();
  const loc = useLocationContext();
  const [adding, setAdding] = useState(false);

  const close = () => {
    setAdding(false);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={adding ? 'New address' : 'Where should we deliver?'}>
      {adding ? (
        <AddressForm
          onSaved={(address) => {
            loc.setAddressId(address.id);
            close();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="space-y-6">
          {status === 'signed_in' && (
            <section aria-label="Saved addresses">
              <ul className="divide-y divide-line">
                {loc.addresses.map((a) => {
                  const active = loc.address?.id === a.id;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          loc.setAddressId(a.id);
                          close();
                        }}
                        className="flex w-full items-start gap-3 py-3 text-left"
                        aria-current={active || undefined}
                      >
                        <MapPin className={cx('mt-0.5 size-5 shrink-0', active ? 'text-ink' : 'text-ink-4')} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{a.label}</span>
                          <span className="block text-small text-ink-3">
                            {a.line1}, {a.barangay}, {a.city}
                          </span>
                        </span>
                        {active && <Check className="size-5 shrink-0" aria-label="Selected" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" onClick={() => setAdding(true)} className="mt-1 flex items-center gap-3 py-3 font-semibold">
                <Plus className="size-5" aria-hidden /> Add an address
              </button>
            </section>
          )}

          <section aria-labelledby="areas-heading">
            <h3 id="areas-heading" className="mb-1 text-small font-semibold text-ink-3">
              {status === 'signed_in' ? 'Or browse an area' : 'Choose your area'}
            </h3>
            {!loc.ready ? (
              <div className="flex h-[76px] items-center justify-center">
                <LoadingDots />
              </div>
            ) : loc.areas.length === 0 ? (
              <p className="py-3 text-ink-3">GETGO isn’t operating in any area yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {loc.areas.map((area) => {
                  const active = !loc.address && loc.area?.id === area.id;
                  return (
                    <li key={area.id}>
                      <button
                        type="button"
                        onClick={() => {
                          loc.setAreaId(area.id);
                          close();
                        }}
                        className="flex w-full items-center justify-between gap-3 py-3 text-left"
                      >
                        <span>
                          <span className="block font-medium">{area.name}</span>
                          <span className="block text-small text-ink-3">
                            {area.city}, {area.province}
                          </span>
                        </span>
                        {active && <Check className="size-5" aria-label="Selected" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {status === 'signed_out' && (
            <p className="text-small text-ink-3">
              <Link to="/sign-in" className="font-semibold text-ink underline underline-offset-4" onClick={close}>
                Sign in
              </Link>{' '}
              to use your saved addresses.
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
