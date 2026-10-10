const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ensurePageAdvertisingAccess } = require('../src/helpers/pageAdvertisingAccess');
const base = { pageId: 'page', pageAccessToken: 'page-token', systemUserAccessToken: 'agency-token', businessId: 'business', userIds: ['operator'] };

test('uses agency credentials for business-scoped assignments and the Page token for bootstrap reads', async () => {
  const writes = []; let reads = 0;
  const api = {
    get: async (_url, options) => { assert.equal(options.headers.Authorization, reads ? 'Bearer agency-token' : 'Bearer page-token'); return { data: { data: reads++ ? [{ id: 'operator', tasks: ['ADVERTISE', 'ANALYZE'] }] : [] } }; },
    post: async (_url, body, options) => { writes.push(body); assert.equal(options.headers.Authorization, 'Bearer agency-token'); },
  };
  await ensurePageAdvertisingAccess({ ...base, api });
  assert.deepEqual(writes, [{ user: 'operator', business: 'business', tasks: ['ADVERTISE', 'ANALYZE'] }]);
});

test('does not claim success if the assignment is still missing', async () => {
  const api = { get: async () => ({ data: { data: [] } }), post: async () => ({ data: { success: true } }) };
  await assert.rejects(ensurePageAdvertisingAccess({ ...base, api }), /not confirmed/);
});

test('existing advertise permission avoids rewriting access', async () => {
  const api = { get: async () => ({ data: { data: [{ id: 'operator', tasks: ['PROFILE_PLUS_ADVERTISE'] }] } }), post: async () => { throw new Error('must not write'); } };
  await ensurePageAdvertisingAccess({ ...base, api });
});
