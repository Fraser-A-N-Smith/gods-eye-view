// Cross-platform key resolution for the dev launchers. These replace logic
// that previously existed only inside bash scripts, which is to say only on
// macOS and Linux. The tests pin the precedence, the platform seam, and the
// one rule that matters most: a secret's VALUE is never reported, only where
// it came from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  parseDotEnv,
  readDotEnv,
  hasKeychain,
  keychainSecret,
  resolveSecret,
  normalizeAuthMode,
  readOpenSkyCredentialsFile,
  resolveOpenSkyCredentials,
  REPO_ROOT,
  repoRootFrom,
  OPENSKY_AUTH_MODES,
  KEYCHAIN_LOOKUPS,
} from './secrets.mjs';

/** A `security` stand-in that answers from a table and records its calls. */
function fakeKeychain(table, calls = []) {
  return (cmd, args) => {
    calls.push({ cmd, args });
    const service = args[args.indexOf('-s') + 1];
    const account = args[args.indexOf('-a') + 1];
    const value = table[`${service}/${account}`];
    return value ? { status: 0, stdout: `${value}\n` } : { status: 1, stdout: '' };
  };
}

test('parseDotEnv handles the forms a real .env carries', () => {
  const parsed = parseDotEnv([
    '# a comment',
    '',
    'GOOGLE_MAPS_API_KEY=plain-value',
    'QUOTED="double quoted"',
    "SINGLE='single quoted'",
    'export EXPORTED=exported-value',
    '  SPACED = spaced-value  ',
    'EMPTY=',
  ].join('\n'));
  assert.equal(parsed.GOOGLE_MAPS_API_KEY, 'plain-value');
  assert.equal(parsed.QUOTED, 'double quoted');
  assert.equal(parsed.SINGLE, 'single quoted');
  assert.equal(parsed.EXPORTED, 'exported-value');
  assert.equal(parsed.SPACED, 'spaced-value');
  assert.equal(parsed.EMPTY, '');
});

test('parseDotEnv reads CRLF files — the default a Windows editor writes', () => {
  const parsed = parseDotEnv('A=1\r\nB=2\r\n');
  assert.equal(parsed.A, '1');
  assert.equal(parsed.B, '2', 'a trailing \\r must not become part of the value');
});

test('parseDotEnv ignores malformed lines rather than inventing keys', () => {
  const parsed = parseDotEnv('no-equals-here\n=novalue\n123BAD=x\nGOOD=y');
  assert.deepEqual(Object.keys(parsed), ['GOOD']);
});

test('parseDotEnv keeps = inside values', () => {
  assert.equal(parseDotEnv('TOKEN=abc=def==').TOKEN, 'abc=def==');
});

test('readDotEnv returns an empty map when the file is absent', () => {
  assert.deepEqual(readDotEnv('/nonexistent/.env'), {});
  assert.deepEqual(readDotEnv('/x/.env', { readFile: () => { throw new Error('nope'); } }), {});
});

test('the keychain seam is macOS-only and never shells out elsewhere', () => {
  assert.equal(hasKeychain('darwin'), true);
  assert.equal(hasKeychain('win32'), false);
  assert.equal(hasKeychain('linux'), false);

  const calls = [];
  const run = fakeKeychain({ 'google-maps-api/api-key': 'SECRET' }, calls);
  assert.equal(keychainSecret('google-maps-api', 'api-key', { platform: 'win32', run }), null);
  assert.equal(calls.length, 0, 'Windows must not attempt to run `security`');
  assert.equal(keychainSecret('google-maps-api', 'api-key', { platform: 'darwin', run }), 'SECRET');
  assert.equal(calls.length, 1);
});

test('a keychain miss or a throwing runner resolves to null, not a crash', () => {
  const run = fakeKeychain({});
  assert.equal(keychainSecret('svc', 'acct', { platform: 'darwin', run }), null);
  assert.equal(
    keychainSecret('svc', 'acct', { platform: 'darwin', run: () => { throw new Error('no security cli'); } }),
    null,
  );
});

test('PRECEDENCE: an explicit env var beats the keychain and .env', () => {
  // dev-secure.sh preferred the keychain, so an explicitly exported key was
  // silently ignored. Explicit intent wins here.
  const run = fakeKeychain({ 'google-maps-api/api-key': 'FROM-KEYCHAIN' });
  const resolved = resolveSecret({
    name: 'GOOGLE_MAPS_API_KEY',
    env: { GOOGLE_MAPS_API_KEY: 'FROM-ENV' },
    dotEnv: { GOOGLE_MAPS_API_KEY: 'FROM-DOTENV' },
    keychain: KEYCHAIN_LOOKUPS.GOOGLE_MAPS_API_KEY,
    platform: 'darwin',
    run,
  });
  assert.equal(resolved.value, 'FROM-ENV');
  assert.equal(resolved.source, 'env');
});

