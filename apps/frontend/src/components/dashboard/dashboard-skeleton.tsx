'use client';

import { Skeleton } from '@/components/ui/skeleton';

export function DashboardSkeleton() {
  return (
    <div className="min-h-full bg-[#282828] p-6 xl:p-8">
      {/* Header rail skeleton */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40 bg-[#383838]" />
          <Skeleton className="h-4 w-56 bg-[#383838]" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full bg-[#383838]" />
          <Skeleton className="h-5 w-24 rounded-full bg-[#383838]" />
          <Skeleton className="h-5 w-20 rounded-full bg-[#383838]" />
        </div>
      </div>

      {/* Gauge grid skeleton */}
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-[180px] rounded-xl bg-[#383838] md:h-[220px]"
          />
        ))}
      </div>

      {/* Detail cards skeleton */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-[200px] rounded-xl bg-[#383838]" />
        <Skeleton className="h-[200px] rounded-xl bg-[#383838]" />
      </div>

      {/* Alarm panel skeleton */}
      <Skeleton className="mt-6 h-[160px] w-full rounded-xl bg-[#383838]" />
    </div>
  );
}
