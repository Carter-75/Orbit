const presets = ['violet', 'blue', 'teal', 'amber', 'rose', 'slate'];
const node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
let generation = 0;
export function avatarBadge(user) {
  const badge = node('span', (user.username || '?').slice(0, 1).toUpperCase());
  badge.className = `avatar-badge avatar-${presets.includes(user.avatar) ? user.avatar : 'violet'}`;
  badge.setAttribute('aria-hidden', 'true'); return badge;
}
export async function renderProfile(user, onSaved) {
  const turn = ++generation;
  document.getElementById('profile-editor')?.remove();
  if (!user) return;
  const area = node('div'); area.id = 'profile-editor';
  const status = node('p', 'Loading profile…'); status.setAttribute('role', 'status');
  area.append(node('h3', 'Your player profile'), status); document.getElementById('account-panel').append(area);
  async function request(body) {
    const response = await fetch('/api/social/profile', { method: body ? 'PATCH' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Profile could not be loaded.'); return result.user;
  }
  try {
    const profile = await request(); if (generation !== turn) return;
    status.textContent = user.emailVerified ? 'Your avatar and bio are visible to other players. Keep personal details out of your bio.' : 'Verify your email to edit your avatar and bio.';
    const preview = node('div'); preview.className = 'profile-preview'; preview.append(avatarBadge(profile), node('strong', profile.username));
    const form = node('form'); form.className = 'profile-form';
    const fieldset = node('fieldset'), legend = node('legend', 'Avatar color'); fieldset.append(legend);
    for (const preset of presets) {
      const label = node('label'), input = node('input'); input.type = 'radio'; input.name = 'avatar'; input.value = preset;
      input.checked = preset === profile.avatar; input.disabled = !user.emailVerified;
      label.append(input, avatarBadge({ username: profile.username, avatar: preset }), node('span', preset)); fieldset.append(label);
      input.onchange = () => preview.replaceChildren(avatarBadge({ ...profile, avatar: preset }), node('strong', profile.username));
    }
    const bioLabel = node('label', 'Short bio'), biography = node('input'); biography.name = 'biography'; biography.maxLength = 160; biography.value = profile.biography || ''; biography.disabled = !user.emailVerified;
    biography.setAttribute('aria-describedby', 'profile-bio-help');
    const help = node('small', 'Up to 160 characters of plain text. Keep private contact details out of your bio.'); help.id = 'profile-bio-help'; bioLabel.append(biography, help);
    const save = node('button', 'Save profile'); save.type = 'submit'; save.disabled = !user.emailVerified;
    form.append(fieldset, bioLabel, save); area.append(preview, form);
    form.onsubmit = async event => {
      event.preventDefault(); save.disabled = true;
      try {
        const updated = await request(Object.fromEntries(new FormData(form))); if (generation !== turn) return;
        preview.replaceChildren(avatarBadge(updated), node('strong', updated.username)); status.textContent = 'Profile saved.'; onSaved(updated);
      } catch (error) { if (generation === turn) status.textContent = error.message; }
      finally { if (generation === turn) save.disabled = !user.emailVerified; }
    };
  } catch (error) { if (generation === turn) status.textContent = error.message; }
}
