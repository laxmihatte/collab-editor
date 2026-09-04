/**
 * Seeds a demo account with a few realistic CS notes.
 *
 * Note bodies have to be written as Yjs state, not as plain strings: the
 * `content` column holds a CRDT, and the editor hydrates from it. Building a
 * Y.Doc here and encoding it is the same path the server takes on every save,
 * which is why the seeded notes open like any other.
 *
 * Usage: node scripts/seed.js
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const Y = require('yjs');
const db = require('../src/db');

const DEMO = { email: 'demo@notecraft.dev', password: 'demo-password', name: 'Demo Student' };
const CLASSMATE = { email: 'classmate@notecraft.dev', password: 'demo-password', name: 'Sam Rivera' };

const NOTES = [
  {
    title: 'Dijkstra — shortest paths',
    course: 'CS 3110',
    tags: ['graphs', 'greedy'],
    language: 'python',
    body: `# Dijkstra's algorithm

Single-source shortest paths on a graph with **non-negative** edge weights.

## The idea

Keep a frontier of nodes whose distance is still provisional. Repeatedly take
the closest one, mark it final, and relax its edges.

The correctness argument is the part worth remembering: when a node is popped
with distance \`d\`, no shorter path can exist, because any other route leaves
through a frontier node that is already at least \`d\` away. **This is exactly
where negative weights break it** — a later negative edge could undercut a
distance we already called final.

## Complexity

| Structure   | Time |
| ----------- | ---- |
| Binary heap | O((V + E) log V) |
| Fibonacci heap | O(E + V log V) |

\`\`\`python
import heapq

def dijkstra(graph, source):
    dist = {node: float('inf') for node in graph}
    dist[source] = 0
    heap = [(0, source)]

    while heap:
        d, node = heapq.heappop(heap)
        if d > dist[node]:
            continue          # stale entry, already improved
        for neighbor, weight in graph[node]:
            candidate = d + weight
            if candidate < dist[neighbor]:
                dist[neighbor] = candidate
                heapq.heappush(heap, (candidate, neighbor))
    return dist

graph = {
    'A': [('B', 4), ('C', 2)],
    'B': [('D', 5)],
    'C': [('B', 1), ('D', 8)],
    'D': [],
}
print(dijkstra(graph, 'A'))
\`\`\`

We never decrease-key; we push duplicates and skip stale ones. Simpler, same
asymptotics with a binary heap.

- [ ] Re-derive the correctness proof without notes
- [x] Implement it once from scratch
`,
  },
  {
    title: 'Virtual memory and page tables',
    course: 'CS 3410',
    tags: ['os', 'memory'],
    language: 'c',
    body: `# Virtual memory

Every process sees its own flat address space. The MMU translates virtual
addresses to physical ones, one page at a time.

## Address breakdown

A 32-bit address with 4 KB pages splits into a 20-bit page number and a 12-bit
offset — 12 bits because 2^12 = 4096.

\`\`\`c
#include <stdio.h>

#define PAGE_BITS 12

int main(void) {
    unsigned int addr = 0xDEADBEEF;
    printf("page number: 0x%X\\n", addr >> PAGE_BITS);
    printf("offset:      0x%X\\n", addr & ((1u << PAGE_BITS) - 1));
    return 0;
}
\`\`\`

## Why multi-level tables

A flat table needs an entry per page whether or not it is mapped: 2^20 entries
× 4 bytes = 4 MB **per process**, mostly empty. A two-level table lets an entire
unmapped region be a single null pointer in the outer table.

> The TLB is what makes this affordable. Without it every memory access would
> need extra memory accesses just to translate the address.
`,
  },
  {
    title: 'Rust ownership — the borrow checker',
    course: 'CS 4110',
    tags: ['rust', 'types'],
    language: 'rust',
    body: `# Ownership

Three rules:

1. Every value has one owner.
2. There can be many immutable borrows **or** one mutable borrow, never both.
3. When the owner goes out of scope, the value is dropped.

Rule 2 is what eliminates data races at compile time: a race needs concurrent
access with at least one writer, and the type system makes that unrepresentable.

\`\`\`rust
fn main() {
    let mut scores = vec![88, 92, 79];

    // Immutable borrows can overlap freely.
    let first = &scores[0];
    let last = &scores[scores.len() - 1];
    println!("{first} … {last}");

    // The borrows above end here, so a mutable borrow is now allowed.
    scores.push(95);
    println!("{scores:?}");
}
\`\`\`

Moving \`scores.push\` above the \`println!\` fails to compile — the immutable
borrows are still live at that point.
`,
  },
];

async function upsertUser({ email, password, name }, extra = {}) {
  const hash = await bcrypt.hash(password, 12);
  const result = await db.query(
    `INSERT INTO users (email, password_hash, name, bio, school, grad_year, avatar_color)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name
     RETURNING id, email, name`,
    [
      email,
      hash,
      name,
      extra.bio ?? '',
      extra.school ?? null,
      extra.grad_year ?? null,
      extra.avatar_color ?? 'indigo',
    ]
  );
  return result.rows[0];
}

/** Encode a markdown string as Yjs state, exactly as a save would. */
function encode(markdown) {
  const ydoc = new Y.Doc();
  ydoc.getText('content').insert(0, markdown);
  return Buffer.from(Y.encodeStateAsUpdate(ydoc));
}

async function main() {
  const demo = await upsertUser(DEMO, {
    bio: 'CS major. Currently deep in algorithms and systems.',
    school: 'Cornell University',
    grad_year: 2027,
    avatar_color: 'indigo',
  });
  const classmate = await upsertUser(CLASSMATE, { avatar_color: 'emerald' });

  // Start clean so re-running does not pile up duplicates.
  await db.query('DELETE FROM notes WHERE owner_id = $1', [demo.id]);

  for (const note of NOTES) {
    const result = await db.query(
      `INSERT INTO notes (title, content, content_text, course, tags, language, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        note.title,
        encode(note.body),
        note.body,
        note.course,
        note.tags,
        note.language,
        demo.id,
      ]
    );
    const noteId = result.rows[0].id;

    await db.query(
      `INSERT INTO note_permissions (note_id, user_id, role) VALUES ($1, $2, 'editor')
       ON CONFLICT DO NOTHING`,
      [noteId, classmate.id]
    );
    await db.query(
      `INSERT INTO reactions (note_id, user_id, emoji) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [noteId, classmate.id, '🔥']
    );
    await db.query(
      `INSERT INTO note_views (note_id, user_id, view_count) VALUES ($1, $2, 3)
       ON CONFLICT DO NOTHING`,
      [noteId, classmate.id]
    );
  }

  console.log(`Seeded ${NOTES.length} notes.`);
  console.log(`  Sign in as ${DEMO.email} / ${DEMO.password}`);
  console.log(`  Collaborator: ${CLASSMATE.email} / ${CLASSMATE.password}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('seed failed:', err.message);
  process.exit(1);
});
