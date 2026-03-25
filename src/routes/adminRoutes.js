const express = require('express');
const { Op } = require('sequelize');
const { ensureAdmin } = require('../middleware/auth');
const { validateAdmin } = require('../services/authService');
const {
  collectFromSource,
  searchVideosAcrossSources,
  collectOneFromSource,
  fetchSourceTypes
} = require('../services/collectorService');
const { CollectorSource, SourceParser, CollectorJobLog, Video, Category } = require('../models');

const router = express.Router();
const collectTaskStore = new Map();

function createCollectTask(source, options) {
  const taskId = `collect_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const task = {
    id: taskId,
    sourceId: source.id,
    sourceName: source.name,
    mode: options.mode,
    startPage: options.startPage,
    endPage: options.endPage,
    typeId: options.typeId,
    hours: options.hours,
    status: 'running',
    stopRequested: false,
    currentPage: options.startPage,
    stopReason: '',
    lastPage: options.startPage,
    totalPages: 0,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: '',
    logs: [`任务创建成功，来源：${source.name}`],
    pageResults: [],
    currentBatchPage: options.startPage,
    currentBatchTitles: [],
    currentBatchFetchedCount: 0,
    currentBatchItems: []
  };
  collectTaskStore.set(taskId, task);
  return task;
}

function trimTaskBuffer(task) {
  if (task.logs.length > 200) {
    task.logs = task.logs.slice(task.logs.length - 200);
  }
  if (task.pageResults.length > 200) {
    task.pageResults = task.pageResults.slice(task.pageResults.length - 200);
  }
}

function updateCollectTask(task, event) {
  if (!task || !event) {
    return;
  }

  if (event.page) {
    task.currentPage = event.page;
    task.lastPage = event.page;
  }

  if (event.totalStats) {
    task.importedCount = Number(event.totalStats.importedCount || 0);
    task.updatedCount = Number(event.totalStats.updatedCount || 0);
    task.skippedCount = Number(event.totalStats.skippedCount || 0);
  }

  if (event.totalPages !== undefined && event.totalPages !== null) {
    task.totalPages = Math.max(Number(task.totalPages || 0), Number(event.totalPages || 0));
  }

  if (event.type === 'page_start') {
    const categoryInfo = task.typeId > 0 && event.categoryParam ? `（分类参数: ${event.categoryParam}）` : '';
    task.logs.push(`开始采集第 ${event.page} 页${categoryInfo}`);
  }

  if (event.type === 'page_empty') {
    const streak = Number(event.emptyPageStreak || 1);
    const threshold = Number(event.emptyPageThreshold || 1);
    const categoryInfo = task.typeId > 0 && event.categoryParam ? `（分类参数: ${event.categoryParam}）` : '';
    if (event.willStop) {
      task.logs.push(`第 ${event.page} 页无数据${categoryInfo}，连续空页 ${streak}/${threshold}，采集结束`);
      task.stopReason = threshold > 1 ? 'empty_page_threshold' : 'empty_page';
    } else {
      task.logs.push(`第 ${event.page} 页无数据${categoryInfo}，连续空页 ${streak}/${threshold}，继续探测下一页`);
    }
  }

  if (event.type === 'category_param_switch') {
    task.logs.push(`分类参数自动切换：${event.from || '-'} -> ${event.to || '-'}（第 ${event.page} 页）`);
  }

  if (event.type === 'page_done') {
    const pageStats = event.pageStats || {};
    const sampleTitles = Array.isArray(event.sampleTitles) ? event.sampleTitles : [];
    task.pageResults.push({
      page: event.page,
      fetchedCount: Number(event.listCount || 0),
      importedCount: Number(pageStats.importedCount || 0),
      updatedCount: Number(pageStats.updatedCount || 0),
      skippedCount: Number(pageStats.skippedCount || 0),
      sampleTitles: sampleTitles.slice(0, 10),
      at: new Date().toISOString()
    });
    task.currentBatchPage = Number(event.page || task.currentBatchPage || task.startPage);
    task.currentBatchFetchedCount = Number(event.listCount || 0);
    task.currentBatchTitles = sampleTitles;
    task.currentBatchItems = Array.isArray(event.itemResults) ? event.itemResults.slice(0, 300) : [];
    task.logs.push(
      `第 ${event.page} 页完成：新增 ${Number(pageStats.importedCount || 0)}，更新 ${Number(
        pageStats.updatedCount || 0
      )}，跳过 ${Number(pageStats.skippedCount || 0)}${sampleTitles.length ? `；示例：${sampleTitles.slice(0, 3).join(' / ')}` : ''}`
    );
  }

  if (event.type === 'sleep') {
    const seconds = Math.round(Number(event.waitMs || 0) / 1000);
    task.logs.push(`等待 ${seconds} 秒后继续采集第 ${event.nextPage} 页`);
  }

  if (event.type === 'latest_stop') {
    task.logs.push(`最新模式检测到连续无新增，停止于第 ${event.page} 页`);
    task.stopReason = 'latest_no_new';
  }

  if (event.type === 'done') {
    task.stopReason = String(event.stopReason || task.stopReason || 'completed');
    task.lastPage = Number(event.lastPage || task.lastPage || task.startPage);
    task.logs.push(`任务完成，停止原因：${task.stopReason}`);
  }

  if (event.type === 'stopped') {
    task.stopReason = 'manual_stop';
    task.logs.push('收到手动停止指令，正在安全停止任务...');
  }

  if (event.type === 'error') {
    task.error = String(event.error || '未知错误');
    task.logs.push(`任务异常：${task.error}`);
  }

  trimTaskBuffer(task);
}

function runCollectTask(task, source, options) {
  setTimeout(async () => {
    try {
      const result = await collectFromSource(source, {
        ...options,
        onProgress: (event) => updateCollectTask(task, event),
        onShouldStop: () => Boolean(task.stopRequested)
      });

      task.status = result.ok ? 'success' : 'failed';
      task.importedCount = Number(result.importedCount || 0);
      task.updatedCount = Number(result.updatedCount || 0);
      task.skippedCount = Number(result.skippedCount || 0);
      task.lastPage = Number(result.lastPage || task.lastPage || task.startPage);
      task.stopReason = String(result.stopReason || task.stopReason || 'completed');
      task.totalPages = Math.max(Number(task.totalPages || 0), Number(result.totalPages || 0));
      task.error = result.ok ? '' : String(result.error || '未知错误');
      task.finishedAt = new Date().toISOString();
      task.logs.push(
        result.ok
          ? `采集成功：新增 ${task.importedCount}，更新 ${task.updatedCount}，跳过 ${task.skippedCount}`
          : `采集失败：${task.error}`
      );
      trimTaskBuffer(task);
    } catch (error) {
      task.status = 'failed';
      task.error = String(error.message || '未知错误');
      task.finishedAt = new Date().toISOString();
      task.logs.push(`任务执行异常：${task.error}`);
      trimTaskBuffer(task);
    }
  }, 0);
}

function normalizeSourceName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

async function resolveSource(sourceId, sourceName) {
  const sid = String(sourceId || '').trim();
  const sname = String(sourceName || '').trim();

  if (sid) {
    const byId = await CollectorSource.findByPk(sid);
    if (byId) {
      return byId;
    }
  }

  if (sname) {
    const byName = await CollectorSource.findOne({ where: { name: sname } });
    if (byName) {
      return byName;
    }

    const allSources = await CollectorSource.findAll({ attributes: ['id', 'name'] });
    const normalized = normalizeSourceName(sname);
    const picked =
      allSources.find((item) => normalizeSourceName(item.name) === normalized) ||
      allSources.find((item) =>
        normalizeSourceName(item.name).includes(normalized) ||
        normalized.includes(normalizeSourceName(item.name))
      ) ||
      null;
    if (picked) {
      return CollectorSource.findByPk(picked.id);
    }
  }

  return null;
}

async function resolveSourceByAny(ref = {}) {
  const sourceId = String(ref.sourceId || '').trim();
  const sourceName = String(ref.sourceName || '').trim();
  const sourceApiUrl = String(ref.sourceApiUrl || '').trim();

  let source = await resolveSource(sourceId, sourceName);
  if (source) {
    return source;
  }

  if (sourceApiUrl) {
    source = await CollectorSource.findOne({ where: { apiUrl: sourceApiUrl } });
    if (source) {
      return source;
    }
  }

  return null;
}

function buildVirtualSource(ref = {}) {
  const sourceApiUrl = String(ref.sourceApiUrl || '').trim();
  if (!sourceApiUrl) {
    return null;
  }

  const sourceName =
    String(ref.sourceName || '').trim() ||
    String(ref.sourceId || '').trim() ||
    '临时采集源';

  return {
    id: 0,
    name: sourceName,
    apiUrl: sourceApiUrl,
    enabled: true
  };
}

function safeDecodeUri(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function parseCollectItem(raw) {
  const text = String(raw || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .trim();
  if (!text) {
    return { sourceId: '', sourceName: '', sourceItemId: '' };
  }

  const candidates = [text, safeDecodeUri(text)];

  for (const candidate of candidates) {
    const line = String(candidate || '').trim();
    if (!line) {
      continue;
    }

    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const parsed = JSON.parse(line);
        return {
          sourceId: String(parsed.sourceId || '').trim(),
          sourceName: String(parsed.sourceName || '').trim(),
          sourceApiUrl: String(parsed.sourceApiUrl || '').trim(),
          sourceItemId: String(parsed.sourceItemId || '').trim(),
          title: String(parsed.title || '').trim()
        };
      } catch (_) {
        // continue fallback parsing
      }
    }

    const splitAt = line.indexOf('|');
    if (splitAt > 0) {
      return {
        sourceId: String(line.slice(0, splitAt) || '').trim(),
        sourceName: '',
        sourceApiUrl: '',
        sourceItemId: String(line.slice(splitAt + 1) || '').trim(),
        title: ''
      };
    }
  }

  return { sourceId: '', sourceName: '', sourceApiUrl: '', sourceItemId: '', title: '' };
}

function normalizeParserRecord(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const fromCandidates = [item.from, item.fromCode, item.id, item.flag, item.key, item.code]
    .map((value) =>
      String(value || '')
        .trim()
        .replace(/^@from=/i, '')
        .toLowerCase()
    )
    .filter(Boolean);
  const fromCode =
    fromCandidates.find((value) => /^[a-z0-9_-]{1,80}$/i.test(value)) ||
    fromCandidates[0] ||
    '';

  const parseCandidates = [item.parse, item.parseUrl, item.parse_url, item.jx, item.url, item.link]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  let parseUrl = parseCandidates[0] || '';
  if (!parseUrl) {
    const codeText = String(item.code || '').trim();
    const byConcatWithSuffix =
      codeText.match(/src\s*=\s*"([^"]*?)"\s*\+\s*MacPlayer\.PlayUrl\s*\+\s*"([^"]*)"/i) ||
      codeText.match(/src\s*=\s*'([^']*?)'\s*\+\s*MacPlayer\.PlayUrl\s*\+\s*'([^']*)'/i);
    const byConcatPrefixOnly =
      codeText.match(/src\s*=\s*"([^"]*?)"\s*\+\s*MacPlayer\.PlayUrl/i) ||
      codeText.match(/src\s*=\s*'([^']*?)'\s*\+\s*MacPlayer\.PlayUrl/i);
    const byDirect = codeText.match(/src\s*=\s*["'](https?:\/\/[^"']+)/i);

    if (byConcatWithSuffix) {
      parseUrl = `${String(byConcatWithSuffix[1] || '').trim()}{url}${String(byConcatWithSuffix[2] || '').trim()}`;
    } else {
      parseUrl = String((byConcatPrefixOnly && byConcatPrefixOnly[1]) || (byDirect && byDirect[1]) || '').trim();
    }
  }

  const ps = String(item.ps || '1').trim() || '1';
  if (!fromCode) {
    return null;
  }

  if (ps !== '0' && !parseUrl) {
    return null;
  }

  const sortRaw = Number(item.sort);
  return {
    parserId: String(item.id || '').trim() || null,
    fromCode,
    showName: String(item.show || item.showName || item.name || item.des || fromCode).trim(),
    parseUrl,
    target: String(item.target || '').trim() || null,
    ps,
    sort: Number.isFinite(sortRaw) ? sortRaw : 0,
    enabled: String(item.status || '1') !== '0',
    rawJson: JSON.stringify(item)
  };
}

function parseParserJsonInput(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed.list)) {
    return parsed.list;
  }
  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }
  return [parsed];
}

async function renderSourceParserPage(req, res, source, result = null, statusCode = 200) {
  const parsers = await SourceParser.findAll({
    where: { sourceId: source.id },
    order: [['sort', 'ASC'], ['id', 'ASC']]
  });

  return res.status(statusCode).render('admin/sourceParsers', {
    title: `${source.name} - 解析配置`,
    admin: req.session.admin,
    source,
    parsers,
    result
  });
}

async function renderSourcesPage(req, res, result = null, statusCode = 200) {
  const sources = await CollectorSource.findAll({ order: [['id', 'DESC']] });
  return res.status(statusCode).render('admin/sources', {
    title: '采集源管理',
    admin: req.session.admin,
    sources,
    result
  });
}

router.get('/login', (req, res) => {
  if (req.session && req.session.admin) {
    return res.redirect('/admin');
  }

  return res.render('admin/login', {
    title: '后台登录',
    error: ''
  });
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  const user = await validateAdmin(username, password);

  if (!user) {
    return res.status(401).render('admin/login', {
      title: '后台登录',
      error: '用户名或密码错误'
    });
  }

  req.session.admin = {
    id: user.id,
    username: user.username
  };

  return res.redirect('/admin');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

router.get('/', ensureAdmin, async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [sourceCount, enabledSourceCount, videoCount, categoryCount, todayLogs, recentVideos] = await Promise.all([
    CollectorSource.count(),
    CollectorSource.count({ where: { enabled: true } }),
    Video.count(),
    Category.count(),
    CollectorJobLog.findAll({
      where: {
        createdAt: { [Op.gte]: startOfDay }
      },
      order: [['createdAt', 'DESC']],
      limit: 80
    }),
    Video.findAll({
      order: [['updatedAt', 'DESC']],
      limit: 8,
      attributes: ['id', 'title', 'sourceName', 'updatedAt']
    })
  ]);

  const todaySuccessCount = todayLogs.filter((item) => item.status === 'success').length;
  const todayFailedCount = todayLogs.filter((item) => item.status !== 'success').length;
  const runningTaskCount = Array.from(collectTaskStore.values()).filter((task) => task.status === 'running').length;

  const todayImported = todayLogs.reduce((sum, item) => sum + Number(item.importedCount || 0), 0);
  const todayUpdated = todayLogs.reduce((sum, item) => sum + Number(item.updatedCount || 0), 0);

  res.render('admin/dashboard', {
    title: '采集管理',
    admin: req.session.admin,
    sourceCount,
    enabledSourceCount,
    videoCount,
    categoryCount,
    runningTaskCount,
    todayLogsCount: todayLogs.length,
    todaySuccessCount,
    todayFailedCount,
    todayImported,
    todayUpdated,
    recentVideos
  });
});

router.get('/videos', ensureAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const sourceName = String(req.query.sourceName || '').trim();
  const categoryId = Number(req.query.categoryId || 0);
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = 30;

  const where = {};
  if (q) {
    where.title = { [Op.like]: `%${q}%` };
  }
  if (sourceName) {
    where.sourceName = sourceName;
  }
  if (Number.isFinite(categoryId) && categoryId > 0) {
    where.categoryId = categoryId;
  }

  const [result, categories, sourceRows] = await Promise.all([
    Video.findAndCountAll({
      where,
      include: [{ model: Category, as: 'category' }],
      order: [['id', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: pageSize
    }),
    Category.findAll({ order: [['name', 'ASC']] }),
    Video.findAll({ attributes: ['sourceName'], group: ['sourceName'], order: [['sourceName', 'ASC']] })
  ]);

  const totalPages = Math.max(1, Math.ceil(result.count / pageSize));
  return res.render('admin/videos', {
    title: '资源管理',
    admin: req.session.admin,
    videos: result.rows,
    categories,
    sourceNames: sourceRows.map((item) => item.sourceName).filter(Boolean),
    query: {
      q,
      sourceName,
      categoryId: Number.isFinite(categoryId) ? categoryId : 0,
      page
    },
    pagination: {
      count: result.count,
      page,
      pageSize,
      totalPages
    }
  });
});

router.post('/videos/:id/delete', ensureAdmin, async (req, res) => {
  const video = await Video.findByPk(req.params.id);
  if (video) {
    await video.destroy();
  }
  return res.redirect('/admin/videos');
});

router.post('/videos/batch-delete', ensureAdmin, async (req, res) => {
  const ids = String(req.body.ids || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isFinite(num) && num > 0);

  if (ids.length) {
    await Video.destroy({ where: { id: { [Op.in]: ids } } });
  }
  return res.redirect('/admin/videos');
});

router.get('/sources', ensureAdmin, async (req, res) => {
  return renderSourcesPage(req, res, null, 200);
});

router.post('/sources', ensureAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const apiUrl = String(req.body.apiUrl || '').trim();
  const note = String(req.body.note || '').trim();

  if (!name || !apiUrl) {
    return renderSourcesPage(req, res, { ok: false, message: '名称和API地址不能为空' }, 400);
  }

  try {
    await CollectorSource.create({ name, apiUrl, note, enabled: true });
  } catch (error) {
    if (error && error.name === 'SequelizeUniqueConstraintError') {
      return renderSourcesPage(req, res, { ok: false, message: '采集源名称已存在，请换一个名称' }, 400);
    }
    throw error;
  }
  return res.redirect('/admin/sources');
});

router.post('/sources/:id/update', ensureAdmin, async (req, res) => {
  const source = await CollectorSource.findByPk(req.params.id);
  if (!source) {
    return renderSourcesPage(req, res, { ok: false, message: '采集源不存在' }, 404);
  }

  const name = String(req.body.name || '').trim();
  const apiUrl = String(req.body.apiUrl || '').trim();
  const note = String(req.body.note || '').trim();

  if (!name || !apiUrl) {
    return renderSourcesPage(req, res, { ok: false, message: '名称和API地址不能为空' }, 400);
  }

  try {
    await source.update({ name, apiUrl, note });
  } catch (error) {
    if (error && error.name === 'SequelizeUniqueConstraintError') {
      return renderSourcesPage(req, res, { ok: false, message: '采集源名称已存在，请换一个名称' }, 400);
    }
    throw error;
  }

  return res.redirect('/admin/sources');
});

router.get('/sources/:id/types', ensureAdmin, async (req, res) => {
  const source = await CollectorSource.findByPk(req.params.id);
  if (!source) {
    return res.status(404).json({ ok: false, message: '采集源不存在', list: [] });
  }

  try {
    const list = await fetchSourceTypes(source);
    return res.json({ ok: true, message: '', list });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message, list: [] });
  }
});

router.post('/sources/:id/toggle', ensureAdmin, async (req, res) => {
  const source = await CollectorSource.findByPk(req.params.id);
  if (source) {
    await source.update({ enabled: !source.enabled });
  }
  res.redirect('/admin/sources');
});

router.post('/sources/:id/delete', ensureAdmin, async (req, res) => {
  const source = await CollectorSource.findByPk(req.params.id);
  if (!source) {
    return renderSourcesPage(req, res, { ok: false, message: '采集源不存在' }, 404);
  }

  await SourceParser.destroy({ where: { sourceId: source.id } });
  await source.destroy();

  return res.redirect('/admin/sources');
});

router.get('/sources/:id/parsers', ensureAdmin, async (req, res) => {
  const source = await CollectorSource.findByPk(req.params.id);
  if (!source) {
    return res.status(404).send('采集源不存在');
  }

  return renderSourceParserPage(req, res, source, null, 200);
});

router.post('/sources/:id/parsers', ensureAdmin, async (req, res) => {
  const source = await CollectorSource.findByPk(req.params.id);
  if (!source) {
    return res.status(404).send('采集源不存在');
  }

  const payload = normalizeParserRecord(req.body);
  if (!payload) {
    return renderSourceParserPage(
      req,
      res,
      source,
      { ok: false, message: 'from 不能为空；当 ps=1 时 parse 不能为空' },
      400
    );
  }

  const existing = await SourceParser.findOne({
    where: { sourceId: source.id, fromCode: payload.fromCode }
  });

  if (existing) {
    await existing.update(payload);
  } else {
    await SourceParser.create({ ...payload, sourceId: source.id });
  }

  return renderSourceParserPage(req, res, source, {
    ok: true,
    message: existing ? '解析配置已更新' : '解析配置已新增'
  });
});

router.post('/sources/:id/parsers/import', ensureAdmin, async (req, res) => {
  const source = await CollectorSource.findByPk(req.params.id);
  if (!source) {
    return res.status(404).send('采集源不存在');
  }

  let list = [];
  try {
    list = parseParserJsonInput(req.body.parserJson);
  } catch (error) {
    return renderSourceParserPage(
      req,
      res,
      source,
      { ok: false, message: `JSON 解析失败: ${error.message}` },
      400
    );
  }

  if (!list.length) {
    return renderSourceParserPage(
      req,
      res,
      source,
      { ok: false, message: '请输入有效 JSON 内容' },
      400
    );
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const rawItem of list) {
    const payload = normalizeParserRecord(rawItem);
    if (!payload) {
      skipped += 1;
      continue;
    }

    const existing = await SourceParser.findOne({
      where: { sourceId: source.id, fromCode: payload.fromCode }
    });

    if (existing) {
      await existing.update(payload);
      updated += 1;
    } else {
      await SourceParser.create({ ...payload, sourceId: source.id });
      created += 1;
    }
  }

  return renderSourceParserPage(req, res, source, {
    ok: true,
    message: `导入完成: 新增 ${created}，更新 ${updated}，跳过 ${skipped}`
  });
});

router.post('/sources/:id/parsers/:parserId/toggle', ensureAdmin, async (req, res) => {
  const source = await CollectorSource.findByPk(req.params.id);
  if (!source) {
    return res.status(404).send('采集源不存在');
  }

  const parser = await SourceParser.findOne({
    where: { id: req.params.parserId, sourceId: source.id }
  });
  if (!parser) {
    return renderSourceParserPage(req, res, source, { ok: false, message: '解析配置不存在' }, 404);
  }

  const nextEnabled = !parser.enabled;
  await parser.update({ enabled: nextEnabled });
  return renderSourceParserPage(req, res, source, {
    ok: true,
    message: `已${nextEnabled ? '启用' : '停用'}解析配置`
  });
});

router.post('/collect/:id(\\d+)', ensureAdmin, async (req, res) => {
  const source = await CollectorSource.findByPk(req.params.id);
  if (!source) {
    return res.status(404).send('采集源不存在');
  }

  const pages = Math.max(1, Number(req.body.pages || 1));
  const startPage = Math.max(1, Number(req.body.startPage || 1));
  const endPage = Math.max(startPage, Number(req.body.endPage || (startPage + pages - 1)));
  const mode = String(req.body.mode || 'latest').trim().toLowerCase() === 'all' ? 'all' : 'latest';
  const typeId = Math.max(0, Number(req.body.typeId || 0));
  const hours = Math.max(0, Number(req.body.hours || 0));

  const wantsJson =
    String(req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest' ||
    String(req.get('accept') || '').toLowerCase().includes('application/json');

  const task = createCollectTask(source, {
    mode,
    startPage,
    endPage,
    typeId,
    hours
  });
  runCollectTask(task, source, {
    mode,
    startPage,
    endPage,
    typeId,
    hours
  });

  if (wantsJson) {
    return res.json({
      ok: true,
      message: '采集任务已启动',
      taskId: task.id
    });
  }

  const sources = await CollectorSource.findAll({ order: [['id', 'DESC']] });

  return res.render('admin/sources', {
    title: '采集源管理',
    admin: req.session.admin,
    sources,
    result: {
      ok: true,
      message: `采集任务已启动[${mode === 'all' ? '采集全部' : '采集最新'}][分类 ${typeId || '全部'}][最近小时 ${hours || '不限'}]，可在页面下方实时查看进度`
    }
  });
});

router.get('/collect/tasks/:taskId', ensureAdmin, async (req, res) => {
  const taskId = String(req.params.taskId || '').trim();
  const task = collectTaskStore.get(taskId);
  if (!task) {
    return res.status(404).json({ ok: false, message: '任务不存在或已过期' });
  }

  return res.json({ ok: true, task });
});

router.post('/collect/tasks/:taskId/stop', ensureAdmin, async (req, res) => {
  const taskId = String(req.params.taskId || '').trim();
  const task = collectTaskStore.get(taskId);
  if (!task) {
    return res.status(404).json({ ok: false, message: '任务不存在或已过期' });
  }

  if (task.status !== 'running') {
    return res.json({ ok: true, message: '任务已结束，无需停止', task });
  }

  task.stopRequested = true;
  task.logs.push('已提交手动停止请求，当前页处理完后停止');
  trimTaskBuffer(task);
  return res.json({ ok: true, message: '停止请求已提交', taskId: task.id });
});

router.post('/collect/tasks/:taskId/resume', ensureAdmin, async (req, res) => {
  const taskId = String(req.params.taskId || '').trim();
  const prevTask = collectTaskStore.get(taskId);
  if (!prevTask) {
    return res.status(404).json({ ok: false, message: '任务不存在或已过期' });
  }

  const source = await CollectorSource.findByPk(prevTask.sourceId);
  if (!source) {
    return res.status(404).json({ ok: false, message: '采集源不存在' });
  }

  if (prevTask.status === 'running') {
    return res.json({ ok: false, message: '任务仍在进行中，无法继续采集' });
  }

  const resumeStartPage = Math.max(1, Number(prevTask.lastPage || prevTask.startPage || 1) + 1);
  const endPage = Math.max(resumeStartPage, Number(prevTask.endPage || prevTask.startPage || resumeStartPage));
  const mode = String(prevTask.mode || 'latest').toLowerCase() === 'all' ? 'all' : 'latest';
  const typeId = Math.max(0, Number(prevTask.typeId || 0));
  const hours = Math.max(0, Number(prevTask.hours || 0));

  if (mode !== 'all' && resumeStartPage > endPage) {
    return res.json({ ok: false, message: '已到达结束页，无法继续采集' });
  }

  const task = createCollectTask(source, {
    mode,
    startPage: resumeStartPage,
    endPage,
    typeId,
    hours
  });

  task.logs.push(`继续采集：从第 ${resumeStartPage} 页开始`);
  runCollectTask(task, source, {
    mode,
    startPage: resumeStartPage,
    endPage,
    typeId,
    hours
  });

  return res.json({ ok: true, message: '续采任务已启动', taskId: task.id });
});

router.get('/collect/search', ensureAdmin, async (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const sourceId = Number(req.query.sourceId || 0);
  const sourceFilter = Number.isFinite(sourceId) && sourceId > 0 ? sourceId : 0;

  const allSources = await CollectorSource.findAll({ where: { enabled: true }, order: [['id', 'ASC']] });
  const sources = sourceFilter ? allSources.filter((item) => item.id === sourceFilter) : allSources;

  let rows = [];
  let errors = [];
  if (keyword && sources.length) {
    const result = await searchVideosAcrossSources(sources, keyword, page);
    rows = result.flatMap((item) => item.list);
    errors = result.filter((item) => !item.ok).map((item) => ({ sourceName: item.sourceName, error: item.error }));
  }

  return res.render('admin/collectSearch', {
    title: '全站搜索',
    admin: req.session.admin,
    sources: allSources,
    rows,
    errors,
    result: null,
    query: {
      keyword,
      page,
      sourceId: sourceFilter
    }
  });
});

router.post('/collect/one', ensureAdmin, async (req, res) => {
  const wantsJson =
    String(req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest' ||
    String(req.get('accept') || '').toLowerCase().includes('application/json');

  const sourceId = String(req.body.sourceId || '').trim();
  const sourceName = String(req.body.sourceName || '').trim();
  const sourceItemId = String(req.body.sourceItemId || '').trim();
  const keyword = String(req.body.keyword || '').trim();
  const page = Math.max(1, Number(req.body.page || 1));
  const sourceFilter = Math.max(0, Number(req.body.sourceFilter || 0));

  const source = await resolveSourceByAny({ sourceId, sourceName, sourceApiUrl: req.body.sourceApiUrl });
  if (!source) {
    if (wantsJson) {
      return res.status(404).json({ ok: false, message: `采集源不存在: id=${sourceId || '-'} name=${sourceName || '-'}` });
    }
    return res.status(404).send(`采集源不存在: id=${sourceId || '-'} name=${sourceName || '-'}`);
  }

  const collectResult = await collectOneFromSource(source, sourceItemId, req.body.title);
  const allSources = await CollectorSource.findAll({ where: { enabled: true }, order: [['id', 'ASC']] });
  const sources = sourceFilter ? allSources.filter((item) => item.id === sourceFilter) : allSources;
  let rows = [];
  let errors = [];
  if (keyword && sources.length) {
    const result = await searchVideosAcrossSources(sources, keyword, page);
    rows = result.flatMap((item) => item.list);
    errors = result.filter((item) => !item.ok).map((item) => ({ sourceName: item.sourceName, error: item.error }));
  }

  return res.render('admin/collectSearch', {
    title: '全站搜索',
    admin: req.session.admin,
    sources: allSources,
    rows,
    errors,
    query: {
      keyword,
      page,
      sourceId: sourceFilter
    },
    result: {
      ok: collectResult.ok,
      message: collectResult.ok
        ? `单采完成: 新增 ${collectResult.importedCount}，更新 ${collectResult.updatedCount}，跳过 ${collectResult.skippedCount}`
        : `单采失败: ${collectResult.error || '未知错误'}`
    }
  });
});

router.post('/collect/batch', ensureAdmin, async (req, res) => {
  const wantsJson =
    String(req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest' ||
    String(req.get('accept') || '').toLowerCase().includes('application/json');

  const rawItems = Array.isArray(req.body.items)
    ? req.body.items
    : [req.body.items].filter(Boolean);
  let jsonItems = [];
  try {
    jsonItems = JSON.parse(String(req.body.itemsJson || '[]'));
    if (!Array.isArray(jsonItems)) {
      jsonItems = [];
    }
  } catch (_) {
    jsonItems = [];
  }
  const keyword = String(req.body.keyword || '').trim();
  const page = Math.max(1, Number(req.body.page || 1));
  const sourceFilter = Math.max(0, Number(req.body.sourceFilter || 0));

  const parsedByJson = jsonItems
    .map((item) => ({
      sourceId: String(item.sourceId || '').trim(),
      sourceName: String(item.sourceName || '').trim(),
      sourceApiUrl: String(item.sourceApiUrl || '').trim(),
      sourceItemId: String(item.sourceItemId || '').trim(),
      title: String(item.title || '').trim()
    }))
    .filter((item) => (item.sourceId || item.sourceName || item.sourceApiUrl) && item.sourceItemId);

  const parsedByRaw = Array.from(
    new Set(
      rawItems
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  )
    .map((item) => parseCollectItem(item))
    .filter((item) => (item.sourceId || item.sourceName || item.sourceApiUrl) && item.sourceItemId);

  const uniquePairs = [];
  const pairKeySet = new Set();
  [...parsedByJson, ...parsedByRaw].forEach((item) => {
    const sourceKey = item.sourceId || item.sourceApiUrl || item.sourceName;
    const key = `${sourceKey}|${item.sourceItemId}`;
    if (pairKeySet.has(key)) {
      return;
    }
    pairKeySet.add(key);
    uniquePairs.push(item);
  });

  let okCount = 0;
  let failCount = 0;
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const failDetails = [];

  for (const pair of uniquePairs) {
    let source = await resolveSourceByAny(pair);
    if (!source) {
      source = buildVirtualSource(pair);
    }
    if (!source) {
      failCount += 1;
      failDetails.push(`source#${pair.sourceId || '-'}(${pair.sourceName || '-'}) 不存在`);
      continue;
    }

    const result = await collectOneFromSource(source, pair.sourceItemId, pair.title);
    if (result.ok) {
      okCount += 1;
      importedCount += result.importedCount;
      updatedCount += result.updatedCount;
      skippedCount += result.skippedCount;
    } else {
      failCount += 1;
      failDetails.push(`${source.name}(${pair.sourceItemId}): ${result.error || '未知错误'}`);
    }
  }

  const allSources = await CollectorSource.findAll({ where: { enabled: true }, order: [['id', 'ASC']] });
  const sources = sourceFilter ? allSources.filter((item) => item.id === sourceFilter) : allSources;
  let rows = [];
  let errors = [];
  if (keyword && sources.length) {
    const result = await searchVideosAcrossSources(sources, keyword, page);
    rows = result.flatMap((item) => item.list);
    errors = result.filter((item) => !item.ok).map((item) => ({ sourceName: item.sourceName, error: item.error }));
  }

  const resultPayload = {
    ok: failCount === 0,
    message:
      uniquePairs.length === 0
        ? '请先勾选要采集的资源'
        : `批量采集完成: 成功 ${okCount} 条，失败 ${failCount} 条；视频新增 ${importedCount}，更新 ${updatedCount}，跳过 ${skippedCount}${failDetails.length ? `；失败详情：${failDetails.slice(0, 3).join(' | ')}` : ''}`
  };

  if (wantsJson) {
    return res.json({
      ok: resultPayload.ok,
      message: resultPayload.message,
      stats: {
        okCount,
        failCount,
        importedCount,
        updatedCount,
        skippedCount,
        failDetails
      }
    });
  }

  return res.render('admin/collectSearch', {
    title: '全站搜索',
    admin: req.session.admin,
    sources: allSources,
    rows,
    errors,
    query: {
      keyword,
      page,
      sourceId: sourceFilter
    },
    result: resultPayload
  });
});

router.use((error, req, res, next) => {
  if (!error) {
    return next();
  }

  const wantsJson =
    String(req.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest' ||
    String(req.get('accept') || '').toLowerCase().includes('application/json');

  if (wantsJson) {
    return res.status(500).json({ ok: false, message: error.message || '服务器错误' });
  }

  return next(error);
});

router.get('/logs', ensureAdmin, async (req, res) => {
  const logs = await CollectorJobLog.findAll({
    order: [['createdAt', 'DESC']],
    limit: 200
  });

  res.render('admin/logs', {
    title: '采集日志',
    admin: req.session.admin,
    logs
  });
});

module.exports = router;
