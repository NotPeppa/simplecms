require('dotenv').config();

const { initModels, Category, Video } = require('../models');

const categoryNames = ['电影', '电视剧', '综艺', '动漫', '短剧', '动作', '悬疑', '喜剧'];

const coverPool = [
  'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=600&q=60',
  'https://images.unsplash.com/photo-1478720568477-152d9b164e26?auto=format&fit=crop&w=600&q=60',
  'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=600&q=60',
  'https://images.unsplash.com/photo-1460881680858-30d872d5b530?auto=format&fit=crop&w=600&q=60',
  'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=600&q=60',
  'https://images.unsplash.com/photo-1616530940355-351fabd9524b?auto=format&fit=crop&w=600&q=60'
];

const titlePrefix = [
  '星际',
  '暗夜',
  '追风',
  '无间',
  '破晓',
  '天幕',
  '迷城',
  '逆流',
  '深海',
  '孤岛'
];

const titleSuffix = [
  '行动',
  '疑云',
  '迷踪',
  '边缘',
  '档案',
  '追击',
  '风暴',
  '信号',
  '时空',
  '传说'
];

function makeTitle(index) {
  const left = titlePrefix[index % titlePrefix.length];
  const right = titleSuffix[(index * 3) % titleSuffix.length];
  return `${left}${right}${index + 1}`;
}

function makePlayUrl(index) {
  return [
    `第1集$https://www.example.com/player/mock-${index + 1}-1`,
    `第2集$https://www.example.com/player/mock-${index + 1}-2`,
    `第3集$https://www.example.com/player/mock-${index + 1}-3`
  ].join('#');
}

async function run() {
  await initModels();

  const categories = [];
  for (const name of categoryNames) {
    const [cat] = await Category.findOrCreate({ where: { name } });
    categories.push(cat);
  }

  const total = 72;
  let created = 0;
  let updated = 0;

  for (let i = 0; i < total; i += 1) {
    const category = categories[i % categories.length];
    const payload = {
      sourceId: `mock:video:${i + 1}`,
      title: makeTitle(i),
      cover: coverPool[i % coverPool.length],
      description: `这是用于首页样式预览的模拟数据，编号 ${i + 1}。`,
      playUrl: makePlayUrl(i),
      sourceName: 'mock',
      updatedAtSource: new Date().toISOString().slice(0, 19).replace('T', ' '),
      categoryId: category.id
    };

    const existing = await Video.findOne({ where: { sourceId: payload.sourceId } });
    if (existing) {
      await existing.update(payload);
      updated += 1;
    } else {
      await Video.create(payload);
      created += 1;
    }
  }

  console.log(`mock seed done: created=${created}, updated=${updated}, total=${total}`);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('mock seed failed:', error.message);
    process.exit(1);
  });
