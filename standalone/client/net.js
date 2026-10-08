// Requests to the local server, with the token made at its start. The server answers failures with a code only; this
// is where codes become words (narration failures have their own, in providers.js).
import { N_ } from '../../src/js/i18n.js';
import { tr } from './i18n.js';

const TEXT = {
  no_server: N_('Start the app with npm start, then reload this page.'),
  name_taken: N_('A profile with that name already exists.'),
  bad_name: N_('Enter a profile name (up to 40 characters).'),
  no_profile: N_('That profile is gone. Choose another in Settings.'),
  bad_settings: N_('Check the port (1 to 65535), the data folder and the names.'),
  too_large: N_('This is too large to store.'),
};
const failed = code =>
  Object.assign(new Error(tr(TEXT[code] || N_('Request failed.'))), { code: code || 'storage_error' });

// the reply as JSON, or with raw the Response itself (a stream)
export async function post(path, body, { type = 'application/json', signal, raw = false } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': type, 'X-DR-Token': window.DR_SERVER_TOKEN },
      body: body instanceof Blob || typeof body === 'string' ? body : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal && signal.aborted) throw e;
    throw failed('no_server');
  }
  // a restarted server has a new token: this page must be reloaded
  if (response.status === 403) throw failed('no_server');
  if (!response.ok) throw failed((await response.json().catch(() => ({}))).code);
  return raw ? response : response.json();
}
