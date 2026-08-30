#!/usr/bin/env node
/**
 * Import OpenSky OAuth client credentials, on any platform.
 *
 * The bash original stored them in the macOS Keychain and hard-failed
 * everywhere else. There is no portable equivalent of the Keychain — Windows
 * Credential Manager has no supported read path for arbitrary secrets from a
 * CLI, and Linux desktops vary — so this keeps the Keychain on macOS and
 * writes to the project's `.env` elsewhere.
 *
 * That difference is stated plainly rather than papered over: `.env` is a file
 * on disk, gitignored but not encrypted, and the tool says so when it uses it.
 *
 * Usage:
 *   node scripts/opensky-import-client.mjs /path/to/credentials.json
 *   npm run opensky:import -- /path/to/credentials.json
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readOpenSkyCredentialsFile, REPO_ROOT, hasKeychain, parseDotEnv } from './lib/secrets.mjs';

const ROOT = REPO_ROOT;
const credentialsPath = process.argv[2] || process.env.OPENSKY_CREDENTIALS_FILE || '';

if (!credentialsPath) {
  console.error('usage: node scripts/opensky-import-client.mjs /path/to/credentials.json');
  console.error('   or: set OPENSKY_CREDENTIALS_FILE and run it with no argument');
  process.exit(1);
}

const resolved = path.resolve(credentialsPath);
if (!fs.existsSync(resolved)) {
  console.error(`error: credentials file not found: ${resolved}`);
  process.exit(1);
}

const { clientId, clientSecret } = readOpenSkyCredentialsFile(resolved);
if (!clientId || !clientSecret) {
  console.error(`error: could not read clientId/clientSecret from ${resolved}`);
  console.error('  Expected JSON with clientId/clientSecret (or client_id/client_secret).');
  process.exit(1);
}

if (hasKeychain()) {
  const store = (account, value) => spawnSync('security', [
    'add-generic-password', '-U', '-s', 'opensky-network', '-a', account, '-w', value,
  ], { stdio: 'ignore' });
  const idResult = store('client_id', clientId);
  const secretResult = store('client_secret', clientSecret);
  if (idResult.status !== 0 || secretResult.status !== 0) {
    console.error('error: failed to write to the macOS Keychain');
    process.exit(1);
  }
  console.log('OpenSky OAuth client credentials stored in Keychain:');
  console.log('  service=opensky-network account=client_id');
  console.log('  service=opensky-network account=client_secret');
  process.exit(0);
}

// No OS secret store to use — merge into .env, preserving everything else in it.
const envPath = path.join(ROOT, '.env');
let existingText = '';
try {
  existingText = fs.readFileSync(envPath, 'utf8');
} catch { /* creating a new .env */ }

const existing = parseDotEnv(existingText);
const updates = { OPENSKY_CLIENT_ID: clientId, OPENSKY_CLIENT_SECRET: clientSecret };

// Rewrite in place where the key already exists so ordering and comments in a
// hand-edited .env survive; append only genuinely new keys.
// Trailing blank lines are stripped before append so a file that ended with a
// newline does not gain an empty line before each new key.
const lines = existingText ? existingText.replace(/[\r\n]+$/, '').split(/\r?\n/) : [];
const written = new Set();
for (let i = 0; i < lines.length; i += 1) {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(lines[i]);
  const key = match?.[1];
  if (key && updates[key] !== undefined) {
    lines[i] = `${key}=${updates[key]}`;
    written.add(key);
  }
}
for (const [key, value] of Object.entries(updates)) {
  if (!written.has(key)) lines.push(`${key}=${value}`);
}
// Keep exactly one trailing newline regardless of how the file arrived.
const output = `${lines.join('\n').replace(/\n+$/, '')}\n`;

try {
  fs.writeFileSync(envPath, output, { encoding: 'utf8', mode: 0o600 });
  // writeFileSync's mode applies only when it CREATES the file, so an existing
  // .env would silently keep whatever permissions it had (typically 0644 —
  // world-readable, holding an API secret). Tighten it explicitly. Windows has
  // no POSIX mode bits, so the failure there is expected and ignored.
  if (process.platform !== 'win32') {
    try { fs.chmodSync(envPath, 0o600); } catch { /* best effort */ }
  }
} catch (error) {
  console.error(`error: could not write ${envPath} (${error?.message || error})`);
  process.exit(1);
}

const replaced = Object.keys(updates).filter((key) => existing[key] !== undefined);
console.log(`OpenSky OAuth client credentials written to ${envPath}`);
console.log('  OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET'
  + (replaced.length ? ` (replaced ${replaced.length} existing value(s))` : ''));
console.log('');
console.log('  Note: this platform has no OS secret store this tool can use, so the');
console.log('  credentials are in a plain file. .env is gitignored but NOT encrypted —');
console.log('  treat it like any other file holding a secret.');
