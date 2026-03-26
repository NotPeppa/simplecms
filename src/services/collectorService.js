const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const { Category, Video, CollectorJobLog } = require('../models');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
  parseTagValue: true
});

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    return [value];
  }
  return [];
}

function unwrapMaybeObject(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return unwrapMaybeObject(value[0]);
  }
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, '#text')) {
      return unwrapMaybeObject(value['#text']);
    }
    if (Object.prototype.hasOwnProperty.call(value, '__cdata')) {
      return unwrapMaybeObject(value.__cdata);
    }
  }
  return '';
}

function parseApiPayload(raw) {
  if (raw && typeof raw === 'object') {
    return raw;
  }

  const text = String(raw || '').trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    // continue xml parsing
  }

  if (text.startsWith('<')) {
    try {
      return xmlParser.parse(text) || {};
    } catch (_) {
      return {};
    }
  }

  return {};
}

function buildPageUrl(baseUrl, page) {
  const hasQuery = baseUrl.includes('?');
  const hasAc = /(?:\?|&)ac=/.test(baseUrl);
  const hasPg = /(?:\?|&)pg=/.test(baseUrl);

  let url = baseUrl;
  if (!hasAc) {
    url += hasQuery ? '&ac=detail' : '?ac=detail';
  }

  if (hasPg) {
    url = url.replace(/([?&]pg=)\d+/i, `$1${page}`);
  } else {
    url += '&pg=' + page;
  }

  return url;
}

