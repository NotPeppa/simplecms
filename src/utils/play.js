const playerRules = require('../config/playerRules');

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeUrl(url) {
  let clean = decodeHtmlEntities(url).trim();
  if (!clean) {
    return '';
  }

  clean = clean.replace(/\s+/g, '');

  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1).trim();
  }

  if (/^https?%3A%2F%2F/i.test(clean)) {
    try {
      clean = decodeURIComponent(clean);
    } catch (_) {
      return clean;
    }
  }

  if (clean.startsWith('//')) {
    return `https:${clean}`;
  }

  if (/^https?:\/\//i.test(clean)) {
    const protocol = clean.slice(0, 8).toLowerCase().startsWith('https://') ? 'https://' : 'http://';
    const rest = clean.slice(protocol.length);
    if (/^[^/]+:\d+\//.test(rest)) {
      return `${protocol}${rest}`;
    }
    const firstSlash = rest.indexOf('/');
    if (firstSlash > 0) {
      const host = rest.slice(0, firstSlash);
      const path = rest.slice(firstSlash);
      if (host.includes(':') && !host.startsWith('[') && host.split(':').length > 2) {
        const hostParts = host.split(':');
        const normalizedHost = hostParts.shift();
        return `${protocol}${normalizedHost}${path}`;
      }
    }
  }

  return clean;
}

