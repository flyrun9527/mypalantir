import { Inbox } from "lucide-react";

type EmptyStateProps = {
  title: string;
  detail?: string;
};

export function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 rounded border border-dashed border-zinc-800 bg-zinc-950/60 p-8 text-center">
      <Inbox className="h-7 w-7 text-zinc-600" />
      <div>
        <div className="text-sm font-semibold text-zinc-300">{title}</div>
        {detail ? <div className="mt-1 max-w-md text-xs leading-5 text-zinc-500">{detail}</div> : null}
      </div>
    </div>
  );
}
