import { useState, type ReactNode } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, FileText, Shield, Store, Bike } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Feedback';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { cx } from '@/components/ui/cx';
import { useToast } from '@/components/ui/Toast';
import { supabase } from '@/lib/supabase';
import { unwrap, userMessage } from '@/lib/errors';
import { LEGAL_EFFECTIVE, operatorDetails, useLegalSettings } from './legal';

type Op = ReturnType<typeof operatorDetails>;

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

const DOCS = [
  { to: '/legal/terms', label: 'Terms of Service' },
  { to: '/legal/privacy', label: 'Privacy Policy' },
  { to: '/legal/stores', label: 'Store listings' },
  { to: '/legal/riders', label: 'Rider Terms' },
];

function P({ children }: { children: ReactNode }) {
  return <p className="text-ink-2">{children}</p>;
}
function UL({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-ink-2 marker:text-ink-4">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
function A({ to, children }: { to: string; children: ReactNode }) {
  return to.startsWith('http') || to.startsWith('mailto:') ? (
    <a href={to} className="font-semibold text-ink underline underline-offset-4" target={to.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
      {children}
    </a>
  ) : (
    <Link to={to} className="font-semibold text-ink underline underline-offset-4">
      {children}
    </Link>
  );
}

function ContactLine({ op, privacy }: { op: Op; privacy?: boolean }) {
  const email = privacy ? op.privacyEmail : op.supportEmail;
  return (
    <UL
      items={[
        privacy && op.dpoName ? <>Data Protection Officer: {op.dpoName}</> : null,
        email ? (
          <>
            Email: <A to={`mailto:${email}`}>{email}</A>
          </>
        ) : null,
        op.supportPhone ? <>Phone: {op.supportPhone}</> : null,
        op.address ? <>Address: {op.address}</> : null,
        <>
          In the app: <A to="/account/support/new">send a support request</A>
        </>,
      ].filter(Boolean)}
    />
  );
}

/** Who operates GETGO (Internet Transactions Act: platforms identify themselves). */
function OperatorBox({ op }: { op: Op }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 rounded-media bg-canvas p-4 text-small sm:grid-cols-[auto_1fr]">
      <dt className="text-ink-3">Operator</dt>
      <dd className="font-semibold">{op.shortName}</dd>
      {op.registration && (
        <>
          <dt className="text-ink-3">Registration</dt>
          <dd>{op.registration}</dd>
        </>
      )}
      {op.address && (
        <>
          <dt className="text-ink-3">Address</dt>
          <dd>{op.address}</dd>
        </>
      )}
      {(op.supportEmail || op.supportPhone) && (
        <>
          <dt className="text-ink-3">Contact</dt>
          <dd>{[op.supportEmail, op.supportPhone].filter(Boolean).join(' · ')}</dd>
        </>
      )}
    </dl>
  );
}

function LegalDoc({ title, summary, sections, children }: { title: string; summary: ReactNode; sections: Section[]; children?: ReactNode }) {
  return (
    <div className="page-x mx-auto max-w-6xl pt-6 pb-16 lg:pt-10">
      <nav aria-label="Legal documents" className="no-scrollbar -mx-4 mb-8 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {DOCS.map((d) => (
          <NavLink
            key={d.to}
            to={d.to}
            className={({ isActive }) =>
              cx(
                'shrink-0 rounded-full border px-3 py-1.5 text-small font-semibold whitespace-nowrap',
                isActive ? 'border-ink bg-ink text-white' : 'border-line text-ink-2 hover:border-line-strong',
              )
            }
          >
            {d.label}
          </NavLink>
        ))}
      </nav>
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-24 space-y-1 text-small">
            <p className="mb-2 font-semibold">On this page</p>
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="block text-ink-3 hover:text-ink">
                {s.title}
              </a>
            ))}
          </nav>
        </aside>
        <article className="min-w-0 max-w-3xl">
          <h1 className="text-display font-bold">{title}</h1>
          <p className="mt-1 text-small text-ink-3">Effective {LEGAL_EFFECTIVE}</p>
          <div className="mt-6 rounded-sheet border border-accent/40 bg-accent-soft/50 p-5">
            <p className="mb-2 text-small font-bold tracking-wide text-accent-ink uppercase">In short</p>
            <div className="space-y-2 text-ink-2">{summary}</div>
          </div>
          {children}
          <div className="mt-10 space-y-10">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24 space-y-3">
                <h2 id={`${s.id}-h`} className="text-heading font-bold">
                  {i + 1}. {s.title}
                </h2>
                {s.body}
              </section>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terms of Service
