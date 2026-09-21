// Copy into your uploaded ZIP and load before your game's script.
(() => {
  let port, sequence = 0;
  const pending = new Map(), listeners = new Set();
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  function connected(event) {
    if (event.source !== parent || event.data?.type !== 'orbit:connected' || !event.ports[0] || port) return;
    port = event.ports[0]; clearInterval(hello); window.removeEventListener('message', connected);
    port.onmessage = ({ data }) => {
      if (data.event === 'multiplayer') { for (const listener of listeners) { try { listener(data.data); } catch (error) { console.error(error); } } return; }
      const waiter = pending.get(data.id); if (!waiter) return;
      clearTimeout(waiter.timer); pending.delete(data.id);
      data.error ? waiter.reject(new Error(data.error)) : waiter.resolve(data.result);
    };
    resolveReady();
  }
  window.addEventListener('message', connected);
  const hello = setInterval(() => parent.postMessage({ type: 'orbit:ready' }, '*'), 250);
  setTimeout(() => clearInterval(hello), 10000);
  async function call(method, params = {}) {
    await Promise.race([ready, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Open this game inside Orbit.')), 10000); ready.then(() => clearTimeout(timer)); })]);
    return new Promise((resolve, reject) => {
      const id = String(++sequence);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Orbit request timed out.')); }, 10000);
      pending.set(id, { resolve, reject, timer }); port.postMessage({ id, method, params });
    });
  }
  window.Orbit = Object.freeze({
    ready, identity: { get: () => call('identity.get') },
    storage: { get: async () => (await call('storage.get')).value, set: value => call('storage.set', { value }) },
    multiplayer: {
      join: roomId => call('multiplayer.join', { roomId }), leave: () => call('multiplayer.leave'),
      state: state => call('multiplayer.state', { state }), chat: phrase => call('multiplayer.chat', { phrase }),
      on: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    },
  });
})();
