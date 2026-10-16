import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { userMessage } from '@/lib/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Notice, PageLoading } from '@/components/ui/Feedback';
import { AuthLayout, safeNext } from '@/features/auth/AuthPages';
import { useAuth } from '@/features/auth/AuthProvider';
import { useServiceAreas } from '@/features/consumer/api';

const RIDER_COPY = {
  suffix: 'Rider',
  headline: 'Deliver for GETGO in your area.',
  blurb: 'Accept orders near you, get paid by GCash before you buy, and deliver on your own schedule.',
};

const mobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^(\+63|0)9\d{9}$/.test(v), 'Enter a mobile number like 0917 123 4567.');

const riderDetails = {
  full_name: z.string().trim().min(2, 'Enter your full name.').max(120),
  phone: mobile,
  vehicle: z.enum(['motorcycle', 'bicycle', 'car'], { message: 'Choose your vehicle.' }),
  plate: z.string().trim().max(20),
  service_area_id: z.string().uuid('Choose the area you’ll deliver in.'),
  gcash_name: z.string().trim().min(2, 'Enter the name on your GCash account.').max(120),
  gcash_number: mobile,
};

const signUpSchema = z.object({
  ...riderDetails,
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
});
// Signed-in people already have an account: same shape, no email/password checks.
const applySchema = z.object({ ...riderDetails, email: z.string(), password: z.string() });

type SignUpIn = z.input<typeof signUpSchema>;
type SignUpOut = z.output<typeof signUpSchema>;

/** Vehicle, area and GCash fields shared by sign-up and "complete your details". */
function RiderDetailsFields({ form }: { form: ReturnType<typeof useForm<SignUpIn, unknown, SignUpOut>> }) {
  const areas = useServiceAreas();
  const e = form.formState.errors;
  const vehicle = form.watch('vehicle');
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vehicle" error={e.vehicle?.message}>
          {(p) => (
            <Select {...p} {...form.register('vehicle')}>
              <option value="motorcycle">Motorcycle</option>
              <option value="bicycle">Bicycle</option>
              <option value="car">Car</option>
            </Select>
          )}
        </Field>
        <Field label="Plate number" optional={vehicle === 'bicycle'} error={e.plate?.message}>
          {(p) => <Input {...p} autoCapitalize="characters" {...form.register('plate')} />}
        </Field>
      </div>
      <Field
        label="Area you’ll deliver in"
        error={e.service_area_id?.message}
        hint={areas.data?.length === 0 ? 'GETGO isn’t operating in any area yet. Check back soon.' : undefined}
      >
        {(p) => (
          <Select {...p} {...form.register('service_area_id')} disabled={areas.isPending}>
            <option value="">{areas.isPending ? 'Loading areas…' : 'Choose an area'}</option>
            {areas.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.city}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <fieldset className="space-y-4 border-t border-line pt-4">
        <legend className="sr-only">GCash account</legend>
        <p className="text-small text-ink-3">Customers send each order’s payment to this GCash account before you buy the items.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="GCash account name" error={e.gcash_name?.message}>
            {(p) => <Input {...p} autoComplete="off" {...form.register('gcash_name')} />}
          </Field>
          <Field label="GCash number" error={e.gcash_number?.message}>
            {(p) => <Input {...p} type="tel" inputMode="tel" placeholder="0917 123 4567" autoComplete="off" {...form.register('gcash_number')} />}
          </Field>
        </div>
      </fieldset>
    </>
  );
}

export function RiderSignInPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next') ?? '/rider');
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string; password: string }>({
    resolver: zodResolver(z.object({ email: z.string().trim().email('Enter a valid email address.'), password: z.string().min(1, 'Enter your password.') })),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) return setError(userMessage(error));
    navigate(next === '/' ? '/rider' : next, { replace: true });
  });

  return (
    <AuthLayout
      title="Rider sign in"
      {...RIDER_COPY}
      footer={
        <>
          Want to deliver for GETGO?{' '}
          <Link className="font-semibold text-ink underline underline-offset-4" to="/rider/sign-up">
            Sign up as a rider
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Email" error={form.formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" {...form.register('email')} />}
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...form.register('password')} />}
        </Field>
        <Button type="submit" block size="lg" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
        <Link to="/forgot-password" className="block text-small font-semibold text-ink-2 underline underline-offset-4">
          Forgot your password?
        </Link>
      </form>
    </AuthLayout>
  );
}

