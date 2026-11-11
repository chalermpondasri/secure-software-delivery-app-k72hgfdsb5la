const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'src', 'pr-gate-demo-sink.js');
const readmePath = path.join(__dirname, '..', 'README.md');

// Exercise the handler without starting the app's unrelated demo routes.
function loadRoute(readFile = fs.readFile) {
  let handler;
  const reads = [];
  const router = {
    get(route, callback) {
      assert.equal(route, '/read');
      handler = callback;
    },
  };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
    __dirname: path.dirname(sourcePath),
    module: { exports: {} },
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === 'path') return path;
      if (name === 'fs') {
        return {
          readFile(filename, encoding, callback) {
            reads.push(filename);
            readFile(filename, encoding, callback);
          },
        };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: sourcePath });

  return {
    reads,
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

test('reads the approved public document using a fixed absolute path', async () => {
  const route = loadRoute();
  const response = await route.request('README.md');
  assert.equal(response.status, 200);
  assert.equal(response.body, fs.readFileSync(readmePath, 'utf8'));
  assert.deepEqual(route.reads, [readmePath]);
});

test('rejects traversal, unapproved paths and malformed queries before reading', async () => {
  const route = loadRoute();
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
  assert.deepEqual(route.reads, []);
});

test('does not disclose filesystem error details', async () => {
  const route = loadRoute((filename, encoding, callback) => {
    callback(new Error(`EACCES: private server path ${filename}`));
  });
  assert.deepEqual(await route.request('README.md'), {
    status: 500,
    body: 'Unable to read file',
  });
});
