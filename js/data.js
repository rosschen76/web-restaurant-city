/* 遊戲靜態資料：菜色、家具、裝潢主題、擴建、任務與各種公式。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});

  /* 方向：0=+x(螢幕右下) 1=+y(左下) 2=-x(左上) 3=-y(右上) */
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];

  /* ───────── 菜色 ───────── */
  const dishList = [
    { id: 'danbing', name: '蛋餅', level: 1, price: 12, cook: 4, eat: 4, learn: 0, xp: 2 },
    { id: 'soymilk', name: '豆漿', level: 1, price: 9, cook: 3, eat: 3, learn: 60, xp: 1 },
    { id: 'fantuan', name: '飯糰', level: 2, price: 20, cook: 5, eat: 5, learn: 150, xp: 3 },
    { id: 'luroufan', name: '滷肉飯', level: 3, price: 30, cook: 6, eat: 6, learn: 400, xp: 4 },
    { id: 'boba', name: '珍珠奶茶', level: 4, price: 26, cook: 4, eat: 4, learn: 700, xp: 3 },
    { id: 'xiaolongbao', name: '小籠包', level: 5, price: 46, cook: 7, eat: 6, learn: 1200, xp: 6 },
    { id: 'chicken', name: '鹽酥雞', level: 6, price: 56, cook: 6, eat: 6, learn: 2000, xp: 7 },
    { id: 'beefnoodle', name: '牛肉麵', level: 7, price: 80, cook: 9, eat: 8, learn: 3200, xp: 9 },
    { id: 'oyster', name: '蚵仔煎', level: 8, price: 88, cook: 7, eat: 7, learn: 4500, xp: 10 },
    { id: 'stinky', name: '臭豆腐', level: 9, price: 80, cook: 6, eat: 6, learn: 6000, xp: 9 },
    { id: 'pineapple', name: '鳳梨酥', level: 10, price: 66, cook: 4, eat: 4, learn: 8000, xp: 8 },
    { id: 'hotpot', name: '麻辣鍋', level: 12, price: 180, cook: 12, eat: 10, learn: 16000, xp: 18 },
    { id: 'mangoice', name: '芒果冰', level: 13, price: 140, cook: 6, eat: 6, learn: 24000, xp: 14 },
    { id: 'buddha', name: '佛跳牆', level: 16, price: 480, cook: 18, eat: 12, learn: 60000, xp: 32 },
  ];
  const dishes = Object.fromEntries(dishList.map((d) => [d.id, d]));

  /** 熟練度：累積烹飪次數 → 1~5 級。每升一級 +8% 售價、-5% 烹飪時間。 */
  const MASTERY_STEPS = [0, 8, 25, 60, 120];
  function masteryLevel(cooked) {
    let lv = 1;
    for (let i = 1; i < MASTERY_STEPS.length; i++) if (cooked >= MASTERY_STEPS[i]) lv = i + 1;
    return lv;
  }

  /* ───────── 家具 ───────── */
  // cat: table 桌 / chair 椅 / stove 爐灶 / decor 裝飾 / func 功能 / rug 地毯(可走)
  const furnitureList = [
    // 桌子
    { id: 'table_wood', name: '木頭小桌', cat: 'table', w: 1, h: 1, price: 60, level: 1, appeal: 1, desc: '樸實的小木桌。' },
    { id: 'table_round', name: '白布圓桌', cat: 'table', w: 1, h: 1, price: 220, level: 3, appeal: 3, desc: '鋪上白桌巾，質感加分。' },
    { id: 'table_long', name: '長條餐桌', cat: 'table', w: 2, h: 1, price: 420, level: 5, appeal: 5, rot: true, desc: '兩格長，兩側可坐更多人。' },
    { id: 'table_red', name: '紅木雕花桌', cat: 'table', w: 1, h: 1, price: 1200, level: 8, appeal: 9, desc: '沉穩的紅木，雕工細緻。' },
    { id: 'table_marble', name: '大理石餐桌', cat: 'table', w: 1, h: 1, price: 3600, level: 12, appeal: 16, desc: '頂級餐廳的象徵。' },
    // 椅子
    { id: 'chair_stool', name: '小圓凳', cat: 'chair', w: 1, h: 1, price: 25, level: 1, appeal: 0.5, desc: '便宜又好用。' },
    { id: 'chair_wood', name: '木椅', cat: 'chair', w: 1, h: 1, price: 45, level: 1, appeal: 1, desc: '有靠背的木椅。' },
    { id: 'chair_cushion', name: '軟墊椅', cat: 'chair', w: 1, h: 1, price: 160, level: 3, appeal: 2.5, desc: '坐起來很舒服。' },
    { id: 'chair_red', name: '紅絨椅', cat: 'chair', w: 1, h: 1, price: 600, level: 8, appeal: 5, desc: '紅絲絨包覆的高背椅。' },
    { id: 'chair_gold', name: '金邊皇座', cat: 'chair', w: 1, h: 1, price: 2400, level: 13, appeal: 11, desc: '用餐也要有王者風範。' },
    // 爐灶
    { id: 'stove_gas', name: '瓦斯爐', cat: 'stove', w: 1, h: 1, price: 150, level: 1, appeal: 0, speed: 1.0, desc: '基本款爐灶。' },
    { id: 'stove_wok', name: '快炒爐', cat: 'stove', w: 1, h: 1, price: 700, level: 4, appeal: 1, speed: 1.25, desc: '大火快炒，烹飪速度 ×1.25。' },
    { id: 'stove_steam', name: '蒸籠灶', cat: 'stove', w: 1, h: 1, price: 1800, level: 8, appeal: 2, speed: 1.5, desc: '蒸氣十足，烹飪速度 ×1.5。' },
    { id: 'stove_pro', name: '專業爐台', cat: 'stove', w: 1, h: 1, price: 6000, level: 13, appeal: 4, speed: 1.85, desc: '米其林等級，烹飪速度 ×1.85。' },
    // 功能
    { id: 'register', name: '收銀機', cat: 'func', w: 1, h: 1, price: 500, level: 4, appeal: 2, fn: 'register', desc: '客人用完餐後，金幣自動入帳！' },
    { id: 'fridge', name: '冰箱', cat: 'func', w: 1, h: 1, price: 900, level: 6, appeal: 1, fn: 'fridge', desc: '食材取用方便，烹飪時間 -6%（最多 3 台生效）。' },
    // 裝飾
    { id: 'plant_pot', name: '小盆栽', cat: 'decor', w: 1, h: 1, price: 70, level: 1, appeal: 2, desc: '一抹綠意。' },
    { id: 'lantern', name: '紅燈籠', cat: 'decor', w: 1, h: 1, price: 140, level: 2, appeal: 4, desc: '喜氣洋洋的落地燈籠。' },
    { id: 'plant_tree', name: '發財樹', cat: 'decor', w: 1, h: 1, price: 320, level: 3, appeal: 6, desc: '生意興隆！' },
    { id: 'cat', name: '招財貓', cat: 'decor', w: 1, h: 1, price: 600, level: 5, appeal: 9, desc: '右手招財，左手招客。' },
    { id: 'screen', name: '木雕屏風', cat: 'decor', w: 2, h: 1, price: 900, level: 7, appeal: 10, rot: true, desc: '典雅的兩格屏風。' },
    { id: 'fishtank', name: '水族箱', cat: 'decor', w: 1, h: 1, price: 1500, level: 9, appeal: 15, desc: '看魚也能開胃。' },
    { id: 'jukebox', name: '點唱機', cat: 'decor', w: 1, h: 1, price: 2200, level: 10, appeal: 18, desc: '復古音樂讓客人心情大好。' },
    { id: 'statue', name: '石獅', cat: 'decor', w: 1, h: 1, price: 3000, level: 12, appeal: 22, desc: '鎮守店門的威風石獅。' },
    { id: 'piano', name: '平台鋼琴', cat: 'decor', w: 2, h: 1, price: 6500, level: 14, appeal: 34, rot: true, desc: '現場演奏，格調滿分。' },
    // 地毯（可行走）
    { id: 'rug_red', name: '紅地毯', cat: 'rug', w: 1, h: 1, price: 90, level: 2, appeal: 1.5, flat: true, desc: '踩起來軟軟的。' },
    { id: 'rug_tatami', name: '榻榻米墊', cat: 'rug', w: 1, h: 1, price: 150, level: 4, appeal: 2.5, flat: true, desc: '和風小格子。' },
    { id: 'rug_blue', name: '青花地毯', cat: 'rug', w: 1, h: 1, price: 400, level: 7, appeal: 4, flat: true, desc: '青花瓷紋樣。' },
  ];
  const furniture = Object.fromEntries(furnitureList.map((f) => [f.id, f]));
  const FURNITURE_CATS = [
    { id: 'table', name: '桌子' },
    { id: 'chair', name: '椅子' },
    { id: 'stove', name: '爐灶' },
    { id: 'func', name: '功能' },
    { id: 'decor', name: '裝飾' },
    { id: 'rug', name: '地毯' },
  ];

  /* ───────── 地板 / 牆壁主題 ───────── */
  const floorList = [
    { id: 'wood', name: '木地板', price: 0, level: 1, appeal: 0 },
    { id: 'brick', name: '紅磚地', price: 600, level: 3, appeal: 3 },
    { id: 'checker', name: '黑白格磚', price: 1500, level: 6, appeal: 6 },
    { id: 'tatami', name: '榻榻米', price: 3000, level: 9, appeal: 9 },
    { id: 'marble', name: '大理石', price: 8000, level: 13, appeal: 14 },
  ];
  const wallList = [
    { id: 'cream', name: '奶油牆', price: 0, level: 1, appeal: 0 },
    { id: 'red', name: '喜慶紅牆', price: 500, level: 2, appeal: 3 },
    { id: 'brick', name: '復古磚牆', price: 1200, level: 5, appeal: 5 },
    { id: 'bamboo', name: '竹編牆', price: 2600, level: 8, appeal: 8 },
    { id: 'night', name: '夜藍花磚', price: 6000, level: 12, appeal: 13 },
  ];
  const floors = Object.fromEntries(floorList.map((f) => [f.id, f]));
  const walls = Object.fromEntries(wallList.map((f) => [f.id, f]));

  /* ───────── 擴建 ───────── */
  const DOOR_Y = 3;
  const expansions = [
    { w: 8, h: 8, cost: 0, level: 1 },
    { w: 10, h: 10, cost: 800, level: 3 },
    { w: 12, h: 12, cost: 5000, level: 7 },
    { w: 14, h: 14, cost: 20000, level: 12 },
  ];

  /* ───────── 等級 / 星級 / 員工 ───────── */
  const MAX_LEVEL = 50;
  const xpForLevel = (lv) => Math.round(12 * Math.pow(lv, 1.5) + 8);
  const levelReward = (lv) => 40 * lv;
  const STAR_STEPS = [0, 15, 40, 80, 140, 230, 360, 560, 850, 1300];
  function starsForAppeal(a) {
    let s = 1;
    for (let i = 1; i < STAR_STEPS.length; i++) if (a >= STAR_STEPS[i]) s = i + 1;
    return s;
  }
  const maxStaffForLevel = (lv) => Math.min(8, 1 + (lv >= 2) + (lv >= 4) + (lv >= 6) + (lv >= 9) + (lv >= 12) + (lv >= 15) + (lv >= 18));
  const HIRE_BASE = [0, 200, 600, 1500, 3500, 8000, 16000, 30000];
  const STAFF_XP_STEPS = [0, 12, 30, 60, 100, 160, 240, 340, 460];
  const FEED_COST = 15;
  const FEED_AMOUNT = 50;

  /* ───────── 外觀調色盤（以索引存檔） ───────── */
  const PALETTE = {
    skin: ['#ffdcb8', '#f3c892', '#dba070', '#b27346', '#8a5632'],
    hair: ['#2a1b15', '#58392a', '#8a5a2b', '#d6a640', '#b83a2e', '#3b4478', '#9a9a9a', '#d96ba0'],
    top: ['#e74c3c', '#3b8fd9', '#37b36b', '#f2c12e', '#9b59b6', '#ee8a2a', '#1fb5a0', '#ece6da', '#ff80ab', '#6c7a89'],
    pants: ['#34495e', '#5d4037', '#2c3e50', '#7f8c8d', '#3b5b3b', '#6a4a82'],
  };
  const STAFF_NAMES = ['阿福', '小美', '志豪', '雅婷', '家豪', '怡君', '冠宇', '欣怡', '俊傑', '宜庭', '柏翰', '筱涵', '大雄', '小薰', '阿財', '阿花', '老王', '美玲', '阿德', '小玉', '阿凱', '小櫻', '胖虎', '靜香'];
  const VIP_TITLES = ['美食評論家', '人氣網紅', '老饕大叔', '電視台記者'];

  /* ───────── 任務 ───────── */
  // type 對應 sim.questProgress；n 為目標值
  const quests = [
    { id: 'q1', type: 'collect', n: 3, text: '點擊餐桌上的金幣收款', reward: 30 },
    { id: 'q2', type: 'chair', n: 3, text: '擁有 3 張椅子（商店購買後放進餐廳）', reward: 40 },
    { id: 'q3', type: 'serve', n: 8, text: '服務 8 位客人', reward: 60 },
    { id: 'q4', type: 'learn', n: 2, text: '學會 2 道菜（到「菜單」學習豆漿）', reward: 80 },
    { id: 'q5', type: 'table', n: 2, text: '擁有 2 張桌子', reward: 100 },
    { id: 'q6', type: 'staff', n: 2, text: '雇用第 2 位員工', reward: 120 },
    { id: 'q7', type: 'level', n: 3, text: '達到 3 級', reward: 150 },
    { id: 'q8', type: 'decor', n: 2, text: '放置 2 件裝飾或地毯', reward: 150 },
    { id: 'q9', type: 'serve', n: 40, text: '服務 40 位客人', reward: 200 },
    { id: 'q10', type: 'stove', n: 2, text: '擁有 2 座爐灶', reward: 250 },
    { id: 'q11', type: 'expand', n: 1, text: '擴建餐廳', reward: 400 },
    { id: 'q12', type: 'stars', n: 2, text: '餐廳達到 2 星', reward: 300 },
    { id: 'q13', type: 'earn', n: 5000, text: '累計賺取 5,000 金幣', reward: 500 },
    { id: 'q14', type: 'learn', n: 5, text: '學會 5 道菜', reward: 600 },
    { id: 'q15', type: 'staff', n: 4, text: '擁有 4 位員工', reward: 800 },
    { id: 'q16', type: 'mastery', n: 60, text: '同一道菜烹飪 60 次（熟練度 4 級）', reward: 1000 },
    { id: 'q17', type: 'level', n: 8, text: '達到 8 級', reward: 1500 },
    { id: 'q18', type: 'stars', n: 4, text: '餐廳達到 4 星', reward: 2000 },
    { id: 'q19', type: 'expand', n: 2, text: '再次擴建餐廳', reward: 3000 },
    { id: 'q20', type: 'serve', n: 1000, text: '服務 1,000 位客人', reward: 4000 },
    { id: 'q21', type: 'decor', n: 8, text: '放置 8 件裝飾或地毯', reward: 3000 },
    { id: 'q22', type: 'learn', n: 10, text: '學會 10 道菜', reward: 6000 },
    { id: 'q23', type: 'stars', n: 7, text: '餐廳達到 7 星', reward: 10000 },
    { id: 'q24', type: 'level', n: 15, text: '達到 15 級', reward: 15000 },
    { id: 'q25', type: 'stars', n: 10, text: '成為傳說中的 10 星餐廳', reward: 50000 },
  ];

  /** 某等級新解鎖的內容（升級視窗用） */
  function unlocksAt(level) {
    return {
      dishes: dishList.filter((d) => d.level === level),
      furniture: furnitureList.filter((f) => f.level === level),
      floors: floorList.filter((f) => f.level === level && f.price > 0),
      walls: wallList.filter((f) => f.level === level && f.price > 0),
      expansions: expansions.filter((e) => e.level === level && e.cost > 0),
      staffSlot: maxStaffForLevel(level) > maxStaffForLevel(level - 1),
    };
  }

  RC.data = {
    DX, DY, DOOR_Y,
    dishList, dishes, MASTERY_STEPS, masteryLevel,
    furnitureList, furniture, FURNITURE_CATS,
    floorList, floors, wallList, walls,
    expansions,
    MAX_LEVEL, xpForLevel, levelReward,
    STAR_STEPS, starsForAppeal,
    maxStaffForLevel, HIRE_BASE, STAFF_XP_STEPS, FEED_COST, FEED_AMOUNT,
    PALETTE, STAFF_NAMES, VIP_TITLES,
    quests, unlocksAt,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