/**
 * New riders create an account and apply in one step. Signed-in people
 * (e.g. existing customers) only fill in the rider details.
 */
export function RiderSignUpPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState<string | null>(null);
  const signedIn = auth.status === 'signed_in';
  const form = useForm<SignUpIn, unknown, SignUpOut>({
    resolver: zodResolver(signedIn ? applySchema : signUpSchema),
    defaultValues: {
      full_name: auth.profile?.full_name ?? '',
      phone: auth.profile?.phone ?? '',
      vehicle: 'motorcycle',
      plate: '',
      service_area_id: '',
      gcash_name: '',
      gcash_number: '',
      email: '',
      password: '',
    },
  });
  const e = form.formState.errors;

  if (auth.status === 'loading') {
    return (
      <AuthLayout title="Become a GETGO rider" {...RIDER_COPY}>
        <PageLoading rows={2} />
      </AuthLayout>
    );
  }
  if (signedIn && auth.hasRole('rider')) return <Navigate to="/rider" replace />;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    if (signedIn) {
      const { error } = await supabase.rpc('apply_as_rider', {
        p_full_name: v.full_name,
        p_phone: v.phone,
        p_vehicle: v.vehicle,
        p_plate: v.plate || null,
        p_service_area_id: v.service_area_id,
        p_gcash_name: v.gcash_name,
        p_gcash_number: v.gcash_number,
      });
      if (error) return setError(userMessage(error));
      await qc.invalidateQueries({ queryKey: ['rider'] });
      navigate('/rider', { replace: true });
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: {
        emailRedirectTo: `${window.location.origin}/rider`,
        data: {
          full_name: v.full_name,
          phone: v.phone,
          rider_application: {
            vehicle: v.vehicle,
            plate: v.plate,
            service_area_id: v.service_area_id,
            gcash_name: v.gcash_name,
            gcash_number: v.gcash_number,
          },
        },
      },
    });
    if (error) return setError(userMessage(error));
    if (data.session) navigate('/rider', { replace: true });
    else setCheckEmail(v.email);
  });

  if (checkEmail) {
    return (
      <AuthLayout title="Check your email" {...RIDER_COPY}>
        <p className="text-ink-2">
          We sent a confirmation link to <strong>{checkEmail}</strong>. Open it, then sign in to see your rider application.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      wide
      title={signedIn ? 'Your rider details' : 'Become a GETGO rider'}
      {...RIDER_COPY}
      footer={
        signedIn ? undefined : (
          <>
            Already a rider?{' '}
            <Link className="font-semibold text-ink underline underline-offset-4" to="/rider/sign-in">
              Sign in
            </Link>
          </>
        )
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <p className="text-small text-ink-3">GETGO reviews every rider before they can accept orders.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={e.full_name?.message}>
            {(p) => <Input {...p} autoComplete="name" {...form.register('full_name')} />}
          </Field>
          <Field label="Mobile number" error={e.phone?.message}>
            {(p) => <Input {...p} type="tel" autoComplete="tel" inputMode="tel" placeholder="0917 123 4567" {...form.register('phone')} />}
          </Field>
        </div>
        {!signedIn && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" error={e.email?.message}>
              {(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" {...form.register('email')} />}
            </Field>
            <Field label="Password" hint="At least 8 characters." error={e.password?.message}>
              {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
            </Field>
          </div>
        )}
        <RiderDetailsFields form={form} />
        <Button type="submit" block size="lg" loading={form.formState.isSubmitting}>
          {signedIn ? 'Submit application' : 'Create rider account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