function buildDetailUrl(baseUrl, params = {}) {
  const url = new URL(baseUrl);
  if (!url.searchParams.get('ac')) {
    url.searchParams.set('ac', 'detail');
  }

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

function pickList(payload) {
  if (Array.isArray(payload?.list)) {
    return payload.list;
  }

  if (payload?.list?.video) {
    return toArray(payload.list.video);
  }

  if (Array.isArray(payload?.data?.list)) {
    return payload.data.list;
  }

  if (payload?.data?.list?.video) {
    return toArray(payload.data.list.video);
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (payload?.rss?.list?.video) {
    return toArray(payload.rss.list.video);
  }

  if (payload?.rss?.video) {
    return toArray(payload.rss.video);
  }

  return [];
}

function extractTotalPages(payload) {
  const candidates = [
    payload?.pagecount,
    payload?.page_count,
    payload?.totalpage,
    payload?.total_page,
    payload?.page?.count,
    payload?.page?.total,
    payload?.data?.pagecount,
    payload?.data?.page_count,
    payload?.data?.totalpage,
    payload?.data?.total_page,
    payload?.data?.page?.count,
    payload?.data?.page?.total,
    payload?.rss?.list?.pagecount,
    payload?.rss?.list?.page,
    payload?.rss?.pagecount,
    payload?.rss?.page
  ];

  for (const candidate of candidates) {
    const value = Number(unwrapMaybeObject(candidate));
    if (Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }

  return 0;
}

function stringifyPlayUrl(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean).join('#');
  }

  if (typeof value === 'object') {
    const groups = Object.values(value)
      .map((group) => {
        if (typeof group === 'string') {
          return group.trim();
        }
        if (Array.isArray(group)) {
          return group.map((item) => String(item || '').trim()).filter(Boolean).join('#');
        }
        return '';
      })
      .filter(Boolean);
    return groups.join('$$$');
  }

  return '';
}

function splitGroups(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '#')
    .split('$$$')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFromCode(value) {
  return String(value || '')
    .trim()
    .replace(/[#$\s]/g, '');
}

function attachPlayFromMetadata(playUrl, playFrom) {
  const groups = splitGroups(playUrl);
  if (!groups.length) {
    return playUrl;
  }

  const fromGroups = splitGroups(playFrom);
  if (!fromGroups.length) {
    return groups.join('$$$');
  }

  const merged = groups.map((group, index) => {
    if (group.startsWith('@from=')) {
      return group;
    }

    const fromCode = normalizeFromCode(fromGroups[index]);
    if (!fromCode) {
      return group;
    }

    return `@from=${fromCode}#${group}`;
  });

  return merged.join('$$$');
}

function buildPlayUrlFromDl(value) {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const ddList = toArray(value.dd);
  if (!ddList.length) {
    return '';
  }

  const groups = ddList
    .map((dd) => {
      const text = unwrapMaybeObject(dd?.['#text'] ?? dd?.text ?? dd);
      if (!text) {
        return '';
      }
      const flag = normalizeFromCode(unwrapMaybeObject(dd?.flag || dd?.from || dd?.name || ''));
      return flag ? `@from=${flag}#${text}` : text;
    })
    .filter(Boolean);

  return groups.join('$$$');
}

function normalizeVideo(item, sourceName) {
  const normalizedItem = item && typeof item === 'object' ? item : {};
  const sourceItemId =
    unwrapMaybeObject(normalizedItem.vod_id) ||
    unwrapMaybeObject(normalizedItem.id) ||
    unwrapMaybeObject(normalizedItem.video_id) ||
    unwrapMaybeObject(normalizedItem.vodid) ||
    unwrapMaybeObject(normalizedItem.vid);

  let playUrl = stringifyPlayUrl(
    normalizedItem.vod_play_url ||
      normalizedItem.play_url ||
      normalizedItem.vod_url ||
      normalizedItem.url ||
      normalizedItem.vodurl ||
      normalizedItem.playurl ||
      ''
  );

  const playFrom = stringifyPlayUrl(
    normalizedItem.vod_play_from ||
      normalizedItem.play_from ||
      normalizedItem.playfrom ||
      normalizedItem.from ||
      ''
  );
  playUrl = attachPlayFromMetadata(playUrl, playFrom);

  if (!playUrl) {
    playUrl = buildPlayUrlFromDl(normalizedItem.dl);
  }

  if (!sourceItemId || !playUrl) {
    return null;
  }

  const categoryName =
    unwrapMaybeObject(normalizedItem.type_name) ||
    unwrapMaybeObject(normalizedItem.vod_class) ||
    unwrapMaybeObject(normalizedItem.type) ||
    '未分类';

  return {
    sourceId: `${sourceName}:${sourceItemId}`,
    title: unwrapMaybeObject(normalizedItem.vod_name) || unwrapMaybeObject(normalizedItem.name) || '未命名视频',
    cover: unwrapMaybeObject(normalizedItem.vod_pic) || unwrapMaybeObject(normalizedItem.pic) || '',
    description: unwrapMaybeObject(normalizedItem.vod_content) || unwrapMaybeObject(normalizedItem.content) || unwrapMaybeObject(normalizedItem.des) || '',
    playUrl,
    sourceName,
    updatedAtSource:
      unwrapMaybeObject(normalizedItem.vod_time) ||
      unwrapMaybeObject(normalizedItem.update_time) ||
      unwrapMaybeObject(normalizedItem.last_update) ||
      unwrapMaybeObject(normalizedItem.last) ||
      '',
    categoryName
  };
}

async function getOrCreateCategory(name) {
  const cleanName = String(name || '未分类').trim() || '未分类';
  const [category] = await Category.findOrCreate({ where: { name: cleanName } });
  return category;
}

async function upsertVideoByRaw(source, raw) {
  const fallbackTitle = unwrapMaybeObject(raw?.vod_name) || unwrapMaybeObject(raw?.name) || '未命名视频';
  const normalized = normalizeVideo(raw, source.name);
  if (!normalized) {
    return { status: 'skipped', title: fallbackTitle, reason: 'missing_source_id_or_play_url' };
  }

  const category = await getOrCreateCategory(normalized.categoryName);
  const payload = {
    sourceId: normalized.sourceId,
    title: normalized.title,
    cover: normalized.cover,
    description: normalized.description,
    playUrl: normalized.playUrl,
    sourceName: normalized.sourceName,
    updatedAtSource: normalized.updatedAtSource,
    categoryId: category.id
  };

  const existing = await Video.findOne({ where: { sourceId: normalized.sourceId } });
  if (!existing) {
    await Video.create(payload);
    return { status: 'imported', title: normalized.title };
  }

  const hasChanged =
    existing.title !== payload.title ||
    String(existing.cover || '') !== String(payload.cover || '') ||
    String(existing.description || '') !== String(payload.description || '') ||
    String(existing.playUrl || '') !== String(payload.playUrl || '') ||
    String(existing.sourceName || '') !== String(payload.sourceName || '') ||
    String(existing.updatedAtSource || '') !== String(payload.updatedAtSource || '') ||
    Number(existing.categoryId || 0) !== Number(payload.categoryId || 0);

  if (!hasChanged) {
    return { status: 'skipped', title: normalized.title, reason: 'unchanged' };
  }

  await existing.update(payload);
  return { status: 'updated', title: normalized.title };
}

async function importFromRawList(source, rawList) {
  const stats = {
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    itemResults: []
  };

  for (const raw of rawList) {
    const result = await upsertVideoByRaw(source, raw);
    if (result.status === 'imported') {
      stats.importedCount += 1;
      stats.itemResults.push({ title: result.title || '未命名视频', status: 'imported', reason: result.reason || '' });
    } else if (result.status === 'updated') {
      stats.updatedCount += 1;
      stats.itemResults.push({ title: result.title || '未命名视频', status: 'updated', reason: result.reason || '' });
    } else {
      stats.skippedCount += 1;
      stats.itemResults.push({ title: result.title || '未命名视频', status: 'skipped', reason: result.reason || '' });
    }
  }

  return stats;
}

async function searchVideosFromSource(source, keyword, page = 1) {
  const q = String(keyword || '').trim();
  if (!q) {
    return [];
  }

  const url = buildDetailUrl(source.apiUrl, { wd: q, pg: page });
  const response = await axios.get(url, { timeout: 15000 });
  const payload = parseApiPayload(response.data);
  const list = pickList(payload);

  return list
    .map((item) => {
      const sourceItemId =
        unwrapMaybeObject(item.vod_id) ||
        unwrapMaybeObject(item.id) ||
        unwrapMaybeObject(item.video_id) ||
        unwrapMaybeObject(item.vodid) ||
        unwrapMaybeObject(item.vid);
      if (!sourceItemId) {
        return null;
      }

      return {
        sourceDbId: String(source.id),
        sourceName: source.name,
        sourceApiUrl: source.apiUrl,
        sourceItemId: String(sourceItemId),
        title: unwrapMaybeObject(item.vod_name) || unwrapMaybeObject(item.name) || '未命名视频',
        cover: unwrapMaybeObject(item.vod_pic) || unwrapMaybeObject(item.pic) || '',
        typeName: unwrapMaybeObject(item.type_name) || unwrapMaybeObject(item.vod_class) || '未分类',
        updatedAtSource:
          unwrapMaybeObject(item.vod_time) ||
          unwrapMaybeObject(item.update_time) ||
          unwrapMaybeObject(item.last_update) ||
          ''
      };
    })
    .filter(Boolean);
}

async function searchVideosAcrossSources(sources, keyword, page = 1) {
  const tasks = sources.map(async (source) => {
    try {
      const list = await searchVideosFromSource(source, keyword, page);
      return { sourceId: source.id, sourceName: source.name, ok: true, list, error: '' };
    } catch (error) {
      return { sourceId: source.id, sourceName: source.name, ok: false, list: [], error: error.message };
    }
  });

  return Promise.all(tasks);
}

function pickTypeList(payload) {
  if (payload?.rss?.class?.ty) {
    return toArray(payload.rss.class.ty).map((item) => ({
      type_id: item.type_id || item.id || item.tid,
      type_name: item.type_name || item.name || item.typename || item['#text'] || ''
    }));
  }
  if (Array.isArray(payload?.class)) {
    return payload.class;
  }
  if (Array.isArray(payload?.data?.class)) {
    return payload.data.class;
  }
  if (Array.isArray(payload?.list) && payload.list.length && (payload.list[0].type_id || payload.list[0].type_name)) {
    return payload.list;
  }
  if (Array.isArray(payload?.data?.list) && payload.data.list.length && (payload.data.list[0].type_id || payload.data.list[0].type_name)) {
    return payload.data.list;
  }
  return [];
}

async function fetchSourceTypes(source) {
  const url = buildDetailUrl(source.apiUrl, { ac: 'list' });
  const response = await axios.get(url, { timeout: 15000 });
  const payload = parseApiPayload(response.data);
  const list = pickTypeList(payload)
    .map((item) => ({
      id: Number(unwrapMaybeObject(item.type_id) || unwrapMaybeObject(item.id) || 0),
      name: String(unwrapMaybeObject(item.type_name) || unwrapMaybeObject(item.name) || '').trim()
    }))
    .filter((item) => Number.isFinite(item.id) && item.id > 0 && item.name);

  const dedup = [];
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    dedup.push(item);
  }
  return dedup;
}

async function collectOneFromSource(source, sourceItemId, fallbackTitle = '') {
  const itemId = String(sourceItemId || '').trim();
  const fallbackName = String(fallbackTitle || '').trim();
  if (!itemId) {
    return { ok: false, importedCount: 0, updatedCount: 0, skippedCount: 0, error: '资源ID不能为空' };
  }

  try {
    if (!source || !source.apiUrl) {
      return { ok: false, importedCount: 0, updatedCount: 0, skippedCount: 0, error: '采集源缺少 apiUrl' };
    }

    const url = buildDetailUrl(source.apiUrl, { ids: itemId, pg: 1 });
    const response = await axios.get(url, { timeout: 15000 });
    const payload = parseApiPayload(response.data);
    const list = pickList(payload);
    const matched = list.filter(
      (item) =>
        String(
          unwrapMaybeObject(item.vod_id) ||
            unwrapMaybeObject(item.id) ||
            unwrapMaybeObject(item.video_id) ||
            unwrapMaybeObject(item.vodid) ||
            unwrapMaybeObject(item.vid) ||
            ''
        ) === itemId
    );
    let targetList = matched;

    if (!targetList.length && fallbackName) {
      const searchUrl = buildDetailUrl(source.apiUrl, { wd: fallbackName, pg: 1 });
      const searchResp = await axios.get(searchUrl, { timeout: 15000 });
      const searchPayload = parseApiPayload(searchResp.data);
      const searchList = pickList(searchPayload);
      targetList = searchList.filter((item) => {
        const rawId = String(
          unwrapMaybeObject(item.vod_id) ||
            unwrapMaybeObject(item.id) ||
            unwrapMaybeObject(item.video_id) ||
            unwrapMaybeObject(item.vodid) ||
            unwrapMaybeObject(item.vid) ||
            ''
        ).trim();
        const rawTitle = String(unwrapMaybeObject(item.vod_name) || unwrapMaybeObject(item.name) || '').trim();
        return rawId === itemId || rawTitle === fallbackName;
      });
    }

    if (!targetList.length) {
      return {
        ok: false,
        importedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        error: `未找到资源: id=${itemId}${fallbackName ? ` title=${fallbackName}` : ''}`
      };
    }

    const stats = await importFromRawList(source, targetList);
    await CollectorJobLog.create({
      sourceName: source.name,
      status: 'success',
      importedCount: stats.importedCount,
      updatedCount: stats.updatedCount,
      skippedCount: stats.skippedCount,
      detail: `单采完成，资源ID: ${itemId}`
    });

    return { ok: true, ...stats };
  } catch (error) {
    await CollectorJobLog.create({
      sourceName: source.name,
      status: 'failed',
      importedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      detail: `单采失败(${itemId}): ${error.message}`
    });

    return { ok: false, importedCount: 0, updatedCount: 0, skippedCount: 0, error: error.message };
  }
}

async function collectFromSource(source, options = {}) {
  let mode = 'latest';
  let startPage = 1;
  let endPage = 1;
  let typeId = 0;
  let hours = 0;

  if (typeof options === 'number') {
    endPage = Math.max(1, Number(options || 1));
  } else {
    mode = String(options.mode || 'latest').toLowerCase() === 'all' ? 'all' : 'latest';
    startPage = Math.max(1, Number(options.startPage || 1));
    endPage = Math.max(startPage, Number(options.endPage || startPage));
    typeId = Math.max(0, Number(options.typeId || 0));
    hours = Math.max(0, Number(options.hours || 0));
  }

  const stats = {
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0
  };

  const hooks = options && typeof options.onProgress === 'function' ? options.onProgress : null;
  const shouldStop = options && typeof options.onShouldStop === 'function' ? options.onShouldStop : null;

  function emitProgress(event) {
    if (!hooks) {
      return;
    }
    try {
      hooks(event);
    } catch (_) {
      // ignore hook errors
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isStopRequested() {
    if (!shouldStop) {
      return false;
    }
    try {
      return Boolean(shouldStop());
    } catch (_) {
      return false;
    }
  }

  const collectMode = mode;
  const pageLimit = collectMode === 'all' ? Number.POSITIVE_INFINITY : endPage;
  let lastFetchedPage = startPage - 1;
  let stopReason = 'completed';
  let stopped = false;
  const emptyPageThreshold = collectMode === 'all' && typeId > 0 ? 5 : 1;
  let emptyPageStreak = 0;
  const categoryParamCandidates = typeId > 0 ? ['t', 'type', 'tid'] : [];
  let activeCategoryParam = categoryParamCandidates[0] || '';
  let categoryParamLocked = false;
  let totalPages = 0;

  try {
    for (let page = startPage; page <= pageLimit; page += 1) {
      if (isStopRequested()) {
        stopReason = 'manual_stop';
        stopped = true;
        emitProgress({ type: 'stopped', mode: collectMode, at: 'before_page', page });
        break;
      }

      const categoryParamsToTry =
        typeId > 0
          ? categoryParamLocked
            ? [activeCategoryParam]
            : [activeCategoryParam, ...categoryParamCandidates.filter((key) => key !== activeCategoryParam)]
          : [''];

      emitProgress({
        type: 'page_start',
        page,
        mode: collectMode,
        categoryParam: activeCategoryParam || '-',
        totalPages
      });

      let url = '';
      let list = [];
      for (const categoryParam of categoryParamsToTry) {
        const query = {
          pg: page,
          h: hours > 0 ? hours : undefined
        };
        if (typeId > 0 && categoryParam) {
          query[categoryParam] = typeId;
        }

        const attemptUrl = buildDetailUrl(source.apiUrl, query);
        const response = await axios.get(attemptUrl, { timeout: 15000 });
        const payload = parseApiPayload(response.data);
        const attemptList = pickList(payload);
        const detectedTotalPages = extractTotalPages(payload);
        if (detectedTotalPages > 0) {
          totalPages = Math.max(totalPages, detectedTotalPages);
        }

        url = attemptUrl;
        if (attemptList.length) {
          list = attemptList;
          if (typeId > 0 && categoryParam && activeCategoryParam !== categoryParam) {
            emitProgress({
              type: 'category_param_switch',
              page,
              from: activeCategoryParam,
              to: categoryParam
            });
          }
          if (typeId > 0 && categoryParam) {
            activeCategoryParam = categoryParam;
            categoryParamLocked = true;
          }
          break;
        }
      }

      lastFetchedPage = page;

      if (!list.length) {
        emptyPageStreak += 1;
        const shouldStopByEmpty = emptyPageStreak >= emptyPageThreshold;
        emitProgress({
          type: 'page_empty',
          page,
          mode: collectMode,
          emptyPageStreak,
          emptyPageThreshold,
          willStop: shouldStopByEmpty,
          categoryParam: activeCategoryParam || '-',
          totalPages
        });
        if (!shouldStopByEmpty && collectMode === 'all') {
          continue;
        }
        stopReason = emptyPageThreshold > 1 ? 'empty_page_threshold' : 'empty_page';
        break;
      }

      emptyPageStreak = 0;

      const onePageStats = await importFromRawList(source, list);
      stats.importedCount += onePageStats.importedCount;
      stats.updatedCount += onePageStats.updatedCount;
      stats.skippedCount += onePageStats.skippedCount;

      const itemResults = Array.isArray(onePageStats.itemResults) ? onePageStats.itemResults : [];
      const sampleTitles = itemResults.map((item) => item.title).filter(Boolean).slice(0, 200);

      emitProgress({
        type: 'page_done',
        page,
        mode: collectMode,
        listCount: list.length,
        pageStats: onePageStats,
        totalStats: { ...stats },
        sampleTitles,
        itemResults,
        categoryParam: activeCategoryParam || '-',
        totalPages
      });

      if (collectMode === 'latest' && page > startPage && onePageStats.importedCount === 0) {
        stopReason = 'latest_no_new';
        emitProgress({ type: 'latest_stop', page, mode: collectMode, totalStats: { ...stats } });
        break;
      }

      if (collectMode === 'all') {
        const waitMs = 10000;
        emitProgress({ type: 'sleep', waitMs, nextPage: page + 1, totalStats: { ...stats } });
        let waitedMs = 0;
        while (waitedMs < waitMs) {
          if (isStopRequested()) {
            stopReason = 'manual_stop';
            stopped = true;
            emitProgress({ type: 'stopped', mode: collectMode, at: 'sleep', page, waitedMs });
            break;
          }
          const step = Math.min(500, waitMs - waitedMs);
          await sleep(step);
          waitedMs += step;
        }
        if (stopped) {
          break;
        }
      }
    }

    await CollectorJobLog.create({
      sourceName: source.name,
      status: 'success',
      importedCount: stats.importedCount,
      updatedCount: stats.updatedCount,
      skippedCount: stats.skippedCount,
      detail: `采集成功，模式: ${collectMode}，页码: ${startPage}-${lastFetchedPage > 0 ? lastFetchedPage : startPage}，分类: ${typeId || '全部'}，最近小时: ${hours || '不限'}，停止原因: ${stopReason}`
    });

    emitProgress({
      type: 'done',
      mode: collectMode,
      totalStats: { ...stats },
      stopReason,
      lastPage: lastFetchedPage > 0 ? lastFetchedPage : startPage,
      stopped,
      totalPages
    });

    return {
      ok: true,
      ...stats,
      stopReason,
      lastPage: lastFetchedPage > 0 ? lastFetchedPage : startPage,
      stopped,
      totalPages
    };
  } catch (error) {
    await CollectorJobLog.create({
      sourceName: source.name,
      status: 'failed',
      importedCount: stats.importedCount,
      updatedCount: stats.updatedCount,
      skippedCount: stats.skippedCount,
      detail: error.message
    });

    emitProgress({
      type: 'error',
      mode: collectMode,
      totalStats: { ...stats },
      error: error.message,
      lastPage: lastFetchedPage > 0 ? lastFetchedPage : startPage,
      totalPages
    });

    return {
      ok: false,
      ...stats,
      error: error.message,
      lastPage: lastFetchedPage > 0 ? lastFetchedPage : startPage,
      totalPages
    };
  }
}

module.exports = {
  collectFromSource,
  searchVideosAcrossSources,
  collectOneFromSource,
  fetchSourceTypes
};
