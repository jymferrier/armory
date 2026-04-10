/**
 * Trust assignment tests — verifies the toggle logic, auth guards,
 * and case-insensitive name matching introduced in the Non-NFA trust feature.
 */

const { createTestEnv, cleanupTestEnv, loginAs } = require('./helpers/setup');

const env = createTestEnv();
const request  = require('supertest');
const app      = require('../server');
const { trustQueries, firearmsQueries } = require('../db');

afterAll(() => cleanupTestEnv(env));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createTestFirearm(overrides = {}) {
  return firearmsQueries.create({
    manufacturer: 'Test Mfg', model: 'Test Model', model_number: null,
    caliber: '9mm', serial: 'TEST001', barrel_length: null, overall_length: null,
    optics: null, date_acquired: '2024-01-01', acquired_from: null,
    price_paid: null, spouse_price: null, transfer_date: null, ffl_transferred_from: null,
    is_3d_printed: 0, is_nfa: 0, nfa_type: null, nfa_form_type: null,
    nfa_form_number: null, nfa_fmi: 0, nfa_submit_date: null, nfa_tax_stamp_serial: null,
    nfa_approve_date: null, nfa_trust_name: null,
    nfa2_enabled: 0, nfa2_form_type: null, nfa2_form_number: null, nfa2_fmi: 0,
    nfa2_submit_date: null, nfa2_tax_stamp_serial: null, nfa2_approve_date: null,
    non_nfa_trust_name: null,
    is_disposed: 0, date_disposed: null, disposal_method: null, notes: null, round_count: 0,
    ...overrides,
  });
}

async function postWithCsrf(cookies, url, body) {
  // Fetch a CSRF token from the trust form — it's a form page guaranteed to have the field
  const page = await request(app).get('/trusts/new').set('Cookie', cookies);
  const csrf = (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';
  return request(app).post(url).set('Cookie', cookies).type('form').send({ ...body, _csrf: csrf });
}

// ---------------------------------------------------------------------------
// Trust list
// ---------------------------------------------------------------------------
describe('Trust list', () => {
  test('GET /trusts is accessible when authenticated', async () => {
    const cookies = await loginAs(app, request);
    const res = await request(app).get('/trusts').set('Cookie', cookies);
    expect(res.status).toBe(200);
  });

  test('GET /trusts redirects when unauthenticated', async () => {
    const res = await request(app).get('/trusts');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Trust create
// ---------------------------------------------------------------------------
describe('Trust create', () => {
  test('POST /trusts/new creates an NFA trust', async () => {
    const cookies = await loginAs(app, request);
    const res = await postWithCsrf(cookies, '/trusts/new', {
      name: 'Integration Test NFA Trust',
      trust_type: 'NFA',
      settlor_name: '', settlor_location: '', agreement_date: '', notes: '',
    });
    expect([200, 302]).toContain(res.status);
    const trust = trustQueries.findByName('Integration Test NFA Trust');
    expect(trust).not.toBeNull();
    expect(trust.trust_type).toBe('NFA');
  });

  test('POST /trusts/new creates a Non-NFA trust', async () => {
    const cookies = await loginAs(app, request);
    await postWithCsrf(cookies, '/trusts/new', {
      name: 'Integration Test NonNFA Trust',
      trust_type: 'Non-NFA',
      settlor_name: '', settlor_location: '', agreement_date: '', notes: '',
    });
    const trust = trustQueries.findByName('Integration Test NonNFA Trust');
    expect(trust).not.toBeNull();
    expect(trust.trust_type).toBe('Non-NFA');
  });
});

// ---------------------------------------------------------------------------
// Non-NFA trust item matching (case-insensitive)
// ---------------------------------------------------------------------------
describe('Non-NFA trust item matching', () => {
  test('nonNfaItemsForTrust finds firearm by non_nfa_trust_name (case-insensitive)', () => {
    trustQueries.create({
      name: 'ci test trust', trust_type: 'Non-NFA',
      settlor_name: null, settlor_location: null, agreement_date: null, notes: null,
    });
    createTestFirearm({ serial: 'CI001', non_nfa_trust_name: 'CI Test Trust' });

    const items = trustQueries.nonNfaItemsForTrust('ci test trust');
    expect(items.some(f => f.serial === 'CI001')).toBe(true);
  });

  test('nonNfaItemsForTrust finds firearm by nfa_trust_name field as fallback', () => {
    trustQueries.create({
      name: 'fallback trust', trust_type: 'Non-NFA',
      settlor_name: null, settlor_location: null, agreement_date: null, notes: null,
    });
    // Firearm has name in the nfa_trust_name field (old behavior)
    createTestFirearm({ serial: 'FB001', nfa_trust_name: 'Fallback Trust', non_nfa_trust_name: null });

    const items = trustQueries.nonNfaItemsForTrust('fallback trust');
    expect(items.some(f => f.serial === 'FB001')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Trust assign toggle — authorization
// ---------------------------------------------------------------------------
describe('Trust assign toggle', () => {
  test('assigning firearm to wrong trust returns 403', async () => {
    const cookies = await loginAs(app, request);

    // Create two trusts
    trustQueries.create({
      name: 'Trust Alpha', trust_type: 'NFA',
      settlor_name: null, settlor_location: null, agreement_date: null, notes: null,
    });
    trustQueries.create({
      name: 'Trust Beta', trust_type: 'NFA',
      settlor_name: null, settlor_location: null, agreement_date: null, notes: null,
    });

    const trustAlpha = trustQueries.findByName('Trust Alpha');
    const trustBeta  = trustQueries.findByName('Trust Beta');

    // Firearm belongs to Alpha
    const result = createTestFirearm({ serial: 'ALPHA01', nfa_trust_name: 'Trust Alpha' });
    const firearmId = result.lastInsertRowid;

    // Try to toggle via Beta's assign route — should be forbidden
    const res = await postWithCsrf(
      cookies,
      `/trusts/${trustBeta.id}/firearms/${firearmId}/assign`,
      {}
    );
    expect(res.status).toBe(403);
  });
});
