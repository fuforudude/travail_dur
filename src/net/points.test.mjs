// Tests des montants courts (shortPoints), lanceur intégré de Node : npm run test:site
import test from 'node:test';
import assert from 'node:assert/strict';

import { shortPoints, signedShortPoints } from './shortPoints.ts';

const nb = (s) => s.replace(/[  ]/g, ' '); // espaces insécables de fr-FR

test('petits montants : chiffre exact, puis k et M', () => {
  assert.equal(nb(shortPoints(999)), '999');
  assert.equal(nb(shortPoints(1000)), '1 000');
  assert.equal(nb(shortPoints(10000)), '10 k');
  assert.equal(nb(shortPoints(1.5e6)), '1,5 M');
});

test('milliards et billions', () => {
  assert.equal(nb(shortPoints(1e9)), '1 Md');
  assert.equal(nb(shortPoints(95e9)), '95 Md');
  assert.equal(nb(shortPoints(37.5e12)), '37,5 T');
  assert.equal(nb(shortPoints(1e12)), '1 T');
});

test('bilan signé', () => {
  assert.equal(nb(signedShortPoints(-1005e9)), '−1,01 T');
  assert.equal(nb(signedShortPoints(95e9)), '+95 Md');
  assert.equal(signedShortPoints(0), '0');
  assert.equal(nb(signedShortPoints(-500)), '−500');
});
