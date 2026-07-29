const test = require('node:test');
const assert = require('node:assert/strict');
const OmadaProvider = require('../src/services/providers/omada');

test('resolveVoucherGroupId prefers explicit plan config keys', () => {
  const provider = new OmadaProvider({ tenant_id: 't1' });
  const groupId = provider.resolveVoucherGroupId(
    { omadaVoucherGroupId: 'group-from-config' },
    [{ id: 'group-1', name: 'default' }],
    'basic'
  );

  assert.equal(groupId, 'group-from-config');
});

test('resolveVoucherGroupId falls back to matching group names', () => {
  const provider = new OmadaProvider({ tenant_id: 't1' });
  const groupId = provider.resolveVoucherGroupId(
    { label: 'basic' },
    [{ id: 'group-2', name: 'basic-plan-vouchers' }],
    'basic'
  );

  assert.equal(groupId, 'group-2');
});
