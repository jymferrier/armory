/**
 * Inventory route tests — CRUD, auth guards, spouse visibility.
 */

const { createTestEnv, cleanupTestEnv, loginAs } = require('./helpers/setup');

const env = createTestEnv();
const request = require('supertest');
const app = require('../server');
const { firearmsQueries, userQueries } = require('../db');
const Database = require('better-sqlite3');

afterAll(() => cleanupTestEnv(env));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// firearmsQueries.create() returns the numeric lastInsertRowid directly
function createFirearm(overrides = {}) {
  return firearmsQueries.create({
    manufacturer: 'Smith & Wesson', model: 'M&P 9', model_number: null,
    caliber: '9mm', serial: null, barrel_length: null, overall_length: null,
    optics: null, date_acquired: '2024-06-01', acquired_from: null,
    price_paid: null, spouse_price: null, transfer_date: null, ffl_transferred_from: null,
    is_3d_printed: 0, is_nfa: 0, nfa_type: null, nfa_form_type: null,
    nfa_form_number: null, nfa_fmi: 0, nfa_submit_date: null,
    nfa_tax_stamp_serial: null, nfa_approve_date: null, nfa_trust_name: null,
    nfa2_enabled: 0, nfa2_form_type: null, nfa2_form_number: null, nfa2_fmi: 0,
    nfa2_submit_date: null, nfa2_tax_stamp_serial: null, nfa2_approve_date: null,
    non_nfa_trust_name: null, is_disposed: 0, date_disposed: null,
    disposal_method: null, notes: null, round_count: 0,
    ...overrides,
  }); // returns numeric id
}

function setSpouseVisible(id, value) {
  const db = new Database(process.env.DB_PATH);
  db.prepare('UPDATE firearms SET spouse_visible = ? WHERE id = ?').run(value ? 1 : 0, id);
  db.close();
}

async function getCsrfFromPage(cookies, path) {
  const page = await request(app).get(path).set('Cookie', cookies);
  return (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';
}

// ---------------------------------------------------------------------------
// Auth guards
// ---------------------------------------------------------------------------
describe('Inventory auth guards', () => {
  test('GET /inventory requires authentication', async () => {
    const res = await request(app).get('/inventory');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
  });

  test('GET /inventory/new requires authentication', async () => {
    const res = await request(app).get('/inventory/new');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// List page
// ---------------------------------------------------------------------------
describe('Inventory list', () => {
  test('GET /inventory renders for authenticated user', async () => {
    const cookies = await loginAs(app, request);
    const res = await request(app).get('/inventory').set('Cookie', cookies);
    expect(res.status).toBe(200);
  });

  test('GET /inventory?q=glock renders without error', async () => {
    const cookies = await loginAs(app, request);
    const res = await request(app).get('/inventory?q=glock').set('Cookie', cookies);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Create (direct DB — bypasses multipart upload complexity)
// ---------------------------------------------------------------------------
describe('Firearm create (direct DB)', () => {
  test('creates firearm and returns a numeric id', () => {
    const id = createFirearm();
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);

    const found = firearmsQueries.findById(id);
    expect(found.manufacturer).toBe('Smith & Wesson');
    expect(found.model).toBe('M&P 9');
  });

  test('findById returns null for nonexistent id', () => {
    expect(firearmsQueries.findById(999999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Firearm detail page
// ---------------------------------------------------------------------------
describe('Firearm detail page', () => {
  test('GET /inventory/:id renders for existing firearm', async () => {
    const id = createFirearm({ serial: 'DETAIL-001' });
    const cookies = await loginAs(app, request);
    const res = await request(app).get(`/inventory/${id}`).set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.text).toContain('DETAIL-001');
  });

  test('GET /inventory/:id returns 404 for nonexistent firearm', async () => {
    const cookies = await loginAs(app, request);
    const res = await request(app).get('/inventory/999999').set('Cookie', cookies);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Spouse visibility enforcement
// ---------------------------------------------------------------------------
describe('Spouse visibility', () => {
  let spouseFirearmId;
  let hiddenFirearmId;

  beforeAll(() => {
    spouseFirearmId = createFirearm({ serial: 'SPOUSE-VIS' });
    setSpouseVisible(spouseFirearmId, true);

    hiddenFirearmId = createFirearm({ serial: 'SPOUSE-HID' });
    setSpouseVisible(hiddenFirearmId, false);

    // Create a spouse-view user
    userQueries.create('spouseuser', 'SpousePass123!');
    const db = new Database(process.env.DB_PATH);
    db.prepare('UPDATE users SET is_spouse_view = 1 WHERE username = ?').run('spouseuser');
    db.close();
  });

  test('admin can view hidden firearm detail page', async () => {
    const cookies = await loginAs(app, request);
    const res = await request(app).get(`/inventory/${hiddenFirearmId}`).set('Cookie', cookies);
    expect(res.status).toBe(200);
  });

  test('spouse-view user sees 404 for hidden firearm', async () => {
    const cookies = await loginAs(app, request, { username: 'spouseuser', password: 'SpousePass123!' });
    const res = await request(app).get(`/inventory/${hiddenFirearmId}`).set('Cookie', cookies);
    expect(res.status).toBe(404);
  });

  test('spouse-view user can access spouse-visible firearm', async () => {
    const cookies = await loginAs(app, request, { username: 'spouseuser', password: 'SpousePass123!' });
    const res = await request(app).get(`/inventory/${spouseFirearmId}`).set('Cookie', cookies);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
describe('Firearm delete', () => {
  test('POST /:id/delete removes the firearm', async () => {
    const id = createFirearm({ serial: 'DELETE-001' });
    const cookies = await loginAs(app, request);
    const csrf = await getCsrfFromPage(cookies, '/inventory/new');

    const res = await request(app)
      .post(`/inventory/${id}/delete`)
      .set('Cookie', cookies)
      .type('form')
      .send({ _csrf: csrf });

    expect([200, 302]).toContain(res.status);
    expect(firearmsQueries.findById(id)).toBeNull();
  });

  test('POST /:id/delete with invalid CSRF token returns 403 and does not delete', async () => {
    const id = createFirearm({ serial: 'DELETE-002' });
    const cookies = await loginAs(app, request);

    const res = await request(app)
      .post(`/inventory/${id}/delete`)
      .set('Cookie', cookies)
      .type('form')
      .send({ _csrf: 'invalid-token' });

    expect(res.status).toBe(403);
    expect(firearmsQueries.findById(id)).not.toBeNull();
  });
});
