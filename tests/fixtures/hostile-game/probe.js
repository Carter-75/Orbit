// Intentionally adversarial uploaded content for local regression tests only.
// Every network target is a disposable loopback service with synthetic data.
const sink = 'http://127.0.0.1:3042';
const results = {}, violations = new Set();
document.addEventListener('securitypolicyviolation', event => violations.add(event.effectiveDirective));
const report = () => { document.querySelector('#result').textContent = JSON.stringify({ ...results, violations: [...violations] }, null, 2); };
function attempt(name, action) {
  try { results[name] = action(); } catch (error) { results[name] = error.name; }
}
let port, sequence = 0;
const replies = new Map();
let connected;
const ready = new Promise(resolve => { connected = resolve; });
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'orbit:connected' || !event.ports[0] || port) return;
  results.handshakeFields = Object.keys(event.data).sort(); port = event.ports[0]; clearInterval(hello);
  port.onmessage = ({ data }) => { const reply = replies.get(data.id); if (reply) { replies.delete(data.id); reply(data); } };
  connected();
});
const hello = setInterval(() => parent.postMessage({ type: 'orbit:ready' }, '*'), 100);
setTimeout(() => clearInterval(hello), 10000);
async function bridge(method) {
  await ready;
  return new Promise(resolve => {
    const id = String(++sequence), timer = setTimeout(() => { replies.delete(id); resolve('timeout'); }, 3000);
    replies.set(id, message => { clearTimeout(timer); resolve(message.error || 'unexpected-success'); });
    port.postMessage({ id, method, params: {} });
  });
}
document.querySelector('#run').onclick = async () => {
  document.querySelector('#run').disabled = true;
  attempt('parentDOM', () => parent.document.body.innerText);
  attempt('cookies', () => document.cookie);
  attempt('localStorage', () => localStorage.getItem('orbit-synthetic'));
  attempt('indexedDB', () => { indexedDB.open('orbit-synthetic'); return 'unexpected-success'; });
  attempt('topNavigation', () => { top.location.href = `${sink}/top?marker=synthetic`; return 'attempted'; });
  attempt('popup', () => window.open(`${sink}/popup?marker=synthetic`) === null ? 'blocked' : 'unexpected-success');
  attempt('beacon', () => navigator.sendBeacon(`${sink}/beacon`, 'synthetic') ? 'queued' : 'blocked');
  attempt('worker', () => { new Worker('probe.js'); return 'unexpected-success'; });
  const image = new Image(); image.src = `${sink}/image?marker=synthetic`; document.body.append(image);
  const script = document.createElement('script'); script.src = `${sink}/script?marker=synthetic`; document.body.append(script);
  const frame = document.createElement('iframe'); frame.src = `${sink}/frame?marker=synthetic`; document.body.append(frame);
  const form = document.createElement('form'); form.action = `${sink}/form`; form.method = 'POST'; form.target = '_blank'; document.body.append(form); form.submit();
  results.externalFetch = await fetch(`${sink}/fetch?marker=synthetic`).then(() => 'unexpected-success', error => error.name);
  results.platformMutation = await fetch('http://127.0.0.1:3040/api/auth/logout', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).then(response => `unexpected-response-${response.status}`, error => error.name);
  results.identity = await bridge('identity.get'); results.storage = await bridge('storage.get');
  results.multiplayer = await bridge('multiplayer.join');
  // Give the browser's asynchronous CSP violation events a rendering turn.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  results.done = true; report();
};
