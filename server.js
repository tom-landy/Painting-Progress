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

const states = ['On Sprue', 'Built', 'Sprayed', 'Undercoat', 'Finished'];
const legacyStateMap = {
  Unbuilt: 'On Sprue',
  Build: 'Built',
  Undercoated: 'Undercoat',
  Painted: 'Finished'
};
const categories = ['Unit', 'Character'];

const commandSchema = z
  .object({
    champion: z.number().int().min(0).default(1),
    musician: z.number().int().min(0).default(1),
    bannerBearer: z.number().int().min(0).default(1)
  })
  .default({ champion: 1, musician: 1, bannerBearer: 1 });

const modelInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  faction: z.string().trim().max(120).optional().default(''),
  category: z.enum(categories).optional().default('Unit'),
  modelCount: z.number().int().min(1).max(500),
  progressCount: z.number().int().min(0).max(500).optional(),
  details: z.string().trim().max(4000).optional().default(''),
  command: commandSchema.optional().default({ champion: 1, musician: 1, bannerBearer: 1 }),
  state: z.enum(states).optional().default('On Sprue')
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
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
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

async function writeModels(models) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(models, null, 2), 'utf8');
}

function normalizeCommand(modelCategory, modelCommand) {
  if (modelCategory === 'Character') {
    return { champion: 0, musician: 0, bannerBearer: 0 };
  }

  return {
    champion: Number.isInteger(modelCommand?.champion) && modelCommand.champion >= 0 ? modelCommand.champion : 1,
    musician: Number.isInteger(modelCommand?.musician) && modelCommand.musician >= 0 ? modelCommand.musician : 1,
    bannerBearer: Number.isInteger(modelCommand?.bannerBearer) && modelCommand.bannerBearer >= 0 ? modelCommand.bannerBearer : 1
  };
}

async function readModels() {
  await ensureDataFile();
  const text = await fs.readFile(DATA_FILE, 'utf8');
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    let hasChanges = false;
    const normalized = parsed.map((item) => {
      const model = item && typeof item === 'object' ? item : {};
      const safeCategory = categories.includes(model.category) ? model.category : 'Unit';
      const mappedState = legacyStateMap[model.state] || model.state;
      const safeState = states.includes(mappedState) ? mappedState : 'On Sprue';
      const safeCommand = normalizeCommand(safeCategory, model.command);

      const normalizedModel = {
        id: typeof model.id === 'string' && model.id ? model.id : nanoid(),
        name: typeof model.name === 'string' && model.name ? model.name : 'Unknown Unit',
        faction: typeof model.faction === 'string' ? model.faction : '',
        category: safeCategory,
        modelCount: Number.isInteger(model.modelCount) && model.modelCount > 0 ? model.modelCount : 1,
        progressCount:
          safeCategory === 'Character'
            ? Number.isInteger(model.modelCount) && model.modelCount > 0
              ? model.modelCount
              : 1
            : Number.isInteger(model.progressCount) && model.progressCount >= 0
              ? Math.min(model.progressCount, Number.isInteger(model.modelCount) && model.modelCount > 0 ? model.modelCount : 1)
              : 0,
        details: typeof model.details === 'string' ? model.details : '',
        command: safeCommand,
        state: safeState,
        createdAt: typeof model.createdAt === 'string' ? model.createdAt : new Date().toISOString(),
        updatedAt: typeof model.updatedAt === 'string' ? model.updatedAt : new Date().toISOString()
      };

      if (
        normalizedModel.id !== model.id ||
        normalizedModel.state !== model.state ||
        normalizedModel.modelCount !== model.modelCount ||
        normalizedModel.progressCount !== model.progressCount ||
        normalizedModel.faction !== model.faction ||
        normalizedModel.category !== model.category ||
        normalizedModel.details !== model.details ||
        JSON.stringify(normalizedModel.command) !== JSON.stringify(model.command)
      ) {
        hasChanges = true;
      }

      return normalizedModel;
    });

    if (hasChanges) {
      await writeModels(normalized);
    }

    return normalized;
  } catch {
    return [];
  }
}

function toStoredModel(input) {
  const progressCount =
    input.category === 'Character'
      ? input.modelCount
      : Number.isInteger(input.progressCount)
        ? Math.max(0, Math.min(input.progressCount, input.modelCount))
        : 0;

  return {
    id: nanoid(),
    name: input.name,
    faction: input.faction,
    category: input.category,
    modelCount: input.modelCount,
    progressCount,
    details: input.details,
    command: normalizeCommand(input.category, input.command),
    state: input.state,
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
    const created = parsed.data.map((input) => toStoredModel(input));

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
    const parsed = z
      .object({
        state: z.enum(states).optional(),
        progressCount: z.number().int().min(0).max(500).optional()
      })
      .refine((value) => value.state !== undefined || value.progressCount !== undefined, {
        message: 'No update provided'
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid state payload' });
    }

    const models = await readModels();
    const index = models.findIndex((m) => m.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const model = models[index];
    if (model.category === 'Unit' && parsed.data.progressCount !== undefined) {
      model.progressCount = Math.min(parsed.data.progressCount, model.modelCount);
    }

    if (model.category === 'Character') {
      model.progressCount = model.modelCount;
    }

    if (parsed.data.state !== undefined) {
      if (model.category === 'Unit' && parsed.data.state !== 'On Sprue' && model.progressCount < model.modelCount) {
        return res
          .status(400)
          .json({ error: `Set progress count to ${model.modelCount}/${model.modelCount} before marking this unit as ${parsed.data.state}.` });
      }
      model.state = parsed.data.state;
    }

    models[index].updatedAt = new Date().toISOString();
    await writeModels(models);

    return res.json(models[index]);
  } catch (err) {
    return next(err);
  }
});

app.delete('/api/models/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const models = await readModels();
    const index = models.findIndex((m) => m.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const [removed] = models.splice(index, 1);
    await writeModels(models);
    return res.json({ deleted: true, id: removed.id, name: removed.name });
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
