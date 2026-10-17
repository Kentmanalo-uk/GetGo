import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { uploadMedia } from '@/lib/media';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';

/** Replaces (or removes) the signed-in person's profile picture, then deletes the old file. */
export function useSetAvatar() {
  const { profile, userId, refreshIdentity } = useAuth();
  return useMutation({
    mutationFn: async (file: File | null) => {
      const old = profile?.avatar_path ?? null;
      const path = file ? await uploadMedia(`avatars/${userId}`, file, 512) : null;
      unwrap(await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId!));
      if (old) await supabase.storage.from('media').remove([old]);
    },
    onSuccess: () => refreshIdentity(),
  });
}

/** The profile picture with Add/Change and Remove buttons. */
export function AvatarPicker({ name }: { name?: string | null }) {
  const { profile } = useAuth();
  const avatar = useSetAvatar();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex items-center gap-4">
        <Avatar name={name ?? profile?.full_name} path={profile?.avatar_path} size="lg" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={avatar.isPending && avatar.variables !== null} onClick={() => inputRef.current?.click()}>
            {profile?.avatar_path ? 'Change photo' : 'Add photo'}
          </Button>
          {profile?.avatar_path && (
            <Button
              variant="ghost"
              size="sm"
              loading={avatar.isPending && avatar.variables === null}
              onClick={() => avatar.mutateAsync(null).then(() => toast('Profile picture removed'), () => undefined)}
            >
              Remove
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) avatar.mutateAsync(file).then(() => toast('Profile picture updated'), () => undefined);
          }}
        />
      </div>
      <div className="mt-2">
        <FormError error={avatar.error} />
      </div>
    </div>
  );
}
