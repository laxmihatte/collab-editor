# Collab Editor

A real-time collaborative document editor — multiple people can edit the same
document simultaneously and see each other's changes live, like Google Docs.

## Features

- ✍️ Rich text editing (headings, bold/italic, lists) with [Tiptap](https://tiptap.dev)
- 🔄 Real-time multi-user sync using [Yjs](https://yjs.dev) CRDTs over Socket.io
- 🔐 Authentication with httpOnly-cookie JWTs (register / login / logout)
- 👥 Document sharing with per-user viewer/editor permissions
- 💾 Documents persisted to PostgreSQL and restored on reload

## Tech stack

| Layer    | Technology                                  |
| -------- | ------------------------------------------- |
| Frontend | Next.js (App Router), React, Tailwind CSS   |
| Editor   | Tiptap + Yjs                                |
| Realtime | Socket.io                                   |
| Backend  | Node.js, Express                            |
| Database | PostgreSQL                                  |
| Auth     | JWT in httpOnly cookies, bcrypt             |

## Running locally

You need Node.js and PostgreSQL installed.

### 1. Database

```bash
createdb collab_editor
psql collab_editor < server/src/db/schema.sql
```

### 2. Server

```bash
cd server
cp .env.example .env   # then fill in DATABASE_URL and JWT_SECRET
npm install
npm run dev            # http://localhost:3001
```

### 3. Client

```bash
cd client
npm install
npm run dev            # http://localhost:3000
```

Open http://localhost:3000, register an account, and create a document. To see
the live collaboration, open the same document in a second browser window.

## Project structure

```
collab-editor/
├── client/   # Next.js frontend
└── server/   # Express + Socket.io backend
```
