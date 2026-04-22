import { ChevronDown, type LucideIcon } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

/** Shared “premium” native select styling — dark theme, focus ring, hover lift. */
export const NICE_SELECT_CLASS =
  "w-full cursor-pointer appearance-none rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/90 py-2.5 pl-4 pr-11 text-sm font-medium text-[var(--fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 ease-out " +
  "hover:border-[var(--accent)]/35 hover:bg-[var(--bg)] hover:shadow-[0_0_0_1px_rgba(139,92,246,0.12),inset_0_1px_0_rgba(255,255,255,0.05)] " +
  "focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-dim)]/80 focus:ring-offset-2 focus:ring-offset-[var(--bg-card)] " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "[&>option]:bg-[var(--bg-elevated)] [&>option]:text-[var(--fg)]";

type SelectFieldProps = {
  label: string;
  icon?: LucideIcon;
  hint?: string;
} & SelectHTMLAttributes<HTMLSelectElement>;

export default function SelectField({
  label,
  icon: Icon,
  hint,
  className = "",
  disabled,
  children,
  ...rest
}: SelectFieldProps) {
  return (
    <div className="flex min-w-[200px] flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--fg)]">
          {Icon ? (
            <Icon className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
          ) : null}
          {label}
        </label>
        {hint ? (
          <span className="text-xs font-normal text-[var(--fg-muted)]">{hint}</span>
        ) : null}
      </div>
      <div className="group relative w-full max-w-xs">
        <select
          disabled={disabled}
          className={`${NICE_SELECT_CLASS} ${className}`}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-muted)] transition group-hover:text-[var(--accent)]/80"
        />
      </div>
    </div>
  );
}
