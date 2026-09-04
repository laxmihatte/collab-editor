'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { clearLocalUser, getUser, isLoggedIn, saveAuth } from '@/lib/auth';
import { applyTheme } from '@/lib/theme';
import Avatar from '@/components/Avatar';
import type { AvatarColor, Profile, ProfileStats } from '@/lib/types';

const COLORS: AvatarColor[] = ['indigo', 'violet', 'sky', 'emerald', 'amber', 'rose', 'slate'];
const SWATCHES: Record<AvatarColor, string> = {
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  sky: 'bg-sky-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-500',
};

export default function ProfilePage() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    api
      .get('/api/profile/me')
      .then((res) => setProfile(res.data))
      .catch((err) => {
        if (err?.response?.status === 401) {
          clearLocalUser();
          router.replace('/login');
        } else {
          setError('Could not load your profile.');
        }
      });
    api.get('/api/profile/me/stats').then((res) => setStats(res.data)).catch(() => {});
  }, [router]);

  /**
   * Send one field at a time.
   *
   * The PATCH endpoint treats an omitted field as "leave it alone", so a
   * single-field save cannot overwrite a change made in another tab — and the
   * appearance controls can apply instantly without a Save button.
   */
  async function save(changes: Partial<Profile>) {
    setSaving(true);
    setError('');
    try {
      const res = await api.patch('/api/profile/me', changes);
      setProfile(res.data);

      // Keep the cached user in step so avatars elsewhere update without a
      // reload; the cookie, not this, is what authenticates.
      const user = getUser();
      if (user) saveAuth({ ...user, name: res.data.name, avatar_color: res.data.avatar_color });
      if (changes.theme) applyTheme(res.data.theme);

      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Could not save that change.'
      );
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center text-neutral-400">
        {error || 'Loading…'}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-6 py-3">
          <Link
            href="/notes"
            className="text-sm text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            ← Notes
          </Link>
          <h1 className="font-semibold text-neutral-900 dark:text-neutral-100">Your profile</h1>
          <span className="ml-auto text-xs text-neutral-400">
            {saving ? 'Saving…' : saved ? 'Saved' : ''}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-8 px-6 py-8">
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            {error}
          </p>
        )}

        <section className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <Avatar name={profile.name} color={profile.avatar_color} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {profile.name}
            </p>
            <p className="truncate text-sm text-neutral-500">
              {profile.username ? `@${profile.username}` : profile.email}
            </p>
            {profile.school && (
              <p className="truncate text-xs text-neutral-400">
                {profile.school}
                {profile.grad_year ? ` · Class of ${profile.grad_year}` : ''}
              </p>
            )}
          </div>
        </section>

        {stats && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Notes" value={stats.notes_owned} />
            <Stat label="Shared with you" value={stats.notes_shared_with_me} />
            <Stat label="Collaborators" value={stats.collaborators} />
            <Stat label="Reactions" value={stats.reactions_received} />
          </section>
        )}

        <Card title="Details">
          <Field label="Display name">
            <input
              defaultValue={profile.name}
              onBlur={(e) => e.target.value !== profile.name && save({ name: e.target.value })}
              className={inputClass}
            />
          </Field>

          <Field label="Username" hint="Lowercase letters, numbers, and underscores.">
            <div className="flex items-center gap-1">
              <span className="text-sm text-neutral-400">@</span>
              <input
                defaultValue={profile.username ?? ''}
                onBlur={(e) =>
                  e.target.value !== (profile.username ?? '') &&
                  save({ username: e.target.value.trim().toLowerCase() })
                }
                placeholder="ada_lovelace"
                className={inputClass}
              />
            </div>
          </Field>

          <Field label="Bio" hint={`${profile.bio.length}/280`}>
            <textarea
              defaultValue={profile.bio}
              rows={3}
              maxLength={280}
              onBlur={(e) => e.target.value !== profile.bio && save({ bio: e.target.value })}
              placeholder="CS major. Currently deep in compilers."
              className={`${inputClass} resize-y`}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="School">
              <input
                defaultValue={profile.school ?? ''}
                onBlur={(e) =>
                  e.target.value !== (profile.school ?? '') && save({ school: e.target.value })
                }
                placeholder="Cornell University"
                className={inputClass}
              />
            </Field>
            <Field label="Graduation year">
              <input
                type="number"
                defaultValue={profile.grad_year ?? ''}
                onBlur={(e) => {
                  const value = e.target.value ? Number(e.target.value) : null;
                  if (value !== profile.grad_year) save({ grad_year: value });
                }}
                placeholder="2027"
                className={inputClass}
              />
            </Field>
          </div>
        </Card>

        <Card title="Appearance">
          <Field label="Avatar colour">
            <div className="flex flex-wrap gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => save({ avatar_color: color })}
                  aria-label={color}
                  className={`h-8 w-8 rounded-full ${SWATCHES[color]} transition-transform hover:scale-110 ${
                    profile.avatar_color === color
                      ? 'ring-2 ring-neutral-900 ring-offset-2 dark:ring-neutral-100 dark:ring-offset-neutral-900'
                      : ''
                  }`}
                />
              ))}
            </div>
          </Field>

          <Field label="Theme">
            <div className="flex overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
              {(['system', 'light', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  onClick={() => save({ theme })}
                  className={`px-3 py-1.5 text-sm capitalize transition-colors ${
                    profile.theme === theme
                      ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900'
                      : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
                  }`}
                >
                  {theme}
                </button>
              ))}
            </div>
          </Field>
        </Card>

        <p className="text-xs text-neutral-400">
          Signed in as {profile.email}. Changes save as you leave each field.
        </p>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-xs font-medium text-neutral-600 dark:text-neutral-400">
        {label}
        {hint && <span className="font-normal text-neutral-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 text-center dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
        {value}
      </p>
      <p className="text-[11px] text-neutral-500">{label}</p>
    </div>
  );
}
