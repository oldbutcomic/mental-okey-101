import assert from 'node:assert/strict';
import test from 'node:test';
import { registrationInviteFailure } from './invite-code.js';

test('production registration closes when the beta invite code is not configured', () => {
  assert.equal(registrationInviteFailure(undefined, { NODE_ENV: 'production' }), 'closed');
});

test('a configured beta invite code is required and compared exactly', () => {
  const env = { NODE_ENV: 'production', BETA_INVITE_CODE: 'private-beta-code' };
  assert.equal(registrationInviteFailure(undefined, env), 'invalid');
  assert.equal(registrationInviteFailure('wrong-code', env), 'invalid');
  assert.equal(registrationInviteFailure(' private-beta-code ', env), null);
  assert.equal(registrationInviteFailure('x'.repeat(257), env), 'invalid');
});

test('production accepts each configured beta invite code and ignores the legacy code when a list is set', () => {
  const env = {
    NODE_ENV: 'production',
    BETA_INVITE_CODES: 'first-invite, second-invite\nthird-invite',
    BETA_INVITE_CODE: 'old-invite',
  };
  for (const code of ['first-invite', 'second-invite', 'third-invite']) {
    assert.equal(registrationInviteFailure(code, env), null);
  }
  assert.equal(registrationInviteFailure('old-invite', env), 'invalid');
  assert.equal(registrationInviteFailure('wrong-invite', env), 'invalid');
  assert.equal(registrationInviteFailure('legacy-first', {
    NODE_ENV: 'production',
    BETA_INVITE_CODE: 'legacy-first, legacy-second',
  }), null);
});

test('development registration remains open by default but honors an explicitly configured code', () => {
  assert.equal(registrationInviteFailure(undefined, { NODE_ENV: 'development' }), null);
  const env = { NODE_ENV: 'development', BETA_INVITE_CODE: 'dev-invite' };
  assert.equal(registrationInviteFailure(undefined, env), 'invalid');
  assert.equal(registrationInviteFailure('dev-invite', env), null);
});
