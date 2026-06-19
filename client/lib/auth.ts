// Auth state helpers.
//
// The JWT now lives in an httpOnly cookie that JS cannot read, so it's never
// stored here. We keep only the (non-sensitive) user profile in localStorage
// as a convenience for rendering and as the client-side "am I logged in?"
// signal. The real enforcement is server-side: every request/socket validates
// the cookie, and a 401 means the session is actually gone.

import api from './api';

export interface User {
  id: string;
  email: string;
  name: string;
}

export function getUser(): User | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

/** Client-side hint only — the server is the source of truth. */
export function isLoggedIn(): boolean {
  return getUser() !== null;
}

export function saveAuth(user: User) {
  localStorage.setItem('user', JSON.stringify(user));
}

/** Clear local user state (does not touch the cookie). */
export function clearLocalUser() {
  localStorage.removeItem('user');
}

/** Log out: clear the server cookie, then drop local state. */
export async function logout() {
  try {
    await api.post('/api/auth/logout');
  } catch {
    // Even if the request fails, clear local state so the UI logs out.
  }
  clearLocalUser();
}
