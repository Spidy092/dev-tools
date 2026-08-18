const test = require('node:test');
const assert = require('node:assert/strict');
const { AdmissionController, AdmissionError } = require('../core/admissionController');

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

function controller(options = {}) {
  return new AdmissionController({
    maxActiveJobs: 2,
    maxActiveUnits: 4,
    maxActiveBytes: 1000,
    maxQueuedJobs: 8,
    maxQueuedBytes: 4000,
    maxWaitMs: 5000,
    maxBypasses: 3,
    ...options
  });
}

test('weighted capacity queues work until a lease is released', async t => {
  const gate = controller({ maxActiveUnits: 3 });
  t.after(() => gate.shutdown('test'));

  const first = await gate.acquire('job-a', { units: 2, bytes: 600, kind: 'image' });
  let secondAdmitted = false;
  const secondPromise = gate.acquire('job-b', { units: 2, bytes: 300, kind: 'pdf' }).then(lease => {
    secondAdmitted = true;
    return lease;
  });

  await tick();
  assert.equal(secondAdmitted, false);
  assert.deepEqual(gate.snapshot().active, { jobs: 1, units: 2, bytes: 600, kinds: { image: 1 } });
  assert.equal(gate.snapshot().queued.jobs, 1);

  assert.equal(first.release(), true);
  assert.equal(first.release(), false, 'release must be idempotent');
  const second = await secondPromise;
  assert.equal(secondAdmitted, true);
  assert.equal(gate.snapshot().active.units, 2);
  second.release();
});

test('active and queued byte budgets are enforced independently', async t => {
  const gate = controller({ maxActiveJobs: 1, maxActiveBytes: 100, maxQueuedBytes: 80 });
  t.after(() => gate.shutdown('test'));

  const active = await gate.acquire('active', { units: 1, bytes: 90 });
  const waiting = gate.acquire('waiting', { units: 1, bytes: 60 });
  await tick();

  await assert.rejects(
    gate.acquire('overflow', { units: 1, bytes: 30 }),
    error => error instanceof AdmissionError && error.code === 'ADMISSION_QUEUE_BYTES_FULL'
  );

  active.release();
  const admitted = await waiting;
  admitted.release();

  await assert.rejects(
    gate.acquire('too-large', { units: 1, bytes: 101 }),
    error => error instanceof AdmissionError && error.code === 'JOB_EXCEEDS_CAPACITY'
  );
});

test('queue count rejects excess work without disturbing existing waiters', async t => {
  const gate = controller({ maxActiveJobs: 1, maxQueuedJobs: 1 });
  t.after(() => gate.shutdown('test'));

  const active = await gate.acquire('active', { units: 1, bytes: 1 });
  const waiting = gate.acquire('waiting', { units: 1, bytes: 1 });
  await tick();
  await assert.rejects(
    gate.acquire('rejected', { units: 1, bytes: 1 }),
    error => error.code === 'ADMISSION_QUEUE_FULL'
  );
  assert.equal(gate.snapshot().queued.jobs, 1);
  active.release();
  (await waiting).release();
});

test('aborting a queued job removes it immediately', async t => {
  const gate = controller({ maxActiveJobs: 1 });
  t.after(() => gate.shutdown('test'));

  const active = await gate.acquire('active', { units: 1, bytes: 1 });
  const abort = new AbortController();
  const waiting = gate.acquire('waiting', { units: 1, bytes: 5, signal: abort.signal });
  await tick();
  assert.equal(gate.snapshot().queued.jobs, 1);
  abort.abort('user');

  await assert.rejects(waiting, error => error.code === 'ADMISSION_ABORTED');
  assert.equal(gate.snapshot().queued.jobs, 0);
  assert.equal(gate.snapshot().queued.bytes, 0);
  active.release();
});

test('queued work times out without leaking queue bytes', async t => {
  const gate = controller({ maxActiveJobs: 1, maxWaitMs: 1000 });
  t.after(() => gate.shutdown('test'));

  const active = await gate.acquire('active', { units: 1, bytes: 1 });
  const waiting = gate.acquire('waiting', { units: 1, bytes: 123 });
  await assert.rejects(waiting, error => error.code === 'ADMISSION_WAIT_TIMEOUT');
  assert.equal(gate.snapshot().queued.jobs, 0);
  assert.equal(gate.snapshot().queued.bytes, 0);
  active.release();
});

