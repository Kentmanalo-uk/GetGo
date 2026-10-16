import { useId, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { uploadMedia, mediaUrl } from '@/lib/media';
import { Button } from './ui/Button';
import { Spinner } from './ui/Feedback';
import { cx } from './ui/cx';

/**
 * Uploads an image into the public media bucket under `prefix` (which storage
 * policies scope to the user's store or application) and reports the path.
 */
export function ImageUpload({
  label,
  hint,
  prefix,
  value,
  onChange,
  aspect = 'square',
}: {
  label: string;
  hint?: string;
  prefix: string;
  value: string | null;
  onChange: (path: string | null) => void;
  aspect?: 'square' | 'wide';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = mediaUrl(value);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await uploadMedia(prefix, file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-1.5">
      <p id={`${id}-label`} className="text-small font-semibold">
        {label}
      </p>
      <div className="flex items-end gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-labelledby={`${id}-label`}
          className={cx(
            'relative flex shrink-0 items-center justify-center overflow-hidden rounded-media border border-dashed border-line-strong bg-canvas text-ink-3 hover:border-ink-3',
            aspect === 'square' ? 'size-24' : 'aspect-[16/9] w-48 sm:w-64',
          )}
        >
          {url ? <img src={url} alt="" className="size-full object-cover" /> : <ImagePlus className="size-6" aria-hidden />}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-surface/70">
              <Spinner label="Uploading" />
            </span>
          )}
        </button>
        <div className="flex flex-col items-start gap-1">
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            {value ? 'Replace' : 'Upload'}
          </Button>
          {value && (
            <Button variant="ghost" size="sm" onClick={() => onChange(null)} disabled={busy}>
              Remove
            </Button>
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
      <p className={cx('text-small', error ? 'text-danger' : 'text-ink-3')}>{error ?? hint ?? 'JPG, PNG or WebP. We resize large photos automatically.'}</p>
    </div>
  );
}
