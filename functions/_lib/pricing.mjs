// 持ち帰り・店内の値付け（有料）。計算だけ・保存しない・AIは使わない。
//
// 今の税込みの値段（持ち帰り8%・店内10%）から、1%になった時の値段の案を出す。
//   A 本体の値段を変えない … 持ち帰りの税込みが下がる（お客様に全部を返す）
//   B 税込みの値段を変えない … 1つ売るごとの手取りが増える
//   C 店内と持ち帰りを同じ税込みにする … 売上の本体の合計が変わらない値段（店内の割合で決まる）
// 端数は1円単位で四捨五入。きりのよい値段（10円単位）も添える。
import S from '../../site/calc.js';

export const PRICE_LIMIT = { items: 200, name: 40, price: 10_000_000 };
const R = S.RATE;

function clip(v) { return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, PRICE_LIMIT.name); }
function price(v) { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= PRICE_LIMIT.price ? n : 0; }

export function cleanPricing(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.items)) return { error: 'bad_input' };
  if (b.items.length > PRICE_LIMIT.items) return { error: 'too_many' };
  const items = b.items
    .map((it) => (it && typeof it === 'object' ? { name: clip(it.name), takeout: price(it.takeout), eatIn: price(it.eatIn) } : null))
    .filter((it) => it && (it.takeout > 0 || it.eatIn > 0));
  if (!items.length) return { error: 'empty' };
  const share = Number(b.eatInShare);
  return { input: { items, eatInShare: Number.isFinite(share) ? Math.min(100, Math.max(0, share)) : 50 } };
}

export const SAMPLE = {
  eatInShare: 60,
  items: [
    { name: '日替わり弁当', takeout: 864, eatIn: 880 },
    { name: 'から揚げ（5個）', takeout: 540, eatIn: 550 },
    { name: 'コーヒー', takeout: 324, eatIn: 330 },
    { name: '食パン（1斤）', takeout: 378, eatIn: 0 },
  ],
};

const up10 = (n) => Math.ceil(n / 10 - 1e-9) * 10;

export function pricing(input) {
  const s = input.eatInShare / 100;
  const rows = input.items.map((it) => {
    const row = { name: it.name, takeout: it.takeout, eatIn: it.eatIn };
    if (it.takeout > 0) {
      const base = it.takeout / (1 + R.foodNow);              // 今の本体の値段
      const keepBase = Math.round(base * (1 + R.foodCut));    // A
      row.base = Math.round(base * 10) / 10;
      row.keepBase = { price: keepBase, customerSaves: it.takeout - keepBase };
      row.keepPrice = { price: it.takeout, gainPerSale: Math.round((it.takeout / (1 + R.foodCut) - base) * 10) / 10 }; // B
    }
    if (it.takeout > 0 && it.eatIn > 0) {
      const baseT = it.takeout / (1 + R.foodNow), baseE = it.eatIn / (1 + R.std);
      const u = (s * baseE + (1 - s) * baseT) / (s / (1 + R.std) + (1 - s) / (1 + R.foodCut)); // C
      row.same = { price: Math.round(u), round10: up10(u) };
      row.gap = { now: it.eatIn - it.takeout, after: it.eatIn - row.keepBase.price }; // 店内と持ち帰りの差（今・Aの時）
    }
    return row;
  });
  const t = rows.filter((r) => r.keepBase);
  return {
    eatInShare: input.eatInShare,
    rows,
    totals: {
      items: rows.length,
      customerSaves: t.reduce((a, r) => a + r.keepBase.customerSaves, 0),
      gainPerSale: Math.round(t.reduce((a, r) => a + r.keepPrice.gainPerSale, 0) * 10) / 10,
    },
  };
}

export function teaser(result) {
  return { items: result.totals.items, withBoth: result.rows.filter((r) => r.same).length };
}
