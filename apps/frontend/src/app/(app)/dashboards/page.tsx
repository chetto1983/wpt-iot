'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { IDashboard } from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function DashboardsListPage() {
  const t = useTranslations('dashboards');
  const router = useRouter();
  const [dashboards, setDashboards] = useState<IDashboard[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboards = useCallback(async () => {
    try {
      const data = await apiFetch<IDashboard[]>('/dashboards');
      setDashboards(data);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboards();
  }, [fetchDashboards]);

  const handleCreate = useCallback(async () => {
    const name = window.prompt(t('nameLabel'), t('namePlaceholder'));
    if (!name?.trim()) return;

    try {
      const created = await apiFetch<IDashboard>('/dashboards', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      router.push(`/dashboards/${String(created.id)}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [t, router]);

  const handleDelete = useCallback(
    async (id: number) => {
      if (!window.confirm(t('confirmDelete'))) return;

      try {
        await apiFetch(`/dashboards/${String(id)}`, { method: 'DELETE' });
        setDashboards((prev) => prev.filter((d) => d.id !== id));
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [t],
  );

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('noDashboardsHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t('createNew')}
        </Button>
      </div>

      {dashboards.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <LayoutGrid className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm font-medium">{t('noDashboards')}</p>
            <p className="text-sm text-muted-foreground">
              {t('noDashboardsHint')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dashboards.map((dashboard) => (
            <Card key={dashboard.id}>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium">{dashboard.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {new Date(dashboard.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  {dashboard.isDefault && (
                    <span className="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Default
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() =>
                      router.push(`/dashboards/${String(dashboard.id)}`)
                    }
                  >
                    {t('open')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void handleDelete(dashboard.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
