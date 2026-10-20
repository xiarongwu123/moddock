const activeJobs = new Set(['queued', 'running', 'authorization_required']);
const activeConnections = new Set(['connecting', 'waiting', 'reconnecting', 'saving']);

function hasActiveWork(state) {
 return state?.jobs?.some(job => activeJobs.has(job.status)) || activeConnections.has(state?.nexusSso?.status) || state?.installations?.progress?.status === 'running';
}

function createStatePoller({ read, apply, isActive, isPaused = () => false, visibility = document,
 schedule = setTimeout, cancel = clearTimeout, activeDelay = 700, idleDelay = 15000, maxDelay = 60000 }) {
 let stopped = true, timer = null, flight = null, generation = 0, failures = 0, immediatePending = false;
 const paused = () => visibility.hidden || isPaused();
 function arm(immediate = false) {
  immediatePending ||= immediate;
  if (timer !== null) cancel(timer);
  timer = null;
  if (stopped) return;
  if (paused()) { flight?.controller.abort(); return; }
  if (flight) return;
  const delay = Math.min(maxDelay, (isActive() ? activeDelay : idleDelay) * 2 ** failures);
  timer = schedule(run, immediatePending ? 0 : delay);
  immediatePending = false;
 }
 async function run() {
  timer = null;
  if (stopped || paused() || flight) return;
  const current = { generation, controller: new AbortController() };
  flight = current;
  try {
   const next = await read(current.controller.signal);
   if (stopped || current.generation !== generation || current.controller.signal.aborted || paused()) return;
   apply(next);
   failures = 0;
  } catch {
   if (!stopped && current.generation === generation && !current.controller.signal.aborted) failures++;
  } finally {
   if (flight === current) flight = null;
   arm();
  }
 }
 function update({ immediate = false } = {}) {
  failures = 0;
  flight?.controller.abort();
  arm(immediate);
 }
 const onVisibility = () => update({ immediate: !visibility.hidden });
 return {
  start() {
   if (!stopped) return;
   stopped = false;
   generation++;
   visibility.addEventListener('visibilitychange', onVisibility);
   arm();
  },
  update,
  stop() {
   stopped = true;
   generation++;
   if (timer !== null) cancel(timer);
   timer = null;
   immediatePending = false;
   flight?.controller.abort();
   visibility.removeEventListener('visibilitychange', onVisibility);
  },
 };
}

module.exports = { createStatePoller, hasActiveWork };
