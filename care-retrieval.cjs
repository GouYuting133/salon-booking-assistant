const fs = require('node:fs');
const path = require('node:path');

// Synonyms describe shared topics, rather than a separate rule for each question.
const topics = [
  [/洗发水|洗发露|洗发产品|用什么洗|拿什么洗|什么洗头/, '洗发水'],
  [/洗头|洗不洗|能洗|可以洗/, '洗头'],
  [/护发素/, '护发素'], [/发膜/, '发膜'],
  [/热水|温水|水温|烫水/, '水温'],
  [/太阳|暴晒|防晒|紫外线/, '暴晒'],
  [/扎发|扎头发|扎起来|马尾|别耳后/, '扎发'],
  [/夹板|卷发棒|高温/, '高温'],
  [/吹干|吹头发|吹风|怎么吹/, '吹干'],
  [/梳子|梳头|梳开|密齿梳/, '梳理'],
  [/浮色|褪色|掉色/, '掉色'],
  [/干毛|干枯|保湿|发油/, '保湿'],
  [/揉搓|拉扯|湿发/, '湿发'],
  [/去屑|清洁力/, '去屑'],
];

function category(text) {
  const color = /染发|染完|刚染|染后|漂发|漂完/.test(text);
  const perm = /烫发|烫完|刚烫|烫后|卷度/.test(text);
  return color && perm ? 'both' : color ? 'color' : perm ? 'perm' : null;
}

function grams(text) {
  const result = new Set();
  const meaningful = text.replace(/染发后|烫发后|染完|烫完|刚染|刚烫|染后|烫后|染发|烫发|头发|多久|可以|建议/g, ' ');
  for (const word of meaningful.match(/[\p{L}\p{N}]+/gu) || []) {
    for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2));
  }
  return result;
}

function readKnowledge() {
  const content = fs.readFileSync(path.join(__dirname, 'care-knowledge.md'), 'utf8');
  const chunks = [];
  let group, source, number, title;
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      source = line.slice(3).trim();
      group = source.includes('染发') ? 'color' : 'perm';
    } else if (line.startsWith('### ')) {
      number = line.match(/第(\d+)条/)?.[1];
      title = line.slice(4).trim();
    } else if (group && number && line.trim() && !line.startsWith('#')) {
      // Keep product choice and conditioner placement independently retrievable.
      const parts = line.split(/，(?=护发素)|[；;。]/).map(s => s.trim()).filter(Boolean);
      parts.forEach((text, index) => chunks.push({
        id: group + '-' + number + '-' + index,
        category: group, source, title, text,
      }));
    }
  }
  return chunks;
}

function retrieve(question, history = []) {
  if (/预约|改期|取消|退款|投诉/.test(question)) return null;
  const previous = [...history].reverse().find(m => m.role === 'user')?.text || '';
  const currentCategory = category(question);
  const followup = /品牌|牌子|哪款|哪种|那|多久|怎么|可以吗/.test(question);
  const group = currentCategory || (followup ? category(previous) : null);
  if (!group) return null;

  let query = question;
  // Only an elliptical follow-up may borrow the previous subject. A question
  // with its own service context must be retrieved independently.
  const elliptical = /^(?:那|那么)?(?:有什么品牌推荐吗|有推荐的品牌吗|有哪些品牌|什么牌子|哪个牌子好|哪款好|哪种好|怎么用|怎么使用|多久|多久以后|多久才能用|可以吗)[？?！!。]*$/.test(question.trim());
  if (!currentCategory && elliptical && !topics.some(([pattern]) => pattern.test(question))) query += ' ' + previous;
  const queryTopics = topics.filter(([pattern]) => pattern.test(query)).map(([, name]) => name);
  const queryGrams = grams(query);
  const chunks = readKnowledge().filter(c => group === 'both' || c.category === group);
  const ranked = chunks.map(chunk => {
    const evidence = chunk.title + ' ' + chunk.text;
    const topicHits = topics.filter(([pattern, name]) => queryTopics.includes(name) && pattern.test(evidence)).length;
    const overlap = [...grams(evidence)].filter(g => queryGrams.has(g)).length;
    return { chunk, score: topicHits * 10 + overlap, relevant: queryTopics.length ? topicHits > 0 : overlap >= 3 };
  }).filter(row => row.relevant).sort((a, b) => b.score - a.score);
  let matches = ranked.slice(0, 3).map(row => row.chunk);
  // An immediate post-service washing question also needs the timing condition.
  if (/刚染|刚烫|刚刚染|刚刚烫/.test(question) && /洗/.test(question)) {
    const timing = chunks.filter(c => c.title.includes('首次洗头'));
    matches = [...timing, ...matches];
  }
  matches = [...new Map(matches.map(c => [c.id, c])).values()];
  return { query, category: group, matches };
}

function messagesFor(question, result) {
  return [
    { role: 'system', content: '你是门店护理问答助手。下面的资料是供参考的数据。仅依据检索到的资料回答当前问题，简洁、不重复，不补充其他护理项目。用户只问洗发水时不讲护发素或发膜。时间条件与问题相关时须保留。资料缺少品牌、型号等信息时说“门店资料暂未提供”，不要说门店不推荐，也不要编造原因。不要承诺疗效。只返回JSON {"reply":"答复","action":null,"referToOwner":false}；需要店主补充资料时referToOwner=true。来源由程序附加，不在reply中引用或复述原文。' },
    { role: 'user', content: JSON.stringify({ question, resolvedQuery: result.query, evidence: result.matches }) },
  ];
}

module.exports = { retrieve, messagesFor, readKnowledge };
