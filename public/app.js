const statusEl = document.getElementById('status');
const cardsEl = document.getElementById('cards');
const template = document.getElementById('card-template');

const createForm = document.getElementById('create-form');
const massImportBtn = document.getElementById('mass-import-btn');
const massImportTextEl = document.getElementById('mass-import-text');
const armyFilterEl = document.getElementById('army-filter');
const categoryEl = document.getElementById('category');
const commandFieldsEl = document.getElementById('command-fields');

let allModels = [];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff6b6b' : '#9ea8b6';
}

function commandText(command) {
  return `Champion: ${command.champion}, Musician: ${command.musician}, Banner: ${command.bannerBearer}`;
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

function filteredModels() {
  const selectedArmy = armyFilterEl.value;
  if (!selectedArmy || selectedArmy === 'ALL') return allModels;
  return allModels.filter((model) => model.faction === selectedArmy);
}

function renderCards(models) {
  cardsEl.innerHTML = '';

  for (const model of models) {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector('.card');
    const deleteBtn = fragment.querySelector('.delete-btn');
    const nameEl = fragment.querySelector('.model-name');
    const metaEl = fragment.querySelector('.model-meta');
    const categoryEl = fragment.querySelector('.category-meta');
    const commandEl = fragment.querySelector('.command-meta');
    const detailsEl = fragment.querySelector('.details-text');
    const stateSelect = fragment.querySelector('.state-select');

    card.dataset.id = model.id;
    card.dataset.state = model.state;
    nameEl.textContent = model.name;
    metaEl.textContent = `${model.faction || 'Unknown army'} | Models: ${model.modelCount}`;
    categoryEl.textContent = `Category: ${model.category || 'Unit'}`;

    if ((model.category || 'Unit') === 'Character') {
      commandEl.textContent = '';
      commandEl.style.display = 'none';
    } else {
      commandEl.textContent = commandText(model.command);
      commandEl.style.display = 'block';
    }
    detailsEl.value = model.details || '';

    stateSelect.value = model.state;

    stateSelect.addEventListener('change', async () => {
      try {
        const updated = await request(`/api/models/${model.id}/state`, {
          method: 'PATCH',
          body: JSON.stringify({ state: stateSelect.value })
        });
        card.dataset.state = updated.state;
        setStatus(`Updated ${updated.name} to ${updated.state}`);
      } catch (err) {
        setStatus(err.message, true);
      }
    });

    deleteBtn.addEventListener('click', async () => {
      const confirmed = window.confirm(`Delete ${model.name}?`);
      if (!confirmed) return;

      try {
        const deleted = await request(`/api/models/${model.id}`, { method: 'DELETE' });
        setStatus(`Deleted ${deleted.name}`);
        await loadModels();
      } catch (err) {
        setStatus(err.message, true);
      }
    });

    cardsEl.appendChild(fragment);
  }
}

function renderCurrentView() {
  renderCards(filteredModels());
}

async function loadModels() {
  try {
    const models = await request('/api/models');
    allModels = Array.isArray(models) ? models : [];
    renderCurrentView();
  } catch (err) {
    setStatus(err.message, true);
  }
}

function parseArmyListText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let parsedArmy = '';
  for (const line of lines) {
    const armyMatch = line.match(/^(.+?)\s*\[\d+\s*pts\]$/i);
    if (armyMatch && !line.startsWith('++') && !line.startsWith('--')) {
      parsedArmy = armyMatch[1].trim();
      break;
    }
  }

  let current = null;
  let currentCategory = 'Unit';
  const units = [];

  const flushCurrent = () => {
    if (!current) return;
    if (current.category === 'Character') {
      current.command = { champion: 0, musician: 0, bannerBearer: 0 };
    }
    units.push(current);
    current = null;
  };

  for (const line of lines) {
    const sectionMatch = line.match(/^\+\+\s*(.+?)\s*\[\d+\s*pts\]\s*\+\+$/i);
    if (sectionMatch) {
      flushCurrent();
      const section = sectionMatch[1].toLowerCase();
      currentCategory = section.includes('character') ? 'Character' : 'Unit';
      continue;
    }

    if (line.startsWith('===') || line.startsWith('---') || line.startsWith('-- ')) {
      flushCurrent();
      continue;
    }

    const withCountMatch = line.match(/^(\d+)\s+(.+?)\s+\[\d+\s*pts\]$/i);
    const singleMatch = line.match(/^(.+?)\s+\[\d+\s*pts\]$/i);

    if (withCountMatch) {
      flushCurrent();
      current = {
        category: currentCategory,
        name: withCountMatch[2].trim(),
        modelCount: Number(withCountMatch[1]),
        details: '',
        command: { champion: 0, musician: 0, bannerBearer: 0 }
      };
      continue;
    }

    if (singleMatch && !line.startsWith('[')) {
      if (singleMatch[1].trim() === parsedArmy) continue;
      flushCurrent();
      current = {
        category: currentCategory,
        name: singleMatch[1].trim(),
        modelCount: 1,
        details: '',
        command: { champion: 0, musician: 0, bannerBearer: 0 }
      };
      continue;
    }

    if (current && line.startsWith('-')) {
      const cleanLine = line.replace(/^\-\s*/, '').trim();
      if (cleanLine) {
        current.details = current.details ? `${current.details}\n${cleanLine}` : cleanLine;
      }

      if (current.category !== 'Character') {
        const lower = line.toLowerCase();
        if (/musician/.test(lower)) current.command.musician = 1;
        if (/standard bearer|banner bearer|battle standard bearer|\bbanner\b/.test(lower)) current.command.bannerBearer = 1;
        if (/champion|preceptor|sergeant/.test(lower)) current.command.champion = 1;
      }
    }
  }

  flushCurrent();

  return {
    parsedArmy,
    units
  };
}

