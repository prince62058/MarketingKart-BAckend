const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup({ business = null, state = null } = {}) {
  const calls = {};
  const models = {
    '../models/businessModel': { findOne: query => { calls.businessQuery = query; return { lean: async () => business }; } },
    '../models/pageLinkStateModel': {
      create: async doc => { calls.created = doc; },
      findOne: query => { calls.stateQuery = query; return { lean: async () => state }; },
    },
  };
  const context = { exports: {}, URLSearchParams, process: { env: {} }, console,
    require: name => models[name] || (name === 'axios' ? {} : require(name)),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/pageLinkOAuthController.js'), 'utf8'), context);
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
  return { controller: context.exports, calls, res };
}

test('cannot start consent for another user business', async () => {
  const { controller, calls, res } = setup();
  await controller.startPageLink({ body: { businessId: 'business' }, user: { _id: 'owner' } }, res);
  assert.equal(res.code, 404);
  assert.equal(calls.businessQuery.userId, 'owner');
  assert.equal(calls.created, undefined);
});

test('authorized consent uses the verified configuration and a fresh state', async () => {
  const { controller, calls, res } = setup({ business: {} });
  await controller.startPageLink({ body: { businessId: 'business' }, user: { _id: 'owner' } }, res);
  const url = new URL(res.body.data.oauthUrl);
  assert.equal(url.searchParams.get('config_id'), '1864354398275256');
  assert.equal(url.searchParams.has('scope'), false);
  assert.equal(url.searchParams.get('state'), calls.created.state);
  assert.equal(calls.created.state.length, 64);
});

test('status restricts token retrieval to the authenticated owner and unexpired state', async () => {
  const { controller, calls, res } = setup();
  await controller.pageLinkStatus({ query: { state: 'nonce' }, user: { _id: 'owner' } }, res);
  assert.equal(calls.stateQuery.userId, 'owner');
  assert.equal(calls.stateQuery.state, 'nonce');
  assert.ok(calls.stateQuery.createdAt.$gt.getTime() > Date.now() - 901000);
  assert.equal(res.code, 404);
});

test('callback error descriptions cannot inject HTML', async () => {
  const { controller, res } = setup();
  await controller.handlePageLinkCallback({ query: { error: 'denied', error_description: '<script>alert("x")</script>' } }, res);
  assert.ok(!res.body.includes('<script>'));
  assert.ok(res.body.includes('&lt;script&gt;'));
});
