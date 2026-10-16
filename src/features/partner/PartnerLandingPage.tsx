import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Clock } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { ButtonLink } from '@/components/ui/Button';
import { supabase, env } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';
import { CATEGORY_LABELS, type MerchantCategory, type PlatformSettings } from '@/types/models';

function usePlatformSettings() {
  return useQuery({
    queryKey: ['platform-settings'],
    queryFn: async () => unwrap(await supabase.from('platform_settings').select('*').single()) as PlatformSettings,
    staleTime: 10 * 60_000,
  });
}

const CATEGORY_NOTES: Record<MerchantCategory, string> = {
  restaurant: 'Carinderias, kainan, grills and full-service kitchens',
  cafe: 'Coffee, milk tea and snack counters',
  bakery: 'Panaderias and pastry shops',
  grocery: 'Groceries, palengke stalls and produce sellers',
  convenience: 'Sari-sari and convenience stores',
  specialty: 'Pasalubong, delicacies and specialty food',
};

const STEPS = [
  { title: 'Apply online', body: 'Tell us about your store, your hours and a few products with their prices. Save and come back anytime.' },
  { title: 'Upload your documents', body: 'A valid government ID, your business permit and your DTI or SEC registration.' },
  { title: 'Review by our team', body: 'We check your documents and may ask for changes. You can follow your application status in GETGO.' },
  { title: 'Keep your list up to date', body: 'Add photos, sizes and choices, and switch items off when they run out. That’s all — GETGO riders do the ordering.' },
];

const EXPECTATIONS = [
  'Keep prices on GETGO the same as at your counter',
  'Switch items off when they’re sold out',
  'Serve GETGO riders like any walk-in customer',
  'Keep your opening hours accurate',
];

const FAQ = [
  {
    q: 'Do I need to watch for orders?',
    a: 'No. Customers order from your list on GETGO, and a GETGO rider comes to your store to buy the items like any customer. You don’t accept orders or handle deliveries.',
  },
  {
    q: 'How do I get paid?',
    a: 'The rider pays you at the counter for what they buy, at your listed prices. There are no settlements or payouts to wait for.',
  },
  {
    q: 'What does it cost?',
    a: 'Listing your store on GETGO is free. Customers pay GETGO’s delivery and service fees separately.',
  },
  {
    q: 'What if an item runs out?',
    a: 'Switch it off in your product list and customers can’t order it. If a rider arrives and something is out, they sort it out with the customer.',
  },
  {
    q: 'Can my staff update the list?',
    a: 'Yes. Staff can switch items on and off; owners and managers can also edit products, prices and store details.',
  },
];

/** A rendering of how a store's product list looks in the partner screen. */
function ProductListPreview() {
  const rows = [
    { name: 'Bicol Express Rice Meal', price: '₱120', on: true },
    { name: 'Laing with Rice', price: '₱110', on: true },
    { name: 'Turon (2 pcs)', price: '₱30', on: false },
  ];
  return (
    <figure className="w-full max-w-sm">
      <div className="rounded-sheet bg-surface p-5 text-ink shadow-pop">
        <p className="text-small font-bold tracking-wide text-ink-3 uppercase">Products</p>
        <ul className="mt-2 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.name}</span>
                <span className="tabular block text-small text-ink-3">{r.price}</span>
              </span>
              <span className={r.on ? 'text-small text-ink-2' : 'text-small font-semibold text-danger'}>{r.on ? 'Available' : 'Sold out'}</span>
              <span aria-hidden className={`relative inline-flex h-6 w-10 items-center rounded-full ${r.on ? 'bg-ink' : 'bg-line-strong'}`}>
                <span className={`inline-block size-4 rounded-full bg-white ${r.on ? 'translate-x-5' : 'translate-x-1'}`} />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="mt-3 text-small text-white/60">Example of a product list on GETGO Partner</figcaption>
    </figure>
  );
}

