const el = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
let roomId = null, currentArea, timer, generation = 0;
export function setInvitationRoom(id) {
  roomId = id;
  if (currentArea) currentArea.querySelector('[data-room-status]').textContent = id ? 'You are in a game room. Choose a friend to invite.' : 'Join a published game room to invite friends.';
}
export async function renderInvitations(user, api, launchGame) {
  const turn = ++generation; clearInterval(timer); currentArea?.remove(); currentArea = null;
  if (!user) { roomId = null; return; }
  const area = el('section'); currentArea = area; area.id = 'game-invitations'; area.className = 'account-panel';
  area.append(el('h2', 'Play with friends'));
  const notice = el('p'); notice.dataset.roomStatus = ''; area.append(notice); document.querySelector('main').append(area); setInvitationRoom(roomId);
  if (!user.emailVerified) { area.append(el('p', 'Verify your email before inviting friends.')); return; }
  const status = el('p'); status.setAttribute('role', 'status');
  const form = el('form'), label = el('label', 'Friend to invite'), choice = el('select'); label.append(choice);
  const send = el('button', 'Send game invitation'); send.type = 'submit'; form.append(label, send);
  const incoming = el('div'), refresh = el('button', 'Refresh game invitations'); refresh.type = 'button'; area.append(form, status, refresh, incoming);
  let loading = false;
  async function load() {
    if (loading || turn !== generation || document.hidden) return; loading = true;
    try {
      const [friends, result] = await Promise.all([api('/social/friends'), api('/invitations')]); if (turn !== generation) return;
      const selected = choice.value; choice.replaceChildren();
      const placeholder = el('option', 'Choose a friend'); placeholder.value = ''; choice.append(placeholder);
      for (const friend of friends.friends) { const option = el('option', friend.user.username); option.value = friend.user.id; choice.append(option); }
      if (friends.friends.some(friend => friend.user.id === selected)) choice.value = selected;
      incoming.replaceChildren(el('h3', 'Invitations for you'));
      if (!result.invitations.length) incoming.append(el('p', 'No available game invitations.'));
      for (const invitation of result.invitations) {
        const card = el('article'); card.className = 'card'; card.append(el('p', `${invitation.senderName} invited you to ${invitation.projectTitle}.`));
        for (const action of ['accept', 'decline']) {
          const button = el('button', action === 'accept' ? 'Join friend' : 'Decline'); button.type = 'button';
          button.onclick = async () => {
            button.disabled = true;
            try {
              const accepted = await api(`/invitations/${invitation.id}/${action}`, {}); if (turn !== generation) return;
              if (action === 'accept') await launchGame(accepted.projectId, undefined, accepted.projectTitle, accepted.roomId);
              await load();
            } catch (error) { if (turn === generation) status.textContent = error.message; } finally { button.disabled = false; }
          }; card.append(button);
        } incoming.append(card);
      }
    } catch (error) { if (turn === generation) status.textContent = error.message; } finally { loading = false; }
  }
  form.onsubmit = async event => {
    event.preventDefault(); if (!roomId || !choice.value) { status.textContent = 'Join a room and choose a friend first.'; return; }
    send.disabled = true;
    try { await api('/invitations', { recipientId: choice.value, roomId }); if (turn === generation) status.textContent = 'Invitation sent. It expires in five minutes.'; }
    catch (error) { if (turn === generation) status.textContent = error.message; } finally { send.disabled = false; }
  };
  refresh.onclick = () => void load(); await load();
  if (turn === generation) timer = setInterval(() => void load(), 60000);
}
