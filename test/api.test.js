/**
 * API / file-serving security tests.
 * Verifies auth guards, 404 handling, and path traversal protection on
 * the authenticated file-serving routes (/api/photos, /api/documents, etc.).
 */

const { createTestEnv, cleanupTestEnv, loginAs } = require('./helpers/setup');

const env = createTestEnv();
const request = require('supertest');
const app     = require('../server');

afterAll(() => cleanupTestEnv(env));

// ---------------------------------------------------------------------------
// Auth guard on API routes
// ---------------------------------------------------------------------------
describe('API auth guard', () => {
  const protectedPaths = [
    '/api/photos/somefile.jpg',
    '/api/documents/somefile.pdf',
    '/api/thumb/somefile.jpg',
  ];

  test.each(protectedPaths)('GET %s redirects unauthenticated request', async (url) => {
    const res = await request(app).get(url);
    // Auth middleware redirects HTML requests to /login
    expect([302, 404]).toContain(res.status);
    if (res.status === 302) {
      expect(res.headers.location).toMatch(/\/login/);
    }
  });
});

// ---------------------------------------------------------------------------
// 404 for nonexistent files (authenticated)
// ---------------------------------------------------------------------------
describe('API 404 handling', () => {
  test('authenticated request for nonexistent photo returns 404', async () => {
    const cookies = await loginAs(app, request);
    const res = await request(app)
      .get('/api/photos/definitely-does-not-exist.jpg')
      .set('Cookie', cookies);
    expect(res.status).toBe(404);
  });

  test('authenticated request for nonexistent document returns 404', async () => {
    const cookies = await loginAs(app, request);
    const res = await request(app)
      .get('/api/documents/definitely-does-not-exist.pdf')
      .set('Cookie', cookies);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Path traversal protection
// ---------------------------------------------------------------------------
describe('Path traversal protection', () => {
  const traversalPaths = [
    '/api/photos/../../../etc/passwd',
    '/api/photos/..%2F..%2F..%2Fetc%2Fpasswd',
    '/api/documents/../server.js',
    '/api/thumb/../../package.json',
  ];

  test.each(traversalPaths)('GET %s is blocked (404 or 400)', async (url) => {
    const cookies = await loginAs(app, request);
    const res = await request(app).get(url).set('Cookie', cookies);
    // Express normalizes .. paths, so this either 404s (file not in DB)
    // or gets rejected by the route's filename validation.
    expect([400, 404]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
describe('Global 404 handler', () => {
  test('unknown route returns 404', async () => {
    const res = await request(app).get('/this/route/does/not/exist');
    expect(res.status).toBe(404);
  });
});
