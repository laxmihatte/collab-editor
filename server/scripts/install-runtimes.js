/**
 * Installs the language runtimes the built-in compiler offers into Piston.
 *
 * Written in Node rather than as a shell script so it can run inside the API
 * container, which has neither bash nor curl — that container is the only
 * thing on the internal network that can reach Piston in production, since
 * Piston publishes no ports.
 *
 * Idempotent: re-installing an existing package is a no-op, so this is safe to
 * run on every deploy.
 *
 * Usage: PISTON_HOST=http://localhost:2000 node scripts/install-runtimes.js
 */

const HOST = process.env.PISTON_HOST || 'http://localhost:2000';

// Piston *packages* are not named after the languages they provide: `gcc`
// provides c and c++, `node` provides javascript. These are package names,
// from GET /api/v2/packages.
const PACKAGES = [
  ['python', '3.10.0'],
  ['node', '18.15.0'],
  ['typescript', '5.0.3'],
  ['gcc', '10.2.0'],
  ['java', '15.0.2'],
  ['go', '1.16.2'],
  ['rust', '1.68.2'],
];

const INSTALL_TIMEOUT_MS = 30 * 60 * 1000; // compilers are large downloads

async function waitForPiston() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${HOST}/api/v2/runtimes`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function main() {
  if (!(await waitForPiston())) {
    console.error(`Piston did not become reachable at ${HOST}`);
    process.exit(1);
  }

  let failed = 0;

  for (const [language, version] of PACKAGES) {
    process.stdout.write(`  ${language.padEnd(12)} ${version.padEnd(9)} ... `);
    try {
      const res = await fetch(`${HOST}/api/v2/packages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, version }),
        signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => ({}));

      if (body.language) console.log('installed');
      else if (/already installed/i.test(body.message ?? '')) console.log('already present');
      else {
        console.log(`FAILED: ${body.message ?? res.status}`);
        failed++;
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
  }

  const runtimes = await (await fetch(`${HOST}/api/v2/runtimes`)).json();
  console.log(`\nRuntimes available: ${runtimes.map((r) => `${r.language} ${r.version}`).join(', ')}`);

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('install failed:', err.message);
  process.exit(1);
});
