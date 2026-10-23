import assert from 'node:assert/strict';
import { isDeploymentUrl } from '../lib/build-version.ts';

for (const url of ['https://hydro-scout.example.com', 'https://preview.example.com/deploy/123?view=build#details', 'http://localhost:3000']) {
  assert.equal(isDeploymentUrl(url), true, url);
}
for (const url of ['', 'javascript:alert(1)', 'data:text/html,test', '//example.com', 'https://user:secret@example.com', 'https://example.com/with space', 'https://', 'https://example.com/' + 'a'.repeat(2048), 'https://example.com:99999']) {
  assert.equal(isDeploymentUrl(url), false, url);
}
console.log('Deployment URL validation passed.');
