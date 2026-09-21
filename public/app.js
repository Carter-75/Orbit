import { renderSocial } from './social.js';
import { createGameBridge } from './game-bridge.js';
let closeBridge;
const $ = (selector) => document.querySelector(selector);
let mode = 'login';
let user = null;
let games = [];
let statusTimer;
let resetToken;
function announce(text) {
  $('#status').textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('#status').textContent = ''; }, 7000);
}
async function api(path, body) {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Please try again.');
  return data;
}
function displayAccount() {
  if (!user) { closeBridge?.(); $('#game-frame').removeAttribute('src'); $('#play-area').hidden = true; }
  void renderSocial(user);
  $('#account-button').textContent = user ? user.username : 'Sign in';
  $('#account-panel').hidden = !user;
  if (user) $('#account-summary').textContent = `Signed in as ${user.username}. ${user.emailVerified ? 'Email verified.' : 'Check your email to verify your account.'}`;
  $('#studio').hidden = !user;
  $('#project-form').hidden = !user?.emailVerified;
  $('#studio-notice').textContent = user && !user.emailVerified ? 'Verify your email before creating or uploading games.' : '';
  if (user) void loadProjects();
}
function setMode(value) {
  mode = value;
  const register = mode === 'register';
  $('#auth-title').textContent = register ? 'Find your orbit.' : 'Welcome back.';
  $('#auth-description').textContent = register ? 'Create your free account. Your password needs at least 15 characters.' : 'Sign in to your Orbit account.';
  $('#username-field').hidden = !register;
  $('#dob-field').hidden = !register;
  $('#auth-form').elements.username.required = register;
  $('#auth-form').elements.dateOfBirth.required = register;
  $('#auth-form').elements.password.autocomplete = register ? 'new-password' : 'current-password';
  $('#auth-form').elements.identifier.type = register ? 'email' : 'text';
  $('#auth-submit').textContent = register ? 'Create account' : 'Sign in';
  $('#toggle-auth').textContent = register ? 'Already here? Sign in' : 'New here? Create an account';
  $('#auth-error').textContent = '';
}
function openAuth(register = false) { setMode(register ? 'register' : 'login'); $('#auth-dialog').showModal(); }
$('#account-button').onclick = () => user ? $('#account-panel').scrollIntoView() : openAuth();
$('#creator-button').onclick = () => user ? $('#studio').scrollIntoView() : openAuth(true);
$('#close-auth').onclick = () => $('#auth-dialog').close();
$('#toggle-auth').onclick = () => setMode(mode === 'login' ? 'register' : 'login');
$('#auth-form').onsubmit = async (event) => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(event.currentTarget));
  $('#auth-submit').disabled = true;
  $('#auth-error').textContent = '';
  try {
    const body = mode === 'register' ? { username: fields.username, email: fields.identifier, password: fields.password, dateOfBirth: fields.dateOfBirth } : { identifier: fields.identifier, password: fields.password };
    const result = await api(`/auth/${mode}`, body);
    user = result.user;
    if (!user) user = (await api('/auth/me')).user;
    displayAccount(); $('#auth-dialog').close(); $('#auth-form').reset();
    announce(mode === 'register' ? (result.emailDeliveryAvailable ? 'Your account is created. Check your email for verification.' : 'Your account is created. Email verification is awaiting delivery setup.') : 'Welcome back.');
  } catch (error) { $('#auth-error').textContent = error.message; }
  finally { $('#auth-submit').disabled = false; }
};
$('#logout').onclick = async () => { try { await api('/auth/logout', {}); user = null; displayAccount(); announce('Signed out.'); } catch (error) { announce(error.message); } };
$('#verify-button').onclick = async () => { try { await api('/auth/resend-verification', {}); announce('If verification is needed, an email will be sent.'); } catch (error) { announce(error.message); } };
$('#forgot').onclick = async () => {
  const email = $('#auth-form').elements.identifier.value.trim();
  if (!email.includes('@')) { $('#auth-error').textContent = 'Enter your email above, then choose Forgot your password.'; return; }
  try { await api('/auth/forgot-password', { email }); announce('If the account exists, a recovery email will be sent.'); }
  catch (error) { $('#auth-error').textContent = error.message; }
};
function renderGames() {
  const area = $('#games'); area.replaceChildren();
  const query = $('#search').value.toLowerCase();
  const matches = games.filter(game => `${game.title} ${game.description}`.toLowerCase().includes(query));
  if (!matches.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    const title = document.createElement('h3'); title.textContent = query ? 'No matching games yet.' : 'A new universe starts small.';
    const copy = document.createElement('p'); copy.textContent = query ? 'Try another search.' : 'The first creator games will appear here after review and publication. There are no published games yet.';
    empty.append(title, copy); area.append(empty); return;
  }
  for (const game of matches) {
    const card = document.createElement('article'); card.className = 'card';
    const title = document.createElement('h3'); title.textContent = game.title;
    const description = document.createElement('p'); description.textContent = game.description;
    card.append(title, description); area.append(card);
    const play = document.createElement('button'); play.textContent = 'Play';
    play.onclick = async () => {
      if (!user) return openAuth();
      play.disabled = true;
      try { await launchGame(game._id, undefined, game.title); }
      catch (error) { announce(error.message); }
      finally { play.disabled = false; }
    };
    card.append(play);
  }
}
$('#search').oninput = renderGames;
api('/auth/me').then(result => { user = result.user; displayAccount(); }).catch(() => {});
api('/games').then(result => { games = result.games; renderGames(); }).catch(() => {
  $('#games').textContent = 'Games could not load. Please refresh to try again.';
});
// Account-link secrets live in a URL fragment, never a request query or referrer.
const accountLink = new URLSearchParams(location.hash.slice(1));
const verifyToken = accountLink.get('verify-email');
resetToken = accountLink.get('reset-password');
if (verifyToken || resetToken) history.replaceState(null, '', location.pathname);
if (verifyToken) {
  api('/auth/verify-email', { token: verifyToken }).then(async () => {
    user = (await api('/auth/me')).user; displayAccount(); announce('Email verified.');
  }).catch(error => announce(error.message));
}
if (resetToken) $('#reset-dialog').showModal();
$('#close-reset').onclick = () => { resetToken = null; $('#reset-dialog').close(); };
$('#reset-form').onsubmit = async (event) => {
  event.preventDefault();
  const button = $('#reset-form button[type=submit]'); button.disabled = true;
  try {
    await api('/auth/reset-password', { token: resetToken, password: $('#reset-form').elements.password.value });
    resetToken = null; user = null; displayAccount(); $('#reset-form').reset(); $('#reset-dialog').close();
    openAuth(); announce('Password changed. Sign in with your new password.');
  } catch (error) { $('#reset-error').textContent = error.message; }
  finally { button.disabled = false; }
};

