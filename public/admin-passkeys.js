const el = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
let cancelCurrent;

export function renderAdminPasskeys(user, onVerified) {
  cancelCurrent?.();
  document.getElementById('admin-passkeys')?.remove();
  if (user?.role !== 'admin' || !user.emailVerified) return;
  const controller = new AbortController();
  cancelCurrent = () => controller.abort();
  const area = el('section'); area.id = 'admin-passkeys'; area.className = 'account-panel';
  const status = el('p'); status.setAttribute('role', 'status');
  const password = el('input'); password.type = 'password'; password.autocomplete = 'current-password'; password.maxLength = 128;
  const label = el('label', 'Current password (only needed to add a passkey)'); label.append(password);
  const register = el('button', 'Add administrator passkey'), verify = el('button', 'Verify administrator passkey');
  register.type = verify.type = 'button';
  area.append(el('h2', 'Administrator security'), el('p', 'Add a passkey, then verify it to unlock production moderation for up to ten minutes. Adding another key requires verification with an existing key first. Keep a backup key; account recovery does not remove passkeys.'), label, register, verify, status);
  document.querySelector('main').append(area);
  const supported = window.isSecureContext && typeof PublicKeyCredential !== 'undefined' &&
    typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function' &&
    typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function' &&
    typeof PublicKeyCredential.prototype.toJSON === 'function';
  async function call(path = '', body) {
    const response = await fetch(`/api/account/admin-passkeys${path}`, { signal: controller.signal,
      method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Passkey request failed.'); return result;
  }
  async function refresh() {
    const state = await call();
    if (controller.signal.aborted) return;
    status.textContent = `${state.count} passkey(s) enrolled. ${state.verified ? 'Administrator verification is active for this session.' : 'Verify your passkey before using production moderation.'}`;
  }
  async function ceremony(kind) {
    register.disabled = verify.disabled = true;
    status.textContent = 'Follow your browser’s passkey prompt.';
    try {
      const body = kind === 'register' ? { password: password.value } : {};
      password.value = '';
      const result = await call(`/${kind}/options`, body);
      const publicKey = kind === 'register' ? PublicKeyCredential.parseCreationOptionsFromJSON(result.options) : PublicKeyCredential.parseRequestOptionsFromJSON(result.options);
      const credential = await navigator.credentials[kind === 'register' ? 'create' : 'get']({ publicKey, signal: controller.signal });
      if (!credential) throw new Error('No passkey was returned. Please try again.');
      await call(`/${kind}/verify`, { challengeId: result.challengeId, response: credential.toJSON() });
      await refresh();
      if (!controller.signal.aborted && kind === 'authenticate') onVerified();
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error.name === 'NotAllowedError' ? 'Passkey verification was cancelled or timed out. You can try again.' : error.message;
    } finally { if (!controller.signal.aborted) register.disabled = verify.disabled = false; }
  }
  register.onclick = () => void ceremony('register');
  verify.onclick = () => void ceremony('authenticate');
  if (!supported) {
    register.disabled = verify.disabled = true;
    status.textContent = 'Administrator passkeys require a current browser on the secure Orbit site. Moderation remains locked without verification.';
  } else void refresh().catch(error => { if (!controller.signal.aborted) status.textContent = error.message; });
}
