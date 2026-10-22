/* 像素美術（人物、菜色、圖示、特效）。人物每幀以矩形即時繪製，可自由換裝與做動畫。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});
  const gfx = RC.gfx;
  const { canvas, ctx, shade, mix, rect, pixmap, OUTLINE } = gfx;
  const D = RC.data;
  const P = D.PALETTE;

  /* ───────── 人物 ───────── */

  /**
   * 畫一個 Q 版小人，(x,y) 為腳底中心。
   * o: { dir:0~3, walk:0~1(步伐相位), pose:'stand'|'sit'|'eat', eat:0/1, staff, vip, t }
   * 預設面向左（dir 1 = 左下）；dir 0/3 水平翻轉；dir 2/3 為背面。
   */
  function drawPerson(g, x, y, look, o) {
    const back = o.dir >= 2;
    const flip = o.dir === 0 || o.dir === 3;
    const sit = o.pose === 'sit' || o.pose === 'eat';
    const skin = P.skin[look.skin];
    const hair = P.hair[look.hair];
    let top = P.top[look.top];
    const pants = P.pants[look.pants];
    if (o.vip) top = '#2d2d38';
    const bob = o.walk !== undefined && o.moving && o.walk > 0.5 ? -1 : 0;
    const dy = (sit ? 4 : 0) + bob;
    const parts = [];
    const add = (px, py, w, h, c) => parts.push([flip ? -(px + w) : px, py, w, h, c]);

    // 腿 / 鞋
    if (!sit) {
      const lift = o.moving ? (o.walk > 0.5 ? 1 : 0) : 0;
      const lift2 = o.moving ? (o.walk > 0.5 ? 0 : 1) : 0;
      add(-3, -6 + lift, 2, 4 - lift, pants);
      add(0, -6 + lift2, 2, 4 - lift2, pants);
      add(-3, -2, 2, 2 - lift, '#2b2220');
      add(0, -2, 2, 2 - lift2, '#2b2220');
    } else {
      add(-3, -5, 6, 2, pants);
      add(-4, -3, 3, 2, '#2b2220');
      add(1, -3, 3, 2, '#2b2220');
    }
    // 身體
    add(-3, -13 + dy, 6, 7, top);
    add(2, -13 + dy, 1, 7, shade(top, 0.8));
    const armUp = o.pose === 'eat' && o.eat;
    add(-5, -12 + dy, 2, 5, shade(top, 0.9));
    add(-5, -7 + dy, 2, 1, skin);
    if (armUp) {
      add(3, -16 + dy, 2, 5, shade(top, 0.9));
      add(3, -17 + dy, 2, 1, skin);
      add(5, -18 + dy, 1, 2, '#d8d8d8');
    } else {
      add(3, -12 + dy, 2, 5, shade(top, 0.9));
      add(3, -7 + dy, 2, 1, skin);
    }
    if (o.staff && !back) {
      // 店掌櫃穿深褐色圍裙配金邊；一般員工是白圍裙
      add(-3, -11 + dy, 6, 6, o.boss ? '#6b4528' : '#f6f1e6');
      add(-3, -11 + dy, 6, 1, o.boss ? '#e8b83a' : '#d94f43');
      add(2, -11 + dy, 1, 6, o.boss ? '#4f321c' : '#d9d2c3');
      if (o.boss) add(-1, -8 + dy, 2, 2, '#e8b83a');
    } else if (o.staff && back) {
      add(-3, -9 + dy, 6, 1, o.boss ? '#e8b83a' : '#f6f1e6');
    }
    if (o.vip && !back) {
      add(-1, -13 + dy, 1, 5, '#e8b83a');
    }
    // 頭
    add(-4, -22 + dy, 8, 8, skin);
    if (back) {
      add(-4, -24 + dy, 8, 1, hair);
      add(-5, -23 + dy, 10, 9, hair);
      if (look.hairStyle === 1) add(-5, -14 + dy, 10, 4, hair);
      add(-4, -24 + dy, 8, 1, shade(hair, 1.25));
    } else {
      add(-4, -24 + dy, 8, 1, shade(hair, 1.25));
      add(-5, -23 + dy, 10, 4, hair);
      add(-5, -19 + dy, 1, 3, hair);
      add(4, -19 + dy, 1, 3, hair);
      if (look.hairStyle === 1) {
        add(-5, -16 + dy, 1, 5, hair);
        add(4, -16 + dy, 1, 5, hair);
      }
      // 臉
      if (o.vip) {
        add(-4, -18 + dy, 8, 2, '#15151a');
      } else {
        add(-3, -18 + dy, 1, 2, '#2b1d1a');
        add(0, -18 + dy, 1, 2, '#2b1d1a');
      }
      add(-3, -15 + dy, 1, 1, mix(skin, '#ff6a6a', 0.45));
      add(0, -15 + dy, 1, 1, mix(skin, '#ff6a6a', 0.45));
      add(-2, -14 + dy, 2, 1, mix(skin, '#8a3a30', 0.5));
    }
    if (look.hairStyle === 2) add(-2, -26 + dy, 4, 3, hair);
    if (o.staff) {
      // 店掌櫃戴紅色廚師帽、金色帽帶
      add(-5, -25 + dy, 10, 3, o.boss ? '#d94f43' : '#f6f1e6');
      add(-4, -29 + dy, 8, 4, o.boss ? '#e85d50' : '#fffaf0');
      add(-4, -25 + dy, 8, 1, o.boss ? '#e8b83a' : '#d9d2c3');
      if (o.boss) add(-1, -28 + dy, 2, 2, '#e8b83a');
    }
    if (o.vip) {
      add(-4, -26 + dy, 8, 2, '#e8b83a');
      add(-4, -28 + dy, 2, 2, '#e8b83a');
      add(-1, -29 + dy, 2, 3, '#e8b83a');
      add(2, -28 + dy, 2, 2, '#e8b83a');
    }

    const ox = Math.round(x);
    const oy = Math.round(y);
    // 先畫描邊，再畫本體
    g.fillStyle = OUTLINE;
    for (const [px, py, w, h] of parts) g.fillRect(ox + px - 1, oy + py - 1, w + 2, h + 2);
    for (const [px, py, w, h, c] of parts) {
      g.fillStyle = c;
      g.fillRect(ox + px, oy + py, w, h);
    }
  }

  /* ───────── 菜色圖示（12×12） ───────── */

  const DL = {
    k: '#3b2a20', w: '#f6f1e6', W: '#d2cabb', y: '#f2c94c', Y: '#d99a2a', e: '#fbeaa0', G: '#5fae4e', D: '#3a7a35',
    n: '#b8793f', N: '#7a4a24', b: '#e4bd7c', B: '#c4975a', r: '#d9473a', R: '#9a2b24', o: '#f08a3a', p: '#f6b3bf',
    c: '#fff3d6', s: '#c89a6a', t: '#7a5a3a', u: '#8ec9f0', g: '#bdbdbd', m: '#ffc83a', M: '#e69a1a', a: '#2f2f35',
    j: '#e8b83a', v: '#a8302a',
  };
  const DISH = {
    danbing: [
      '............', '............', '..kkkkkkkk..', '.kbbeeeebbk.', 'kbbeyyyyebbk', 'kbbeyGGyebbk', 'kbbbeeeebbbk', '.kbbbbbbbbk.', 'kwkkkkkkkkwk', 'kwwwwwwwwwwk', '.kWWWWWWWWk.', '..kkkkkkkk..',
    ],
    soymilk: [
      '............', '....w..w....', '...w..w.....', '..kkkkkkkk..', '.kccccccccck', 'kkccccccccck', 'kwwwwwwwwwwk', '.kwwwwwwwwk.', '.kwwwwwwwwk.', '..kWwwwwWk..', '...kkkkkk...', '............',
    ],
    fantuan: [
      '............', '.....kk.....', '....kwwk....', '...kwwwwk...', '..kwwwwwwk..', '..kwwwwwwk..', '.kwwkkkkwwk.', '.kwwkaakwwk.', 'kwwwkaakwwwk', 'kwwwkkkkwwwk', 'kWWWWWWWWWWk', '.kkkkkkkkkk.',
    ],
    luroufan: [
      '............', '...kkkkkk...', '..knNNNNnk..', '.knNNnNNNnk.', '.kwwNNNNwwk.', '.kwwwewwwwk.', 'kkkkkkkkkkkk', 'kvvvvvvvvvvk', '.kvvvvvvvvk.', '..kvvvvvvk..', '...kkkkkk...', '............',
    ],
    boba: [
      '.........k..', '........kr..', '.kkkkkkkkkk.', '.kwwwwwwwwk.', '..ksssssssk.', '..kssssssk..', '..kssssssk..', '..kssssssk..', '..ktsttstk..', '..kttatttk..', '...kkkkkk...', '............',
    ],
    xiaolongbao: [
      '............', '..kkkkkkkk..', '.kbbbbbbbbk.', 'kbBwwBwwBbbk', 'kbwwwwwwwwbk', 'kbwkwwkwwwbk', 'kBBBBBBBBBBk', 'kbbbbbbbbbbk', 'kBBBBBBBBBBk', 'kbbbbbbbbbbk', '.kkkkkkkkkk.', '............',
    ],
    chicken: [
      '............', '..kkkkkkkk..', '.kbbbbbbbbk.', '.kbybyGybbk.', '.kbyyobybbk.', '.kbooyyoybk.', '.kbyyybyobk.', '.kbbGyybbbk.', '.kbbbbbbbbk.', '..kkkkkkkk..', '............', '............',
    ],
    beefnoodle: [
      '..k......k..', '...k....k...', '.kkkkkkkkkk.', 'kttttttttttk', 'ktGGbtbbtGtk', 'ktNNNbbNNttk', 'ktNNbtbNNtGk', '.ktttttttk..', '.kvvvvvvvvk.', '..kvvvvvvk..', '...kkkkkk...', '............',
    ],
    oyster: [
      '............', '............', '..kkkkkkkk..', '.kyoooooyyk.', 'kyooRRoooyyk', 'kyoRRRRoooyk', 'kbyoRRoGoyyk', 'kbbyoooooybk', 'kwkkkkkkkkwk', 'kwwwwwwwwwwk', '.kWWWWWWWWk.', '..kkkkkkkk..',
    ],
    stinky: [
      '............', '..kkkk......', '.kBnnBk.rr..', '.kBnnBkkrk..', 'kkBBBBkkkk..', 'kBnnBkkBnnBk', 'kBnnBkkBnnBk', 'kGwGwGkkBBBk', 'kwGwGwGwwwwk', '.kkkkkkkkkk.', '............', '............',
    ],
    pineapple: [
      '............', '............', '.kkkkkkkkkk.', 'kjyyyyyyyyjk', 'kyYyYyYyYyyk', 'kyyyyyyyyyyk', 'kjjjjjjjjjjk', '.kkkkkkkkkk.', '..kjyyyyjk..', '..kyYyYyYk..', '..kkkkkkkk..', '............',
    ],
    hotpot: [
      '..w..w..w...', '...w..w..w..', '..w..w..w...', 'kkkkkkkkkkkk', 'krrRrrrrRrrk', 'krRrrGrrrrrk', 'krrrrrRrrRrk', 'kRrrrrrrrrrk', 'kaaaaaaaaaak', '.kaaaaaaaak.', '..kkkkkkkk..', '............',
    ],
    mangoice: [
      '............', '....kkkk....', '...kwwwwk...', '..kwwuwwwk..', '.kmMwwmMwwk.', '.kmmmwmmmwk.', 'kkkkkkkkkkkk', 'kwwwwwwwwwwk', '.kwwwwwwwwk.', '..kWwwwwWk..', '...kkkkkk...', '............',
    ],
    buddha: [
      '.....kk.....', '....kjjk....', '...kkkkkk...', '..kvvvvvvk..', '.kvvjvvjvvk.', 'kvvvvvvvvvvk', 'kjjjjjjjjjjk', 'kvvjvvvvjvvk', '.kvvvvvvvvk.', '.kvjvvvvjvk.', '..kkkkkkkk..', '............',
    ],
  };
  /* 其餘的菜用「容器模板 × 配色」程式生成（dishes.js 的 ic = '容器:主色配色點綴'）。
   * 模板裡 a/A 是主食材（亮／暗）、b 是配料、c 是點綴，其餘沿用上面的調色盤。 */
  const VESSELS = {
    bowl: ['............', '............', '..kkkkkkkk..', '.kaaAaabaak.', 'kaAaabaacaak', 'kabaaacaAabk', 'kAaaaaaaaaAk', 'kkkkkkkkkkkk', 'kwwwwwwwwwwk', '.kwwwwwwwwk.', '..kWWWWWWk..', '...kkkkkk...'],
    plate: ['............', '............', '............', '...kkkkkk...', '..kaabaaak..', '.kaAaaaAcak.', '.kabaacaaak.', 'kkkkkkkkkkkk', 'kwwwwwwwwwwk', 'kWWWWWWWWWWk', '.kkkkkkkkkk.', '............'],
    cup: ['.......k....', '......kb....', '.kkkkkkkkkk.', '.kwwwwwwwwk.', '..kaaaaaak..', '..kaAaaaak..', '..kaaaabak..', '..kaaaaaak..', '..kAaaaaAk..', '..kaaaaaak..', '...kkkkkk...', '............'],
    steam: ['...w..w.....', '....w..w....', '..kkkkkkkk..', '.knnnnnnnnk.', 'knaaAaabaank', 'knnnnnnnnnnk', 'kNNNNNNNNNNk', 'knnnnnnnnnnk', 'kNNNNNNNNNNk', 'knnnnnnnnnnk', '.kkkkkkkkkk.', '............'],
    pot: ['..w..w..w...', '...w..w..w..', '..w..w..w...', 'kkkkkkkkkkkk', 'kaabaAaabaak', 'kaAaacaaaAak', 'kabaaaaAaabk', 'kDDDDDDDDDDk', 'kDDDDDDDDDDk', '.kDDDDDDDDk.', '..kkkkkkkk..', '............'],
    cake: ['............', '............', '....kkkkkk..', '...kbcbcbck.', '..kaaaaaaak.', '.kaaaAaaaak.', '.kkkkkkkkkk.', '.kcccccccck.', '.kaaaAaaaak.', '.kkkkkkkkkk.', '............', '............'],
    bun: ['............', '............', '...kkkkkk...', '..kaaaaAak..', '.kaabaaaaak.', '.kaaaaaacak.', 'kaaAaaaaaaak', 'kaaaaabaaaAk', '.kkkkkkkkkk.', '..kwwwwwwk..', '...kkkkkk...', '............'],
    tray: ['............', '............', 'kkkkkkkkkkkk', 'kaaabbbcccak', 'kaAaabbcccak', 'kaaaabbcccAk', 'kkkkkkkkkkkk', 'kWWWWWWWWWWk', 'kkkkkkkkkkkk', '............', '............', '............'],
    glass: ['............', '...kkkkkk...', '..kcccbccck.', '..kbaaaaabk.', '..kaaAaaaak.', '...kaaaAak..', '...kbbbbbk..', '....kaaak...', '.....kwk....', '.....kwk....', '...kkkkkk...', '............'],
  };
  const TONES = {
    r: ['#d9473a', '#9a2b24'], o: ['#f08a3a', '#c0621f'], y: ['#f2c94c', '#d99a2a'], g: ['#5fae4e', '#3a7a35'], n: ['#b8793f', '#7a4a24'],
    w: ['#f6f1e6', '#d2cabb'], p: ['#f6b3bf', '#d9808f'], b: ['#e4bd7c', '#c4975a'], d: ['#4a3a34', '#2b1d1a'], u: ['#8ec9f0', '#5aa0e0'],
    c: ['#fff3d6', '#f2e0a8'], t: ['#c89a6a', '#7a5a3a'], v: ['#b89ad8', '#8468b0'], l: ['#b9d95f', '#8aa83a'],
  };
  const hashOf = (id) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  /** 依 ic 設定生成菜色圖示；同一容器的菜以名字的雜湊決定要不要左右翻轉，多一點變化 */
  function genDish(id) {
    const [vessel, cols] = D.dishes[id].ic.split(':');
    const [m, ac, ga] = cols.split('');
    const pal = { ...DL, D: '#4a4a52', a: TONES[m][0], A: TONES[m][1], b: TONES[ac][0], c: TONES[ga][0] };
    let rows = VESSELS[vessel];
    if (hashOf(id) & 1) rows = rows.map((r) => [...r].reverse().join(''));
    return pixmap(rows, pal);
  }
  const dishCache = new Map();
  function dish(id) {
    let c = dishCache.get(id);
    if (!c) {
      if (DISH[id]) c = pixmap(DISH[id].map((r) => r.padEnd(12, '.')), DL);
      else c = genDish(id);
      dishCache.set(id, c);
    }
    return c;
  }

  /* ───────── UI 圖示（12×12） ───────── */

  const IL = { k: '#2b1d1a', y: '#f2c94c', Y: '#d99a2a', w: '#fffaf0', r: '#d9473a', R: '#9a2b24', b: '#5aa0e0', B: '#3a6aa8', g: '#8e979f', G: '#5fae4e', n: '#b8793f', N: '#7a4a24', p: '#f6b3bf', o: '#f08a3a', s: '#ffdcb8' };
  const ICONS = {
    coin: ['............', '...kkkkkk...', '..kyyyyyyk..', '.kyyYYYYyyk.', '.kyYyyyyYyk.', '.kyYyYYyYyk.', '.kyYyyyyYyk.', '.kyyYYYYyyk.', '..kyyyyyyk..', '...kkkkkk...', '............', '............'],
    star: ['............', '.....kk.....', '.....kyk....', '....kyyyk...', 'kkkkyyyyykkk', '.kyyyyyyyyk.', '..kyyyyyyk..', '..kyyyyyyk..', '.kyyykkyyyk.', '.kyykk.kyyk.', '..kk....kk..', '............'],
    shop: ['............', '..kkkkkkkk..', '.krwrwrwrwk.', '.krwrwrwrwk.', '.kkkkkkkkkk.', '..kwwwwwwk..', '..kwbbwnwk..', '..kwbbwnwk..', '..kwbbwnwk..', '..kkkkkkkk..', '............', '............'],
    hammer: ['............', '..kkkkkk....', '.kggggggk...', '.kggggggkk..', '..kkkkkkNnk.', '......kNnk..', '.....kNnk...', '....kNnk....', '...kNnk.....', '...kNk......', '...kk.......', '............'],
    book: ['............', '.kkkkkkkkkk.', '.krrrrrrrRk.', '.krwwwwwwRk.', '.krwkkkkwRk.', '.krwwwwwwRk.', '.krwkkkkwRk.', '.krwwwwwwRk.', '.krrrrrrrRk.', '.kkkkkkkkkk.', '............', '............'],
    person: ['....kkkk....', '...kwwwwk...', '...kwwwwk...', '...kssssk...', '...ksskk....', '....kkkk....', '..kkrrrrkk..', '.kssrrrrssk.', '..kkrrrrkk..', '...kaakaak..', '...kk..kk...', '............'],
    scroll: ['............', '..kkkkkkkk..', '.kwwwwwwwwk.', '.kwkkkkkkwk.', '.kwwwwwwwwk.', '.kwkkkkkkwk.', '.kwwwwwwwwk.', '.kwkkkkwwwk.', '.kwwwwwwwwk.', '..kkkkkkkk..', '............', '............'],
    gear: ['.....kk.....', '..k.kggk.k..', '.kgkkggkkgk.', '..kggggggk..', '.kggkwwkggk.', 'kkggkwwkggkk', 'kkggkwwkggkk', '.kggkkkkggk.', '..kggggggk..', '.kgkkggkkgk.', '..k.kggk.k..', '.....kk.....'],
    bolt: ['............', '......kkk...', '.....kyyk...', '....kyyk....', '...kyyyk....', '..kyyyyykk..', '...kkyyyk...', '.....kyk....', '....kyk.....', '....kk......', '............', '............'],
    lock: ['............', '...kkkkkk...', '..kggggggk..', '..kg....gk..', '..kg....gk..', '.kkkkkkkkkk.', '.kYYYYYYYYk.', '.kYYYkkYYYk.', '.kYYYkkYYYk.', '.kYYYYYYYYk.', '.kkkkkkkkkk.', '............'],
    sound: ['............', '.....k......', '....kk..k...', 'kkkkkk...k..', 'kwwwkk.k.k..', 'kwwwkk..k.k.', 'kwwwkk..k.k.', 'kkkkkk.k.k..', '....kk...k..', '.....k..k...', '............', '............'],
    mute: ['............', '.....k......', '....kk......', 'kkkkkk..k.k.', 'kwwwkk...kk.', 'kwwwkk...kk.', 'kwwwkk..k.k.', 'kkkkkk.k...k', '....kk......', '.....k......', '............', '............'],
    play: ['............', '.kk....kk...', '.kwk...kwk..', '.kwwk..kwwk.', '.kwwwk.kwwwk', '.kwwwwkkwwwk', '.kwwwk.kwwwk', '.kwwk..kwwk.', '.kwk...kwk..', '.kk....kk...', '............', '............'],
    box: ['............', '..kkkkkkkk..', '.knnnnnnnnk.', '.kNNNNNNNNk.', '.knnnkknnnk.', '.knnnnnnnnk.', '.knnnnnnnnk.', '.knnnnnnnnk.', '.kkkkkkkkkk.', '............', '............', '............'],
    trash: ['....kkkk....', '..kkkkkkkk..', '..kgggggk...', '..kggggggk..', '..kgkgkgk...', '..kgkgkggk..', '..kgkgkggk..', '..kgkgkggk..', '..kggggggk..', '...kkkkkk...', '............', '............'],
    rotate: ['............', '...kkkkk....', '..kwwwwwk...', '.kwkkkkkwk..', '.kwk...kwwk.', '.kwk...kwwwk', '.kwk....kkk.', '..kk.....k..', '............', '............', '............', '............'],
    plus: ['............', '....kkkk....', '....kGGk....', '..kkkGGkkk..', '..kGGGGGGk..', '..kGGGGGGk..', '..kkkGGkkk..', '....kGGk....', '....kkkk....', '............', '............', '............'],
    check: ['............', '..........kk', '.........kGk', '........kGGk', 'kk.....kGGk.', 'kGk...kGGk..', '.kGk.kGGk...', '..kGkGGk....', '...kGGk.....', '....kk......', '............', '............'],
    cross: ['............', '.kk......kk.', '.krk....krk.', '..krk..krk..', '...krkkrk...', '....krrk....', '...krkkrk...', '..krk..krk..', '.krk....krk.', '.kk......kk.', '............', '............'],
    heart: ['............', '..kk....kk..', '.kppk..kppk.', 'kpwppkkpppk.', 'kppppppppppk', 'kppppppppppk', '.kpppppppk..', '..kpppppk...', '...kpppk....', '....kpk.....', '.....k......', '............'],
    note: ['............', '.....kk.....', '.....kwk....', '.....kwwk...', '.....kwwwk..', '.....kwkwk..', '.....kwk.kk.', '.....kwk....', '..kkkkwk....', '.kwwwkwk....', '.kwwwwwk....', '..kkkkk.....'],
    pause: ['............', '............', '..kkkk.kkkk.', '..kwwk.kwwk.', '..kwwk.kwwk.', '..kwwk.kwwk.', '..kwwk.kwwk.', '..kwwk.kwwk.', '..kwwk.kwwk.', '..kkkk.kkkk.', '............', '............'],
    resume: ['............', '..kk........', '..kwkk......', '..kwwwkk....', '..kwwwwwkk..', '..kwwwwwwwk.', '..kwwwwwwwk.', '..kwwwwwkk..', '..kwwwkk....', '..kwkk......', '..kk........', '............'],
    mover: ['.....kk.....', '....kwwk....', '...kkwwkk...', '.....ww.....', '.kk..ww..kk.', 'kwwwwwwwwwwk', 'kwwwwwwwwwwk', '.kk..ww..kk.', '.....ww.....', '...kkwwkk...', '....kwwk....', '.....kk.....'],
  };
  const iconCache = new Map();
  function icon(name) {
    let c = iconCache.get(name);
    if (!c) {
      const rows = ICONS[name].map((r) => r.padEnd(12, '.'));
      c = pixmap(rows, IL);
      iconCache.set(name, c);
    }
    return c;
  }
  /** 「關閉」版本：在圖示上畫一條紅色斜線 */
  function iconOff(name) {
    const key = name + ':off';
    let c = iconCache.get(key);
    if (!c) {
      const base = icon(name);
      c = canvas(base.width, base.height);
      const g = ctx(c);
      g.globalAlpha = 0.4; // 圖示本身變淡，斜線才看得清楚
      g.drawImage(base, 0, 0);
      g.globalAlpha = 1;
      for (let i = 0; i < 10; i++) {
        g.fillStyle = '#e04a3a';
        g.fillRect(i + 1, 10 - i, 2, 1);
      }
      iconCache.set(key, c);
    }
    return c;
  }
  const urlCache = new Map();
  /** 給 DOM <img> 用的 data URL（放大 scale 倍） */
  function iconURL(name, scale, kind) {
    const key = (kind || 'i') + name + ':' + scale;
    let u = urlCache.get(key);
    if (!u) {
      const src = kind === 'dish' ? dish(name) : kind === 'off' ? iconOff(name) : icon(name);
      const c = canvas(src.width * scale, src.height * scale);
      ctx(c).drawImage(src, 0, 0, c.width, c.height);
      u = c.toDataURL();
      urlCache.set(key, u);
    }
    return u;
  }
  /** 家具縮圖：置中縮放到 box×box（不放大超過 2 倍，保持像素感） */
  function furnThumb(id, box) {
    const key = 'th:' + id + ':' + box;
    let u = urlCache.get(key);
    if (!u) {
      const e = RC.artWorld.furniture(id, 0, 'all');
      const s = Math.max(1, Math.min(Math.floor(box / e.c.width), Math.floor(box / e.c.height), 3));
      const c = canvas(box, box);
      const g = ctx(c);
      const w = e.c.width * s;
      const h = e.c.height * s;
      g.drawImage(e.c, Math.floor((box - w) / 2), Math.floor((box - h) / 2), w, h);
      u = c.toDataURL();
      urlCache.set(key, u);
    }
    return u;
  }

  /* ───────── 特效小圖 ───────── */

  const FXL = { k: OUTLINE, y: '#f2c94c', Y: '#d99a2a', w: '#fffaf0', r: '#e04a3a', p: '#ff8fb0', P: '#d9477a', b: '#8ec9f0', g: '#bdbdbd' };
  const FX = {
    coin: ['..kkkk..', '.kyyyyk.', 'kyYYYYyk', 'kyYyyYyk', 'kyYyyYyk', 'kyYYYYyk', '.kyyyyk.', '..kkkk..'],
    heart: ['.kk..kk.', 'kppkkppk', 'kpwppppk', 'kppppppk', '.kppppk.', '..kppk..', '...kk...'],
    anger: ['kk....kk', 'krk..krk', '.krkkrk.', '..krrk..', '.krkkrk.', 'krk..krk', 'kk....kk'],
    spark: ['...k...', '..kyk..', '.kyyyk.', 'kyyyyyk', '.kyyyk.', '..kyk..', '...k...'],
    zzz: ['kkkk....', '..kb....', '.kb.kkk.', 'kkkk..kb', '....kb..', '...kkkk.'],
    exclaim: ['.kk.', 'krrk', 'krrk', 'krrk', '.kk.', 'krrk', '.kk.'],
    dots: ['........', '.k.k.k..', 'kbkbkbk.', '.k.k.k..'],
    plates: ['.kkkkk..', 'kwwwwwk.', 'kWWWWWkk', '.kkkkkWk', '.kwwwwwk', '.kWWWWWk', '..kkkkk.'],
  };
  const fxCache = new Map();
  function fx(name) {
    let c = fxCache.get(name);
    if (!c) {
      c = pixmap(FX[name], FXL);
      fxCache.set(name, c);
    }
    return c;
  }

  /** 7×7 的小頭像（候位標示用） */
  function drawHead(g, x, y, look) {
    x = Math.round(x);
    y = Math.round(y);
    g.fillStyle = OUTLINE;
    g.fillRect(x, y, 7, 7);
    g.fillStyle = P.skin[look.skin];
    g.fillRect(x + 1, y + 2, 5, 4);
    g.fillStyle = P.hair[look.hair];
    g.fillRect(x + 1, y + 1, 5, 2);
    if (look.hairStyle === 1) {
      g.fillRect(x + 1, y + 3, 1, 3);
      g.fillRect(x + 5, y + 3, 1, 3);
    }
    g.fillStyle = OUTLINE;
    g.fillRect(x + 2, y + 4, 1, 1);
    g.fillRect(x + 4, y + 4, 1, 1);
  }

  /** 對話泡泡：白底圓角 + 尾巴；內容由呼叫者畫在 (x+2,y+2) 起的內框。回傳內框尺寸。 */
  function bubble(g, cx, by, w, h, tint) {
    const x = Math.round(cx - w / 2);
    const y = Math.round(by - h - 3);
    g.fillStyle = OUTLINE;
    g.fillRect(x + 1, y, w - 2, h);
    g.fillRect(x, y + 1, w, h - 2);
    g.fillRect(Math.round(cx) - 2, y + h, 4, 1);
    g.fillRect(Math.round(cx) - 1, y + h + 1, 2, 1);
    g.fillStyle = tint || '#fffaf0';
    g.fillRect(x + 2, y + 1, w - 4, h - 2);
    g.fillRect(x + 1, y + 2, w - 2, h - 4);
    g.fillRect(Math.round(cx) - 1, y + h - 1, 2, 1);
    return { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
  }

  RC.artPeople = { drawPerson, drawHead, dish, icon, iconOff, iconURL, furnThumb, fx, bubble, ICONS_LIST: Object.keys(ICONS), DISH_IDS: Object.keys(DISH) };
})(typeof globalThis !== 'undefined' ? globalThis : window);