test('PRECEDENCE: the keychain beats .env when no env var is set', () => {
  const run = fakeKeychain({ 'google-maps-api/api-key': 'FROM-KEYCHAIN' });
  const resolved = resolveSecret({
    name: 'GOOGLE_MAPS_API_KEY',
    env: {},
    dotEnv: { GOOGLE_MAPS_API_KEY: 'FROM-DOTENV' },
    keychain: KEYCHAIN_LOOKUPS.GOOGLE_MAPS_API_KEY,
    platform: 'darwin',
    run,
  });
  assert.equal(resolved.value, 'FROM-KEYCHAIN');
  assert.match(resolved.source, /^keychain:/);
});

test('ON WINDOWS: resolution falls through the keychain to .env cleanly', () => {
  const resolved = resolveSecret({
    name: 'GOOGLE_MAPS_API_KEY',
    env: {},
    dotEnv: { GOOGLE_MAPS_API_KEY: 'FROM-DOTENV' },
    keychain: KEYCHAIN_LOOKUPS.GOOGLE_MAPS_API_KEY,
    platform: 'win32',
    run: fakeKeychain({ 'google-maps-api/api-key': 'UNREACHABLE' }),
  });
  assert.equal(resolved.value, 'FROM-DOTENV');
  assert.equal(resolved.source, '.env');
});

test('a blank or whitespace env var is not a value', () => {
  const resolved = resolveSecret({
    name: 'K', env: { K: '   ' }, dotEnv: { K: 'REAL' }, platform: 'win32',
  });
  assert.equal(resolved.value, 'REAL');
});

test('nothing configured resolves to a null value AND a null source', () => {
  const resolved = resolveSecret({ name: 'K', env: {}, dotEnv: {}, platform: 'win32' });
  assert.deepEqual(resolved, { value: null, source: null });
});

test('the reported source never contains the secret itself', () => {
  const run = fakeKeychain({ 'google-maps-api/api-key': 'SUPER-SECRET-VALUE' });
  const resolved = resolveSecret({
    name: 'GOOGLE_MAPS_API_KEY',
    env: {},
    dotEnv: {},
    keychain: KEYCHAIN_LOOKUPS.GOOGLE_MAPS_API_KEY,
    platform: 'darwin',
    run,
  });
  assert.doesNotMatch(resolved.source, /SUPER-SECRET-VALUE/);
});

test('auth modes normalize, and an invalid one warns instead of failing silently', () => {
  for (const mode of OPENSKY_AUTH_MODES) {
    assert.deepEqual(normalizeAuthMode(mode), { mode, warning: null });
  }
  assert.deepEqual(normalizeAuthMode('OAuth'), { mode: 'oauth', warning: null });
  assert.deepEqual(normalizeAuthMode(''), { mode: 'oauth', warning: null });
  assert.deepEqual(normalizeAuthMode(undefined), { mode: 'oauth', warning: null });
  const bad = normalizeAuthMode('nonsense');
  assert.equal(bad.mode, 'oauth');
  assert.match(bad.warning, /invalid OPENSKY_AUTH_MODE/);
});

test('credentials files parse both camelCase and snake_case', () => {
  const readFile = (p) => (p === 'camel'
    ? JSON.stringify({ clientId: 'ID1', clientSecret: 'SEC1' })
    : JSON.stringify({ client_id: 'ID2', client_secret: 'SEC2' }));
  assert.deepEqual(readOpenSkyCredentialsFile('camel', { readFile }), { clientId: 'ID1', clientSecret: 'SEC1' });
  assert.deepEqual(readOpenSkyCredentialsFile('snake', { readFile }), { clientId: 'ID2', clientSecret: 'SEC2' });
  assert.deepEqual(readOpenSkyCredentialsFile('', { readFile }), { clientId: null, clientSecret: null });
  assert.deepEqual(
    readOpenSkyCredentialsFile('bad', { readFile: () => 'not json' }),
    { clientId: null, clientSecret: null },
  );
});

test('OAuth mode does not forward basic credentials, and vice versa', () => {
  const env = {
    OPENSKY_AUTH_MODE: 'oauth',
    OPENSKY_CLIENT_ID: 'CID', OPENSKY_CLIENT_SECRET: 'CSEC',
    OPENSKY_USERNAME: 'USER', OPENSKY_PASSWORD: 'PASS',
  };
  const oauth = resolveOpenSkyCredentials({ env, platform: 'win32' });
  assert.equal(oauth.credentials.OPENSKY_CLIENT_ID, 'CID');
  assert.equal(oauth.credentials.OPENSKY_USERNAME, undefined, 'the proxy must not pick an unchosen auth path');
  assert.equal(oauth.configured, true);

  const basic = resolveOpenSkyCredentials({ env: { ...env, OPENSKY_AUTH_MODE: 'basic' }, platform: 'win32' });
  assert.equal(basic.credentials.OPENSKY_USERNAME, 'USER');
  assert.equal(basic.credentials.OPENSKY_CLIENT_ID, undefined);
  assert.equal(basic.configured, true);
});

