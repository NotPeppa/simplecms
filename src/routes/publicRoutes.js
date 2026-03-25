const express = require('express');
const axios = require('axios');
const { Op } = require('sequelize');
const { Category, Video, CollectorSource, SourceParser } = require('../models');
const { parsePlayItems } = require('../utils/play');

const router = express.Router();

function normalizeSourceName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function toAbsoluteUrl(input, baseUrl) {
  try {
    return new URL(input, baseUrl).toString();
  } catch (_) {
    return '';
  }
}

function buildProxyUrl(targetUrl, referer, sourceName) {
  const params = new URLSearchParams({ url: targetUrl });
  if (referer) {
    params.set('ref', referer);
  }
  if (sourceName) {
    params.set('source', sourceName);
  }
  return `/play/proxy?${params.toString()}`;
}

function normalizeCategoryName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function pickCategoryIdsForFixedNav(targetName, categories) {
  const key = String(targetName || '').trim();
  const all = Array.isArray(categories) ? categories : [];
  const ruleMap = {
    电影: ['电影', '影片', '动作片', '喜剧片', '爱情片', '科幻片', '恐怖片', '战争片', '剧情片', '纪录片'],
    电视剧: ['电视剧', '连续剧', '国产剧', '港台剧', '韩剧', '日剧', '美剧', '欧美剧', '海外剧'],
    综艺: ['综艺'],
    动漫: ['动漫', '动画'],
    短剧: ['短剧', '微短剧', '微剧']
  };

  const keywords = ruleMap[key];
  if (!keywords) {
    return [];
  }

  const normalizedKeywords = keywords.map((item) => normalizeCategoryName(item));
  const deniedForTv = key === '电视剧' ? ['短剧', '微短剧', '微剧'].map((item) => normalizeCategoryName(item)) : [];

  return all
    .filter((category) => {
      const cname = normalizeCategoryName(category.name);
      if (!cname) {
        return false;
      }
      if (deniedForTv.some((deny) => cname.includes(deny))) {
        return false;
      }
      return normalizedKeywords.some((kw) => cname === kw || cname.includes(kw));
    })
    .map((category) => Number(category.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function rewriteM3u8Content(content, playlistUrl, referer, sourceName) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return line;
    }

    if (trimmed.startsWith('#')) {
      if (trimmed.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (_all, uri) => {
          const abs = toAbsoluteUrl(uri, playlistUrl);
          if (!abs) {
            return `URI="${uri}"`;
          }
          return `URI="${buildProxyUrl(abs, referer, sourceName)}"`;
        });
      }
      return line;
    }

    const abs = toAbsoluteUrl(trimmed, playlistUrl);
    if (!abs) {
      return line;
    }
    return buildProxyUrl(abs, referer, sourceName);
  });

  return rewritten.join('\n');
}

