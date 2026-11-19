import { readFileSync, existsSync } from 'fs';

const orig = JSON.parse(readFileSync('test-fixtures/page1_golden.json', 'utf8'));
console.log('--- ORIGINAL FIXTURE page1_golden.json Offer 6 ---');
console.log(JSON.stringify(orig.offers[5], null, 2));

if (existsSync('test-fixtures/page1_golden_verified_reference.json')) {
  const verified = JSON.parse(readFileSync('test-fixtures/page1_golden_verified_reference.json', 'utf8'));
  console.log('--- VERIFIED REFERENCE page1_golden_verified_reference.json Offer 6 ---');
  console.log(JSON.stringify(verified.offers[5], null, 2));
}
process.exit(0);