// ---------------------------------------------------------------------------
export function TermsPage() {
  const op = operatorDetails(useLegalSettings().data);
  const sections: Section[] = [
    {
      id: 'about',
      title: 'Who we are and what these terms cover',
      body: (
        <>
          <P>
            GETGO is an online platform operated by {op.name} (“GETGO”, “we”, “us”). These Terms of Service (“Terms”) apply when you use the GETGO website
            or app to browse, request a pabili (buy-for-me) order, send a padala, book an errand, or create an account. By creating an account or using
            GETGO you agree to these Terms and to our <A to="/legal/privacy">Privacy Policy</A>.
          </P>
          <OperatorBox op={op} />
        </>
      ),
    },
    {
      id: 'service',
      title: 'What GETGO is — and isn’t',
      body: (
        <>
          <P>
            GETGO connects customers with independent riders in their town. When you place a request, you ask a rider to act on your behalf: to buy
            items for you at a store (pabili), to carry a parcel (padala), or to do an errand. The rider buys at the store as an ordinary walk-in customer
            and delivers to you.
          </P>
          <UL
            items={[
              <>
                <strong>GETGO is not a store and does not sell the items listed.</strong> The store sells to the rider, who buys for you. Each store is
                an independent business.
              </>,
              <>
                <strong>Store listings are not partnerships.</strong> Unless a listing says it’s managed by the store, the store has no agreement with
                GETGO and does not endorse or sponsor GETGO. Store names and logos are shown only to identify where your rider will buy. See{' '}
                <A to="/legal/stores">Store listings</A>.
              </>,
              <>
                <strong>Listed prices are a guide.</strong> They come from the store’s public menu or the store itself and may be out of date. See
                “Prices and availability” below.
              </>,
              <>GETGO does not hold your money. You pay your rider directly by GCash, as explained below.</>,
            ]}
          />
        </>
      ),
    },
    {
      id: 'accounts',
      title: 'Your account',
      body: (
        <UL
          items={[
            'You must be at least 18 years old, or use GETGO with the consent and supervision of a parent or guardian.',
            'Give accurate details, including a mobile number where riders can reach you, and keep them up to date.',
            'Keep your password secret. You are responsible for requests made from your account. Tell us right away if you think someone else is using it.',
            'One person, one account. Don’t create accounts for others without their permission.',
          ]}
        />
      ),
    },
    {
      id: 'orders',
      title: 'How requests work',
      body: (
        <>
          <UL
            items={[
              'When you send a request, riders in your area are notified. Nothing is owed until a rider accepts.',
              'When a rider accepts, the app shows the rider’s name and the GCash account to pay. Send the exact total shown, then enter the GCash reference number in the app.',
              'The rider confirms the payment, then buys, picks up or does the errand, and delivers it to the address you gave.',
              'Be reachable on your mobile number while your request is in progress, and make sure someone can receive the delivery.',
            ]}
          />
          <P>
            By paying, you authorize the rider to spend the item amount (or errand budget) on your behalf and to keep the delivery and service fees
            shown.
          </P>
        </>
      ),
    },
    {
      id: 'payments',
      title: 'Payments and fees',
      body: (
        <>
          <UL
            items={[
              <>
                <strong>Pay only to the GCash account shown in the app</strong> for that order, and only after a rider accepts. GETGO will never ask you
                to pay anyone else, or to send money through chat, calls or text messages.
              </>,
              'The total is the listed item prices (or your errand budget) plus the delivery fee and service fee shown before you send the request. Fees are set by GETGO for your area and barangay.',
              'GETGO does not receive, hold or process your payment. GCash transfers are governed by GCash’s own terms.',
              'Senior citizen, PWD and other statutory discounts are given by stores at their counters. A store may not be able to apply them to a purchase made by a rider for you.',
              'Riders may give you a receipt from the store. GETGO does not issue official receipts for items bought at stores.',
            ]}
          />
        </>
      ),
    },
    {
      id: 'prices',
      title: 'Prices and availability',
      body: (
        <>
          <P>
            Stores can change prices and run out of items at any time. If an item is unavailable or costs more at the counter than listed, your rider
            should contact you before buying. You can choose a replacement, pay the difference, skip the item, or cancel.
          </P>
          <P>
            If the rider buys less than you paid for, the unspent amount is returned to you — in cash on delivery, or by GCash if arranged with GETGO
            support.
          </P>
        </>
      ),
    },
    {
      id: 'cancellations',
      title: 'Cancellations and refunds',
      body: (
        <UL
          items={[
            'You can cancel in the app at no cost until you send payment.',
            'After you pay, contact your rider or GETGO support to cancel. If the rider hasn’t bought anything yet, the full amount is refunded to your GCash.',
            'If a rider can’t complete a paid request (for example, the store is closed), the request is cancelled and GETGO arranges the refund of what you paid, less anything already bought and delivered to you.',
            'Errands: the rider returns unspent budget in cash with the receipt when delivering.',
            'Refunds are sent to the GCash number you paid from, usually within a few business days after we confirm the details.',
          ]}
        />
      ),
    },
    {
      id: 'quality',
      title: 'Problems with items',
      body: (
        <>
          <P>
            The store is responsible for the quality and safety of what it sells, as the seller under the Consumer Act of the Philippines (Republic Act
            No. 7394). If something is wrong — spoiled, damaged, incomplete or not what you asked for — report it in the app within 24 hours of
            delivery with photos. We will help you deal with the rider and, where needed, the store, and we will refund or re-deliver where the rider
            or GETGO is at fault.
          </P>
          <P>Riders are expected to handle items with care, keep food sealed and deliver promptly.</P>
        </>
      ),
    },
    {
      id: 'padala',
      title: 'Padala and errand rules',
      body: (
        <>
          <P>
            For padala, you are the sender and must describe the parcel truthfully. For errands, describe the task clearly and give a budget that covers
            it. Riders may refuse, inspect or return any parcel or task that seems unsafe or unlawful. You may not use GETGO to send, buy or carry:
          </P>
          <UL
            items={[
              'Cash, checks, jewelry, gadgets worth more than ₱5,000, or other valuables. GETGO is not a remittance or courier insurance service.',
              'Illegal drugs and drug paraphernalia (RA 9165), firearms, ammunition, explosives and their parts (RA 10591).',
              'Prescription medicines without a valid prescription the rider can present (RA 10918), and any regulated product without the required documents.',
              'Alcohol, tobacco or vape products for anyone under 18 (RA 9211, RA 11900), or in violation of local ordinances.',
              'Flammable, toxic, corrosive or hazardous materials; live animals; and protected wildlife (RA 9147).',
              'Counterfeit or pirated goods (RA 8293), stolen property, and anything else that is illegal to sell, buy or possess in the Philippines.',
              'Parcels that are unsealed for inspection when asked, heavier than about 20 kg, or too large to carry safely on the rider’s vehicle.',
            ]}
          />
          <P>
            Errands must be lawful and must not require the rider to sign documents, receive government benefits, or act on your behalf in a way that
            needs your personal appearance or a special power of attorney. Bill payments are made with the money you provide; keep the receipt the
            rider brings back.
          </P>
          <P>
            Padala and errands stay within one town. Loss of or damage to a parcel caused by a rider is handled through GETGO support; our
            responsibility is limited as described below.
          </P>
        </>
      ),
    },
    {
      id: 'conduct',
      title: 'Using GETGO responsibly',
      body: (
        <UL
          items={[
            'Treat riders, store staff and GETGO support with respect. Harassment, threats and discrimination are not allowed.',
            'Don’t place fake requests, send fake GCash references, or try to get refunds you aren’t owed.',
            'Don’t copy, scrape or misuse the app, other people’s data, or listings; don’t interfere with how GETGO works.',
            'Reviews must be honest and about your own experience.',
          ]}
        />
      ),
    },
    {
      id: 'riders',
      title: 'Riders',
      body: (
        <P>
          Riders are independent people who use GETGO to find requests and choose which to accept. They follow the <A to="/legal/riders">Rider Terms</A>.
          GETGO checks rider details before approving them, but you should still check the rider’s name in the app before handing over a parcel or
          paying.
        </P>
      ),
    },
    {
      id: 'ip',
      title: 'Content and trademarks',
      body: (
        <P>
          The GETGO name, logo and app belong to {op.shortName}. Store names, logos and photos belong to their owners and appear on GETGO only to
          identify stores and items; this does not mean the owner is affiliated with GETGO. If you own content shown on GETGO and want it changed or
          removed, see <A to="/legal/stores#owners">Store listings</A>.
        </P>
      ),
    },
    {
      id: 'liability',
      title: 'Our responsibility to you',
      body: (
        <>
          <P>
            We work to keep GETGO available and accurate, but we can’t promise it will always be error-free or that every listing is current. To the
            extent allowed by Philippine law, GETGO is not liable for indirect or consequential losses, and our total liability for any request is
            limited to the fees you paid for that request plus any amount you paid that was not used for you.
          </P>
          <P>
            Nothing in these Terms limits your rights under the Consumer Act of the Philippines or any other law that can’t be waived, or our liability
            for fraud, bad faith or gross negligence.
          </P>
        </>
      ),
    },
    {
      id: 'suspension',
      title: 'Suspending or closing accounts',
      body: (
        <P>
          We may suspend or close an account that breaks these Terms or the law, or puts riders, stores or other users at risk. You can stop using GETGO
          and ask us to delete your account at any time from <A to="/account">Account</A>. Some records are kept as the law requires; see the{' '}
          <A to="/legal/privacy#retention">Privacy Policy</A>.
        </P>
      ),
    },
    {
      id: 'changes',
      title: 'Changes to these Terms',
      body: (
        <P>
          We may update these Terms as GETGO changes or the law requires. We will show the new effective date here and, for important changes, notify
          you in the app and ask you to accept them before you continue.
        </P>
      ),
    },
    {
      id: 'disputes',
      title: 'Complaints, governing law and disputes',
      body: (
        <>
          <P>
            Please contact us first so we can try to fix the problem. These Terms are governed by the laws of the Republic of the Philippines,
            including the Electronic Commerce Act (RA 8792) and the Internet Transactions Act of 2023 (RA 11967).
          </P>
          <P>
            You may also bring consumer complaints to the Department of Trade and Industry (DTI hotline 1-384, consumercare@dti.gov.ph) and privacy
            complaints to the National Privacy Commission. Where the law requires it, disputes between residents of the same city or municipality first
            go through barangay conciliation (Katarungang Pambarangay). Court cases are filed in the proper courts of the Philippines.
          </P>
        </>
      ),
    },
    { id: 'contact', title: 'Contact us', body: <ContactLine op={op} /> },
  ];
  return (
    <LegalDoc
      title="Terms of Service"
      sections={sections}
      summary={
        <>
          <p>GETGO connects you with local riders who buy, pick up or deliver for you. Stores listed are independent and aren’t GETGO partners.</p>
          <p>You pay your rider directly by GCash, only after a rider accepts and only to the account shown in the app.</p>
          <p>Prices can change at the store; your rider checks with you first. Unused money comes back to you.</p>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Privacy Policy (Data Privacy Act of 2012)
// ---------------------------------------------------------------------------
export function PrivacyPage() {
  const op = operatorDetails(useLegalSettings().data);
  const sections: Section[] = [
    {
      id: 'controller',
      title: 'Who is responsible for your data',
      body: (
        <>
          <P>
            {op.name} is the personal information controller for GETGO under the Data Privacy Act of 2012 (Republic Act No. 10173), its Implementing
            Rules and Regulations, and issuances of the National Privacy Commission (NPC). This policy explains what we collect, why, who we share it
            with, and your rights.
          </P>
          <ContactLine op={op} privacy />
        </>
      ),
    },
    {
      id: 'collect',
      title: 'What we collect',
      body: (
        <UL
          items={[
            <>
              <strong>Account:</strong> your name, email address, mobile number and password (stored only in scrambled, hashed form).
            </>,
            <>
              <strong>Addresses:</strong> delivery addresses, barangay, landmarks and the recipient names and numbers you enter.
            </>,
            <>
              <strong>Requests:</strong> items, notes, padala details (sender, recipient, parcel description), errand descriptions and budgets, status
              history, and reviews.
            </>,
            <>
              <strong>Payments:</strong> the GCash reference number and sender name you enter, and the amount. We never see your GCash PIN, balance or
              account.
            </>,
            <>
              <strong>Riders:</strong> name, mobile number, vehicle type, plate number, service area and GCash name and number, and delivery records.
            </>,
            <>
              <strong>Stores:</strong> business and owner contact details, documents submitted with a listing request, and listing content.
            </>,
            <>
              <strong>Support:</strong> messages you send us.
            </>,
            <>
              <strong>Technical:</strong> sign-in session data and preferences saved in your browser, and basic logs (such as IP address and time of
              access) kept by our hosting providers for security. We don’t use advertising trackers, and we don’t collect your device’s GPS location.
            </>,
          ]}
        />
      ),
    },
    {
      id: 'sensitive',
      title: 'Sensitive information',
      body: (
        <P>
          We don’t ask for sensitive personal information such as health, religion or government ID numbers from customers. Some requests may reveal it
          — for example, an errand to buy a medicine. We use such details only to complete that request, with your consent given by sending it. Please
          don’t include more than the rider needs.
        </P>
      ),
    },
    {
      id: 'use',
      title: 'Why we use it (and our legal basis)',
      body: (
        <UL
          items={[
            'To create your account and provide requests you make — necessary to perform our agreement with you.',
            'To let riders contact you, find addresses, and confirm payments — necessary to perform the request.',
            'To prevent fraud, keep GETGO safe, handle complaints and refunds, and improve the service — our legitimate interests, balanced against your rights.',
            'To keep records and respond to lawful requests from authorities — compliance with legal obligations.',
            'To send service notifications about your requests and account. We don’t send marketing messages without your separate consent.',
          ]}
        />
      ),
    },
    {
      id: 'sharing',
      title: 'Who we share it with',
      body: (
        <>
          <UL
            items={[
              <>
                <strong>Your rider:</strong> your name, delivery address, landmark and mobile number — only after you pay, and only for that request.
                For padala, the sender and recipient details you entered.
              </>,
              <>
                <strong>Stores:</strong> stores don’t receive your personal details from GETGO. Your rider buys as a walk-in customer.
              </>,
              <>
                <strong>Service providers</strong> who process data for us under contract: Supabase (database, sign-in and file storage) and our web
                hosting provider. When a rider taps “Directions”, the address is sent to Google Maps.
              </>,
              <>
                <strong>Authorities:</strong> when required by law, court order or a lawful request, or to protect someone’s life or safety.
              </>,
            ]}
          />
          <P>We don’t sell your personal data.</P>
        </>
      ),
    },
    {
      id: 'transfers',
      title: 'Data stored outside the Philippines',
      body: (
        <P>
          Our database and hosting providers store data on servers outside the Philippines (for example, in Japan). We choose providers with strong
          security, and we remain responsible for your data under the Data Privacy Act wherever it is processed.
        </P>
      ),
    },
    {
      id: 'retention',
      title: 'How long we keep it',
      body: (
        <UL
          items={[
            'Account and address data: while your account is open.',
            'Requests, payment references and support records: for as long as needed to handle disputes and refunds, and as required by tax, accounting and other laws.',
            'When you delete your account, we delete or anonymize your personal data, except records we must keep by law, which we keep securely and delete when no longer required.',
          ]}
        />
      ),
    },
    {
      id: 'security',
      title: 'How we protect it',
      body: (
        <P>
          We use encrypted connections (HTTPS), hashed passwords, database access rules so each person only sees data meant for them, limited staff
          access with audit logs, and providers with industry security certifications. If a personal data breach puts you at real risk of serious
          harm, we will notify you and the NPC within 72 hours of knowing about it, as NPC rules require.
        </P>
      ),
    },
    {
      id: 'rights',
      title: 'Your rights',
      body: (
        <>
          <P>Under the Data Privacy Act, you have the right to:</P>
          <UL
            items={[
              'Be informed about how your data is processed (this policy).',
              <>
                Access your data and get a copy in a common format — use <A to="/account#your-data">Download my data</A> in your account.
              </>,
              'Correct inaccurate data — edit your profile and addresses, or ask us.',
              'Object to processing, and ask us to suspend, withdraw, block or delete your data.',
              <>
                Delete your account — use <A to="/account#your-data">Request account deletion</A>.
              </>,
              'Be compensated for damages caused by inaccurate, unlawfully obtained or unauthorized use of your data.',
              <>
                File a complaint with the National Privacy Commission (<A to="https://privacy.gov.ph">privacy.gov.ph</A>).
              </>,
            ]}
          />
          <P>Contact our Data Protection Officer to use any of these rights. We may need to confirm your identity first.</P>
        </>
      ),
    },
    {
      id: 'others',
      title: 'Other people’s information',
      body: (
        <P>
          When you enter someone else’s details — a padala recipient, or a person receiving your order — make sure they agree to you sharing their name,
          number and address with GETGO and the rider for that delivery.
        </P>
      ),
    },
    {
      id: 'children',
      title: 'Children',
      body: (
        <P>
          GETGO is meant for people 18 and older. If you believe a child gave us personal data without a parent’s or guardian’s consent, contact us and
          we will delete it.
        </P>
      ),
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      body: <P>We will post updates here with a new effective date and tell you in the app about important changes.</P>,
    },
  ];
  return (
    <LegalDoc
      title="Privacy Policy"
      sections={sections}
      summary={
        <>
          <p>We collect what’s needed to run your requests: your account, addresses, requests and the GCash reference you enter.</p>
          <p>Your rider sees your address and number only after you pay. Stores don’t get your details. We don’t sell your data.</p>
          <p>You can download your data or ask us to delete your account any time from your Account page.</p>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Store listings
// ---------------------------------------------------------------------------
function StoreRequestForm() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  const toast = useToast();
  const storeName = params.get('store') ?? '';
  const [kind, setKind] = useState('remove');
  const [details, setDetails] = useState(storeName ? `Store: ${storeName}\n` : '');
  const send = useMutation({
    mutationFn: async () => {
      const label = kind === 'remove' ? 'remove listing' : kind === 'correct' ? 'correct listing' : 'manage listing';
      const ticket = unwrap(
        await supabase
          .from('support_tickets')
          .insert({ subject: `Store listing: ${label}${storeName ? ` — ${storeName}` : ''}`.slice(0, 120), priority: kind === 'remove' ? 'high' : 'normal' })
          .select('id')
          .single(),
      ) as { id: string };
      unwrap(await supabase.from('ticket_messages').insert({ ticket_id: ticket.id, body: details.trim() }));
    },
  });

  if (status !== 'signed_in') {
    return (
      <Notice
        title="Send a request"
        action={
          <ButtonLink size="sm" to={`/sign-in?next=${encodeURIComponent(`/legal/stores${storeName ? `?store=${encodeURIComponent(storeName)}` : ''}#owners`)}`}>
            Sign in
          </ButtonLink>
        }
      >
        Sign in (or create a free account) to send a request we can reply to, or email us at the address below.
      </Notice>
    );
  }
  if (send.isSuccess) {
    return (
      <Notice tone="success" title="Request sent">
        We’ll reply in <A to="/account/support">your support requests</A>. Removal requests are handled first.
      </Notice>
    );
  }
  return (
    <form
      className="space-y-3 rounded-sheet border border-line p-5"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutateAsync().then(() => toast('Request sent'), () => undefined);
      }}
    >
      <p className="font-semibold">Send a request</p>
      <Field label="What would you like?">
        {(p) => (
          <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="remove">Remove my store from GETGO</option>
            <option value="correct">Correct my store’s details or prices</option>
            <option value="manage">Manage my store’s listing myself</option>
          </Select>
        )}
      </Field>
      <Field label="Details" hint="Store name and address, your role (owner or manager), and how we can confirm it — e.g. a business number we can call.">
        {(p) => <Textarea {...p} rows={4} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} required />}
      </Field>
      {send.error && <Notice tone="danger">{userMessage(send.error)}</Notice>}
      <Button type="submit" loading={send.isPending} disabled={details.trim().length < 10}>
        Send request
      </Button>
    </form>
  );
}

export function StoreListingsPage() {
  const op = operatorDetails(useLegalSettings().data);
  const sections: Section[] = [
    {
      id: 'what',
      title: 'What a store listing is',
      body: (
        <>
          <P>
            GETGO lists stores in your town so you can tell a rider what to buy for you. A listing is information — the store’s name, location, hours
            and items with reference prices — not an offer from the store and not a sign of partnership.
          </P>
          <UL
            items={[
              'Unless a listing says it is managed by the store, the store has no agreement with GETGO and has not endorsed, sponsored or authorized GETGO.',
              'GETGO does not sell on the store’s behalf, is not the store’s agent or reseller, and takes no commission from stores.',
              'Riders buy at the store as ordinary walk-in customers and pay the store’s counter price.',
              'Store names, logos and photos belong to their owners and are used only to identify the store.',
            ]}
          />
        </>
      ),
    },
    {
      id: 'sources',
      title: 'Where listing details come from',
      body: (
        <P>
          Details come from the store’s publicly posted menus and prices, from what riders see at the counter, or from the store owner. They can be out of
          date. Customers are told that prices are a guide and that riders check with them when a price or item differs.
        </P>
      ),
    },
    {
      id: 'owners',
      title: 'For store owners: your choice',
      body: (
        <>
          <P>Being on GETGO is optional and free. As the owner or authorized manager of a listed store, you can at any time:</P>
          <UL
            items={[
              <>
                <strong>Remove</strong> your store from GETGO. We take the listing down promptly once we confirm you represent the store.
              </>,
              <>
                <strong>Correct</strong> its details, items or prices.
              </>,
              <>
                <strong>Manage</strong> the listing yourself — update items, prices, availability and hours. Managing a listing is free, has no minimum
                and no exclusivity, and doesn’t require you to accept orders: riders still buy at your counter like any customer.
              </>,
            ]}
          />
          <StoreRequestForm />
          <ContactLine op={op} />
        </>
      ),
    },
    {
      id: 'managed',
      title: 'If you manage your listing',
      body: (
        <UL
          items={[
            'Keep your items, prices and hours accurate, and only list products you’re allowed to sell.',
            'You remain responsible for your products, permits and taxes, and for honoring your counter prices to riders.',
            'You can hide items, pause your store or stop managing the listing whenever you want.',
            'Your account details are handled under our Privacy Policy.',
          ]}
        />
      ),
    },
  ];
  return (
    <LegalDoc
      title="Store listings"
      sections={sections}
      summary={
        <>
          <p>Stores on GETGO are independent. A listing helps customers tell riders what to buy — it isn’t a partnership or endorsement.</p>
          <p>Store owners can remove, correct or manage their listing at any time, for free.</p>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Rider Terms
// ---------------------------------------------------------------------------
export function RiderTermsPage() {
  const op = operatorDetails(useLegalSettings().data);
  const sections: Section[] = [
    {
      id: 'relationship',
      title: 'How riding with GETGO works',
      body: (
        <>
          <P>
            These Rider Terms apply when you apply to ride and when you accept requests on GETGO, together with the{' '}
            <A to="/legal/terms">Terms of Service</A> and <A to="/legal/privacy">Privacy Policy</A>.
          </P>
          <UL
            items={[
              'You decide when you’re available and which requests to accept. There are no required hours or minimum number of jobs.',
              'You provide your own vehicle, phone, data and GCash account.',
              'You act for the customer when buying, picking up or doing an errand.',
              'These terms don’t take away any rights you have under Philippine labor or social legislation.',
            ]}
          />
        </>
      ),
    },
    {
      id: 'requirements',
      title: 'Requirements',
      body: (
        <UL
          items={[
            'Be at least 18 and give true, current details. GETGO may check them before approving you.',
            'Hold a valid driver’s license for your vehicle, keep the vehicle registered with the LTO and covered by compulsory third-party liability insurance where required.',
            'Follow traffic laws (RA 4136), wear a standard helmet (RA 10054), and don’t ride under the influence or while using your phone.',
          ]}
        />
      ),
    },
    {
      id: 'money',
      title: 'Handling customers’ money',
      body: (
        <UL
          items={[
            'Confirm a payment in the app only after it has arrived in your GCash. Don’t start buying before that.',
            'Use the item amount or errand budget only for that customer’s request. Ask the customer before buying a replacement or spending more.',
            'Return unspent money in cash with the store’s receipt, and record the amount spent in the app for errands.',
            'If you cancel after being paid, return the customer’s money right away (or as GETGO support instructs).',
            'You keep the delivery and service fees shown for the request, unless GETGO tells you of a different arrangement in advance. You are responsible for your own taxes on what you earn.',
          ]}
        />
      ),
    },
    {
      id: 'items',
      title: 'Safe and lawful deliveries',
      body: (
        <P>
          Refuse any request that involves prohibited items — see <A to="/legal/terms#padala">Padala and errand rules</A>. You may ask to inspect a padala
          before accepting it. Handle items with care and keep food sealed.
        </P>
      ),
    },
    {
      id: 'privacy',
      title: 'Customers’ personal data',
      body: (
        <P>
          You’ll see customers’ names, numbers and addresses. Use them only to complete that request. Don’t save, share, post or contact customers for
          anything else. Misusing personal data can be a crime under the Data Privacy Act (RA 10173).
        </P>
      ),
    },
    {
      id: 'conduct',
      title: 'Conduct and deactivation',
      body: (
        <P>
          Be courteous and honest. GETGO may suspend or deactivate a rider account for fraud, keeping customers’ money, unsafe riding, harassment,
          misuse of personal data or repeated complaints. You can ask GETGO support to review a decision.
        </P>
      ),
    },
    {
      id: 'liability',
      title: 'Accidents and responsibility',
      body: (
        <P>
          You are responsible for riding safely and for loss or damage you cause through your own fault. Report any accident, loss or dispute to GETGO
          support right away so we can help.
        </P>
      ),
    },
    { id: 'contact', title: 'Contact', body: <ContactLine op={op} /> },
  ];
  return (
    <LegalDoc
      title="Rider Terms"
      sections={sections}
      summary={
        <>
          <p>You choose when to ride and which requests to take. You use your own vehicle and GCash.</p>
          <p>Customers pay you first; spend only on their request and return any change with the receipt. Keep their details private.</p>
        </>
      }
    />
  );
}

export function LegalIndexPage() {
  const items = [
    { to: '/legal/terms', label: 'Terms of Service', detail: 'Using GETGO, payments, refunds and padala rules', icon: FileText },
    { to: '/legal/privacy', label: 'Privacy Policy', detail: 'Your data and your rights under the Data Privacy Act', icon: Shield },
    { to: '/legal/stores', label: 'Store listings', detail: 'Independent stores, and how owners remove or manage listings', icon: Store },
    { to: '/legal/riders', label: 'Rider Terms', detail: 'For people who deliver with GETGO', icon: Bike },
  ];
  return (
    <div className="page-x mx-auto max-w-3xl pt-6 pb-16 lg:pt-10">
      <h1 className="text-display font-bold">Legal</h1>
      <p className="mt-1 text-ink-3">Effective {LEGAL_EFFECTIVE}</p>
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {items.map(({ to, label, detail, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="flex items-center gap-4 py-4 hover:bg-canvas/60">
              <Icon className="size-6 shrink-0 text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{label}</span>
                <span className="block text-small text-ink-3">{detail}</span>
              </span>
              <ChevronRight className="size-4 text-ink-3" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
