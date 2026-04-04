'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/password-input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';

const LANGUAGES = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
] as const;

export function LoginForm() {
  const t = useTranslations('login');
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState(() => {
    // Read current locale from cookie
    if (typeof document !== 'undefined') {
      const match = document.cookie.match(/NEXT_LOCALE=(\w+)/);
      return match?.[1] ?? 'it';
    }
    return 'it';
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // If already logged in, redirect to dashboard
  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  // Check for ?expired=true on mount
  useEffect(() => {
    if (searchParams.get('expired') === 'true') {
      setError(t('errors.expired'));
    }
  }, [searchParams, t]);

  // Clear error when user types
  const handleUsernameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setUsername(e.target.value);
      setError('');
    },
    [],
  );

  const handlePasswordChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPassword(e.target.value);
      setError('');
    },
    [],
  );

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const lang = e.target.value;
      setLanguage(lang);
      // Set cookie immediately so next-intl picks it up
      document.cookie = `NEXT_LOCALE=${lang};path=/;max-age=31536000`;
      // Refresh to re-render labels in new language without full page reload
      router.refresh();
    },
    [router],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setSubmitting(true);

      try {
        await login(username, password, language);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('credentials') || msg.includes('401')) {
          setError(t('errors.invalid'));
        } else {
          setError(t('errors.server'));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [login, username, password, language, t],
  );

  // Show nothing while checking session (brief flash guard)
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Already logged in — redirecting
  if (user) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center space-y-3 pb-2">
          <Image
            src="/logo.png"
            alt="WPT"
            width={120}
            height={120}
            priority
          />
          <h1 className="text-xl font-semibold leading-tight">
            {t('subtitle')}
          </h1>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t('username')}</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={handleUsernameChange}
                disabled={submitting}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('password')}</Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={handlePasswordChange}
                disabled={submitting}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="language">{t('language')}</Label>
              <select
                id="language"
                value={language}
                onChange={handleLanguageChange}
                disabled={submitting}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button
              type="submit"
              disabled={submitting}
              className="h-11 w-full"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('signIn')}
            </Button>

            {error ? (
              <p className="text-center text-sm text-destructive">{error}</p>
            ) : null}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
