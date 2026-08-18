const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { groupBySize, findDuplicates, buildReport } = require('../core/duplicateFinder');

test('groups only files with colliding sizes', () => {
  const groups = groupBySize([
    { relativePath: 'a.txt', size: 4 },
    { relativePath: 'b.txt', size: 4 },
    { relativePath: 'c.txt', size: 9 }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0][0], 4);
  assert.equal(groups[0][1].length, 2);
});

test('minimum size and empty-file filtering reduce candidates', () => {
  const groups = groupBySize([
    { relativePath: 'empty-a', size: 0 },
    { relativePath: 'empty-b', size: 0 },
    { relativePath: 'small-a', size: 3 },
    { relativePath: 'small-b', size: 3 },
    { relativePath: 'large-a', size: 20 },
    { relativePath: 'large-b', size: 20 }
  ], { minimumSize: 10, ignoreEmpty: true });
  assert.deepEqual(groups.map(([size]) => size), [20]);
});

test('findDuplicates verifies content so same-size different files are not false positives', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devtoolkit-dupes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = [
    ['one.txt', 'same'],
    ['two.txt', 'same'],
    ['three.txt', 'diff']
  ].map(([name, content]) => {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content);
    return { filePath, relativePath: name, size: Buffer.byteLength(content) };
  });

  const report = await findDuplicates(files);
  assert.equal(report.totalFiles, 3);
  assert.equal(report.candidateFiles, 3);
  assert.equal(report.duplicateGroups, 1);
  assert.equal(report.duplicateFiles, 2);
  assert.equal(report.extraCopies, 1);
  assert.equal(report.recoverableBytes, 4);
  assert.deepEqual(report.groups[0].files.sort(), ['one.txt', 'two.txt']);
  assert.match(report.groups[0].hash, /^[a-f0-9]{64}$/);
});

test('report recovery counts only extra copies', () => {
  const report = buildReport(5, 4, [
    { size: 10, files: ['a', 'b', 'c'] },
    { size: 5, files: ['d', 'e'] }
  ]);
  assert.equal(report.duplicateGroups, 2);
  assert.equal(report.duplicateFiles, 5);
  assert.equal(report.extraCopies, 3);
  assert.equal(report.recoverableBytes, 25);
});