test('bounded bypassing uses spare capacity but prevents starvation', async t => {
  const gate = controller({ maxActiveJobs: 3, maxActiveUnits: 4, maxBypasses: 1 });
  t.after(() => gate.shutdown('test'));

  const largeActive = await gate.acquire('large-active', { units: 3, bytes: 1 });
  let blockedAdmitted = false;
  const blockedPromise = gate.acquire('blocked-large', { units: 2, bytes: 1 }).then(lease => {
    blockedAdmitted = true;
    return lease;
  });
  const smallOne = await gate.acquire('small-one', { units: 1, bytes: 1 });
  assert.equal(blockedAdmitted, false, 'small job should use the one spare unit');

  let smallTwoAdmitted = false;
  const smallTwoPromise = gate.acquire('small-two', { units: 1, bytes: 1 }).then(lease => {
    smallTwoAdmitted = true;
    return lease;
  });
  await tick();

  smallOne.release();
  await tick();
  assert.equal(smallTwoAdmitted, false, 'second bypass must be blocked after starvation limit is reached');
  assert.equal(gate.snapshot().queued.jobs, 2);

  largeActive.release();
  const blocked = await blockedPromise;
  const smallTwo = await smallTwoPromise;
  assert.equal(blockedAdmitted, true);
  assert.equal(smallTwoAdmitted, true);
  blocked.release();
  smallTwo.release();
});

test('queue positions are updated after earlier jobs leave', async t => {
  const gate = controller({ maxActiveJobs: 1 });
  t.after(() => gate.shutdown('test'));

  const active = await gate.acquire('active', { units: 1, bytes: 1 });
  const positions = [];
  const firstWaiting = gate.acquire('first', { units: 1, bytes: 1 });
  const secondWaiting = gate.acquire('second', {
    units: 1,
    bytes: 1,
    onPosition: update => positions.push(update.position)
  });
  await tick();
  assert.equal(gate.snapshot().queued.jobs, 2);

  gate.cancelQueued('first', 'test');
  await assert.rejects(firstWaiting, error => error.code === 'ADMISSION_ABORTED');
  assert.ok(positions.includes(1), 'second waiter should be told it moved to queue position 1');

  active.release();
  (await secondWaiting).release();
});

test('shutdown rejects queued and future admissions while active leases can release cleanly', async () => {
  const gate = controller({ maxActiveJobs: 1 });
  const active = await gate.acquire('active', { units: 1, bytes: 1, kind: 'pdf' });
  const waiting = gate.acquire('waiting', { units: 1, bytes: 1, kind: 'image' });
  await tick();

  assert.equal(gate.shutdown('SIGTERM'), 1);
  await assert.rejects(waiting, error => error.code === 'ADMISSION_SHUTDOWN');
  await assert.rejects(gate.acquire('late', { units: 1, bytes: 1 }), error => error.code === 'ADMISSION_SHUTDOWN');

  const snapshot = gate.snapshot();
  assert.equal(snapshot.closed, true);
  assert.equal(snapshot.accepting, false);
  assert.equal(snapshot.active.kinds.pdf, 1);
  assert.equal(active.release(), true);
  assert.equal(gate.snapshot().active.jobs, 0);
});

test('queue-disabled mode still accepts immediately runnable work', async () => {
  const gate = controller({ maxActiveJobs: 1, maxQueuedJobs: 0, maxQueuedBytes: 0 });
  assert.equal(gate.snapshot().accepting, true);

  const active = await gate.acquire('only', { units: 1, bytes: 1 });
  assert.equal(gate.snapshot().accepting, false);
  await assert.rejects(gate.acquire('cannot-wait', { units: 1, bytes: 1 }), error => error.code === 'ADMISSION_QUEUE_FULL');
  active.release();
  assert.equal(gate.snapshot().accepting, true);
  gate.shutdown('test');
});

test('observer callback failures never corrupt scheduler accounting', async t => {
  const gate = controller({ maxActiveJobs: 1 });
  t.after(() => gate.shutdown('test'));

  const active = await gate.acquire('active', {
    units: 1,
    bytes: 10,
    onAdmitted: () => { throw new Error('metrics backend failed'); }
  });
  assert.equal(gate.snapshot().active.jobs, 1);
  assert.equal(gate.snapshot().metrics.observerErrors, 1);

  const waiting = gate.acquire('waiting', {
    units: 1,
    bytes: 20,
    onQueued: () => { throw new Error('progress observer failed'); },
    onPosition: () => { throw new Error('position observer failed'); }
  });
  await tick();
  assert.equal(gate.snapshot().queued.jobs, 1);
  assert.ok(gate.snapshot().metrics.observerErrors >= 2);

  active.release();
  const lease = await waiting;
  assert.equal(gate.snapshot().active.jobs, 1);
  lease.release();
});
