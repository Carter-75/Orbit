const section = document.createElement('section');
import { avatarBadge } from './profile.js';
section.id = 'social'; section.hidden = true;
document.querySelector('#account-panel').after(section);
const nav = document.createElement('a'); nav.href = '#social'; nav.textContent = 'Friends';
document.querySelector('nav').prepend(nav);
let currentUser;
let generation = 0;
let presenceTimer;
function node(tag, text) { const el = document.createElement(tag); el.textContent = text; return el; }
async function call(path, body, method = 'POST') {
  const res = await fetch(`/api/social${path}`, { method: body === undefined ? 'GET' : method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await res.json(); if (!res.ok) throw new Error(value.error || 'Please try again.'); return value;
}
export async function renderSocial(user) {
  clearInterval(presenceTimer);
  currentUser = user; const turn = ++generation; section.hidden = !user; section.replaceChildren();
  if (!user) return;
  const status = node('p', 'Loading your friends…'); status.setAttribute('role', 'status');
  section.append(node('h2', 'Your people.'), status);
  const action = (parent, text, fn) => {
    const button = node('button', text); button.type = 'button';
    button.onclick = async () => { button.disabled = true; status.textContent = ''; try { await fn(); } catch (error) { status.textContent = error.message; } finally { button.disabled = false; } };
    parent.append(button); return button;
  };
  action(section, 'Refresh friends', () => renderSocial(currentUser));
  const presenceLabel = node('label', 'Share my online status with friends '), presenceChoice = document.createElement('input');
  presenceChoice.type = 'checkbox'; presenceChoice.disabled = true; presenceChoice.style.width = 'auto'; presenceLabel.prepend(presenceChoice);
  section.append(presenceLabel, node('p', 'Off by default. When enabled, eligible friends can see you online while this page is active. No last-seen time is shown.'));
  const onlineLabels = new Map();
  let sharing = false, checkingPresence = false;
  async function refreshPresence() {
    if (checkingPresence || document.hidden || turn !== generation) return;
    checkingPresence = true;
    try {
      if (sharing && user.emailVerified) await call('/presence/heartbeat', {});
      const state = await call('/presence'); if (turn !== generation) return;
      sharing = state.sharing; presenceChoice.checked = sharing; presenceChoice.disabled = !user.emailVerified;
      const online = new Set(state.onlineFriendIds);
      for (const [id, label] of onlineLabels) label.textContent = online.has(id) ? 'Online' : 'Status not shared or offline';
    } catch (error) { if (turn === generation) {
      for (const label of onlineLabels.values()) label.textContent = 'Status unavailable';
      status.textContent = error.message;
    } } finally { checkingPresence = false; }
  }
  presenceChoice.onchange = async () => {
    presenceChoice.disabled = true;
    try {
      const result = await call('/presence', { sharing: presenceChoice.checked }, 'PATCH');
      if (turn !== generation) return; sharing = result.sharing;
      await refreshPresence();
    } catch (error) { status.textContent = error.message; presenceChoice.checked = sharing; }
    finally { if (turn === generation) presenceChoice.disabled = !user.emailVerified; }
  };
  const invite = document.createElement('form');
  const label = node('label', 'Add by exact username'); const input = document.createElement('input');
  input.required = true; input.maxLength = 24; label.append(input);
  const submit = node('button', 'Send friend request'); invite.append(label, submit); section.append(invite);
  invite.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true;
    try { await call('/requests', { username: input.value.trim() }); await renderSocial(currentUser); }
    catch (error) { status.textContent = error.message; } finally { submit.disabled = false; }
  };
  try {
    const [relations, blocks] = await Promise.all([call('/friends'), call('/blocks')]);
    if (turn !== generation) return;
    status.textContent = 'Friend requests require verified accounts. Teen and adult accounts currently have separate friend groups.';
    for (const [key, title] of [['incoming', 'Incoming requests'], ['outgoing', 'Sent requests'], ['friends', 'Friends']]) {
      section.append(node('h3', title));
      if (!relations[key].length) section.append(node('p', 'Nothing here yet.'));
      for (const item of relations[key]) {
        const row = node('div', item.user.username); row.className = 'version';
        row.prepend(avatarBadge(item.user));
        if (item.user.biography) row.append(node('small', item.user.biography));
        if (key === 'friends') { const online = node('small', 'Checking status…'); onlineLabels.set(item.user.id, online); row.append(online); }
        if (key === 'incoming') {
          action(row, 'Accept', async () => { await call(`/requests/${item.id}/accept`, {}); await renderSocial(currentUser); });
          action(row, 'Decline', async () => { await call(`/requests/${item.id}/reject`, {}); await renderSocial(currentUser); });
        }
        if (key === 'friends') action(row, 'Remove friend', async () => { await call('/remove', { userId: item.user.id }); await renderSocial(currentUser); });
        action(row, 'Block', async () => { await call('/block', { userId: item.user.id }); await renderSocial(currentUser); });
        action(row, 'Report player', () => reportUser(item.user.id));
        section.append(row);
      }
    }
    if (blocks.blocks.length) section.append(node('h3', 'Blocked accounts'));
    for (const entry of blocks.blocks) {
      const row = node('div', `Blocked account ${entry.userId.slice(0, 8)}`); row.className = 'version';
      action(row, 'Report player', () => reportUser(entry.userId));
      action(row, 'Unblock', async () => { await call('/unblock', { userId: entry.userId }); await renderSocial(currentUser); }); section.append(row);
    }
    await refreshPresence();
    if (turn === generation) presenceTimer = setInterval(() => void refreshPresence(), 30000);
  } catch (error) { if (turn === generation) status.textContent = error.message; }
}
import { reportUser } from './safety.js';
