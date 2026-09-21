const el = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
let currentUser, section;
async function call(path, body) {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Please try again.'); return result;
}
export function renderSafety(user) {
  currentUser = user;
  section?.remove(); section = null;
  if (!user) return;
  section = el('section'); section.id = 'safety'; section.className = 'account-panel';
  section.append(el('h2', 'Help & safety'), el('p', 'Report a game or account, or ask for help. Do not include passwords, payment details, or private personal information. This is not an emergency service.'));
  const form = el('form'); form.className = 'safety-form';
  function field(name, label, node) { const wrapper = el('label', label); node.name = name; wrapper.append(node); form.append(wrapper); return node; }
  const select = options => { const node = el('select'); for (const [value, label] of options) { const option = el('option', label); option.value = value; node.append(option); } return node; };
  field('kind', 'Request type', select([['support', 'Get help'], ['report', 'Report content or a player']]));
  field('category', 'Category', select(['technical', 'account', 'harassment', 'unsafe-content', 'scam', 'copyright', 'other'].map(x => [x, x.replace('-', ' ')])));
  field('targetType', 'Reported item (optional for help)', select([['', 'No specific item'], ['project', 'Game'], ['user', 'Player']]));
  const target = field('targetId', 'Item ID', el('input')); target.maxLength = 36;
  const message = field('message', 'What happened?', el('textarea')); message.required = true; message.minLength = 10; message.maxLength = 2000; message.rows = 4;
  const submit = el('button', 'Send request'); submit.type = 'submit'; form.append(submit);
  const status = el('p'); status.setAttribute('role', 'status');
  const history = el('div');
  async function refresh() {
    const owner = user.id;
    try {
      const result = await call('/safety/cases'); if (currentUser?.id !== owner) return;
      history.replaceChildren(el('h3', 'Your recent requests'));
      if (!result.cases.length) history.append(el('p', 'No requests yet.'));
      for (const item of result.cases) {
        const card = el('article'); card.className = 'card';
        card.append(el('h4', `${item.category} · ${item.status}`), el('p', item.message), el('small', `Reference: ${item.id}`));
        if (item.publicReply) card.append(el('p', `Orbit response: ${item.publicReply}`)); history.append(card);
      }
    } catch (error) { status.textContent = error.message; }
  }
  form.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      if (!body.targetType && !body.targetId) { delete body.targetType; delete body.targetId; }
      const result = await call('/safety/cases', body); form.reset(); status.textContent = `Received. Reference: ${result.case.id}. Check here for a response.`; await refresh();
    } catch (error) { status.textContent = error.message; } finally { submit.disabled = false; }
  };
  const reload = el('button', 'Refresh requests'); reload.onclick = () => void refresh();
  section.append(form, status, reload, history); document.querySelector('main').append(section); void refresh();
}
export function reportGame(id) {
  reportItem('project', id);
}
export function reportUser(id) {
  reportItem('user', id);
}
function reportItem(type, id) {
  if (!section) return;
  const form = section.querySelector('form'); form.elements.kind.value = 'report'; form.elements.targetType.value = type; form.elements.targetId.value = id;
  form.elements.category.value = type === 'user' ? 'harassment' : 'unsafe-content';
  section.scrollIntoView(); form.elements.message.focus();
}

export async function renderModeration(user, launchGame) {
  document.getElementById('moderation')?.remove();
  if (user?.role !== 'admin') return;
  const area = el('section'); area.id = 'moderation'; area.className = 'account-panel';
  area.append(el('h2', 'Moderator workspace'), el('p', 'Review the actual build before approving it. Case closure does not automatically suspend a game or account. Record an internal reason and a separate response safe to show the reporter.'));
  const status = el('p'); status.setAttribute('role', 'status'); const content = el('div');
  function button(parent, label, action) {
    const control = el('button', label); control.type = 'button'; control.onclick = async () => { control.disabled = true; try { await action(); } catch (error) { status.textContent = error.message; } finally { control.disabled = false; } }; parent.append(control);
  }
  function textField(parent, label) { const wrapper = el('label', label), input = el('textarea'); input.rows = 2; input.minLength = 10; input.maxLength = 2000; wrapper.append(input); parent.append(wrapper); return input; }
  async function refresh() {
    const [queue, cases] = await Promise.all([call('/admin/queue'), call('/admin/cases')]);
    content.replaceChildren(el('h3', 'Build review'));
    if (!queue.versions.length) content.append(el('p', 'No builds awaiting review.'));
    for (const version of queue.versions) {
      const card = el('article'); card.className = 'card';
      card.append(el('h4', version.projectTitle), el('p', `Build: ${version.id}. Capabilities: ${(version.manifest.capabilities || []).join(', ') || 'none'}.`));
      button(card, 'Preview build', () => launchGame(version.projectId, version.id, version.projectTitle));
      const reason = textField(card, 'Review reason (creator can see this)');
      for (const decision of ['approve', 'reject']) button(card, decision === 'approve' ? 'Approve build' : 'Reject build', async () => {
        await call(`/admin/versions/${version.id}/review`, { decision, reason: reason.value }); await refresh(); status.textContent = 'Review recorded.';
      }); content.append(card);
    }
    content.append(el('h3', 'Reports & support'));
    if (!cases.cases.length) content.append(el('p', 'No open cases.'));
    for (const item of cases.cases) {
      const card = el('article'); card.className = 'card';
      card.append(el('h4', `${item.kind} · ${item.category}`), el('p', item.message), el('small', `Case ${item.id}${item.targetId ? ` · ${item.targetType}: ${item.targetId}` : ''}`));
      const reason = textField(card, 'Internal reason'), reply = textField(card, 'Response to reporter');
      if (item.targetId) button(card, `Suspend reported ${item.targetType === 'project' ? 'game' : 'account'}`, async () => {
        if (!confirm('Suspend this reported item? Review the evidence first. This action takes effect immediately.')) return;
        await call(`/admin/${item.targetType === 'project' ? 'projects' : 'users'}/${item.targetId}/suspend`, { reason: reason.value }); status.textContent = 'Suspension recorded. Resolve the case separately.';
      });
      for (const outcome of ['resolved', 'dismissed']) button(card, outcome === 'resolved' ? 'Resolve case' : 'Dismiss case', async () => {
        await call(`/admin/cases/${item.id}/resolve`, { outcome, reason: reason.value, publicReply: reply.value }); await refresh(); status.textContent = 'Case decision recorded.';
      }); content.append(card);
    }
  }
  button(area, 'Refresh moderation queue', refresh); area.append(status, content); document.querySelector('main').append(area);
  try { await refresh(); } catch (error) { status.textContent = error.message; }
}
