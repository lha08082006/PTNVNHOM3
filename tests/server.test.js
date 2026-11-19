const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const server = require('../server');

let base;
before(() => new Promise(resolve => server.listen(0, () => {
  base = 'http://127.0.0.1:' + server.address().port;
  resolve();
})));
after(() => new Promise(resolve => server.close(resolve)));

test('Không phục vụ file nhạy cảm / mã nguồn server', async () => {
  for (const p of ['/.env', '/.env.example', '/lib/db.js', '/api/refund.js', '/schema.sql', '/package.json', '/.git/config', '/%2e%2e/%2e%2e/etc/passwd']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
  }
});

test('Vẫn phục vụ trang tĩnh và clean URL', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/checkout')).status, 200);
  assert.equal((await fetch(base + '/pay-client.js')).status, 200);
});

test('JSON lỗi -> 400', async () => {
  const r = await fetch(base + '/api/create-order', { method: 'POST', body: '{bad', headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 400);
});
