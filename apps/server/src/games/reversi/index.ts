import {
  reversiActionSchema,
  reversiCatalog,
  reversiOptionsSchema,
  type ReversiAction,
  type ReversiGameView,
  type ReversiOptions,
} from '@bgx/protocol/games/reversi';
import type { GamePlugin } from '../types.js';
import { reversi, type ReversiState } from './engine.js';

/** 黑白棋插件：目录信息 + 动作校验 + 引擎。 */
export const plugin: GamePlugin<
  ReversiState,
  ReversiGameView,
  ReversiAction,
  ReversiOptions
> = {
  ...reversi,
  meta: reversiCatalog,
  actionType: (action) => action.type,
  actionSchema: reversiActionSchema,
  optionSchema: reversiOptionsSchema,
  defaultOptions: {},
};

export default plugin;
