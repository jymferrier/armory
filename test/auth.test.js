/**
 * Auth flow tests — login, lockout, CSRF, session protection.
 * Each test file gets its own isolated temp database via createTestEnv().
 */

const { createTestEnv, cleanupTestEnv, loginAs, TEST_ADMIN } = require('./helpers/setup');

// Set env vars BEFORE requiring server (db path is fixed at module load time)
const env = createTestEnv();
const request = require('supertest');
const app     = require('../server');

afterAll(() => cleanupTestEnv(env));

// ---------------------------------------------------------------------------
// GET /login
// ---------------------------------------------------------------------------
describe('GET /login', () => {
  test('renders login page when unauthenticated', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('form');
  });

  test('redirects to /inventory when already authenticated', async () => {
    const cookies = await loginAs(app, request);
    const res = await request(app).get('/login').set('Cookie', cookies);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/inventory');
  });
});

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------
describe('POST /login', () => {
  test('correct credentials redirect to /inventory', async () => {
    const cookies = await loginAs(app, request);
    // After loginAs, hitting /inventory should not redirect back to login
    const res = await request(app).get('/inventory').set('Cookie', cookies);
    expect(res.status).toBe(200);
  });

  test('wrong password returns error message', async () => {
    const loginPage = await request(app).get('/login');
    const csrf = (loginPage.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';
    const cookies = (loginPage.headers['set-cookie'] || []).join('; ');

    const res = await request(app)
      .post('/login')
      .set('Cookie', cookies)
      .type('form')
      .send({ username: TEST_ADMIN.username, password: 'wrongpassword', _csrf: csrf });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid username or password');
  });

  test('nonexistent username returns same error (no enumeration)', async () => {
    const loginPage = await request(app).get('/login');
    const csrf = (loginPage.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';
    const cookies = (loginPage.headers['set-cookie'] || []).join('; ');

    const res = await request(app)
      .post('/login')
      .set('Cookie', cookies)
      .type('form')
      .send({ username: 'nosuchuser', password: 'whatever', _csrf: csrf });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid username or password');
  });

  test('account locks out after 10 failed attempts', async () => {
    async function badLogin() {
      const loginPage = await request(app).get('/login');
      const csrf = (loginPage.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';
      const cookies = (loginPage.headers['set-cookie'] || []).join('; ');
      return request(app)
        .post('/login')
        .set('Cookie', cookies)
        .type('form')
        .send({ username: 'locktarget', password: 'wrong', _csrf: csrf });
    }

    for (let i = 0; i < 10; i++) await badLogin();
    const final = await badLogin();

    expect(final.text).toContain('locked');
  });
});

// ---------------------------------------------------------------------------
// Auth guard on protected routes
// ---------------------------------------------------------------------------
describe('Authentication guard', () => {
  test('GET /inventory redirects unauthenticated requests to /login', async () => {
    const res = await request(app).get('/inventory');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
  });

  test('GET /trusts redirects unauthenticated requests to /login', async () => {
    const res = await request(app).get('/trusts');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
  });

  test('GET /settings redirects unauthenticated requests to /login', async () => {
    const res = await request(app).get('/settings');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// CSRF protection
// ---------------------------------------------------------------------------
describe('CSRF protection', () => {
  test('POST /inventory/new without CSRF token returns 403', async () => {
    const cookies = await loginAs(app, request);
    const res = await request(app)
      .post('/inventory/new')
      .set('Cookie', cookies)
      .type('form')
      .send({ manufacturer: 'Glock', model: 'G17', _csrf: 'invalid-token' });

    expect(res.status).toBe(403);
  });

  test('POST /login without CSRF token returns 403', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
describe('Logout', () => {
  test('GET /logout destroys session and redirects to /login', async () => {
    const cookies = await loginAs(app, request);

    // Confirm authenticated first
    const before = await request(app).get('/inventory').set('Cookie', cookies);
    expect(before.status).toBe(200);

    // Logout
    await request(app).get('/logout').set('Cookie', cookies);

    // Session should now be invalid — /inventory redirects to login
    const after = await request(app).get('/inventory').set('Cookie', cookies);
    expect(after.status).toBe(302);
    expect(after.headers.location).toMatch(/\/login/);
  });
});
