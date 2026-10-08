/* ============ host: the platform the page runs on ============ */

/*
 * The game reaches its host only through an adapter, so another host (a Gemini artifact, say) is one more adapter
 * file listed in HOSTS. An adapter is:
 *   id                    a short name, shown in ⚙ 진단
 *   available()           true when the page is running on this host
 *   connect(capability)   a Promise of that capability's handle, or null when the host does not give it
 *   assetUrl(id)          the URL an uploaded file is served from: a fixed prefix, then the id (the story export
 *                         finds the pictures to embed by that prefix)
 *   bindSettings(root)    optional: adds the host's own controls to the ⚙ settings sheet once it is drawn
 * An adapter outside this build (the standalone add-on, standalone/) joins with registerHost() before the game starts.
 * The handles connect() returns must offer what the game uses (and nothing else is assumed):
 *   'db'         a document store: doc(path).get() -> { exists, id, data() }, .set(data), .delete(), and
 *                collection(path) with .where(field, op, value), .orderBy(field, dir), .limit(n), .get() -> { docs },
 *                .add(data), .doc(id). Failures carry .code ('conflict', 'quota_exceeded', ...).
 *   'sample'     the model: sample(prompt, opts) -> { text, modelTierApplied } and sample.json(prompt, opts) -> the
 *                parsed reply, with opts { modelTier: 'quick' | 'default' | 'complex', cache, onText({ text }),
 *                signal, images }; sample.limits() -> { maxPromptBytes, images }. Failures carry .code, read by
 *                prompt.js (FATAL, sampleError): not_granted, rate_limited, refused, cancelled, sampling_disabled,
 *                session_expired, prompt_too_large.
 *   'assets'     the file store: upload(blob, { type }) -> { id }, list() -> { assets, usage }, delete(id)
 *   'user'       the player: id(), isOwner(), can(permission)
 *   'downloads'  save({ filename, data: Blob }) -> { status }
 */
import { claudeHost } from './host-claude.js';

const HOSTS = [claudeHost];
const NO_HOST = { id: 'none', available: () => true, connect: async () => null, assetUrl: id => id }; // a plain browser: no capabilities, the game runs in memory

let chosen = null;

export function registerHost(h) {
  HOSTS.push(h);
}

// the adapter for the host this page runs on, picked on first use (the runtime is in place before the page starts)
export function host() {
  if (!chosen) chosen = HOSTS.find(h => h.available()) || NO_HOST;
  return chosen;
}
