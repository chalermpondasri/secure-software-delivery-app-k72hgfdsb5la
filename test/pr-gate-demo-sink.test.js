const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const readmePath = path.join(__dirname, '..', 'README.md');
const publicContent = 'Public README content';

// Exercise the handler without starting the app's unrelated demo routes.
function loadRoute(t, readFile = (filename, encoding, callback) => {
  callback(null, publicContent);
}) {
  let handler;
  const readMock = t.mock.method(fs, 'readFile', readFile);
  const router = {
    get(route, callback) {
      assert.equal(route, '/read');
      handler = callback;
    },
  };
  const originalLoad = Module._load;
  const loadMock = t.mock.method(Module, '_load', function (name, parent, isMain) {
    if (name === 'express') return { Router: () => router };
    return Reflect.apply(originalLoad, this, [name, parent, isMain]);
  });
  const moduleId = require.resolve('../src/pr-gate-demo-sink');
  delete require.cache[moduleId];
  try {
    require('../src/pr-gate-demo-sink');
  } finally {
    loadMock.mock.restore();
    delete require.cache[moduleId];
  }

  return {
    readMock,
    request(file) {
      return new Promise((resolve) => {
        let status = 200;
        handler({ query: { file } }, {
          status(code) { status = code; return this; },
          send(body) { resolve({ status, body }); },
        });
      });
    },
  };
}

test('reads the approved public document using a fixed absolute path', async (t) => {
  const route = loadRoute(t);
  const response = await route.request('README.md');
  assert.equal(response.status, 200);
  assert.equal(response.body, publicContent);
  assert.equal(route.readMock.mock.callCount(), 1);
  const [filename, encoding] = route.readMock.mock.calls[0].arguments;
  assert.equal(filename, readmePath);
  assert.equal(encoding, 'utf8');
});

test('rejects traversal, unapproved paths and malformed queries before reading', async (t) => {
  const route = loadRoute(t);
  for (const file of [
    '../README.md', '../../etc/passwd', '/etc/passwd',
    '..\\README.md', 'C:\\Windows\\win.ini', '%2e%2e%2fetc%2fpasswd',
    './README.md', 'src/../README.md', 'README.md/../.env',
    '.env', 'package.json', 'linked-secret', 'README.md\0',
    '', undefined, null, ['README.md'], { file: 'README.md' },
  ]) {
    const response = await route.request(file);
    assert.equal(response.status, 400, JSON.stringify(file));
    assert.equal(response.body, 'Unsupported file');
  }
  assert.equal(route.readMock.mock.callCount(), 0);
});

test('does not disclose filesystem error details', async (t) => {
  const route = loadRoute(t, (filename, encoding, callback) => {
    callback(new Error(`EACCES: private server path ${filename}`));
  });
  assert.deepEqual(await route.request('README.md'), {
    status: 500,
    body: 'Unable to read file',
  });
});
