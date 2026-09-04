const express = require('express');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

// Piston is a sandboxed code-execution service we run ourselves (see
// docker-compose.yml). The public instance became whitelist-only in February
// 2026, and self-hosting is better anyway: no shared quota, and the sandbox
// limits are ours to set.
//
// Calling it from the server rather than the browser is the point of this
// route. It keeps execution behind our own auth and rate limit, and means the
// browser never learns which backend we use — so swapping in Judge0 later is a
// change to this file alone.
const PISTON_URL = process.env.PISTON_URL || 'http://localhost:2000/api/v2/execute';

// Piston's language identifiers differ from the ones stored on notes.
const LANGUAGES = {
  python: { language: 'python', version: '3.10.0', file: 'main.py' },
  javascript: { language: 'javascript', version: '18.15.0', file: 'main.js' },
  typescript: { language: 'typescript', version: '5.0.3', file: 'main.ts' },
  java: { language: 'java', version: '15.0.2', file: 'Main.java' },
  c: { language: 'c', version: '10.2.0', file: 'main.c' },
  cpp: { language: 'c++', version: '10.2.0', file: 'main.cpp' },
  go: { language: 'go', version: '1.16.2', file: 'main.go' },
  rust: { language: 'rust', version: '1.68.2', file: 'main.rs' },
};

const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_STDIN_BYTES = 16 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

// Execution is the one expensive thing an authenticated user can trigger, and
// the upstream quota is shared across everyone. Cap it per user, not per IP —
// a campus network puts a whole class behind one address.
const executeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { error: 'Too many runs — wait a moment and try again' },
});

// GET /api/execute/languages — what the editor's language picker offers.
router.get('/languages', (req, res) => {
  res.json(Object.keys(LANGUAGES).map((id) => ({ id, version: LANGUAGES[id].version })));
});

// POST /api/execute — run a snippet and return its output.
router.post('/', executeLimiter, async (req, res) => {
  const { language, source, stdin } = req.body;

  const target = LANGUAGES[language];
  if (!target) return res.status(400).json({ error: 'Unsupported language' });
  if (typeof source !== 'string' || !source.trim()) {
    return res.status(400).json({ error: 'Nothing to run' });
  }
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) {
    return res.status(413).json({ error: 'Source is too large to run' });
  }
  if (stdin && Buffer.byteLength(String(stdin)) > MAX_STDIN_BYTES) {
    return res.status(413).json({ error: 'Input is too large' });
  }

  // AbortController bounds our own wait. Piston enforces its own CPU limit
  // inside the sandbox, but a hung *connection* would otherwise tie up this
  // request until Node's default socket timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(PISTON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        language: target.language,
        version: target.version,
        files: [{ name: target.file, content: source }],
        stdin: stdin ? String(stdin) : '',
        run_timeout: 10_000,
      }),
    });

    if (upstream.status === 429) {
      return res.status(503).json({ error: 'Execution service is busy — try again shortly' });
    }
    if (!upstream.ok) {
      console.error('piston error:', upstream.status, await upstream.text());
      return res.status(502).json({ error: 'Execution service unavailable' });
    }

    const result = await upstream.json();

    // Piston reports compilation and runtime as separate stages. Surfacing them
    // separately is what lets the UI say "your code did not compile" instead of
    // dumping a wall of text that looks like program output.
    res.json({
      language,
      version: result.version ?? target.version,
      compile: result.compile
        ? { stdout: result.compile.stdout, stderr: result.compile.stderr, code: result.compile.code }
        : null,
      run: {
        stdout: result.run?.stdout ?? '',
        stderr: result.run?.stderr ?? '',
        code: result.run?.code ?? null,
        // Set when the sandbox killed the process (timeout, OOM) rather than
        // it exiting on its own.
        signal: result.run?.signal ?? null,
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Execution timed out' });
    }
    console.error('execute error:', err.message);
    res.status(502).json({ error: 'Execution service unavailable' });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = { router, LANGUAGES };