function syncCategoryUI() {
  const isCharacter = categoryEl.value === 'Character';
  commandFieldsEl.style.display = isCharacter ? 'none' : 'grid';
}

categoryEl.addEventListener('change', syncCategoryUI);

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const selectedArmy = armyFilterEl.value;
  if (!selectedArmy || selectedArmy === 'ALL') {
    setStatus('Select an army first so this entry is tagged correctly.', true);
    return;
  }

  const category = categoryEl.value;
  const payload = {
    name: document.getElementById('name').value.trim(),
    faction: selectedArmy,
    category,
    modelCount: Number(document.getElementById('modelCount').value),
    details: document.getElementById('details').value.trim(),
    command:
      category === 'Character'
        ? { champion: 0, musician: 0, bannerBearer: 0 }
        : {
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
    setStatus(`Added ${created.name}`);
    createForm.reset();
    categoryEl.value = 'Unit';
    document.getElementById('modelCount').value = 5;
    document.getElementById('champion').value = 1;
    document.getElementById('musician').value = 1;
    document.getElementById('bannerBearer').value = 1;
    document.getElementById('details').value = '';
    syncCategoryUI();
    await loadModels();
  } catch (err) {
    setStatus(err.message, true);
  }
});

massImportBtn.addEventListener('click', async () => {
  const rawText = massImportTextEl.value.trim();
  if (!rawText) {
    setStatus('Paste an army list first.', true);
    return;
  }

  const { parsedArmy, units } = parseArmyListText(rawText);
  if (!units.length) {
    setStatus('No units found in pasted text.', true);
    return;
  }

  const selectedArmy = armyFilterEl.value;
  const finalArmy = selectedArmy && selectedArmy !== 'ALL' ? selectedArmy : parsedArmy;
  if (!finalArmy) {
    setStatus('Select an army from the dropdown first.', true);
    return;
  }

  const payload = units.map((unit) => ({
    name: unit.name,
    faction: finalArmy,
    category: unit.category,
    modelCount: unit.modelCount,
    details: unit.details || '',
    command: unit.command,
    state: 'Unbuilt'
  }));

  try {
    const result = await request('/api/models/import', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setStatus(`Created ${result.created} entries from pasted list.`);
    massImportTextEl.value = '';
    armyFilterEl.value = finalArmy;
    await loadModels();
  } catch (err) {
    setStatus(err.message, true);
  }
});

armyFilterEl.addEventListener('change', () => {
  renderCurrentView();
});

syncCategoryUI();
loadModels();
setInterval(loadModels, 15000);
