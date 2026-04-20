'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { IDashboard } from '@wpt/types';
import { apiFetch } from '@/lib/api';
import { useAppLocale } from '@/lib/locale';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function DashboardsListPage() {
  const t = useTranslations('dashboards');
  const router = useRouter();
  const { formatDateTime } = useAppLocale();
  const [dashboards, setDashboards] = useState<IDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const fetchDashboards = useCallback(async () => {
    try {
      const data = await apiFetch<IDashboard[]>('/api/dashboards');
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

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = createName.trim();
      if (!name) return;

      setCreating(true);
      try {
        const created = await apiFetch<IDashboard>('/api/dashboards', {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        setCreateName('');
        router.push(`/dashboards/${String(created.id)}`);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setCreating(false);
      }
    },
    [createName, router],
  );

  const handleDelete = useCallback(
    async (dashId: number) => {
      try {
        await apiFetch(`/api/dashboards/${String(dashId)}`, { method: 'DELETE' });
        setDashboards((prev) => prev.filter((d) => d.id !== dashId));
        setDeleteId(null);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [],
  );

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t('title')}</h1>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 flex-1" />
                  <Skeleton className="h-8 w-8" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <form onSubmit={handleCreate} className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder={t('namePlaceholder')}
            className="w-full sm:w-48"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!createName.trim() || creating}
            className="w-full sm:w-auto"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t('createNew')}
          </Button>
        </form>
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
                      {formatDateTime(new Date(dashboard.createdAt))}
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
                    size="icon"
                    variant="ghost"
                    className="min-w-11 text-destructive hover:text-destructive"
                    aria-label={t('deleteDashboard.title')}
                    onClick={() => setDeleteId(dashboard.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteDashboard.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDashboard.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('deleteDashboard.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId !== null) void handleDelete(deleteId); }}
            >
              {t('deleteDashboard.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
