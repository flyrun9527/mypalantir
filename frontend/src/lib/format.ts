import dayjs from "dayjs";

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(value);
}

export function formatTime(value: string): string {
  return dayjs(value).format("HH:mm:ss");
}

export function stringify(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function firstLine(value?: string): string {
  return (value ?? "").trim().split("\n")[0] ?? "";
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
