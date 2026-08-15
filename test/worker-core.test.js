import assert from 'node:assert/strict';
import test from 'node:test';

import { allowedOrigin, isValidCats, isValidSettings, parseOfficialHolidayCsv } from '../worker-core.js';

const validSettings = {
  ratePeriods: [{ name: '2026', start: '2026-01-01', end: '2026-12-31', rate1: 880, rate2: 1540, rate3: 2400 }],
  transportTiers: { base: 50, t10: 100, t15: 150, t20: 200 },
  special1: 1400,
  special2: 2500,
  special3: 3800,
  holidayFee: 150,
  multiCatFee: 150,
  specialStart: '2026-02-14',
  specialEnd: '2026-02-22',
  holidayRanges: [{ name: '元旦', start: '2025-12-31', end: '2026-01-02' }],
  copyText: '付款方式',
};

test('accepts a valid cats payload', () => {
  assert.equal(isValidCats([{ name: '咪咪', fees: [{ caretaker: '管理師 A', fee: 100 }] }]), true);
});

test('rejects malformed or excessive cat fees', () => {
  assert.equal(isValidCats([{ name: '咪咪', fees: [{ caretaker: 'A', fee: -1 }] }]), false);
  assert.equal(isValidCats([{ name: '', fees: [] }]), false);
});

test('accepts complete settings and rejects invalid date ranges', () => {
  assert.equal(isValidSettings(validSettings), true);
  assert.equal(isValidSettings({ ...validSettings, specialStart: '2026-02-23' }), false);
});

test('only allows the production site, configured sites, and local development', () => {
  assert.equal(allowedOrigin('https://ccats-calculator.netlify.app'), 'https://ccats-calculator.netlify.app');
  assert.equal(allowedOrigin('https://preview.example.com', 'https://preview.example.com'), 'https://preview.example.com');
  assert.equal(allowedOrigin('http://localhost:3456'), 'http://localhost:3456');
  assert.equal(allowedOrigin('https://attacker.example'), '');
});

test('groups official holiday blocks without treating ordinary weekends as holidays', () => {
  const csv = `西元日期,星期,是否放假,備註
20270205,五,0,
20270206,六,2,農曆春節
20270207,日,2,
20270208,一,2,
20270209,二,2,春節補假
20270210,三,2,
20270211,四,0,
20270213,六,2,
20270214,日,2,`;
  assert.deepEqual(parseOfficialHolidayCsv(csv, 2027), [{
    name: '農曆春節、春節補假',
    officialStart: '2027-02-06',
    officialEnd: '2027-02-10',
  }]);
});
