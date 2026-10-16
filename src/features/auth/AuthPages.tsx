import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { userMessage } from '@/lib/errors';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Feedback';
import { Logo } from '@/components/Logo';
import { useAuth } from './AuthProvider';

export function safeNext(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function AuthLayout({
  title,
  children,
  footer,
  suffix,
  headline = 'Local food and essentials, delivered.',
  blurb = 'One account for ordering, running your store on GETGO, and tracking every order.',
  wide,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Logo suffix, e.g. "Rider". */
  suffix?: string;
  headline?: string;
  blurb?: string;
  wide?: boolean;
}) {
  return (
    <div className="safe-top flex min-h-dvh flex-col bg-surface lg:flex-row">
      <aside className="hidden flex-col justify-between bg-ink p-10 text-white lg:flex lg:w-[42%]">
        <Logo inverted suffix={suffix} />
        <div className="max-w-sm space-y-3">
          <p className="text-display font-bold">{headline}</p>
          <p className="text-white/70">{blurb}</p>
        </div>
        <span />
      </aside>
      <main className="flex flex-1 flex-col px-5 py-6 sm:items-center sm:justify-center">
        <div className="mb-10 lg:hidden">
          <Link to="/" aria-label="GETGO home">
            <Logo suffix={suffix} />
          </Link>
        </div>
        <div className={wide ? 'w-full sm:max-w-lg' : 'w-full sm:max-w-sm'}>
          <h1 className="mb-6 text-title font-bold">{title}</h1>
          {children}
          {footer && <div className="mt-8 text-ink-3">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

const signInSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export function SignInPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof signInSchema>>({ resolver: zodResolver(signInSchema) });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) return setError(userMessage(error));
    navigate(next, { replace: true });
  });

  return (
    <AuthLayout
      title="Sign in"
      footer={
        <>
          New to GETGO?{' '}
          <Link className="font-semibold text-ink underline underline-offset-4" to={`/sign-up?next=${encodeURIComponent(next)}`}>
            Create an account
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

const phonePattern = /^(\+63|0)9\d{9}$/;
const signUpSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter your name.').max(120),
  email: z.string().trim().email('Enter a valid email address.'),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .refine((v) => phonePattern.test(v), 'Enter a mobile number like 0917 123 4567.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
});

export function SignUpPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const form = useForm<z.input<typeof signUpSchema>, unknown, z.output<typeof signUpSchema>>({ resolver: zodResolver(signUpSchema) });

  const onSubmit = form.handleSubmit(async ({ email, password, full_name, phone }) => {
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name, phone }, emailRedirectTo: `${window.location.origin}${next}` },
    });
    if (error) return setError(userMessage(error));
    if (data.session) navigate(next, { replace: true });
    else setConfirmEmail(email);
  });

  if (confirmEmail) {
    return (
      <AuthLayout title="Check your email">
        <p className="text-ink-2">
          We sent a confirmation link to <strong>{confirmEmail}</strong>. Open it on this device to finish creating your account.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-semibold text-ink underline underline-offset-4" to={`/sign-in?next=${encodeURIComponent(next)}`}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Full name" error={form.formState.errors.full_name?.message}>
          {(p) => <Input {...p} autoComplete="name" {...form.register('full_name')} />}
        </Field>
        <Field label="Email" error={form.formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" {...form.register('email')} />}
        </Field>
        <Field label="Mobile number" hint="Stores and riders use this to reach you about orders." error={form.formState.errors.phone?.message}>
          {(p) => <Input {...p} type="tel" autoComplete="tel" inputMode="tel" placeholder="0917 123 4567" {...form.register('phone')} />}
        </Field>
        <Field label="Password" hint="At least 8 characters." error={form.formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
        </Field>
        <Button type="submit" block size="lg" loading={form.formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().trim().email('Enter a valid email address.') })) });
  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) return setError(userMessage(error));
    setSent(true);
  });
  return (
    <AuthLayout title="Reset your password" footer={<Link className="font-semibold text-ink underline underline-offset-4" to="/sign-in">Back to sign in</Link>}>
      {sent ? (
        <p className="text-ink-2">If an account uses that email, a reset link is on its way.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Email" error={form.formState.errors.email?.message}>
            {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
          </Field>
          <Button type="submit" block size="lg" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ password: string }>({ resolver: zodResolver(z.object({ password: z.string().min(8, 'Use at least 8 characters.') })) });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return setError(userMessage(error));
    navigate('/', { replace: true });
  });
  return (
    <AuthLayout title="Choose a new password">
      {status === 'signed_out' ? (
        <Notice tone="warning">This reset link has expired or was already used. Request a new one from the sign-in page.</Notice>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="New password" error={form.formState.errors.password?.message}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
          </Field>
          <Button type="submit" block size="lg" loading={form.formState.isSubmitting}>
            Save password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
