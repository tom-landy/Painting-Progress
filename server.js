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
const allowedImageHostSuffixes = [
  'wikimedia.org',
  'wikipedia.org',
  'warhammer.com',
  'warhammer-community.com',
  'games-workshop.com',
  'images.ctfassets.net',
  'cdn.shopify.com',
  'scene7.com'
];

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
  modelCount: z.number().int().min(1).max(500),
  command: commandSchema.optional().default({ champion: 1, musician: 1, bannerBearer: 1 }),
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
    if (!Array.isArray(parsed)) return [];

    let hasChanges = false;
    const normalized = parsed.map((item) => {
      const model = item && typeof item === 'object' ? item : {};
      const safeState = states.includes(model.state) ? model.state : 'Unbuilt';
      const safeCommand = {
        champion: Number.isInteger(model?.command?.champion) && model.command.champion >= 0 ? model.command.champion : 1,
        musician: Number.isInteger(model?.command?.musician) && model.command.musician >= 0 ? model.command.musician : 1,
        bannerBearer:
          Number.isInteger(model?.command?.bannerBearer) && model.command.bannerBearer >= 0 ? model.command.bannerBearer : 1
      };

      const normalizedModel = {
        id: typeof model.id === 'string' && model.id ? model.id : nanoid(),
        name: typeof model.name === 'string' && model.name ? model.name : 'Unknown Unit',
        faction: typeof model.faction === 'string' ? model.faction : '',
        modelCount: Number.isInteger(model.modelCount) && model.modelCount > 0 ? model.modelCount : 1,
        command: safeCommand,
        state: safeState,
        imageUrl: typeof model.imageUrl === 'string' ? model.imageUrl : '',
        createdAt: typeof model.createdAt === 'string' ? model.createdAt : new Date().toISOString(),
        updatedAt: typeof model.updatedAt === 'string' ? model.updatedAt : new Date().toISOString()
      };

      if (
        normalizedModel.id !== model.id ||
        normalizedModel.state !== model.state ||
        normalizedModel.modelCount !== model.modelCount ||
        normalizedModel.faction !== model.faction ||
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

async function writeModels(models) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(models, null, 2), 'utf8');
}

function sanitizeForSearch(value) {
  return value.replace(/[^a-zA-Z0-9 '\-]/g, '').trim();
}

function hasAllowedImageHost(hostname) {
  return allowedImageHostSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function extractMetaImage(html) {
  const og =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i);
  if (og?.[1]) return og[1];

  const tw =
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i);
  if (tw?.[1]) return tw[1];

  return '';
}

function searchVariants(name, faction = '') {
  const raw = `${name} ${faction}`.trim();
  const cleaned = sanitizeForSearch(raw).toLowerCase();
  const deMerged = cleaned.replace(/\bseaguard\b/g, 'sea guard');
  const deHyphen = deMerged.replace(/-/g, ' ');
  const compact = deHyphen.replace(/\s+/g, ' ').trim();

  const variants = new Set();
  if (compact) variants.add(`${compact} warhammer the old world`);
  if (compact) variants.add(`${compact} miniatures`);
  if (compact) variants.add(`${compact} old world`);
  if (compact) variants.add(`${compact} warhammer.com`);
  return [...variants];
}

async function findWikipediaImage(query) {
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

async function findWarhammerImage(query) {
  try {
    const ddgUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(`site:warhammer.com ${query}`)}`;
    const ddgRes = await fetch(ddgUrl, {
      headers: { 'User-Agent': 'painting-progress-app/1.0 (render)' }
    });
    if (!ddgRes.ok) return '';

    const html = await ddgRes.text();
    const urls = [];
    for (const match of html.matchAll(/uddg=([^"&]+)/g)) {
      try {
        const decoded = decodeURIComponent(match[1]);
        const parsed = new URL(decoded);
        if (parsed.hostname === 'warhammer.com' || parsed.hostname.endsWith('.warhammer.com')) {
          urls.push(parsed.toString());
        }
      } catch {
        // Ignore malformed links.
      }
      if (urls.length >= 5) break;
    }

    for (const pageUrl of urls) {
      const pageRes = await fetch(pageUrl, {
        headers: { 'User-Agent': 'painting-progress-app/1.0 (render)' }
      });
      if (!pageRes.ok) continue;
      const pageHtml = await pageRes.text();
      const image = extractMetaImage(pageHtml);
      if (!image) continue;

      try {
        const parsed = new URL(image, pageUrl);
        if (hasAllowedImageHost(parsed.hostname)) return parsed.toString();
      } catch {
        // Ignore malformed image URLs.
      }
    }
  } catch {
    return '';
  }

  return '';
}

async function findDuckDuckGoImage(query) {
  try {
    const bootstrapUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
    const bootstrapRes = await fetch(bootstrapUrl, {
      headers: { 'User-Agent': 'painting-progress-app/1.0 (render)' }
    });
    if (!bootstrapRes.ok) return '';
    const bootstrapHtml = await bootstrapRes.text();

    const vqdMatch = bootstrapHtml.match(/vqd=['"]([^'"]+)['"]/i) || bootstrapHtml.match(/"vqd":"([^"]+)"/i);
    const vqd = vqdMatch?.[1];
    if (!vqd) return '';

    const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&p=1&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}`;
    const imageRes = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'painting-progress-app/1.0 (render)',
        Referer: 'https://duckduckgo.com/'
      }
    });
    if (!imageRes.ok) return '';
    const imageJson = await imageRes.json();
    const results = Array.isArray(imageJson?.results) ? imageJson.results : [];

    for (const result of results) {
      const candidate = result?.image || result?.thumbnail || '';
      if (!candidate || typeof candidate !== 'string') continue;
      try {
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
        return parsed.toString();
      } catch {
        // Ignore malformed URLs.
      }
    }
  } catch {
    return '';
  }

  return '';
}