router.get('/play/proxy', async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();
  const ref = String(req.query.ref || '').trim();
  const sourceName = String(req.query.source || '').trim();
  if (!rawUrl) {
    return res.status(400).send('missing url');
  }

  let target;
  try {
    target = new URL(rawUrl);
  } catch (_) {
    return res.status(400).send('invalid url');
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    return res.status(400).send('invalid protocol');
  }

  let referer = ref || `${target.protocol}//${target.host}/`;
  let origin = `${target.protocol}//${target.host}`;

  try {
    const baseHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      Referer: referer,
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Connection: 'keep-alive'
    };

    const range = String(req.headers.range || '').trim();
    if (range) {
      baseHeaders.Range = range;
    }

    const headerVariants = [
      { ...baseHeaders, Origin: origin },
      { ...baseHeaders, Referer: `${target.protocol}//${target.host}/`, Origin: `${target.protocol}//${target.host}` },
      { ...baseHeaders, Referer: `${target.protocol}//${target.host}/` },
      (() => {
        const noRef = { ...baseHeaders };
        delete noRef.Referer;
        return noRef;
      })()
    ];

    let upstream = null;
    let pickedHeaders = headerVariants[0];
    for (let i = 0; i < headerVariants.length; i += 1) {
      const headers = headerVariants[i];
      const resp = await axios.get(target.toString(), {
        timeout: 20000,
        responseType: 'arraybuffer',
        validateStatus: () => true,
        headers
      });

      upstream = resp;
      pickedHeaders = headers;
      if (resp.status < 400 || resp.status === 404) {
        break;
      }
    }

    if (upstream.status >= 400) {
      return res.status(upstream.status).send(`upstream ${upstream.status}`);
    }

    const contentType = String(upstream.headers['content-type'] || '').toLowerCase();
    const isPlaylist =
      target.pathname.toLowerCase().endsWith('.m3u8') ||
      contentType.includes('mpegurl') ||
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegurl');

    if (isPlaylist) {
      const text = Buffer.from(upstream.data).toString('utf-8');
      const rewritten = rewriteM3u8Content(text, target.toString(), pickedHeaders.Referer || referer, sourceName);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Proxy-Upstream-Status', String(upstream.status));
      res.setHeader('X-Proxy-Target-Host', target.host);
      return res.send(rewritten);
    }

    if (upstream.headers['content-type']) {
      res.setHeader('Content-Type', upstream.headers['content-type']);
    }
    if (upstream.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', upstream.headers['accept-ranges']);
    }
    if (upstream.headers['content-length']) {
      res.setHeader('Content-Length', upstream.headers['content-length']);
    }
    if (upstream.headers['content-range']) {
      res.setHeader('Content-Range', upstream.headers['content-range']);
    }
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.setHeader('X-Proxy-Upstream-Status', String(upstream.status));
    res.setHeader('X-Proxy-Target-Host', target.host);
    return res.status(upstream.status).send(Buffer.from(upstream.data));
  } catch (error) {
    return res.status(502).send(`proxy failed: ${error.message}`);
  }
});

router.get('/', async (req, res) => {
  const categories = await Category.findAll({ order: [['id', 'ASC']] });
  const rawVideos = await Video.findAll({
    order: [['createdAt', 'DESC']],
    limit: 250,
    include: [{ model: Category, as: 'category' }]
  });

  const seenTitles = new Set();
  const videos = [];
  for (const v of rawVideos) {
    if (!seenTitles.has(v.title)) {
      seenTitles.add(v.title);
      videos.push(v);
      if (videos.length >= 48) break;
    }
  }

  res.render('public/index', {
    title: '视频首页',
    categories,
    videos,
    query: '',
    currentCategoryId: null,
    currentCategoryName: null,
    isSearch: false
  });
});

router.get('/category/:id', async (req, res) => {
  const category = await Category.findByPk(req.params.id);
  if (!category) {
    return res.status(404).send('分类不存在');
  }

  const categories = await Category.findAll({ order: [['id', 'ASC']] });
  const rawVideos = await Video.findAll({
    where: { categoryId: category.id },
    order: [['createdAt', 'DESC']],
    limit: 250,
    include: [{ model: Category, as: 'category' }]
  });

  const seenTitles = new Set();
  const videos = [];
  for (const v of rawVideos) {
    if (!seenTitles.has(v.title)) {
      seenTitles.add(v.title);
      videos.push(v);
      if (videos.length >= 48) break;
    }
  }

  return res.render('public/index', {
    title: `${category.name} - 分类`,
    categories,
    videos,
    query: '',
    currentCategoryId: category.id,
    currentCategoryName: null,
    isSearch: false
  });
});

router.get('/category-by-name/:name', async (req, res) => {
  const targetName = String(req.params.name || '').trim();
  const categories = await Category.findAll({ order: [['id', 'ASC']] });
  const exactCategory = categories.find((item) => item.name === targetName) || null;
  let categoryIds = pickCategoryIdsForFixedNav(targetName, categories);

  if (exactCategory && !categoryIds.includes(Number(exactCategory.id))) {
    categoryIds.push(Number(exactCategory.id));
  }

  categoryIds = Array.from(new Set(categoryIds));

  if (!categoryIds.length) {
    // If the category isn't in DB yet, just return empty list gracefully
    return res.render('public/index', {
      title: `${targetName} - 分类`,
      categories,
      videos: [],
      query: '',
      currentCategoryName: targetName,
      isSearch: false
    });
  }

  const rawVideos = await Video.findAll({
    where: { categoryId: { [Op.in]: categoryIds } },
    order: [['createdAt', 'DESC']],
    limit: 250,
    include: [{ model: Category, as: 'category' }]
  });

  const seenTitles = new Set();
  const videos = [];
  for (const v of rawVideos) {
    if (!seenTitles.has(v.title)) {
      seenTitles.add(v.title);
      videos.push(v);
      if (videos.length >= 48) break;
    }
  }

  return res.render('public/index', {
    title: `${targetName} - 分类`,
    categories,
    videos,
    query: '',
    currentCategoryName: targetName,
    isSearch: false
  });
});

