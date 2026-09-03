/**
 * @module scripts/lib/secrets
 * @description Cross-platform key resolution for the dev launchers.
 *
 * The bash launchers (`scripts/dev-secure.sh`, `scripts/dev-fresh.sh`) read
 * secrets from the macOS Keychain and fall back to the environment. That is a
 * good default on a Mac and completely unavailable on Windows, where those
 * scripts cannot run at all. This module reimplements the same precedence in
 * portable Node so `npm run dev:secure` works on every platform the project
 * supports, and it keeps the platform-specific part behind one seam.
 *
 * ## Precedence, and why it is this way round
 *
 * An explicit environment variable wins over everything. That is a change from
 * `dev-secure.sh`, which preferred the Keychain over the environment — a
 * surprising order, because it means `GOOGLE_MAPS_API_KEY=... npm run
 * dev:secure` silently used a *different* key than the one the operator just
 * typed. Explicit intent should not be quietly overridden, so the order here
 * is: explicit env → OS secret store → .env file.
 *
 * `.env` sits last because Vite loads it anyway; it is consulted only so the
 * launcher can report honestly whether a key will be present at all, rather
 * than starting a server that fails a minute later on a blank globe.
 *
 * No secret value is ever logged. `describeSource()` returns where a value
 * came from, never what it is.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/** True on platforms with a macOS-style `security` CLI. */
export function hasKeychain(platform = process.platform) {
  return platform === 'darwin';
}

/**
 * Parse a .env file body.
 *
 * Intentionally small: `KEY=value`, `#` comments, optional `export ` prefix,
 * and surrounding single or double quotes. It is not a full dotenv
 * implementation because Vite already owns that at runtime — this only needs
 * to be good enough to answer "is a key configured".
 *
 * @param {string} text File contents.
 * @returns {Object<string, string>} Parsed pairs.
 */
