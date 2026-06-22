const loopN = 80;   // Store 80 samples of jitter history (10-20 seconds)
var loopInterval;   // Target fastLoop interval with millisecond precision
var loopHist;       // Sliding window of recent timer skew history
var loopIdx = 0;    // Next index in loopHist[]
var loopSkew;       // Sum of all entries in loopHist[]
var loopTargTs;     // Target time for next timer to fire
var timerId;        // For clearing the timer
var loopRun;        // Safety guarantee against race condition in timer clear (possibly unnecessary)

// Back-pressure between the worker and the main thread. The main thread acknowledges each
// batch once execGameLoops finishes; until then we hold off posting and let periods pile up
// in pendingPeriods. This keeps the worker from enqueuing 'main' messages faster than the
// main thread can drain them - that unbounded backlog is what previously capped real
// throughput below the selected speed and kept the game running flat-out for a while after
// the player dropped from 100x/1000x back down to a slower multiplier.
var pendingPeriods = 0; // Periods accrued but not yet handed to the main thread
var inFlight = false;   // True while a batch is awaiting acknowledgement

self.addEventListener('message', function(e){
    const data = e.data;
    switch (data.loop) {
        case 'start':
            loopInterval = data.period;
            loopHist = new Array(loopN).fill(0);
            loopSkew = 0;
            loopRun = true;
            pendingPeriods = 0;
            inFlight = false;
            loopTargTs = performance.now() + loopInterval;
            timerId = setTimeout(lowDriftTimer, loopInterval);
            break;
        case 'clear':
            loopRun = false;
            clearTimeout(timerId);
            break;
        case 'ack':
            // The main thread finished the previous batch. Release back-pressure and flush
            // anything that accrued while it was busy into a single catch-up batch.
            inFlight = false;
            flush();
            break;
    };
  }, false);

// Hands accrued periods to the main thread, but only when no batch is in flight and the
// timer is still running. While the main thread is busy, periods keep accumulating here, so
// the next batch performs several turns' worth of work in one execGameLoops call instead of
// one message (and one round-trip) per turn.
function flush(){
    if (!loopRun || inFlight || pendingPeriods <= 0){ return; }
    const periods = pendingPeriods;
    pendingPeriods = 0;
    inFlight = true;
    self.postMessage({ loop: 'main', periods: periods });
}

function lowDriftTimer(){
    const ts = performance.now();
    const jitter = ts - loopTargTs;
    let periods = 1;

    if (jitter > loopInterval){
        // High error mode: run multiple fastLoop calls at once
        periods += Math.floor(jitter / loopInterval);

        // Slowly discard skew history in case it's related to the cause of high skew
        loopSkew -= loopHist[loopIdx];
        loopHist[loopIdx] = 0;

        // Create new baseline timestamp due to high drift
        loopTargTs = ts + loopInterval;
    }
    else {
        // Accumulate skew history normally
        loopSkew += jitter - loopHist[loopIdx];
        loopHist[loopIdx] = jitter;

        // Use existing baseline timestamp
        loopTargTs += loopInterval;
    }

    // Cancel out recent skew to center jitter near zero
    const timeout = (loopTargTs - ts) - (loopSkew / loopN);

    // Paranoid: in case clearTimeout does not take effect before the event loop calls
    // the scheduled timeout for lowDriftTimer, these timeouts will continue forever
    if (loopRun){
        timerId = setTimeout(lowDriftTimer, timeout);
    }

    // Accrue this tick's periods, then hand them off subject to back-pressure. Not gated on
    // pause here: gameLoop('start'/'stop') drives loopRun, and flush() respects it.
    pendingPeriods += periods;
    flush();

    if (++loopIdx === loopN){ loopIdx = 0; }
}