function element(tag, text, className) {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className;
  return node;
}
async function loadProjects() {
  try {
    const result = await api('/projects'); const area = $('#project-list'); area.replaceChildren();
    if (!result.projects.length) area.append(element('p', 'Your first game starts with a draft.'));
    for (const project of result.projects) {
      const card = element('article', '', 'card');
      card.append(element('h3', project.title), element('p', project.description), element('small', project.status));
      const open = element('button', 'Manage builds'); open.onclick = () => void loadProject(project.id);
      card.append(open); area.append(card);
    }
  } catch (error) { $('#project-list').textContent = error.message; }
}
$('#project-form').onsubmit = async event => {
  event.preventDefault(); const button = $('#project-form button'); button.disabled = true;
  try {
    const result = await api('/projects', Object.fromEntries(new FormData($('#project-form'))));
    $('#project-form').reset(); await loadProjects(); await loadProject(result.project.id); announce('Draft created. Add your first build.');
  } catch (error) { announce(error.message); } finally { button.disabled = false; }
};
async function loadProject(id) {
  try {
    const { project, versions } = await api(`/projects/${id}`); const area = $('#project-detail'); area.replaceChildren();
    area.append(element('h2', project.title), element('p', 'Upload a browser ZIP with orbit.json and an HTML entry. Up to 10 MB compressed, 30 MB expanded; builds go through review before publication.'));
    const form = document.createElement('form'); form.className = 'upload-form';
    const label = element('label', 'Game package (.zip)'); const input = document.createElement('input');
    input.type = 'file'; input.accept = '.zip'; input.required = true; label.append(input);
    const submit = element('button', 'Upload build'); submit.type = 'submit'; form.append(label, submit); area.append(form);
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true;
      try {
        const body = new FormData(); body.append('package', input.files[0]);
        const response = await fetch(`/api/projects/${id}/versions`, { method: 'POST', body });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        await loadProject(id); announce('Build validated. Preview it before submitting for review.');
      } catch (error) { announce(error.message); } finally { submit.disabled = false; }
    };
    for (const version of versions) {
      const row = element('div', '', 'version'); row.append(element('span', `${new Date(version.createdAt).toLocaleString()} · ${version.status} · ${Math.ceil(version.totalBytes / 1024)} KB`));
      const action = (label, handler) => { const button = element('button', label); button.onclick = async () => { button.disabled = true; try { await handler(); } catch (error) { announce(error.message); } finally { button.disabled = false; } }; row.append(button); };
      if (version.status !== 'staging') action('Preview', () => launchGame(id, version.id, project.title));
      if (['ready', 'rejected'].includes(version.status)) action('Submit for review', async () => { await api(`/projects/${id}/versions/${version.id}/submit`, {}); await loadProject(id); announce('Submitted for review.'); });
      if (version.status === 'approved' && project.publishedVersion !== version.id) action('Publish this version', async () => { await api(`/projects/${id}/publish`, { versionId: version.id }); await loadProject(id); await loadProjects(); games = (await api('/games')).games; renderGames(); announce('Published.'); });
      if (project.publishedVersion === version.id) row.append(element('small', 'Currently published'));
      area.append(row);
    }
  } catch (error) { announce(error.message); }
}
async function launchGame(id, versionId, title) {
  const grant = await api(`/games/${id}/launch`, versionId ? { preview: true, versionId } : {});
  closeBridge?.();
  closeBridge = createGameBridge({ frame: $('#game-frame'), grant, user, api });
  $('#play-title').textContent = title; $('#game-frame').src = grant.url; $('#play-area').hidden = false; $('#play-area').scrollIntoView();
}
$('#close-game').onclick = () => { closeBridge?.(); $('#game-frame').removeAttribute('src'); $('#play-area').hidden = true; };
