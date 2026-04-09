'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, MoreHorizontal, Pencil, Trash2, KeyRound, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { UserDialog } from '@/components/user-dialog';
import { DeleteDialog } from '@/components/delete-dialog';
import { PasswordDialog } from '@/components/password-dialog';

interface UserRow {
  id: number;
  username: string;
  role: string;
  createdAt: string;
}

function roleBadgeVariant(role: string): 'default' | 'secondary' {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'default';
    default:
      return 'secondary';
  }
}

function roleBadgeClassName(role: string): string {
  switch (role) {
    case 'WPT':
      return 'bg-wpt-gold text-white hover:bg-wpt-gold/80';
    case 'CLIENT':
      return 'bg-muted text-muted-foreground';
    default:
      return '';
  }
}

export function UserTable() {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserRow | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserRow | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await apiFetch<UserRow[]>('/users');
      setUsers(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon('error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const refreshUsers = useCallback(() => {
    void fetchUsers();
  }, [fetchUsers]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">{t('heading')}</h1>
        <Button onClick={() => setCreateOpen(true)} className="w-full sm:w-auto">
          <UserPlus className="size-4" />
          {t('createUser')}
        </Button>
      </div>

      {/* Table or empty state */}
      {users.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <h3 className="text-lg font-medium">{t('empty.heading')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('empty.body')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:hidden">
            {users.map((row) => (
              <div key={row.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.username}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('table.created')}: {new Date(row.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge
                    variant={roleBadgeVariant(row.role)}
                    className={cn(roleBadgeClassName(row.role))}
                  >
                    {tCommon(`roles.${row.role}`)}
                  </Badge>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setEditingUser(row)}
                  >
                    <Pencil className="size-4" />
                    {t('actions.edit')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setPasswordUser(row)}
                  >
                    <KeyRound className="size-4" />
                    {t('actions.changePassword')}
                  </Button>
                  {currentUser && row.id !== currentUser.id ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => setDeletingUser(row)}
                    >
                      <Trash2 className="size-4" />
                      {t('actions.delete')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden rounded-lg border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('table.username')}</TableHead>
                  <TableHead>{t('table.role')}</TableHead>
                  <TableHead>{t('table.created')}</TableHead>
                  <TableHead className="w-12">{t('table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.username}</TableCell>
                    <TableCell>
                      <Badge
                        variant={roleBadgeVariant(row.role)}
                        className={cn(roleBadgeClassName(row.role))}
                      >
                        {tCommon(`roles.${row.role}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="size-4" />
                              <span className="sr-only">{t('table.actions')}</span>
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditingUser(row)}>
                            <Pencil className="size-4" />
                            {t('actions.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setPasswordUser(row)}>
                            <KeyRound className="size-4" />
                            {t('actions.changePassword')}
                          </DropdownMenuItem>
                          {currentUser && row.id !== currentUser.id ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDeletingUser(row)}
                              >
                                <Trash2 className="size-4" />
                                {t('actions.delete')}
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Create / Edit dialog */}
      <UserDialog
        open={createOpen || editingUser !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setCreateOpen(false);
            setEditingUser(null);
          }
        }}
        user={editingUser}
        onSuccess={refreshUsers}
      />

      {/* Delete confirmation dialog */}
      <DeleteDialog
        open={deletingUser !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDeletingUser(null);
        }}
        user={deletingUser}
        onSuccess={refreshUsers}
      />

      {/* Password reset dialog (SuperAdmin resetting another user) */}
      <PasswordDialog
        open={passwordUser !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPasswordUser(null);
        }}
        user={passwordUser}
        onSuccess={refreshUsers}
      />
    </div>
  );
}
