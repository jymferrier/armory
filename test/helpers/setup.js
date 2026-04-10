/**
 * Test environment bootstrap.
 *
 * Call createTestEnv() BEFORE requiring the server or db modules.
 * Each test file gets isolated temp databases so tests never touch production data.
 *
 * Usage:
 *   const { createTestEnv, cleanupTestEnv } = require('./helpers/setup');
 *   const env = createTestEnv();                     // sets env vars
 *   const app = require('../server');                // now safe to require
 *   afterAll(() => cleanupTestEnv(env));
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');

const TEST_ADMIN = { username: 'testadmin', password: 'TestPass123!' };

function createTestEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'armory-test-'));
  process.env.DB_PATH          = path.join(tmpDir, 'armory.db');
  process.env.SESSION_DB_PATH  = path.join(tmpDir, 'sessions.db');
  process.env.SESSION_SECRET   = 'test-session-secret-long-enough-for-armory-tests';
  process.env.DEFAULT_USER     = TEST_ADMIN.username;
  process.env.DEFAULT_PASS     = TEST_ADMIN.password;
  return { tmpDir };
}

function cleanupTestEnv({ tmpDir }) {
  // Close the DB so the temp file can be removed on Windows too
  try {
    const { closeDB } = require('../../db');
    closeDB();
  } catch (_) {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

/**
 * Log in as the test admin and return the cookie jar (array of Set-Cookie strings).
 * Pass cookies back into subsequent requests via .set('Cookie', cookies).
 */
async function loginAs(app, request, creds = TEST_ADMIN) {
  // First GET /login to obtain a CSRF token
  const loginPage = await request(app).get('/login');
  const csrfMatch = loginPage.text.match(/name="_csrf" value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  const cookies = (loginPage.headers['set-cookie'] || []).join('; ');

  const res = await request(app)
    .post('/login')
    .set('Cookie', cookies)
    .type('form')
    .send({ username: creds.username, password: creds.password, _csrf: csrf });

  // Collect all cookies from the login response
  const sessionCookies = (res.headers['set-cookie'] || []).join('; ');
  return sessionCookies || cookies;
}

module.exports = { createTestEnv, cleanupTestEnv, loginAs, TEST_ADMIN };
