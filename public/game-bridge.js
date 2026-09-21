// The trusted parent owns credentials. Sandboxed games only receive a private
// MessagePort; neither session cookies nor launch grants cross this boundary.
export function createGameBridge({ frame, grant, user, api }) {
  let closed = false, port, socket, windowStart = Date.now(), calls = 0, pending = 0;
  const capabilities = new Set(grant.manifest.capabilities || []);
  const emit = message => { if (!closed && port) port.postMessage(message); };
  function disconnect() { if (socket) { socket.close(); socket = null; } }
  function connect() {
    if (socket) return socket;
    const url = new URL('/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    const current = socket;
    current.onmessage = event => {
      try { emit({ event: 'multiplayer', data: JSON.parse(event.data) }); } catch { /* Invalid server frame. */ }
    };
    current.onclose = () => { if (socket === current) socket = null; emit({ event: 'multiplayer', data: { type: 'disconnected' } }); };
    current.onerror = () => emit({ event: 'multiplayer', data: { type: 'error', error: 'Connection failed.' } });
    return current;
  }
  async function request(message) {
    const { method, params = {} } = message;
    const capability = method.split('.')[0];
    if (!capabilities.has(capability)) throw new Error('This game did not declare that capability.');
    if (method === 'identity.get') return { id: user.id, username: user.username, avatar: user.avatar };
    if (method === 'storage.get' || method === 'storage.set') return api('/sdk/storage', {
      grantId: grant.grantId, operation: method.slice(8), ...(method === 'storage.set' ? { value: params.value } : {}),
    });
    if (method === 'multiplayer.leave') { disconnect(); return { left: true }; }
    if (['multiplayer.join', 'multiplayer.state', 'multiplayer.chat'].includes(method)) {
      const ws = method === 'multiplayer.join' ? connect() : socket;
      if (!ws) throw new Error('Join a room first.');
      if (ws.readyState === WebSocket.CONNECTING) await new Promise((resolve, reject) => {
        const finish = error => { clearTimeout(timer); ws.removeEventListener('open', opened); ws.removeEventListener('close', failed); error ? reject(error) : resolve(); };
        const opened = () => finish(); const failed = () => finish(new Error('Connection failed.'));
        const timer = setTimeout(failed, 5000);
        ws.addEventListener('open', opened, { once: true }); ws.addEventListener('close', failed, { once: true });
      });
      if (closed || ws.readyState !== WebSocket.OPEN) throw new Error('Connection ended.');
      const outgoing = method === 'multiplayer.join' ? { type: 'join', grantId: grant.grantId, ...(params.roomId ? { roomId: params.roomId } : {}) }
        : method === 'multiplayer.state' ? { type: 'state', state: params.state } : { type: 'chat', phrase: params.phrase };
      const json = JSON.stringify(outgoing);
      if (json.length > 4000 || ws.bufferedAmount > 65536) throw new Error('Game message is too large or connection is busy.');
      ws.send(json); return { sent: true };
    }
    throw new Error('This feature is not available.');
  }
  function ready(event) {
    if (closed || event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.type !== 'orbit:ready' || port) return;
    const channel = new MessageChannel(); port = channel.port1;
    port.onmessage = async ({ data }) => {
      if (closed || !data || typeof data.id !== 'string' || data.id.length > 80 || typeof data.method !== 'string') return;
      if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); calls = 0; }
      if (++calls > 30 || pending >= 8) { emit({ id: data.id, error: 'Request limit reached.' }); return; }
      pending++;
      try { emit({ id: data.id, result: await request(data) }); }
      catch (error) { emit({ id: data.id, error: error.message }); }
      finally { pending--; }
    };
    // '*' is necessary for an opaque sandbox origin. Transfer only a revocable
    // constrained port to this exact frame, not an auth token or a wildcard listener.
    frame.contentWindow.postMessage({ type: 'orbit:connected' }, '*', [channel.port2]);
  }
  window.addEventListener('message', ready);
  return () => { closed = true; window.removeEventListener('message', ready); port?.close(); disconnect(); };
}