export function parseDotEnv(text) {
  const out = {};
  if (typeof text !== 'string') return out;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Read and parse a .env file, returning {} when it is absent.
 * @param {string} filePath Path to the .env file.
 * @param {object} [deps]
 * @returns {Object<string, string>}
 */
export function readDotEnv(filePath, { readFile = null } = {}) {
  try {
    const read = readFile || ((p) => fs.readFileSync(p, 'utf8'));
    return parseDotEnv(read(filePath));
  } catch {
    return {};
  }
}

/**
 * Look one secret up in the macOS Keychain.
 *
 * Returns null on every non-macOS platform and on every failure, so callers
 * never need to branch on the platform themselves.
 *
 * @param {string} service Keychain service name.
 * @param {string} account Keychain account name.
 * @param {object} [deps]
 * @returns {string|null}
 */
export function keychainSecret(service, account, { platform = process.platform, run = null } = {}) {
  if (!hasKeychain(platform)) return null;
  const exec = run || ((cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }));
  try {
    const result = exec('security', ['find-generic-password', '-s', service, '-a', account, '-w']);
    if (result?.status !== 0) return null;
    const value = String(result.stdout ?? '').trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Resolve one secret across all available sources.
 *
 * @param {object} options
 * @param {string} options.name Environment variable name.
 * @param {Object<string,string>} [options.env] Environment to read.
 * @param {Object<string,string>} [options.dotEnv] Parsed .env contents.
 * @param {Array<{service:string, account:string}>} [options.keychain] Lookups to try, in order.
 * @param {string} [options.platform] Platform id.
 * @param {Function} [options.run] Command runner seam.
 * @returns {{value: string|null, source: string|null}}
 */
export function resolveSecret({
  name,
  env = process.env,
  dotEnv = {},
  keychain = [],
  platform = process.platform,
  run = null,
}) {
  const explicit = String(env?.[name] ?? '').trim();
  if (explicit) return { value: explicit, source: 'env' };

  for (const entry of keychain) {
    const value = keychainSecret(entry.service, entry.account, { platform, run });
    if (value) return { value, source: `keychain:${entry.service}/${entry.account}` };
  }

  const fromFile = String(dotEnv?.[name] ?? '').trim();
  if (fromFile) return { value: fromFile, source: '.env' };

  return { value: null, source: null };
}

/** Keychain lookups per secret, mirroring the account names in .env.example. */
export const KEYCHAIN_LOOKUPS = Object.freeze({
  GOOGLE_MAPS_API_KEY: [
    { service: 'google-maps-api', account: 'api-key' },
    { service: 'google-maps-api', account: 'default' },
    { service: 'google-maps-api', account: 'key' },
  ],
  OPENSKY_CLIENT_ID: [
    { service: 'opensky-network', account: 'client_id' },
    { service: 'opensky-network', account: 'client-id' },
    { service: 'opensky', account: 'client_id' },
  ],
  OPENSKY_CLIENT_SECRET: [
    { service: 'opensky-network', account: 'client_secret' },
    { service: 'opensky-network', account: 'client-secret' },
    { service: 'opensky', account: 'client_secret' },
  ],
  OPENSKY_USERNAME: [
    { service: 'opensky-network', account: 'username' },
    { service: 'opensky', account: 'username' },
  ],
  OPENSKY_PASSWORD: [
    { service: 'opensky-network', account: 'password' },
    { service: 'opensky', account: 'password' },
  ],
});

/**
 * Optional secrets the launcher forwards when it can find them.
 *
 * Every name here must match the variable the corresponding proxy actually
 * reads in vite.config.js. A near-miss does not fail loudly — Vite's own
 * loadEnv still picks the real name up out of .env, so the feature keeps
 * working while the launcher's "Optional keys" line silently never reports it.
 * `secrets.test.mjs` pins these against vite.config.js so the drift is caught.
 */
export const OPTIONAL_SECRET_NAMES = Object.freeze([
  'CESIUM_ION_TOKEN',
  'OPENAI_API_KEY',
  'AISSTREAM_API_KEY',
  'FIRMS_MAP_KEY',
  'TOMTOM_API_KEY',
  'LL2_API_TOKEN',
  'COPERNICUS_CLIENT_ID',
  'COPERNICUS_CLIENT_SECRET',
  'COPERNICUS_INSTANCE_ID',
  'GFW_API_TOKEN',
]);

/** Valid OpenSky auth modes. */
export const OPENSKY_AUTH_MODES = Object.freeze(['basic', 'oauth', 'auto', 'anon']);

/**
 * Normalize the requested OpenSky auth mode.
 * @param {string} value Raw mode.
 * @returns {{mode: string, warning: string|null}}
 */
export function normalizeAuthMode(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return { mode: 'oauth', warning: null };
  if (OPENSKY_AUTH_MODES.includes(raw)) return { mode: raw, warning: null };
  return { mode: 'oauth', warning: `invalid OPENSKY_AUTH_MODE='${raw}', defaulting to 'oauth'` };
}

/**
 * Read OAuth client credentials out of an OpenSky credentials JSON file.
 * @param {string} filePath Path to the downloaded credentials file.
 * @param {object} [deps]
 * @returns {{clientId: string|null, clientSecret: string|null}}
 */
export function readOpenSkyCredentialsFile(filePath, { readFile = null } = {}) {
  if (!filePath) return { clientId: null, clientSecret: null };
  try {
    const read = readFile || ((p) => fs.readFileSync(p, 'utf8'));
    const raw = JSON.parse(read(filePath));
    const clientId = String(raw?.clientId ?? raw?.client_id ?? '').trim() || null;
    const clientSecret = String(raw?.clientSecret ?? raw?.client_secret ?? '').trim() || null;
    return { clientId, clientSecret };
  } catch {
    return { clientId: null, clientSecret: null };
  }
}

/**
 * Resolve the full OpenSky credential set for a given auth mode.
 *
 * Credentials outside the selected mode are cleared rather than forwarded:
 * shipping a username into an OAuth run would let the proxy silently pick an
 * auth path the operator did not choose.
 *
 * @param {object} options
 * @returns {{mode:string, warning:string|null, credentials:Object<string,string>, configured:boolean, summary:string}}
 */
export function resolveOpenSkyCredentials({
  env = process.env,
  dotEnv = {},
  platform = process.platform,
  run = null,
  readFile = null,
} = {}) {
  const { mode, warning } = normalizeAuthMode(env?.OPENSKY_AUTH_MODE ?? dotEnv?.OPENSKY_AUTH_MODE);
  const credentialsFile = String(env?.OPENSKY_CREDENTIALS_FILE ?? dotEnv?.OPENSKY_CREDENTIALS_FILE ?? '').trim();

  const pick = (name) => resolveSecret({
    name, env, dotEnv, keychain: KEYCHAIN_LOOKUPS[name] || [], platform, run,
  }).value;

  const credentials = {};
  if (mode === 'anon') {
    return {
      mode,
      warning,
      credentials: { OPENSKY_AUTH_MODE: mode },
      configured: true,
      summary: 'anonymous mode — no credentials used',
    };
  }

  if (mode === 'basic' || mode === 'auto') {
    const username = pick('OPENSKY_USERNAME');
    const password = pick('OPENSKY_PASSWORD');
    if (username) credentials.OPENSKY_USERNAME = username;
    if (password) credentials.OPENSKY_PASSWORD = password;
  }

  if (mode === 'oauth' || mode === 'auto') {
    let clientId = pick('OPENSKY_CLIENT_ID');
    let clientSecret = pick('OPENSKY_CLIENT_SECRET');
    if ((!clientId || !clientSecret) && credentialsFile) {
      const fromFile = readOpenSkyCredentialsFile(credentialsFile, { readFile });
      clientId = clientId || fromFile.clientId;
      clientSecret = clientSecret || fromFile.clientSecret;
    }
    if (clientId) credentials.OPENSKY_CLIENT_ID = clientId;
    if (clientSecret) credentials.OPENSKY_CLIENT_SECRET = clientSecret;
  }

  credentials.OPENSKY_AUTH_MODE = mode;
  if (credentialsFile) credentials.OPENSKY_CREDENTIALS_FILE = credentialsFile;

  const hasOauth = Boolean(credentials.OPENSKY_CLIENT_ID && credentials.OPENSKY_CLIENT_SECRET);
  const hasBasic = Boolean(credentials.OPENSKY_USERNAME && credentials.OPENSKY_PASSWORD);
  let configured = false;
  let summary = '';
  if (mode === 'oauth') {
    configured = hasOauth;
    summary = hasOauth ? 'OAuth configured' : 'missing client credentials';
  } else if (mode === 'basic') {
    configured = hasBasic;
    summary = hasBasic ? 'basic auth configured' : 'missing credentials';
  } else {
    configured = hasOauth || hasBasic;
    summary = hasOauth ? 'OAuth configured' : (hasBasic ? 'basic configured' : 'no credentials found');
  }

  return { mode, warning, credentials, configured, summary };
}

/**
 * Absolute repository root.
 *
 * Derived from THIS module's own location rather than from a caller-supplied
 * URL. The earlier caller-supplied form took an "up two levels" that is only
 * correct for modules inside `scripts/lib/`; called from `scripts/` it
 * resolved one directory above the repository, and the credential importer
 * duly wrote a .env outside the project. A constant cannot be called from the
 * wrong depth.
 *
 * `fileURLToPath` is required, never `new URL(...).pathname`: on Windows the
 * latter yields `/C:/Users/...`, a leading-slash path that every later
 * `path.join` builds on and no `fs` call can open.
 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Repository root for a module at a known depth below it.
 * @param {string} moduleUrl An `import.meta.url`.
 * @param {number} [levelsUp] Directories between that module and the root.
 * @returns {string} Absolute path.
 */
export function repoRootFrom(moduleUrl, levelsUp = 2) {
  const segments = Array.from({ length: levelsUp }, () => '..');
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), ...segments);
}