function getPlayType(url) {
  const value = String(url || '').toLowerCase();
  if (!value) {
    return 'unknown';
  }

  if (/\.(m3u8)([?#]|$)/.test(value) || /([?&](type|format|ext)=m3u8)([&#]|$)/.test(value) || /\/m3u8([/?#]|$)/.test(value)) {
    return 'm3u8';
  }

  if (/\.(mp4|webm|ogg|m4v|mov|flv|mp3)(\?|$)/.test(value)) {
    return 'media';
  }

  if (/^https?:\/\//.test(value)) {
    return 'iframe';
  }

  return 'unknown';
}

function splitPlayGroups(playUrlText) {
  return String(playUrlText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '#')
    .split(/\${3,}/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeFromCode(value) {
  return String(value || '')
    .replace(/^@from=/i, '')
    .trim()
    .replace(/[#$\s]/g, '')
    .toLowerCase();
}

function splitGroupMeta(groupLine) {
  const line = String(groupLine || '').trim();
  if (!line) {
    return { fromCode: '', line: '' };
  }

  if (!line.startsWith('@from=')) {
    return { fromCode: '', line };
  }

  const splitAt = line.indexOf('#');
  if (splitAt < 0) {
    return { fromCode: normalizeFromCode(line.slice(6)), line: '' };
  }

  return {
    fromCode: normalizeFromCode(line.slice(6, splitAt)),
    line: line.slice(splitAt + 1).trim()
  };
}

function pickAlias(sourceName, rawUrl) {
  const source = String(sourceName || '').toLowerCase();
  const url = String(rawUrl || '').toLowerCase();

  for (const rule of playerRules.sourceRules || []) {
    const keyword = String(rule.keyword || '').toLowerCase();
    if (keyword && source.includes(keyword) && rule.alias) {
      return rule.alias;
    }
  }

  for (const rule of playerRules.urlRules || []) {
    const keyword = String(rule.keyword || '').toLowerCase();
    if (keyword && url.includes(keyword) && rule.alias) {
      return rule.alias;
    }
  }

  return playerRules.defaultIframeAlias || '';
}

function pickSourceParser(options = {}, fromCode) {
  const parserMap = options.parserMapByFrom || {};
  let parser = null;
  if (fromCode) {
    parser = parserMap[fromCode] || parserMap[fromCode.toLowerCase()] || null;
  }

  if (!parser) {
    parser = options.defaultParser || null;
  }

  if (!parser) {
    return null;
  }

  return {
    fromCode: String(parser.fromCode || fromCode || '').trim().toLowerCase(),
    showName: String(parser.showName || '').trim(),
    parseUrl: String(parser.parseUrl).trim(),
    ps: String(parser.ps || '').trim(),
    target: String(parser.target || '').trim(),
    playVia: String(parser.showName || parser.fromCode || fromCode || 'custom').trim()
  };
}

function buildParserUrl(parseUrl, rawUrl) {
  const tpl = String(parseUrl || '').trim();
  if (!tpl) {
    return rawUrl;
  }

  if (tpl.includes('%s')) {
    return tpl.replace('%s', encodeURIComponent(rawUrl));
  }

  if (tpl.includes('{url}')) {
    return tpl.replace('{url}', rawUrl);
  }

  return `${tpl}${rawUrl}`;
}

function buildParsedUrl(rawUrl, alias, sourceParser) {
  if (sourceParser) {
    const ps = String(sourceParser.ps || '1').trim();
    if (ps === '0') {
      return {
        url: rawUrl,
        playVia: sourceParser.playVia || 'direct',
        forcedType: '',
        target: sourceParser.target || ''
      };
    }

    if (!sourceParser.parseUrl) {
      return {
        url: rawUrl,
        playVia: sourceParser.playVia || 'direct',
        forcedType: '',
        target: sourceParser.target || ''
      };
    }

    return {
      url: buildParserUrl(sourceParser.parseUrl, rawUrl),
      playVia: sourceParser.playVia || 'custom',
      forcedType: 'iframe',
      target: sourceParser.target || '_self'
    };
  }

  const parserTpl = playerRules.parsers ? playerRules.parsers[alias] : '';
  if (!alias || alias === 'direct' || !parserTpl) {
    return { url: rawUrl, playVia: 'direct' };
  }

  return {
    url: parserTpl.replace('%s', encodeURIComponent(rawUrl)),
    playVia: alias,
    target: ''
  };
}

function parseOneEpisode(segment, index, groupIndex, fromCode, options = {}) {
  const cleanSegment = String(segment || '').trim();
  if (!cleanSegment) {
    return null;
  }

  let name = '';
  let rawUrl = cleanSegment;
  let epFromCode = normalizeFromCode(fromCode);

  const splitAt = cleanSegment.indexOf('$');
  if (splitAt >= 0) {
    name = cleanSegment.slice(0, splitAt).trim();
    const rest = cleanSegment.slice(splitAt + 1).trim();
    const secondSplitAt = rest.indexOf('$');
    if (secondSplitAt >= 0) {
      rawUrl = rest.slice(0, secondSplitAt).trim();
      const fromOverride = normalizeFromCode(rest.slice(secondSplitAt + 1));
      if (fromOverride) {
        epFromCode = fromOverride;
      }
    } else {
      rawUrl = rest;
    }
  } else {
    rawUrl = cleanSegment;
  }

  rawUrl = normalizeUrl(rawUrl);
  if (!rawUrl) {
    return null;
  }

  let type = getPlayType(rawUrl);
  const sourceParser = pickSourceParser(options, epFromCode);
  const alias = pickAlias(options.sourceName, rawUrl);
  const parserResolved = buildParsedUrl(rawUrl, alias, sourceParser);
  const allowGlobalAliasFallback = options.allowGlobalAliasFallback !== false;
  let resolved = { url: rawUrl, playVia: 'direct', forcedType: '', target: '' };

  if (sourceParser) {
    resolved = parserResolved;
    if (resolved.forcedType) {
      type = resolved.forcedType;
    }
  } else if (type === 'iframe' && allowGlobalAliasFallback) {
    resolved = parserResolved;
  }

  return {
    name: name || `线路${groupIndex + 1} - 第${index + 1}集`,
    url: resolved.url,
    rawUrl,
    fromCode: epFromCode,
    type,
    playVia: resolved.playVia,
    target: resolved.target
  };
}

function parsePlayItems(playUrlText, options = {}) {
  if (!playUrlText || typeof playUrlText !== 'string') {
    return [];
  }

  const groups = splitPlayGroups(playUrlText);
  const result = [];

  groups.forEach((rawLine, groupIndex) => {
    const groupMeta = splitGroupMeta(rawLine);
    if (!groupMeta.line) {
      return;
    }

    groupMeta.line
      .split('#')
      .map((segment, index) => parseOneEpisode(segment, index, groupIndex, groupMeta.fromCode, options))
      .filter(Boolean)
      .forEach((item) => result.push(item));
  });

  return result;
}

module.exports = {
  parsePlayItems
};
