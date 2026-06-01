import { cx } from "../lib/format";

type BadgeProps = {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "blue" | "amber" | "red" | "purple";
};

const tones = {
  neutral: "",
  green: "badge-green",
  blue: "badge-blue",
  amber: "badge-amber",
  red: "badge-red",
  purple: "badge-purple"
};

export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return (
    <span className={cx("badge", tones[tone])}>
      {children}
    </span>
  );
}
