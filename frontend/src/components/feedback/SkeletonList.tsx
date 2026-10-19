import { Skeleton } from '@/components/ui/skeleton';

export interface SkeletonListProps {
  rows?: number;
}

/** Skeleton com a forma exata da lista (código, categoria, status e prazo). */
export function SkeletonList({ rows = 8 }: SkeletonListProps) {
  return (
    <div data-testid="skeleton-list" aria-hidden="true" className="flex flex-col">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 border-b border-border border-l-2 border-l-border-strong px-3 py-3"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="ml-auto h-4 w-20 rounded-full" />
            <Skeleton className="h-3 w-14" />
          </div>
          <Skeleton className="h-3.5 w-2/3" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="ml-auto h-4 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
