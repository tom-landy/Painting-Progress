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
const stateOrder = {
  Unbuilt: 0,
  Build: 1,
  Sprayed: 2,
  Undercoated: 3,
  Painted: 4
};
const orderedStates = ['Unbuilt', 'Build', 'Sprayed', 'Undercoated', 'Painted'];
const categoryOrder = { Character: 0, Unit: 1 };

function generalPriority(model) {
  if ((model.category || 'Unit') !== 'Character') return 1;
  return /\bgeneral\b/i.test(model.details || '') ? 0 : 1;
}

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
  const base = !selectedArmy || selectedArmy === 'ALL' ? allModels : allModels.filter((model) => model.faction === selectedArmy);

  return [...base].sort((a, b) => {
    const stateDiff = (stateOrder[a.state] ?? 999) - (stateOrder[b.state] ?? 999);
    if (stateDiff !== 0) return stateDiff;
    const categoryDiff = (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99);
    if (categoryDiff !== 0) return categoryDiff;
    const generalDiff = generalPriority(a) - generalPriority(b);
    if (generalDiff !== 0) return generalDiff;
    return a.name.localeCompare(b.name);
  });
}

function createCardElement(model) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.card');
  const deleteBtn = fragment.querySelector('.delete-btn');
  const nameEl = fragment.querySelector('.model-name');
  const metaEl = fragment.querySelector('.model-meta');
  const categoryEl = fragment.querySelector('.category-meta');
  const commandEl = fragment.querySelector('.command-meta');
  const detailsEl = fragment.querySelector('.details-text');
  const stateSelect = fragment.querySelector('.state-select');
  const progressLabelEl = fragment.querySelector('.progress-label');
  const progressInputEl = fragment.querySelector('.progress-count');

  card.dataset.id = model.id;
  card.dataset.state = model.state;
  nameEl.textContent = model.name;
  metaEl.textContent = `${model.faction || 'Unknown army'} | Models: ${model.modelCount}`;
  categoryEl.textContent = `Category: ${model.category || 'Unit'}`;

  if ((model.category || 'Unit') === 'Character') {
    commandEl.textContent = '';
    commandEl.style.display = 'none';
    progressLabelEl.style.display = 'none';
    progressInputEl.style.display = 'none';
  } else {
    commandEl.textContent = commandText(model.command);
    commandEl.style.display = 'block';
    progressLabelEl.style.display = 'inline';
    progressInputEl.style.display = 'block';
  }
  detailsEl.value = model.details || '';

  stateSelect.value = model.state;
  progressInputEl.max = String(model.modelCount);
  progressInputEl.min = '0';
  progressInputEl.value = String(model.progressCount ?? 0);

  stateSelect.addEventListener('change', async () => {
    try {
      const updated = await request(`/api/models/${model.id}/state`, {
        method: 'PATCH',
        body: JSON.stringify({
          state: stateSelect.value,
          progressCount: Number(progressInputEl.value || 0)
        })
      });
      card.dataset.state = updated.state;
      progressInputEl.value = String(updated.progressCount ?? progressInputEl.value);
      setStatus(`Updated ${updated.name} to ${updated.state}`);
      await loadModels();
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  progressInputEl.addEventListener('change', async () => {
    if ((model.category || 'Unit') === 'Character') return;
    try {
      const nextValue = Number(progressInputEl.value || 0);
      const updated = await request(`/api/models/${model.id}/state`, {
        method: 'PATCH',
        body: JSON.stringify({ progressCount: nextValue })
      });
      progressInputEl.value = String(updated.progressCount ?? nextValue);
      setStatus(`Updated ${updated.name} count to ${updated.progressCount}/${updated.modelCount}`);
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

  return fragment;
}

function renderFlatCards(models) {
  cardsEl.classList.remove('grouped');
  cardsEl.innerHTML = '';
  for (const model of models) {
    cardsEl.appendChild(createCardElement(model));
  }
}

function renderGroupedByArmy(models) {
  cardsEl.classList.add('grouped');
  cardsEl.innerHTML = '';

  const byArmy = new Map();
  for (const model of models) {
    const army = model.faction || 'Unknown army';
    if (!byArmy.has(army)) byArmy.set(army, []);
    byArmy.get(army).push(model);
  }

  const armies = [...byArmy.keys()].sort((a, b) => a.localeCompare(b));
  for (const army of armies) {
    const section = document.createElement('section');
    section.className = 'army-section';

    const title = document.createElement('h3');
    title.className = 'army-title';
    title.textContent = army;
    section.appendChild(title);

    const armyModels = byArmy.get(army);
    for (const state of orderedStates) {
      const stateModels = armyModels
        .filter((m) => m.state === state)
        .sort((a, b) => {
          const categoryDiff = (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99);
          if (categoryDiff !== 0) return categoryDiff;
          const generalDiff = generalPriority(a) - generalPriority(b);
          if (generalDiff !== 0) return generalDiff;
          return a.name.localeCompare(b.name);
        });

      if (!stateModels.length) continue;

      const stateSection = document.createElement('div');
      stateSection.className = 'state-section';

      const stateTitle = document.createElement('h4');
      stateTitle.className = 'state-title';
      stateTitle.textContent = state;
      stateSection.appendChild(stateTitle);

      const stateGrid = document.createElement('div');
      stateGrid.className = 'state-grid';
      for (const model of stateModels) {
        stateGrid.appendChild(createCardElement(model));
      }

      stateSection.appendChild(stateGrid);
      section.appendChild(stateSection);
    }

    cardsEl.appendChild(section);
  }
}

function renderCurrentView() {
  const selectedArmy = armyFilterEl.value;
  const models = filteredModels();
  if (!selectedArmy || selectedArmy === 'ALL') {
    renderGroupedByArmy(models);
    return;
  }
  renderFlatCards(models);
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
    progressCount: category === 'Character' ? Number(document.getElementById('modelCount').value) : 0,
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
    progressCount: unit.category === 'Character' ? unit.modelCount : 0,
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
