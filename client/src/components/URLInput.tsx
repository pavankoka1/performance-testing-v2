import { Globe } from "lucide-react";
import { memo } from "react";

type URLInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Overrides the default "Target URL" label */
  label?: string;
  /** Strong border / ring so the field stands out in the form */
  emphasize?: boolean;
};

function URLInput({
  value,
  onChange,
  label = "Target URL",
  emphasize = true,
}: URLInputProps) {
  const shell = emphasize
    ? "rounded-2xl border-2 border-[var(--accent)]/55 bg-[var(--accent)]/[0.07] p-4 shadow-[0_0_0_1px_rgba(139,92,246,0.25),inset_0_1px_0_rgba(255,255,255,0.06)] ring-2 ring-[var(--accent)]/25"
    : "";

  return (
    <div className={`flex flex-col gap-2 ${shell}`}>
      <label
        className="text-sm font-semibold tracking-tight text-[var(--fg)]"
        htmlFor="target-url"
      >
        {label}
      </label>
      <div className="relative">
        <Globe
          className={`absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${emphasize ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"}`}
        />
        <input
          id="target-url"
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://example.com"
          autoComplete="url"
          className={
            emphasize
              ? "w-full rounded-xl border-2 border-[var(--accent)]/45 bg-[var(--bg-elevated)] py-3.5 pl-10 pr-4 text-[15px] font-medium text-[var(--fg)] shadow-inner placeholder:text-[var(--fg-muted)]/55 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50"
              : "w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] py-3 pl-10 pr-4 text-sm text-[var(--fg)] placeholder:text-[var(--fg-muted)]/60 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-dim)]"
          }
        />
      </div>
      <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
        Any http(s) URL — recording includes this tab, additional tabs you open, and the
        bundled Chromium trace (full detail by default).
      </p>
    </div>
  );
}

export default memo(URLInput);
