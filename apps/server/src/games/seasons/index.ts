import {
  seasonsActionSchema,
  seasonsCatalog,
  seasonsDefaultOptions,
  seasonsOptionsSchema,
  type SeasonsAction,
  type SeasonsGameView,
  type SeasonsOptions,
} from '@bgx/protocol/games/seasons';
import type { GamePlugin } from '../types.js';
import { seasons, type SeasonsState } from './engine.js';

/** 四季物语插件：目录信息 + 动作校验 + 引擎。 */
export const plugin: GamePlugin<
  SeasonsState,
  SeasonsGameView,
  SeasonsAction,
  SeasonsOptions
> = {
  ...seasons,
  meta: seasonsCatalog,
  actionType: (action) => action.type,
  actionSchema: seasonsActionSchema,
  optionSchema: seasonsOptionsSchema,
  defaultOptions: seasonsDefaultOptions,
};

export default plugin;
