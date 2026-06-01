import { Inbox } from "lucide-react";

type EmptyStateProps = {
  title: string;
  detail?: string;
};

export function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <div className="empty-state h-full">
      <Inbox className="h-7 w-7" style={{ color: "var(--text-faint)" }} />
      <div>
        <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</div>
        {detail ? <div className="mt-1 max-w-md text-xs leading-5" style={{ color: "var(--text-faint)" }}>{detail}</div> : null}
      </div>
    </div>
  );
}
