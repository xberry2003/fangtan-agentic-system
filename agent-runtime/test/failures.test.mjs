import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFailure } from '../failures.mjs';
test('provider failures preserve category and redact credentials',()=>{
  const result=formatFailure(new Error('fetch failed key=secret-value Bearer token123'),'secret-value','kimi-k3','model');
  assert.equal(result.error_code,'network');assert.ok(!JSON.stringify(result).includes('secret-value'));assert.ok(!JSON.stringify(result).includes('token123'));
  assert.equal(result.diagnostic.phase,'model');
});
test('output budget, rate limiting and authentication are distinguished',()=>{
  assert.equal(formatFailure(Object.assign(new Error('unfinished'),{stopReason:'length'})).error_code,'output_limit');
  assert.equal(formatFailure(new Error('429 rate limit')).error_code,'rate_limit');
  assert.equal(formatFailure(new Error('401 unauthorized')).error_code,'authentication');
  assert.equal(formatFailure(new Error('request timed out')).error_code,'timeout');
});
