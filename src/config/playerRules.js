const PLAYER_RULES = {
  // iframe 类地址默认走哪个解析器别名。
  // 可选：'' | 'direct' | 下方 parsers 里的键名
  defaultIframeAlias: 'jx1',

  // 解析器地址模板，%s 会替换为 encodeURIComponent(原始播放地址)
  parsers: {
    jx1: 'https://jx.playerjy.com/?url=%s',
    jx2: 'https://jx.xmflv.com/?url=%s'
  },

  // 按采集源匹配（sourceName 包含关键字时生效）
  sourceRules: [
    // { keyword: '量子', alias: 'jx1' },
    // { keyword: '非凡', alias: 'jx2' }
  ],

  // 按播放地址匹配（url 包含关键字时生效）
  urlRules: [
    // { keyword: 'youku.com', alias: 'jx1' },
    // { keyword: 'iqiyi.com', alias: 'jx2' }
  ]
};

module.exports = PLAYER_RULES;
