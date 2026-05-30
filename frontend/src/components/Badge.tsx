import { cx } from "../lib/format";

type BadgeProps = {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "blue" | "amber" | "red" | "purple";
};

const tones = {
  neutral: "border-zinc-700 bg-zinc-900 text-zinc-300",
  green: "border-emerald-700/60 bg-emerald-950/70 text-emerald-300",
  blue: "border-sky-700/60 bg-sky-950/70 text-sky-300",
  amber: "border-amber-700/60 bg-amber-950/70 text-amber-300",
  red: "border-red-700/60 bg-red-950/70 text-red-300",
  purple: "border-purple-700/60 bg-purple-950/70 text-purple-300"
};

export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return (
    <span className={cx("inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium", tones[tone])}>
      {children}
    </span>
  );
}