test('auto mode accepts either credential pair and names which it found', () => {
  const oauthOnly = resolveOpenSkyCredentials({
    env: { OPENSKY_AUTH_MODE: 'auto', OPENSKY_CLIENT_ID: 'A', OPENSKY_CLIENT_SECRET: 'B' },
    platform: 'win32',
  });
  assert.equal(oauthOnly.configured, true);
  assert.match(oauthOnly.summary, /OAuth/);

  const basicOnly = resolveOpenSkyCredentials({
    env: { OPENSKY_AUTH_MODE: 'auto', OPENSKY_USERNAME: 'U', OPENSKY_PASSWORD: 'P' },
    platform: 'win32',
  });
  assert.equal(basicOnly.configured, true);
  assert.match(basicOnly.summary, /basic/);

  const neither = resolveOpenSkyCredentials({ env: { OPENSKY_AUTH_MODE: 'auto' }, platform: 'win32' });
  assert.equal(neither.configured, false);
  assert.match(neither.summary, /no credentials/);
});

test('anon mode forwards no credentials at all', () => {
  const resolved = resolveOpenSkyCredentials({
    env: { OPENSKY_AUTH_MODE: 'anon', OPENSKY_CLIENT_ID: 'CID', OPENSKY_USERNAME: 'U' },
    platform: 'win32',
  });
  assert.deepEqual(resolved.credentials, { OPENSKY_AUTH_MODE: 'anon' });
  assert.equal(resolved.configured, true, 'anonymous is a configured state, not a broken one');
});

test('a credentials FILE fills in OAuth gaps', () => {
  const resolved = resolveOpenSkyCredentials({
    env: { OPENSKY_AUTH_MODE: 'oauth', OPENSKY_CREDENTIALS_FILE: 'creds.json' },
    platform: 'win32',
    readFile: () => JSON.stringify({ clientId: 'FILE-ID', clientSecret: 'FILE-SEC' }),
  });
  assert.equal(resolved.credentials.OPENSKY_CLIENT_ID, 'FILE-ID');
  assert.equal(resolved.configured, true);
});

test('an explicit env client id is not overwritten by the credentials file', () => {
  const resolved = resolveOpenSkyCredentials({
    env: {
      OPENSKY_AUTH_MODE: 'oauth',
      OPENSKY_CLIENT_ID: 'ENV-ID',
      OPENSKY_CLIENT_SECRET: 'ENV-SEC',
      OPENSKY_CREDENTIALS_FILE: 'creds.json',
    },
    platform: 'win32',
    readFile: () => JSON.stringify({ clientId: 'FILE-ID', clientSecret: 'FILE-SEC' }),
  });
  assert.equal(resolved.credentials.OPENSKY_CLIENT_ID, 'ENV-ID');
});

test('WINDOWS PATHS: root resolution goes through fileURLToPath, not URL.pathname', () => {
  // `new URL(...).pathname` yields "/C:/Users/..." on Windows — a leading-slash
  // path that every later path.join builds on and no fs call can open.
  // `{ windows: false }` forces POSIX URL parsing for this literal regardless
  // of the host OS running the suite: fileURLToPath() otherwise follows
  // process.platform, and a POSIX-shaped file:// URL has no drive letter for
  // its Windows parser to find, which throws ERR_INVALID_FILE_URL_PATH.
  const root = repoRootFrom('file:///home/user/project/scripts/lib/secrets.mjs', 2, { windows: false });
  assert.equal(root, path.resolve('/home/user/project'));
  assert.doesNotMatch(root, /^\/[A-Za-z]:/, 'a drive-letter path must never keep a leading slash');
});

test('REPO_ROOT is a constant, so it cannot be resolved from the wrong depth', () => {
  // The caller-supplied form took an "up two levels" correct only for modules
  // in scripts/lib/. Called from scripts/ it landed one directory ABOVE the
  // repository, and the credential importer wrote a .env outside the project.
  assert.equal(path.basename(REPO_ROOT), 'gods-eye-view');
  assert.equal(
    repoRootFrom('file:///a/b/c/scripts/tool.mjs', 1, { windows: false }),
    path.resolve('/a/b/c'),
  );
  assert.equal(
    repoRootFrom('file:///a/b/c/scripts/lib/tool.mjs', 2, { windows: false }),
    path.resolve('/a/b/c'),
  );
});