router.get('/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const categories = await Category.findAll({ order: [['id', 'ASC']] });

  let videos = [];
  if (query) {
    const rawVideos = await Video.findAll({
      where: {
        title: {
          [Op.like]: `%${query}%`
        }
      },
      order: [['createdAt', 'DESC']],
      limit: 300,
      include: [{ model: Category, as: 'category' }]
    });

    const seenTitles = new Set();
    for (const v of rawVideos) {
      if (!seenTitles.has(v.title)) {
        seenTitles.add(v.title);
        videos.push(v);
        if (videos.length >= 100) break;
      }
    }
  }

  res.render('public/index', {
    title: query ? `搜索: ${query}` : '搜索',
    categories,
    videos,
    query,
    currentCategoryId: null,
    currentCategoryName: null,
    isSearch: true
  });
});

router.get('/video/:id', async (req, res) => {
  const video = await Video.findByPk(req.params.id, {
    include: [{ model: Category, as: 'category' }]
  });
  if (!video) {
    return res.status(404).send('视频不存在');
  }

  const categories = await Category.findAll({ order: [['id', 'ASC']] });

  const sameTitleVideos = await Video.findAll({
    where: { title: video.title },
    order: [['createdAt', 'DESC']]
  });

  let source = await CollectorSource.findOne({ where: { name: video.sourceName } });
  if (!source) {
    const allSources = await CollectorSource.findAll({ attributes: ['id', 'name'] });
    const normalizedVideoSourceName = normalizeSourceName(video.sourceName);
    source =
      allSources.find((item) => normalizeSourceName(item.name) === normalizedVideoSourceName) ||
      allSources.find((item) =>
        normalizeSourceName(item.name).includes(normalizedVideoSourceName) ||
        normalizedVideoSourceName.includes(normalizeSourceName(item.name))
      ) ||
      null;
  }
  let parserMapByFrom = {};
  let defaultParser = null;
  if (source) {
    const parsers = await SourceParser.findAll({
      where: { sourceId: source.id, enabled: true },
      order: [['sort', 'ASC'], ['id', 'ASC']]
    });

    const parserForFallback =
      parsers.find((item) => String(item.ps || '1').trim() !== '0' && String(item.parseUrl || '').trim()) ||
      parsers[0] ||
      null;
    if (parserForFallback) {
      defaultParser = {
        fromCode: parserForFallback.fromCode,
        showName: parserForFallback.showName,
        parseUrl: parserForFallback.parseUrl,
        ps: parserForFallback.ps,
        target: parserForFallback.target
      };
    }

    parserMapByFrom = parsers.reduce((acc, item) => {
      const key = String(item.fromCode || '').trim().toLowerCase();
      if (!key || !item.parseUrl) {
        if (String(item.ps || '1').trim() === '0' && key) {
          acc[key] = {
            fromCode: item.fromCode,
            showName: item.showName,
            parseUrl: item.parseUrl,
            ps: item.ps,
            target: item.target
          };
        }
        return acc;
      }
      acc[key] = {
        fromCode: item.fromCode,
        showName: item.showName,
        parseUrl: item.parseUrl,
        ps: item.ps,
        target: item.target
      };
      return acc;
    }, {});
  }

  const playItems = parsePlayItems(video.playUrl, {
    sourceName: video.sourceName,
    parserMapByFrom,
    defaultParser
  });

  return res.render('public/video', {
    title: video.title,
    video,
    categories,
    sameTitleVideos,
    playItems,
    currentEp: Math.max(0, Number(req.query.ep || 0) || 0),
    currentCategoryId: video.categoryId,
    currentCategoryName: null,
    isSearch: false
  });
});

module.exports = router;
