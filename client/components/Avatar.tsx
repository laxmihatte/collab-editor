import type { AvatarColor } from '@/lib/types';

// Tailwind scans source files for complete class strings, so the colour classes
// have to appear literally. Building them as `bg-${color}-500` would produce
// classes that are correct at runtime but absent from the generated CSS.
const COLORS: Record<AvatarColor, string> = {
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  sky: 'bg-sky-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-500',
};

const SIZES = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-16 h-16 text-xl',
};

/** First letter of the first two words: "Ada Lovelace" → "AL". */
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function Avatar({
  name,
  color = 'slate',
  size = 'sm',
  ring = false,
  title,
}: {
  name: string;
  color?: AvatarColor;
  size?: keyof typeof SIZES;
  /** Draws a halo — used to mark someone who is actively typing. */
  ring?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title ?? name}
      className={`${COLORS[color] ?? COLORS.slate} ${SIZES[size]} ${
        ring ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-white dark:ring-offset-neutral-900' : ''
      } inline-flex items-center justify-center rounded-full font-semibold text-white select-none shrink-0`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
