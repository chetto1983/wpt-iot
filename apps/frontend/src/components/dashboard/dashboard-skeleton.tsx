'use client';

import { Skeleton } from '@/components/ui/skeleton';

export function DashboardSkeleton() {
  return (
    <div className="min-h-full bg-gradient-to-b from-background to-background/80 p-6 xl:p-8 space-y-6">
      {/* Header rail skeleton */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40 bg-muted" />
          <Skeleton className="h-4 w-56 bg-muted" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full bg-muted" />
          <Skeleton className="h-5 w-24 rounded-full bg-muted" />
          <Skeleton className="h-5 w-20 rounded-full bg-muted" />
        </div>
      </div>

      {/* Gauge grid skeleton */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={i}
            className="min-h-[180px] xl:min-h-[220px] rounded-xl shadow-lg shadow-black/20 bg-muted"
          />
        ))}
      </div>

      {/* Detail cards skeleton */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-[200px] rounded-xl shadow-lg shadow-black/20 bg-muted" />
        <Skeleton className="h-[200px] rounded-xl shadow-lg shadow-black/20 bg-muted" />
      </div>

      {/* Technical signals card skeleton */}
      <Skeleton className="h-[200px] rounded-xl shadow-lg shadow-black/20 bg-muted" />

      {/* Alarm panel skeleton */}
      <Skeleton className="h-[160px] w-full rounded-xl shadow-lg shadow-black/20 bg-muted" />
    </div>
  );
}
