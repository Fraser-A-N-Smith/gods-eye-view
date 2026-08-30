#!/usr/bin/env node
/**
 * Cross-platform dev launcher.
 *
 * This is the portable equivalent of `scripts/dev-secure.sh`. The bash version
 * cannot run on Windows at all — no bash, no `security` CLI — which made
 * `npm run dev:secure` a macOS/Linux-only entry point in a project whose only
 * hard requirement is Node. This does the same job in Node: resolve the keys,
 * report where each came from without ever printing one, and hand a fully
 * populated environment to Vite.
 *
 * The `.sh` scripts are kept. `dev-fresh.sh` in particular does more than this
 * (Vite cache clearing, richer Keychain sweeps) and remains the documented
 * macOS shortcut; this is what everyone else — and CI — can run.
 *
 * Usage:
 *   npm run dev:secure
 *   HOST=0.0.0.0 PORT=4173 npm run dev:secure     (macOS/Linux)
 *   $env:PORT=4173; npm run dev:secure            (PowerShell)
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  readDotEnv,
  resolveSecret,
  resolveOpenSkyCredentials,
  REPO_ROOT,
  hasKeychain,
  KEYCHAIN_LOOKUPS,
  OPTIONAL_SECRET_NAMES,
} from './lib/secrets.mjs';

const ROOT = REPO_ROOT;
const dotEnv = readDotEnv(path.join(ROOT, '.env'));

const PORT = process.env.PORT || '4173';
// Local-only by default. Binding to 0.0.0.0 brokers every configured key to
// anyone who can reach the port, so it stays an explicit opt-in.
const HOST = process.env.HOST || 'localhost';

const google = resolveSecret({
  name: 'GOOGLE_MAPS_API_KEY',
  dotEnv,
  keychain: KEYCHAIN_LOOKUPS.GOOGLE_MAPS_API_KEY,
});

if (!google.value) {
  console.error('error: Google Maps API key missing.');
  console.error('  Set GOOGLE_MAPS_API_KEY in your environment, or put it in .env');
  if (hasKeychain()) {
    console.error('  ...or add a Keychain item: service=google-maps-api account=api-key');
  }
  process.exit(1);
}

const openSky = resolveOpenSkyCredentials({ dotEnv });
if (openSky.warning) console.warn(`warning: ${openSky.warning}`);

const childEnv = {
  ...process.env,
  GOOGLE_MAPS_API_KEY: google.value,
  CCTV_AUSTIN_MAX_SOURCES: process.env.CCTV_AUSTIN_MAX_SOURCES || '36',
  CCTV_MAX_SOURCES: process.env.CCTV_MAX_SOURCES || '48',
  ...openSky.credentials,
};

// Optional keys are forwarded when they can be found, and simply absent when
// they cannot — every one of them has a documented keyless degradation.
const optionalSources = [];
for (const name of OPTIONAL_SECRET_NAMES) {
  const resolved = resolveSecret({ name, dotEnv, keychain: KEYCHAIN_LOOKUPS[name] || [] });
  if (resolved.value) {
    childEnv[name] = resolved.value;
    optionalSources.push(`${name} (${resolved.source})`);
  }
}

console.log("Starting God's Eye View dev server...");
console.log(`  URL:            http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
console.log(`  Google Maps key: ${google.source}`);
console.log(`  OpenSky:         ${openSky.mode} — ${openSky.summary}`);
console.log(`  Optional keys:   ${optionalSources.length ? optionalSources.join(', ') : 'none configured'}`);
if (HOST === '0.0.0.0' || HOST === '::') {
  console.warn('  WARNING: bound to all interfaces — anyone who can reach this port can spend your API keys.');
  console.warn('           See SECURITY.md and the GEV_RATELIMIT_* settings in .env.example.');
}

// Resolve Vite's own entry through Node rather than invoking the `vite` shim.
// On Windows the shim is `vite.cmd`, which plain spawn() cannot execute without
// a shell — and putting a shell in the path would mean quoting user-supplied
// host/port values into a command line. Running the JS directly avoids both.
const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const args = [viteBin, '--host', HOST, '--port', String(PORT)];

const child = spawn(process.execPath, args, {
  cwd: ROOT,
  env: childEnv,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`error: could not start Vite (${error?.message || error})`);
  console.error('  Did you run `npm install`?');
  process.exit(1);
});

// Forward interactive signals so Ctrl-C stops the server rather than orphaning
// it. SIGINT only on Windows — SIGTERM/SIGHUP are not raised there.
const signals = process.platform === 'win32' ? ['SIGINT'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
for (const signal of signals) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
