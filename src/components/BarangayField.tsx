import { Field, Input, Select } from './ui/Field';
import { usePsgcBarangays } from '@/lib/psgc';

/**
 * Barangay picker for a city/municipality, using the official PSGC list.
 * Falls back to a text field when the town has no PSGC code or the list
 * can't be loaded.
 */
export function BarangayField({
  municipalityCode,
  value,
  onChange,
  error,
  disabled,
}: {
  municipalityCode: string | null | undefined;
  value: string;
  onChange: (barangay: { name: string; code: string | null }) => void;
  error?: string;
  disabled?: boolean;
}) {
  const barangays = usePsgcBarangays(municipalityCode);
  const useList = Boolean(municipalityCode) && !barangays.isError;

  if (!useList) {
    return (
      <Field label="Barangay" error={error} hint={barangays.isError ? 'Couldn’t load the barangay list — type it instead.' : undefined}>
        {(p) => <Input {...p} value={value} disabled={disabled} onChange={(e) => onChange({ name: e.target.value, code: null })} />}
      </Field>
    );
  }

  const list = barangays.data ?? [];
  const known = list.some((b) => b.name === value);
  return (
    <Field label="Barangay" error={error}>
      {(p) => (
        <Select
          {...p}
          value={known ? value : ''}
          disabled={disabled || barangays.isPending}
          onChange={(e) => {
            const picked = list.find((b) => b.code === e.target.selectedOptions[0]?.dataset.code);
            onChange(picked ? { name: picked.name, code: picked.code } : { name: '', code: null });
          }}
        >
          <option value="">{barangays.isPending ? 'Loading barangays…' : municipalityCode ? 'Choose your barangay' : 'Choose the town first'}</option>
          {list.map((b) => (
            <option key={b.code} value={b.name} data-code={b.code}>
              {b.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
