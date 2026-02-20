const statusEl = document.getElementById('status');
const cardsEl = document.getElementById('cards');
const template = document.getElementById('card-template');

const createForm = document.getElementById('create-form');
const importBtn = document.getElementById('import-btn');
const importJsonEl = document.getElementById('import-json');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff6b6b' : '#9ea8b6';
}

function commandText(command) {
  return `Champion: ${command.champion}, Musician: ${command.musician}, Banner: ${command.bannerBearer}`;
}

function displayImageUrl(imageUrl) {
  if (!imageUrl) return '/no-image.svg';
  return `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || 'Request failed');
  }

  return res.json();
}

function renderCards(models) {
  cardsEl.innerHTML = '';

  for (const model of models) {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector('.card');
    const imageEl = fragment.querySelector('.card-image');
    const nameEl = fragment.querySelector('.model-name');
    const metaEl = fragment.querySelector('.model-meta');
    const commandEl = fragment.querySelector('.command-meta');
    const stateSelect = fragment.querySelector('.state-select');
    const refreshBtn = fragment.querySelector('.refresh-image');

    card.dataset.id = model.id;
    imageEl.src = displayImageUrl(model.imageUrl);
    imageEl.addEventListener('error', () => {
      imageEl.src = '/no-image.svg';
    });
    nameEl.textContent = model.name;
    metaEl.textContent = `${model.faction || 'Unknown faction'} | Models: ${model.modelCount}`;
    commandEl.textContent = commandText(model.command);
    stateSelect.value = model.state;

    stateSelect.addEventListener('change', async () => {
      try {
        const updated = await request(`/api/models/${model.id}/state`, {
          method: 'PATCH',
          body: JSON.stringify({ state: stateSelect.value })
        });
        setStatus(`Updated ${updated.name} to ${updated.state}`);
      } catch (err) {
        setStatus(err.message, true);
      }
    });

    refreshBtn.addEventListener('click', async () => {
      try {
        const updated = await request(`/api/models/${model.id}/refresh-image`, { method: 'POST' });
        imageEl.src = displayImageUrl(updated.imageUrl);
        setStatus(`Refreshed image for ${updated.name}`);
      } catch (err) {
        if ((err.message || '').toLowerCase().includes('model not found')) {
          await loadModels();
          setStatus('Model changed on server. Reloaded list, please try again.', true);
          return;
        }
        setStatus(err.message, true);
      }
    });

    cardsEl.appendChild(fragment);
  }
}

async function loadModels() {
  try {
    const models = await request('/api/models');
    renderCards(models);
  } catch (err) {
    setStatus(err.message, true);
  }
}

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: document.getElementById('name').value.trim(),
    faction: document.getElementById('faction').value.trim(),
    modelCount: Number(document.getElementById('modelCount').value),
    command: {
      champion: Number(document.getElementById('champion').value || 1),
      musician: Number(document.getElementById('musician').value || 1),
      bannerBearer: Number(document.getElementById('bannerBearer').value || 1)
    }
  };

  try {
    const created = await request('/api/models', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setStatus(`Added ${created.name}. Looking up image in background...`);
    createForm.reset();
    document.getElementById('modelCount').value = 5;
    document.getElementById('champion').value = 1;
    document.getElementById('musician').value = 1;
    document.getElementById('bannerBearer').value = 1;
    await loadModels();
    setTimeout(loadModels, 3000);
  } catch (err) {
    setStatus(err.message, true);
  }
});

importBtn.addEventListener('click', async () => {
  let parsed;
  try {
    parsed = JSON.parse(importJsonEl.value);
  } catch {
    setStatus('Import JSON is invalid', true);
    return;
  }

  try {
    const result = await request('/api/models/import', {
      method: 'POST',
      body: JSON.stringify(parsed)
    });
    setStatus(`Imported ${result.created} units`);
    importJsonEl.value = '';
    await loadModels();
  } catch (err) {
    setStatus(err.message, true);
  }
});

loadModels();
setInterval(loadModels, 15000);
