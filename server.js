const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const fs = require('fs/promises');
const path = require('path');
const { nanoid } = require('nanoid');
const { z } = require('zod');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const isProduction = process.env.NODE_ENV === 'production';

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'models.json');

const states = ['Unbuilt', 'Build', 'Sprayed', 'Undercoated', 'Painted'];

const commandSchema = z
  .object({
    champion: z.number().int().min(0).default(0),
    musician: z.number().int().min(0).default(0),
    bannerBearer: z.number().int().min(0).default(0)
  })
  .default({ champion: 0, musician: 0, bannerBearer: 0 });

const modelInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  faction: z.string().trim().max(120).optional().default(''),
  modelCount: z.number().int().min(1).max(500),
  command: commandSchema.optional().default({ champion: 0, musician: 0, bannerBearer: 0 }),
  state: z.enum(states).optional().default('Unbuilt')
});

const importSchema = z.array(modelInputSchema).min(1).max(1000);

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'https:', 'data:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"]
      }
    }
  })
);

const frontendOrigin = process.env.FRONTEND_ORIGIN;
app.use(
  cors({
    origin: frontendOrigin ? [frontendOrigin] : true,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Content-Type']
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(morgan(isProduction ? 'combined' : 'dev'));

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, '[]', 'utf8');
  }
}

async function readModels() {
  await ensureDataFile();
  const text = await fs.readFile(DATA_FILE, 'utf8');
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeModels(models) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(models, null, 2), 'utf8');
}

function sanitizeForSearch(value) {
  return value.replace(/[^a-zA-Z0-9 '\-]/g, '').trim();
}

async function findModelImage(name, faction = '') {
  const query = sanitizeForSearch(`${name} ${faction} warhammer`.trim());
  if (!query) return '';

  const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json`;
  const searchRes = await fetch(searchUrl, {
    headers: { 'User-Agent': 'painting-progress-app/1.0 (render)' }
  });
  if (!searchRes.ok) return '';

  const searchJson = await searchRes.json();
  const title = searchJson?.[1]?.[0];
  if (!title) return '';

  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summaryRes = await fetch(summaryUrl, {
    headers: { 'User-Agent': 'painting-progress-app/1.0 (render)' }
  });
  if (!summaryRes.ok) return '';

  const summaryJson = await summaryRes.json();
  return summaryJson?.thumbnail?.source || '';
}

function toStoredModel(input) {
  return {
    id: nanoid(),
    name: input.name,
    faction: input.faction,
    modelCount: input.modelCount,
    command: input.command,
    state: input.state,
    imageUrl: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/models', async (_req, res, next) => {
  try {
    const models = await readModels();
    res.json(models);
  } catch (err) {
    next(err);
  }
});

app.post('/api/models', async (req, res, next) => {
  try {
    const parsed = modelInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid model payload', details: parsed.error.flatten() });
    }

    const models = await readModels();
    const model = toStoredModel(parsed.data);
    model.imageUrl = await findModelImage(model.name, model.faction);
    models.push(model);
    await writeModels(models);

    return res.status(201).json(model);
  } catch (err) {
    return next(err);
  }
});

app.post('/api/models/import', async (req, res, next) => {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid import payload', details: parsed.error.flatten() });
    }

    const existing = await readModels();
    const created = [];

    for (const input of parsed.data) {
      const model = toStoredModel(input);
      model.imageUrl = await findModelImage(model.name, model.faction);
      created.push(model);
    }

    const merged = [...existing, ...created];
    await writeModels(merged);
    return res.status(201).json({ created: created.length, models: created });
  } catch (err) {
    return next(err);
  }
});

app.patch('/api/models/:id/state', async (req, res, next) => {
  try {
    const id = req.params.id;
    const parsed = z.object({ state: z.enum(states) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid state payload' });
    }

    const models = await readModels();
    const index = models.findIndex((m) => m.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Model not found' });
    }

    models[index].state = parsed.data.state;
    models[index].updatedAt = new Date().toISOString();
    await writeModels(models);

    return res.json(models[index]);
  } catch (err) {
    return next(err);
  }
});

app.post('/api/models/:id/refresh-image', async (req, res, next) => {
  try {
    const id = req.params.id;
    const models = await readModels();
    const index = models.findIndex((m) => m.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const imageUrl = await findModelImage(models[index].name, models[index].faction);
    models[index].imageUrl = imageUrl;
    models[index].updatedAt = new Date().toISOString();
    await writeModels(models);

    return res.json(models[index]);
  } catch (err) {
    return next(err);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

ensureDataFile()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Painting Progress running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize app:', err);
    process.exit(1);
  });
