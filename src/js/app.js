/* ============ app identity ============ */

export const APP_VERSION = __APP_VERSION__; // package.json "version", set by the bundler (tools/bundle.mjs)
export const REPO_URL = 'https://github.com/wonjoonSeol/dice-roguelife'; // fixed here, never taken from anywhere remote
export const RELEASES_URL = REPO_URL + '/releases';

/* ============ app state ============ */
// The data the whole app shares. Code anywhere may read and change it; the persistence code (persistence.js)
// decides when it is written to the database.
export const app = {
  saves: [], // the save cards in the saves tab
  currentSave: null, // the card of the save that is open
  state: null, // the open life: stats, cast, clock, memory... (written to states/items/<id>)
  turns: [], // the loaded turn rows of the open save
  images: [], // the image library index
  setMeta: {}, // character set cards by key
  settings: { tier: 'default' }, // this player's settings
  pendingRoll: null, // a rolled fate waiting on the new life form
  phase: 'idle', // what the game is doing, see exclusive() below
  turn: null, // the reply being written (turn.js runTurn): the log reads its heading for the live box
};

/* ============ one action at a time ============ */
// A send, a rewrite, a retry, the opening reply, the life ledger and a branch each hold the game until they finish,
// so two of them never write the same save at once. While one runs, app.phase is
//   'busy'       saving rows, rolling back, picking dice
//   'narrating'  waiting for the narrator's reply (the log shows the live box)
//   'ledger'     waiting for the life ledger (the log shows the live box)
// and it is back to 'idle' when the action is over, however it ended.
// Leaving the open save (persistence.js leaveOpenSave) abandons the running action: the game is idle at once, and
// the action checks currentRun().abandoned after each wait so nothing it does later lands in the next save.
let running = null; // the action holding the game, with its abandoned flag

export function isIdle() {
  return app.phase === 'idle';
}
export function waitingForReply() {
  return app.phase === 'narrating' || app.phase === 'ledger';
}
export function currentRun() {
  return running;
}
export async function exclusive(action) {
  if (!isIdle()) return;
  const run = { abandoned: false };
  running = run;
  app.phase = 'busy';
  try {
    return await action();
  } finally {
    if (running === run) {
      running = null;
      app.phase = 'idle';
    }
  }
}
export function abandonAction() {
  if (!running) return;
  running.abandoned = true;
  running = null;
  app.phase = 'idle';
  if (app.turn) {
    app.turn.abort.abort(); // stop the reply being written; its turn sees run.abandoned and drops it
    app.turn = null;
  }
}
