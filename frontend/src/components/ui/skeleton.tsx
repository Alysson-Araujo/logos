import { cn } from '@/lib/utils';

export interface SkeletonProps {
  className?: string;
}

/** Bloco de carregamento com a forma do conteúdo real (nada de spinner no vazio). */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('block animate-pulse rounded-sm bg-surface-sunken', className)}
    />
  );
}
