import {
  planeBombActionSchema,
  planeBombCatalog,
  planeBombDefaultOptions,
  planeBombOptionsSchema,
  type PlaneBombAction,
  type PlaneBombGameView,
  type PlaneBombOptions,
} from '@bgx/protocol/games/plane-bomb';
import type { GamePlugin } from '../types.js';
import { planeBomb, type PlaneBombState } from './engine.js';

/** 炸飞机插件：目录信息 + 动作校验 + 引擎。 */
export const plugin: GamePlugin<
  PlaneBombState,
  PlaneBombGameView,
  PlaneBombAction,
  PlaneBombOptions
> = {
  ...planeBomb,
  meta: planeBombCatalog,
  actionType: (action) => action.type,
  actionSchema: planeBombActionSchema,
  optionSchema: planeBombOptionsSchema,
  defaultOptions: planeBombDefaultOptions,
};

export default plugin;