async function findModelImage(name, faction = '') {
  try {
    for (const query of searchVariants(name, faction)) {
      const warhammerImage = await findWarhammerImage(query);
      if (warhammerImage) return warhammerImage;

      const generalImage = await findDuckDuckGoImage(query);
      if (generalImage) return generalImage;

      const wikiImage = await findWikipediaImage(query);
      if (wikiImage) return wikiImage;
    }
  } catch {
    return '';
  }

  return '';
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

function enqueueImageLookup(modelId) {
  setTimeout(async () => {
    try {
      const models = await readModels();
      const index = models.findIndex((m) => m.id === modelId);
      if (index === -1) return;
      if (models[index].imageUrl) return;

      const imageUrl = await findModelImage(models[index].name, models[index].faction);
      if (!imageUrl) return;

      models[index].imageUrl = imageUrl;
      models[index].updatedAt = new Date().toISOString();
      await writeModels(models);
    } catch (err) {
      console.error('Background image lookup failed:', err?.message || err);
    }
  }, 0);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/image-proxy', async (req, res, next) => {
  try {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!rawUrl) return res.status(400).json({ error: 'Missing image URL' });

    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid image URL' });
    }

    if (!['http:', 'https:'].includes(target.protocol)) {
      return res.status(400).json({ error: 'Invalid image protocol' });
    }

    if (!hasAllowedImageHost(target.hostname)) {
      return res.status(403).json({ error: 'Image host not allowed' });
    }

    const upstream = await fetch(target.toString(), {
      headers: { 'User-Agent': 'painting-progress-app/1.0 (render)' }
    });
    if (!upstream.ok) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');

    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.send(buffer);
  } catch (err) {
    return next(err);
  }
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
    enqueueImageLookup(model.id);

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
      created.push(model);
    }

    const merged = [...existing, ...created];
    await writeModels(merged);
    for (const model of created) {
      enqueueImageLookup(model.id);
    }
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
