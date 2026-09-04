export type Theme = 'system' | 'light' | 'dark';

/**
 * Apply a theme to the document.
 *
 * "system" removes the class entirely rather than resolving it to light or
 * dark, so the page keeps following the OS setting if the user changes it
 * while the tab is open.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const prefersDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  root.classList.toggle('dark', prefersDark);
  localStorage.setItem('theme', theme);
}

export function storedTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const value = localStorage.getItem('theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}
