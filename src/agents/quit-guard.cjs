'use strict';

// Holds every quit request until cleanup has finished or the cap has passed.
// One shared cleanup promise serves all requests, so a second Quit while cleaning up
// is also held and nothing exits before the cleanup is done.
function createQuitGuard({ cleanup, capMs, quit }) {
  let pending = null;
  let allowed = false;
  return function beforeQuit(event) {
    if (allowed) return;
    event.preventDefault();
    if (pending) return;
    const cap = new Promise(resolve => setTimeout(resolve, capMs).unref());
    // Start the cleanup now, in this turn, so it cannot be skipped by an exit that follows.
    let work;
    try { work = cleanup(); } catch { work = null; }
    pending = Promise.race([Promise.resolve(work), cap]).catch(() => {}).finally(() => {
      allowed = true;
      quit();
    });
  };
}

module.exports = { createQuitGuard };
