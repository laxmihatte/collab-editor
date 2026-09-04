// Shapes returned by the API. Kept in one place so a server change that breaks
// the client shows up as a type error rather than as undefined at runtime.

export type Role = 'owner' | 'editor' | 'viewer';

export type AvatarColor =
  | 'indigo' | 'violet' | 'sky' | 'emerald' | 'amber' | 'rose' | 'slate';

export type Language =
  | 'python' | 'javascript' | 'typescript' | 'java' | 'c' | 'cpp' | 'go' | 'rust';

export interface Note {
  id: string;
  title: string;
  course: string | null;
  tags: string[];
  language: Language;
  is_public: boolean;
  owner_id: string;
  created_at: string;
  updated_at: string;
  is_owner?: boolean;
  excerpt?: string;
  role?: Role;
  owner_name?: string;
  owner_avatar_color?: AvatarColor;
}

export interface Collaborator {
  id: string;
  email: string;
  name: string;
  avatar_color: AvatarColor;
  role: Exclude<Role, 'owner'>;
}

export interface Reaction {
  emoji: string;
  count: number;
  reacted: boolean;
  names: string[];
}

/** Someone with the note open right now, streamed over the socket. */
export interface Viewer {
  userId: string;
  name: string;
  avatarColor: AvatarColor;
  role: Role;
  tabs: number;
  joinedAt: number;
  activeAt: number;
}

/** Someone who has opened the note at some point, from note_views. */
export interface PastViewer {
  id: string;
  name: string;
  avatar_color: AvatarColor;
  last_viewed_at: string;
  view_count: number;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  username: string | null;
  bio: string;
  school: string | null;
  grad_year: number | null;
  avatar_color: AvatarColor;
  theme: 'system' | 'light' | 'dark';
  created_at: string;
}

export interface ProfileStats {
  notes_owned: number;
  notes_shared_with_me: number;
  collaborators: number;
  reactions_received: number;
}

export interface ExecutionResult {
  language: Language;
  version: string;
  compile: { stdout: string; stderr: string; code: number } | null;
  run: { stdout: string; stderr: string; code: number | null; signal: string | null };
}

export const LANGUAGE_LABELS: Record<Language, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  go: 'Go',
  rust: 'Rust',
};

export const REACTION_PALETTE = ['👍', '🔥', '🤯', '❓', '✅', '🐛'] as const;
