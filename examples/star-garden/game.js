const $ = id => document.getElementById(id);
let me, score = 0, position = { x: 50, y: 50 }, peers = [], joined = false, lastState = 0;
const star = { x: 65, y: 50 };
const status = text => { $('status').textContent = text; };
const coordinate = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(5, Math.min(95, value)) : 50;
function render() {
  $('score').textContent = `Stars collected: ${score}`;
  $('star').style.left = `${star.x}%`; $('star').style.top = `${star.y}%`;
  const players = peers.filter(p => p.id !== me?.id).concat(me ? [{ ...me, state: position }] : []);
  $('players').replaceChildren(...players.map(player => {
    const item = document.createElement('div'); item.className = `player${player.id === me?.id ? ' self' : ''}`;
    item.style.left = `${coordinate(player.state?.x)}%`; item.style.top = `${coordinate(player.state?.y)}%`;
    const dot = document.createElement('b'), label = document.createElement('span');
    label.textContent = typeof player.username === 'string' ? player.username : 'Player'; item.append(dot, label); return item;
  }));
}
async function move(direction) {
  if (!me) return;
  const delta = { up: [0, -5], down: [0, 5], left: [-5, 0], right: [5, 0] }[direction];
  if (!delta) return;
  position = { x: coordinate(position.x + delta[0]), y: coordinate(position.y + delta[1]) };
  if (Math.hypot(position.x - star.x, position.y - star.y) < 6) {
    score++; star.x = 10 + Math.floor(Math.random() * 17) * 5; star.y = 10 + Math.floor(Math.random() * 17) * 5;
    status('Star collected! Save your progress before leaving.');
  }
  render();
  if (joined && Date.now() - lastState >= 100) { lastState = Date.now(); try { await Orbit.multiplayer.state(position); } catch (error) { status(error.message); } }
}
const keys = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
$('garden').addEventListener('keydown', event => { if (keys[event.key]) { event.preventDefault(); void move(keys[event.key]); } });
for (const button of document.querySelectorAll('[data-move]')) button.onclick = () => void move(button.dataset.move);
function action(id, run) { $(id).onclick = async () => { $(id).disabled = true; try { await run(); } catch (error) { status(error.message); } finally { $(id).disabled = false; } }; }
action('save', async () => { await Orbit.storage.set({ score }); status('Progress saved to your Orbit account.'); });
action('create', () => Orbit.multiplayer.join());
action('join', () => { const code = $('room-code').value.trim(); if (!code) throw new Error('Enter a room code.'); return Orbit.multiplayer.join(code); });
action('leave', async () => { await Orbit.multiplayer.leave(); joined = false; peers = []; $('room-status').textContent = 'You left the room.'; render(); });
action('hello', () => Orbit.multiplayer.chat(0));
Orbit.multiplayer.on(event => {
  if (event.type === 'room') {
    joined = true; peers = Array.isArray(event.players) ? event.players.slice(0, 8) : [];
    $('room-code').value = event.roomId; $('room-status').textContent = `${peers.length} player${peers.length === 1 ? '' : 's'} in this room. Share its code with a friend.`; render();
  } else if (event.type === 'chat') $('chat').textContent = `${event.username}: ${event.text}`;
  else if (event.type === 'error') status(event.error);
  else if (event.type === 'disconnected') { joined = false; peers = []; $('room-status').textContent = 'Room connection ended. Create or join a room to reconnect.'; render(); }
});
(async () => {
  try {
    me = await Orbit.identity.get(); const saved = await Orbit.storage.get();
    score = Number.isSafeInteger(saved?.score) && saved.score >= 0 ? saved.score : 0;
    status(`Welcome, ${me.username}. Collect your first star.`); render();
  } catch (error) { status(error.message); }
})();
