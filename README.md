# NoteCraft

Collaborative markdown notes for computer science students. Two people can type
in the same note at once, run the code blocks inside it, and react to each
other's work — with a live list of who is reading it right now.

## Features

- **Markdown editor** — CodeMirror 6 with per-language highlighting inside
  fenced code blocks, and a live preview beside it
- **Built-in compiler** — run any fenced block in eight languages, with stdin,
  in a sandbox this project hosts itself
- **Real-time collaboration** — Yjs CRDTs over Socket.io, with remote cursors
- **Viewer activity** — who is here now, who is typing, and who read it earlier
- **Reactions** — 👍 🔥 🤯 ❓ ✅ 🐛 on any note you can see
- **Sharing** — per-person viewer/editor roles, enforced on the API *and* the
  live connection
- **Search** — Postgres full-text over titles and bodies, plus course and tag
  filters
- **Profiles** — display name, username, bio, school, avatar colour, theme
- **Auth** — bcrypt and JWTs delivered as httpOnly cookies

## Tech stack

| Layer     | Technology                                     |
| --------- | ---------------------------------------------- |
| Frontend  | Next.js (App Router), React 19, Tailwind CSS 4  |
| Editor    | CodeMirror 6 + Yjs                             |
| Realtime  | Socket.io                                      |
| Backend   | Node.js, Express                               |
| Database  | PostgreSQL                                     |
| Execution | Self-hosted Piston in Docker                   |
| Auth      | JWT in httpOnly cookies, bcrypt                |

## How it works

**Note content is a CRDT, not a string.** Every note's body is a Yjs document.
Concurrent edits merge instead of overwriting, so two people typing in the same
paragraph both keep their work — there is no last-write-wins moment. The server
holds the live document in memory while anyone has it open, debounce-saves the
binary state to Postgres, and evicts it when the last person leaves.

**Search reads a plain-text mirror.** Postgres cannot read a CRDT, so each save
also writes a `content_text` column, indexed with a GIN full-text index. The
cost is that search reflects the last save rather than the last keystroke, which
is the right trade for a note-taking app.

**Permissions are enforced twice, on purpose.** The REST layer checks the
caller's role on every request. The socket layer resolves the role once when a
client joins a note and caches it, because re-querying Postgres on every
keystroke would put a database round trip in the editing hot path. Because that
cache exists, changing or revoking someone's access explicitly disconnects them
rather than waiting for them to reload.

**Code execution never touches the browser.** The editor posts to our own
`/api/execute`, which forwards to a Piston container. Keeping it server-side
puts execution behind our auth and our per-user rate limit, and means swapping
in a different execution backend is a change to one file.

## Running locally

You need Node.js, PostgreSQL, and Docker.

### 1. Database

```bash
createdb notecraft
psql notecraft < server/src/db/schema.sql
```

Upgrading an existing `collab_editor` database instead? Apply the migrations in
`server/src/db/migrations/` in order.

### 2. Code execution sandbox

```bash
docker compose up -d
./scripts/install-runtimes.sh    # downloads compilers; takes a few minutes
```

### 3. Server

```bash
cd server
cp .env.example .env    # fill in DATABASE_URL and JWT_SECRET
npm install
npm run dev             # http://localhost:3001
```

### 4. Client

```bash
cd client
npm install
npm run dev             # http://localhost:3000
```

Register an account and create a note. To see collaboration working, share it
with a second account and open it in another browser.

### 5. Demo data (optional)

```bash
cd server && node scripts/seed.js
```

Seeds three CS notes with runnable code blocks, shared between two accounts:

| Account | Password |
| ------- | -------- |
| `demo@notecraft.dev` | `demo-password` |
| `classmate@notecraft.dev` | `demo-password` |

Sign in as each in two different browsers, open the same note, and type.

## Tests

With the server running:

```bash
cd server
npm test
```

- `npm run test:api` — 48 assertions over the REST API, covering the
  authorization rules from both sides (a viewer is checked for what they *cannot*
  do, not only what they can)
- `npm run test:realtime` — drives real Socket.io clients to prove Yjs
  convergence under concurrent edits, that a viewer's writes are refused over
  the socket, that presence tracks joins and leaves, and that content survives
  every client disconnecting

## Project structure

```
notecraft/
├── client/            # Next.js frontend
│   ├── app/notes/     # library and the note editor
│   └── app/profile/
├── server/            # Express + Socket.io backend
│   └── src/
│       ├── db/        # schema and migrations
│       ├── lib/       # Yjs note store, presence
│       └── routes/
├── scripts/           # setup and API tests
└── docker-compose.yml # Piston sandbox
```
