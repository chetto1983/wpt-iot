'use client';

interface MetricRowProps {
  label: string;
  value: string;
}

export function MetricRow({ label, value }: MetricRowProps) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-white/5 last:border-0">
      <span className="text-xs font-semibold text-white/40">{label}</span>
      <span className="text-sm text-white/80">{value}</span>
    </div>
  );
}
