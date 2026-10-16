import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { supabase } from '@/lib/supabase';
import { userMessage } from '@/lib/errors';
import { useAuth } from './AuthProvider';

const RESEND_SECONDS = 60;
const RETURN_PARAM = 'verify';

/**
 * Asks signed-in users to verify their email without blocking the app.
 * "Send link" emails a one-time sign-in link back to this page; opening it
 * proves the user controls the inbox, and confirm_email_verification()
 * records that on the server.
 */
export function VerifyEmailBanner() {
  const { profile, status, refreshIdentity } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirming = useRef(false);

  // Returning from the email link: confirm on the server, then tidy the URL.
  useEffect(() => {
    if (params.get(RETURN_PARAM) !== '1' || status !== 'signed_in' || !profile || confirming.current) return;
    confirming.current = true;
    const done = () =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete(RETURN_PARAM);
          return next;
        },
        { replace: true },
      );
    if (profile.email_verified_at) {
      done();
      return;
    }
    supabase.rpc('confirm_email_verification').then(async ({ error: rpcError }) => {
      if (rpcError) setError(userMessage(rpcError));
      else {
        await refreshIdentity();
        toast('Email verified');
      }
      done();
    });
  }, [params, status, profile, refreshIdentity, setParams, toast]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  if (status !== 'signed_in' || !profile?.email || profile.email_verified_at) return null;

  const send = async () => {
    setError(null);
    setSending(true);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: profile.email!,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/account?${RETURN_PARAM}=1` },
    });
    setSending(false);
    if (sendError) {
      setError(/rate limit|security purposes/i.test(sendError.message) ? 'Please wait a minute before requesting another link.' : userMessage(sendError));
      return;
    }
    setSentTo(profile.email);
    setCooldown(RESEND_SECONDS);
  };

  return (
    <Notice
      tone="warning"
      className="mb-6"
      title={sentTo ? 'Link sent — check your email' : 'Verify your email'}
      action={
        <Button size="sm" variant="dark" loading={sending} disabled={cooldown > 0} icon={<MailCheck className="size-4" aria-hidden />} onClick={() => void send()}>
          {cooldown > 0 ? `${cooldown}s` : sentTo ? 'Resend' : 'Verify'}
        </Button>
      }
    >
      {error && <span className="font-semibold text-danger">{error}</span>}
    </Notice>
  );
}