export default function PartnerLandingPage() {
  const { memberships } = useAuth();
  const settings = usePlatformSettings();
  const s = settings.data;
  const isPartner = memberships.length > 0;
  const supportEmail = s?.support_email ?? env.supportEmail;
  const supportPhone = s?.support_phone ?? env.supportPhone;

  return (
    <div>
      <section className="bg-ink text-white">
        <div className="page-x mx-auto grid max-w-7xl gap-12 py-12 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-20">
          <div className="space-y-6">
            <p className="text-small font-semibold text-accent">GETGO Partner</p>
            <h1 className="text-[2rem] leading-[1.1] font-extrabold tracking-tight sm:text-[2.75rem] lg:text-[3.25rem]">List your store. Our riders do the buying.</h1>
            <p className="max-w-lg text-heading text-white/75">
              Customers nearby order from your product list. A GETGO rider comes to your counter and pays for the items like any customer — no order screen, no
              payouts to chase.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink to={isPartner ? '/merchant' : '/partner/apply'} size="lg">
                {isPartner ? 'Open your product list' : 'Become a partner'}
              </ButtonLink>
              <ButtonLink to="/merchant" size="lg" variant="secondary" className="border-white/25 bg-transparent text-white hover:bg-white/10">
                Partner login
              </ButtonLink>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <ProductListPreview />
          </div>
        </div>
      </section>

      <div className="page-x mx-auto max-w-7xl space-y-16 py-14 lg:space-y-24 lg:py-20">
        <section aria-labelledby="who-heading" className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <h2 id="who-heading" className="text-title font-bold lg:text-display">
            Who can join
          </h2>
          <ul className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
            {(Object.keys(CATEGORY_NOTES) as MerchantCategory[]).map((c) => (
              <li key={c} className="border-t border-line pt-4">
                <p className="font-semibold">{CATEGORY_LABELS[c]}</p>
                <p className="text-small text-ink-3">{CATEGORY_NOTES[c]}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-heading" className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <h2 id="how-heading" className="text-title font-bold lg:text-display">
            How it works
          </h2>
          <ol className="space-y-6">
            {STEPS.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[2.5rem_1fr] gap-x-3">
                <span className="tabular text-title font-extrabold text-accent-ink">{i + 1}</span>
                <div>
                  <p className="text-heading font-semibold">{step.title}</p>
                  <p className="text-ink-2">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="fees-heading" className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <h2 id="fees-heading" className="text-title font-bold lg:text-display">
            Fees
          </h2>
          <div className="space-y-4">
            <p className="text-heading text-ink-2">Listing your store is free.</p>
            <ul className="space-y-2 text-ink-2">
              <li className="flex gap-2.5">
                <Check className="mt-0.5 size-5 shrink-0 text-accent-ink" aria-hidden /> Riders pay your listed prices in full at the counter.
              </li>
              <li className="flex gap-2.5">
                <Check className="mt-0.5 size-5 shrink-0 text-accent-ink" aria-hidden /> Delivery and service fees are paid by customers to GETGO, shown to them before ordering.
              </li>
            </ul>
            {s?.partner_fee_note && <p className="text-small whitespace-pre-line text-ink-3">{s.partner_fee_note}</p>}
          </div>
        </section>

        <section aria-labelledby="needs-heading" className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <h2 id="needs-heading" className="text-title font-bold lg:text-display">
            What you’ll need
          </h2>
          <div className="grid gap-10 sm:grid-cols-2">
            <div>
              <p className="mb-2 font-semibold">Documents</p>
              <ul className="space-y-1.5 text-ink-2">
                <li>Valid government-issued ID of the owner</li>
                <li>Mayor’s or business permit</li>
                <li>DTI or SEC registration</li>
                <li className="text-ink-3">BIR certificate and food safety permit, if you have them</li>
              </ul>
            </div>
            <div>
              <p className="mb-2 font-semibold">What we ask of partners</p>
              <ul className="space-y-1.5 text-ink-2">
                {EXPECTATIONS.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-heading" className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <h2 id="faq-heading" className="text-title font-bold lg:text-display">
            Questions
          </h2>
          <div className="divide-y divide-line border-y border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {item.q}
                  <span aria-hidden className="text-title leading-none text-ink-3 transition-transform group-open:rotate-45 motion-reduce:transition-none">
                    +
                  </span>
                </summary>
                <p className="mt-2 max-w-2xl text-ink-2">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-6 border-t border-line pt-10 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h2 className="text-title font-bold">Ready to apply?</h2>
            <p className="flex items-center gap-2 text-ink-3">
              <Clock className="size-4" aria-hidden /> You can save your application and finish it later.
            </p>
            {(supportEmail || supportPhone) && (
              <p className="text-small text-ink-3">Questions? Contact partner support at {[supportEmail, supportPhone].filter(Boolean).join(' or ')}.</p>
            )}
          </div>
          <ButtonLink to={isPartner ? '/merchant' : '/partner/apply'} size="lg" className="self-start sm:self-auto">
            {isPartner ? 'Open your product list' : 'Start your application'} <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </section>
      </div>
    </div>
  );
}
