#!/usr/bin/env node
/**
 * 四季物语 差分 oracle（L1 数据基线）：
 * 把新引擎的卡表 / 骰表与旧项目 cards.json / dice.json 逐项对照。
 *
 * 不进 CI（依赖本机旧项目路径）；用法：
 *   pnpm --filter @bgx/server build && node apps/server/scripts/oracle-seasons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { BASE_CARDS } from '../dist/games/seasons/cards/base.js';
import { DICE_BY_ELEMENT } from '../dist/games/seasons/rules/dice.js';

const OLD = '/home/squid/seasons_web/seasons-web/src/games/seasons';
const readCards = (file) => JSON.parse(fs.readFileSync(path.join(OLD, file), 'utf8')).cards;
const oldCards = readCards('cards.json');
const oldDice = JSON.parse(fs.readFileSync(path.join(OLD, 'dice.json'), 'utf8'));

const problems = [];
const detail = (what, a, b) =>
  problems.push(`${what}\n  新: ${JSON.stringify(a)}\n  旧: ${JSON.stringify(b)}`);

// ---- 卡表：id / 名称 / 类型 / 分数 / 费用 / 效果元数据 ----
const ALL_CARDS = BASE_CARDS;
const byId = new Map(ALL_CARDS.map((card) => [card.id, card]));
for (const old of oldCards) {
  const mine = byId.get(old.id);
  if (!mine) {
    problems.push(`卡牌缺失: id=${old.id} ${old.nameZh}`);
    continue;
  }
  const keys = [
    ['nameZh', mine.nameZh, old.nameZh],
    ['type', mine.type, old.type],
    ['points', mine.points, old.points],
    ['cost', mine.cost, old.cost],
    ['costByPlayers', mine.costByPlayers ?? null, old.costByPlayers ?? null],
    ['costFlexible', mine.costFlexible ?? null, old.costFlexible ?? null],
    ['effect.type', mine.effect?.type ?? null, old.effect?.type ?? null],
    ['effect.typeKey', mine.effect?.typeKey ?? null, old.effect?.typeKey ?? null],
    ['effect.trigger', mine.effect?.trigger ?? null, old.effect?.trigger ?? null],
    ['effect.triggers', [...(mine.effect?.triggers ?? [])].sort(), [...(old.effect?.triggers ?? [])].sort()],
    ['effect.abilities', (mine.effect?.abilities ?? []).map((a) => a.kind).sort(), (old.effect?.abilities ?? []).map((a) => a.kind).sort()],
  ];
  for (const [field, a, b] of keys) {
    if (JSON.stringify(a) !== JSON.stringify(b)) detail(`卡牌 #${old.id} ${old.nameZh} 的 ${field}`, a, b);
  }
}
for (const mine of ALL_CARDS) {
  if (!oldCards.some((old) => old.id === mine.id)) problems.push(`多出的卡牌: id=${mine.id} ${mine.nameZh}`);
}

// ---- 骰表：每季 5 颗 × 6 面的点数与奖励 ----
const normRewards = (rewards) =>
  Object.entries(rewards ?? {})
    .filter(([, value]) => value !== false && value !== 0 && value !== null && value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
for (const season of oldDice.seasons) {
  const mine = DICE_BY_ELEMENT[season.element];
  if (!mine) {
    problems.push(`缺少季节骰表: ${season.element}`);
    continue;
  }
  if (mine.length !== season.dice.length) {
    problems.push(`骰子数量不符: ${season.element} 新 ${mine.length} 旧 ${season.dice.length}`);
  }
  for (const oldDie of season.dice) {
    const myDie = mine.find((die) => die.id === oldDie.id);
    if (!myDie) {
      problems.push(`缺少骰子: ${season.element} id=${oldDie.id}`);
      continue;
    }
    if (myDie.faces.length !== oldDie.faces.length) {
      problems.push(`骰面数量不符: ${season.element} id=${oldDie.id}`);
    }
    for (const oldFace of oldDie.faces) {
      const myFace = myDie.faces.find((face) => face.roll === oldFace.roll);
      if (!myFace) {
        problems.push(`缺少骰面: ${season.element} id=${oldDie.id} roll=${oldFace.roll}`);
        continue;
      }
      if (myFace.pip !== oldFace.pip) {
        detail(`骰面 ${season.element} id=${oldDie.id} roll=${oldFace.roll} 的 pip`, myFace.pip, oldFace.pip);
      }
      const a = normRewards(myFace.rewards);
      const b = normRewards(oldFace.rewards);
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        detail(`骰面 ${season.element} id=${oldDie.id} roll=${oldFace.roll} 的奖励`, a, b);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`✗ oracle 发现 ${problems.length} 处差异：\n\n${problems.join('\n\n')}`);
  process.exitCode = 1;
} else {
  console.log(`OK 差分基线一致：${BASE_CARDS.length} 张卡 + ${oldDice.seasons.length} 季 × 5 骰 × 6 面`);
}
