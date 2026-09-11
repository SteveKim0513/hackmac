import type { ThemePreference } from '../../shared/types';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
  { value: 'system', label: '시스템' },
];

export function ThemeSwitch({ value, onChange }: { value: ThemePreference; onChange: (pref: ThemePreference) => void }) {
  return (
    <div className="theme-switch" role="group" aria-label="테마">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          className={`theme-switch-btn ${value === opt.value ? 'is-active' : ''}`}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
