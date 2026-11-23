# 《四季物语》BGA 实现规则规格（无源码版）

> 依据：`mizutismask/bga-seasons`（develop 分支）的 `states.inc.php` 与 `seasonssk.game.php`，对应 2026-10 线上构建。本文只描述规则与实现语义，不包含 PHP/JS 源码。

## 0. 阅读说明

- 状态机沿用 BGA 框架的四类状态：`单人`（activeplayer，当前玩家行动）、`同时`（multipleactiveplayer，多人同时行动）、`流程`（game，自动执行）、`管理`（manager，框架管理）。
- 「进入动作」是进入该状态时服务端自动执行的逻辑；「可选动作」是玩家可提交的 action；「转移」是该状态可能跳往的后继，格式为 `事件→状态ID`。
- 全部动作都由服务端校验；客户端的按钮只是可选动作的呈现。
- 卡牌效果在 B 部分按 **92 个方法**展开：play 45、active 30、onEndTurn 8、onSummon 4、onSeasonChange 4、onDrawOne 1。题述的 74 是「play + 有效 active」的口径（45 + 29）；Steadfast Die 的 active 为空壳，实际逻辑在状态 227。

## A. 状态机

### A.1 总览

共 **118 个状态条目**：117 个游戏状态 + 1 个调试态（100）。类型分布：单人 91、流程 21、同时 4、管理 2。

### A.2 准备与轮抽（7 个）

| ID | 状态名 | 类型 | 进入动作 | 可选动作 | 转移 | 说明 |
|---:|---|---|---|---|---|---|
| 1 | gameSetup | 管理 | stGameSetup | — | →11 | 初始化整局：洗牌、发预选牌与起始资源、确定首玩家；随后自动进入轮抽。 |
| 10 | draftChoice | 同时 | stDraftChoice | draftChooseCard, undoDraftChooseCard | everyoneChoosed→11 | 轮抽第一轮：所有玩家同时从若干候选牌中保留 1 张；可撤销。 |
| 11 | continueDraftChoice | 流程 | stContinueDraftChoice | — | endDraftChoice→14；endDraftChoiceTwist→12；continueDraftChoice→10 | 轮抽推进：给候选牌不足的玩家补发；只剩 1 张时自动收下；在此决定是否触发 Twist of Fate。 |
| 12 | draftTwist | 同时 | — | draftTwist | draftTwist→14 | Twist of Fate 的额外轮抽：被点名的玩家从 2 张中保留 1 张。 |
| 13 | chooseToken | 同时 | stMakeEveryoneActive | chooseToken, undoChooseToken | startYear→20 | 选择能力 token：所有玩家同时选择（仅 Enchanted Kingdom / Path of Destiny 模式）。 |
| 14 | prepareBuildLibrary | 流程 | stPrepareBuildLibrary | — | →18 | 建库前的准备：弃掉所有 Twist of Fate，所有人进入同时行动。 |
| 18 | buildLibraryNew | 同时 | stBuildLibraryNew | chooseLibrarynew, undoChooseLibrarynew | chooseLibrarynew→20；chooseToken→13 | 建库：每人把手牌分成第 1/2/3 年三个牌库（3/3/3），可撤销；没有 token 模式则直接开始第 1 年。 |

### A.3 年、回合与骰子（17 个）

| ID | 状态名 | 类型 | 进入动作 | 可选动作 | 转移 | 说明 |
|---:|---|---|---|---|---|---|
| 20 | startYear | 流程 | stStartYear | — | newyear→21；endGame→98 | 年份开始：第 4 年开始时进入终局；否则进入回合。 |
| 21 | startRound | 流程 | stStartRound | — | newround→22；endGame→98 | 回合开始：按当前季节掷骰，重置回合状态。 |
| 22 | diceChoice | 单人 | — | chooseDie | chooseDie→23 | 选骰：当前玩家从剩余骰子中选 1 颗。 |
| 23 | diceChoiceNextPlayer | 流程 | stDiceChoiceNextPlayer | — | nextPlayer→22；noMoreDice→27 | 选骰推进：还有剩余骰子就让下一位选；只剩 1 颗时归最后一位，然后进入回合开始。 |
| 25 | nextPlayerTurn | 流程 | stNextPlayerTurn | — | nextPlayer→27；endRound→39 | 回合间推进：清除所有卡的「已激活」标记，找下一位玩家；所有人都行动过则进入回合结束。 |
| 27 | maliceDie | 单人 | stMaliceDie | reroll | startTurn→217；cardEffect→50 | Die of Malice：回合开始前，拥有该卡的玩家可重掷季节骰；否则直接开始结算。 |
| 217 | token17Effect | 单人 | stToken17Effect | reroll, playToken | steadfastDie→227 | 能力 token 17：可重掷季节骰（进入 227 继续判定 Steadfast Die）。 |
| 227 | steadfastDie | 单人 | stSteadfastDie | steadFast | startTurn→28；cardEffect→50 | Steadfast Die：可把本次骰面替换为固定面；否则开始结算骰面。 |
| 28 | startPlayerTurn | 流程 | stStartPlayerTurn | — | checkEnergy→31；startTurn→29 | 结算骰面：按骰子类型发放能量、召唤等级、抽牌、时间、转化、水晶。 |
| 29 | startPlayerTurn2 | 流程 | stStartPlayerTurn2 | — | startTurn→30 | 骰面结算的第二步（例如抽到的牌入手/弃掉、额外选择）。 |
| 30 | playerTurn | 单人 | stPlayerTurn | incSummon, draw, transmute, summon, active, useBonus, endTurn, playToken, undoBonusAction, bonusExchange | endOfTurn→25；cardEffect→50；summonVariableCost→35；draw→32；useBonus→30；bonusDraw→36；bonusExchange→31；resetPlayerTurn→30；playerTurn→30；tokenEffect→200 | 回合主状态：召唤、激活、抽牌、转化、使用 bonus、使用 token、结束回合。 |
| 31 | checkEnergy | 单人 | stCheckEnergy | discardEnergy | energyOk→30；discardEnergy→30；continueDiscard→31 | 能量上限检查：保留区最多 7 个（可被卡牌修正），超出必须弃到上限。 |
| 32 | keepOrDiscard | 单人 | — | keepOrDiscard | keepOrDiscard→30；zombieTurn→30 | 抽牌后选择：把抽到的牌加入手牌或弃掉。 |
| 35 | summonVariableCost | 单人 | stSummonVariableCost | chooseCost | chooseCost→50；cancelChooseCost→30 | 可变费用：选择用哪些能量支付召唤费，或取消召唤。 |
| 36 | bonusDrawChoice | 单人 | — | chooseCard | chooseCard→30；zombieTurn→30 | Bonus 抽牌：从翻出的牌中选 1 张加入手牌。 |
| 39 | preEndRound | 流程 | stPreEndRound | — | endRound→40；cardEffect→50 | 回合结束效果：按玩家顺序结算「回合结束时」触发的卡牌。 |
| 40 | endRound | 流程 | stEndRound | — | nextYear→20；nextRound→21；endGame→98；cardEffect→50 | 回合结束：首玩家轮转、时间标记前进、季节/年份变化、给下一年发牌库。 |

### A.4 效果队列（3 个）

| ID | 状态名 | 类型 | 进入动作 | 可选动作 | 转移 | 说明 |
|---:|---|---|---|---|---|---|
| 50 | cardEffect | 流程 | stCardEffect | — | nextEffect→51；checkEnergy→52；endEffectPlayerTurn→30；endEffectEndOfRound→39；endEffectNewRound→21；endEffectNewYear→20；endEffectBeforeTurn→27；gainEnergy→60；discardIshtar→61；discardKairn→62；necroticSacrifice→63；discardMirror→64；elementalChoice→66；treeOfLifeChoice→67；cauldronPlace→69；vampiricChoice→70；amuletFireChoice→73；divineChoice→74；potionDreamChoice→75；dragonSkull→76；temporalBoots→79；syllasSacrifice→80；nariaChoice→82；amsugTakeback→83；lewisChoice→85；orbChoice→86；discardIshtar2→88；discardHornPlenty→89；familiarChoice→90；rattyNightshade→92；warden_choice→93；throneDiscard→150；telescopeChoice→151；discardJewel→152；fairyMonolith→153；fairyMonolithActive→154；seleniaCodex→155；scrollIshtar→157；statueOfEolisChoice→159；resurrectionChoice→161；potionSacrificeChoice→162；ravenChoice→163；potionOfAncientChoice→165；sepuchralAmuletCardChoice→168；discardEstorian→170；arusSacrifice→171；argosianChoice→172；discardEolis→173；dragonSoulCardChoice→174；dialColofDualChoice→175；staffWinterDiscard→176；chronoRingChoice→178；urmianChoice→179；draw→181；craftyChoice→183；discardMinion→185；chaliceEternity→186；chaliceEternityChoice→187；carnivoraChoice→188；igramulChoice→189；escaped_choice→193；endTokenEffect→299 | 效果队列：取最早的一条效果，按（卡名 + 事件）分派到对应效果方法；方法可返回一个子状态完成选择。 |
| 51 | nextEffect | 流程 | stNextEffect | — | →50 | 下一条效果：删除当前效果，回到 50 继续。 |
| 52 | nextEffectCheckEnergy | 单人 | stCheckEnergy | discardEnergy, discardEnergyEffect | energyOk→51；discardEnergy→51；continueDiscard→52；playerTurn→30 | 效果结算后的能量上限检查（规则同 31，但结束后回到队列）。 |

### A.5 卡牌结算子状态（81 个）

| ID | 状态名 | 类型 | 进入动作 | 可选动作 | 转移 | 说明 |
|---:|---|---|---|---|---|---|
| 60 | gainEnergy | 单人 | — | gainEnergy | next→60；end→52；endAmuletOfTime→91 | 获得能量：逐次选择能量类型；可连续获得多次。 |
| 61 | discardIshtar | 单人 | — | discardEnergyEffect | discardEnergy→51 | 弃掉 4 个相同能量（Ishtar 天平旧版）。 |
| 62 | discardKairn | 单人 | — | discardEnergyEffect | discardEnergy→51 | 弃掉 1 个能量（Kairn）。 |
| 63 | necroticSacrifice | 单人 | — | sacrifice, discard | sacrifice→60；discard→60；zombieTurn→51 | 弃掉或献祭 1 个 Familiar（Necrotic Kriss）。 |
| 64 | mirrorDiscard | 单人 | — | chooseXenergy | chooseXenergy→65；none→51 | 选择 X 个相同能量（Mirror of the Seasons）。 |
| 65 | mirrorChoose | 单人 | — | chooseEnergyType | chooseEnergyType→52 | 选择要把这些能量转化成的目标类型。 |
| 66 | elementalChoice | 单人 | — | chooseEnergyType, cardEffectEnd | chooseEnergyType→51；gainEnergy→72；continue→66 | 元素护符：消耗 1 个能量并选择一项（气=召唤等级 +1、水=获得 2 能量、火=抽 1 张、土=5 水晶）；每种只能用一次，也可免费使用。 |
| 67 | treeOfLifeChoice | 单人 | — | dualChoice | discardEnergy→68；gainEnergy→60 | 生命之树：弃 1 能量，或获得 2 能量。 |
| 68 | discardTree | 单人 | — | discardEnergyEffect | discardEnergy→51 | 弃 1 个能量（生命之树）。 |
| 69 | cauldronPlace | 单人 | — | discardEnergyEffect, placeenergyEffect | discardEnergy→52；potionSacrificeChoice→162 | 暴食坩埚：从保留区放 1 个能量到卡上。 |
| 70 | vampiricChoice | 单人 | — | dualChoice | gainEnergy→60；chooseDiscard→71；noGain→51 | 吸血王冠：选择抽 1 张或弃 1 张。 |
| 71 | vampiricDiscard | 单人 | — | discard, useZira | gainEnergy→60；noGain→51 | 弃 1 张牌（吸血王冠）。 |
| 72 | gainEnergy | 单人 | — | gainEnergy | next→72；end→66 | 元素护符水选项：逐次获得 2 能量，结束后回 66 继续。 |
| 73 | amuletFireChoice | 单人 | — | chooseCard | chooseCard→51 | 火焰护符：从 4 张中选 1 张加入手牌。 |
| 74 | divineChoice | 单人 | — | chooseCard | chooseCard→51 | 神圣圣杯：从 4 张中选 1 张免费召唤。 |
| 75 | potionDreamChoice | 单人 | — | chooseCardHand, chooseCardHandOtus | chooseCardHand→51 | 梦境药水：从手牌选 1 张免费召唤。 |
| 76 | dragonSkull1 | 单人 | — | sacrifice | sacrifice→77 | 龙颅：献祭第 1 张牌。 |
| 77 | dragonSkull2 | 单人 | — | sacrifice | sacrifice→78 | 龙颅：献祭第 2 张牌。 |
| 78 | dragonSkull3 | 单人 | — | sacrifice, lastsacrifice | sacrifice→51 | 龙颅：献祭第 3 张牌。 |
| 79 | temporalBoots | 单人 | — | moveSeason | moveSeason→51 | 时空靴：把季节标记前进或后退 1–3 格。 |
| 80 | syllasSacrifice | 单人 | — | sacrifice | nextPlayer→81 | Syllas：当前对手献祭 1 张 Power 卡。 |
| 81 | syllasSacrificeNext | 流程 | — | — | continue→80；end→51 | Syllas：处理下一位对手。 |
| 82 | nariaChoice | 单人 | — | chooseCard | chooseCard→51；nextPlayer→82 | Naria：为目标玩家从翻开的牌中选 1 张。 |
| 83 | amsugTakeback | 单人 | — | takeBack | nextPlayer→84 | Amsug：当前对手收回 1 件魔法物品。 |
| 84 | amsugTakebackNext | 流程 | — | — | continue→83；end→51 | Amsug：处理下一位对手。 |
| 85 | lewisChoice | 单人 | — | choosePlayer | choosePlayer→52 | Lewis：选择 1 名对手。 |
| 86 | orbChoice | 单人 | — | dualChoice | seeNextCard→87；discardNextCard→51 | 水晶球：选择看牌堆顶，或花 3 水晶弃掉顶牌。 |
| 87 | orbChoice2 | 单人 | — | orbChoice | orbChoice→51 | 水晶球：免费召唤刚看的牌，或把它放回牌堆顶。 |
| 88 | discardIshtar | 单人 | — | discardEnergyEffect | discardEnergy→51 | 弃掉 3 个相同能量（Ishtar 天平新版）。 |
| 89 | discardHornPlenty | 单人 | — | discardEnergyEffect | discardEnergy→51 | 丰饶之角：弃 1 个能量。 |
| 90 | familiarChoice | 单人 | — | dualChoice, familiarAddToHand, familiarDiscard | familiarAddToHand→51；familiarDiscard→51 | 魔宠捕手：把翻到的 Familiar 加入手牌或弃掉。 |
| 91 | amuletOfTime | 单人 | — | amuletOfTime, useZira | amuletOfTime→52；chooseZira→91 | 时间护符：弃 X 张牌，抽 X 张（X 由选择决定）。 |
| 92 | rattyNightshade | 单人 | — | collectEnergy | rattyNightshade→52 | 鼠尾草：从每个对手保留区各取最多 2 个能量。 |
| 93 | wardenChoice | 单人 | — | dualChoice | discardEnergy→95；discardCard→97 | 守卫：选择「所有玩家弃 4 能量」或「所有玩家弃 1 张牌」。 |
| 94 | wardenDiscardEnergy | 单人 | — | discardEnergyEffect | nextPlayer→95；end→51 | 守卫（能量分支）：当前对手弃 4 能量。 |
| 95 | wardenDiscardEnergyNext | 流程 | stWardenDiscardEnergyNext | — | playerChoice→94；next→95；end→51 | 守卫（能量分支）：处理下一位对手。 |
| 96 | wardenDiscardCard | 单人 | — | discard, useZira | nextPlayer→97；end→51 | 守卫（弃牌分支）：当前对手弃 1 张牌。 |
| 97 | wardenDiscardCardNext | 流程 | stWardenDiscardCardNext | — | playerChoice→96；next→97；end→51 | 守卫（弃牌分支）：处理下一位对手。 |
| 150 | throneDiscard | 单人 | — | discard, useZira | discard→51 | 重生王座：弃 1 张牌。 |
| 151 | telescopeChoice | 单人 | — | chooseCard | chooseCard→51 | 望远镜：选择 1 张牌放回牌堆顶（替换原顶牌）。 |
| 152 | discardJewel | 单人 | — | discardEnergyEffect | discardEnergy→51 | 古代宝石：弃 3 个相同能量。 |
| 153 | fairyMonolith | 单人 | — | discardEnergyEffect, doNotUse | discardEnergy→51；doNotUse→51 | 仙灵巨石：可选择放 1 个能量到卡上。 |
| 154 | fairyMonolithActive | 单人 | — | fairyMonolithActive | fairyMonolithActive→52 | 仙灵巨石：取回卡上的能量。 |
| 155 | seleniaTakeback | 单人 | — | takeBack | takeback→51 | Selenia 法典：收回 1 件魔法物品。 |
| 157 | scrollIshtarChoice | 单人 | — | chooseEnergyType | scrollIshtarCardChoice→158 | Ishtar 卷轴：选择要寻找的能量类型。 |
| 158 | scrollIshtarCardChoice | 单人 | — | dualChoice, familiarAddToHand, familiarDiscard | familiarAddToHand→51；familiarDiscard→51 | Ishtar 卷轴：把翻到的牌加入手牌或弃掉。 |
| 159 | statueOfEolisChoice | 单人 | — | statueOfEolisChoice, gainEnergy | statueOfEolisChoice→51；end→51；topcard→160；zombieTurn→51 | Eolis 雕像：选择拿 1 能量，或拿 2 水晶并看牌堆顶。 |
| 160 | statueOfEolisLook | 单人 | — | dualChoice | end→51；zombieTurn→51 | Eolis 雕像：查看牌堆顶。 |
| 161 | resurrectionChoice | 单人 | — | chooseCard | chooseCard→51 | 复活药水：从弃牌堆选 1 张加入手牌。 |
| 162 | potionSacrificeChoice | 单人 | stPotionSacrificeChoice | dualChoice, useZira | chooseZira→52；potionDreamChoice→75；gainEnergy→60；resurrectionChoice→161；potionOfAncientChoice→165；crystalTitanChoice→192 | 药水通用：可牺牲 Shield of Zira 代替「弃牌/献祭」，再进入具体药水效果。 |
| 163 | ravenChoice | 单人 | — | chooseOpponentCard, doNotUse | summonVariableCost→35；chooseOpponentCard→51；doNotUse→51；ravenChoice→163 | 渡鸦：选择 1 件对手魔法物品来模仿，或跳过。 |
| 165 | potionOfAncientChoice | 单人 | stPotionOfAncientChoice | dualChoice | continue→165；stop→52；potionOfAncientCardChoice→166；gainEnergy→167 | 古代药水：选择 2 个效果（可重复或停止）。 |
| 166 | potionOfAncientCardChoice | 单人 | — | chooseCard | chooseCard→165 | 古代药水：抽 2 张，保留 1 张。 |
| 167 | gainEnergy | 单人 | — | gainEnergy | next→167；end→194 | 古代药水：获得能量。 |
| 168 | sepulchralAmuletChoice | 单人 | — | chooseCard | chooseCard→169；moMoreCard→51 | 墓葬护符：从弃牌堆顶 3 张中选 1 张加入手牌。 |
| 169 | sepulchralAmuletChoice2 | 单人 | — | chooseCard | chooseCard→51；moMoreCard→51 | 墓葬护符：选 1 张放回牌堆顶。 |
| 170 | discardEstorian | 单人 | — | discardEnergyEffect | discardEnergy→51 | Estorian 竖琴：弃 2 个相同能量。 |
| 171 | arusSacrifice | 单人 | — | sacrifice, discard | sacrifice→51；discard→51；zombieTurn→51 | Arus 拟态：弃掉或献祭 1 张牌。 |
| 172 | argosianChoice | 单人 | — | chooseOpponentCard | chooseOpponentCard→51；zombieTurn→51 | Argosian：锁定 1 个对手 Familiar。 |
| 173 | discardEolis | 单人 | — | discardEnergyEffect, chooseCost | discardEnergy→51；zombieTurn→51 | Eolis 复制器：弃 1 个水能量。 |
| 174 | dragonsouldCardChoice | 单人 | — | chooseTableauCard, cancel | chooseTableauCard→51；cancel→51；zombieTurn→51 | 龙魂：选择 1 张己方已激活的 Power 卡。 |
| 175 | dialDualChoice | 单人 | — | dualChoice | dualChoice→51；zombieTurn→51 | Colof 日晷：可重掷剩余的季节骰。 |
| 176 | staffWinterDiscard | 单人 | — | discard, useZira | gainEnergy→177；zombieTurn→51 | 冬之杖：弃 1 件魔法物品。 |
| 177 | gainEnergy | 单人 | — | gainEnergy | next→177；end→52；zombieTurn→52 | 冬之杖：获得 3 个能量。 |
| 178 | chronoRingChoice | 单人 | — | chronoRingChoice, gainEnergy, chronoRingChoice | chronoRingChoice→51；end→51；zombieTurn→51 | 时空戒：选择 4 水晶或 1 能量。 |
| 179 | urmianChoice | 单人 | — | urmianChoice, dualChoice | urmianChoice→51；urmianSacrifice→180；zombieTurn→51 | Urmian 笼：选择弃牌或献祭。 |
| 180 | urmianSacrifice | 单人 | — | sacrifice | sacrifice→51；zombieTurn→51 | Urmian 笼：献祭 1 张牌。 |
| 181 | keepOrDiscardRagfield | 单人 | — | keepOrDiscard | keepOrDiscard→182；draw→181；zombieTurn→182 | Ragfield 仆从：抽牌后选择保留或弃掉。 |
| 182 | servantNext | 流程 | stServantNext | — | continue→181；end→51；next→182；draw→181 | Ragfield 仆从：处理下一位玩家。 |
| 183 | craftyChooseOpponent | 单人 | — | choosePlayer | choosePlayer→184 | 狡猾夜影：选择 1 名对手。 |
| 184 | crafyChoice | 单人 | — | chooseCardHandcrafty | chooseCardHand→51 | 狡猾夜影：选 1 张手牌交给该对手。 |
| 185 | discardMinion | 单人 | — | discardEnergyEffect, chooseCost | discardEnergy→51；zombieTurn→51 | Io 仆从：弃 1 个气能量。 |
| 186 | chaliceEternity | 单人 | — | discardEnergyEffect, doNotUse | discardEnergy→51；doNotUse→51；zombieTurn→51 | 永恒圣杯：可选择放 1 个能量到卡上。 |
| 187 | chaliceEternityChoice | 单人 | — | chooseCard | chooseCard→51 | 永恒圣杯：免费召唤 1 张。 |
| 188 | carnivoraChoice | 单人 | — | dualChoice | dualChoice→51 | 食肉花：选择保留此牌或替换。 |
| 189 | igramulChoice | 单人 | — | dualChoice | dualChoice→191 | Igramul：命名 1 张牌。 |
| 190 | igramulDiscard | 单人 | stIgramulDiscard | useZira | nextPlayer→191；end→52 | Igramul：对手弃掉同名牌（可用 Zira 代替）。 |
| 191 | igramulDiscardNext | 流程 | — | — | continue→190；end→52 | Igramul：处理下一位对手。 |
| 192 | crystalTitanChoice | 单人 | — | chooseOpponentCard, doNotUse, dualChoice | chooseOpponentCard→51；doNotUse→51 | 水晶泰坦：选择对手 1 张 Power 卡献祭。 |
| 193 | escapedChoice | 单人 | — | dualChoice | dualChoice→51 | Speedwall：拿取最后抽到的牌。 |
| 194 | checkEnergy | 单人 | stCheckEnergy | discardEnergy | energyOk→165；discardEnergy→165；continueDiscard→194 | 古代药水后的能量上限检查。 |

### A.6 能力 token（7 个）

| ID | 状态名 | 类型 | 进入动作 | 可选动作 | 转移 | 说明 |
|---:|---|---|---|---|---|---|
| 200 | tokenEffect | 流程 | stTokenEffect | — | token18Effect→218；continuePlayerTurn→30；token3Effect→60；token10Effect→210；token17Effect→217；token11Effect→211；token12Effect→212；token2Effect→202 | 能力 token 分发：按 token 类型进入对应子状态。 |
| 202 | token2Effect | 单人 | — | sacrifice, discard | endTokenEffect→299 | token 2：弃掉或献祭 1 张 Power 卡。 |
| 210 | token10Effect | 单人 | — | moveSeason | moveSeason→51 | token 10：把季节标记后退或前进 1–2 格（可跨年）。 |
| 211 | token11Effect | 单人 | — | endSeeOpponentsHands | endTokenEffect→299 | token 11：查看所有对手手牌。 |
| 212 | token12Effect | 单人 | — | sort | endTokenEffect→299 | token 12：排列牌堆顶 3 张。 |
| 218 | token18Effect | 单人 | — | playToken | continuePlayerTurn→30 | token 18：从未来年份牌库选 1 张 Power 卡加入手牌。 |
| 299 | endTokenEffect | 流程 | stEndTokenEffect | — | continuePlayerTurn→30 | token 结算完毕：标记 token 已使用，回到回合。 |

### A.7 终局（3 个）

| ID | 状态名 | 类型 | 进入动作 | 可选动作 | 转移 | 说明 |
|---:|---|---|---|---|---|---|
| 98 | finalScoring | 流程 | stFinalScoring | — | debugEnd→100；realEnd→99 | 终局计分：水晶、桌面牌、卡牌分、终局效果分、bonus 惩罚、手牌惩罚、token 分。 |
| 99 | gameEnd | 管理 | stGameEnd | — | — | 游戏结束，显示结果。 |
| 100 | debuggingEnd | 单人 | — | endGame | next→99；loopback→100 | 调试用终局（Studio 环境直接结束）。 |

### A.8 效果队列：一张卡的效果如何排队与结算

卡牌效果不是「谁触发谁立刻算完」，而是先写进 effect 表，再由状态 50 逐个弹出。这样做的原因是同一时点可能有多张卡同时触发（例如一次召唤同时触发对手的 Magma Core、自己的 Staff of Spring、以及 Urmian Psychic Cage 的陷阱），必须给所有触发一个确定的先后顺序。

1. **入队**：触发点调用「按事件插入效果」的通用逻辑，扫描场上所有卡牌（包括渡鸦复制出来的副本），对每张匹配该事件的卡写入一行效果记录。效果记录包含：所属卡牌、事件类型、卡牌定义 id。效果的所有者是该卡当前的控制者；渡鸦复制品沿用复制者的控制者。
2. **出队**：状态 50 每次取 effect 表中 effect_id 最小的一行，也就是最早入队的一行（先进先出）。结算过程中新插入的效果 id 更大，因此排到队尾，等当前这批效果都处理完才轮到它。
3. **切人**：结算前把当前行动玩家切到效果拥有者，保证「由谁选择、由谁得分、由谁弃牌」都正确；效果产生的提示也以该玩家名义发出。
4. **分派**：用卡牌定义名（小写，空格、撇号、连字符转下划线）加事件名拼出方法名；方法存在就调用。方法的返回值有三种：返回一个状态名，表示需要玩家做选择，进入该子状态；返回空，表示效果已处理完，继续下一条；返回 do_not_nextState，表示方法自己控制了后续流程（例如 Servant of Ragfield 要按玩家顺序逐个处理）。
5. **子状态**：子状态只负责一次选择或一次连续结算，结束后通常回到 51（删除当前效果）或直接回 50。示例：进场效果返回 gainEnergy 时进入 60，玩家逐次选能量；能量发完后 60 转到 52 做保留区上限检查，52 再回到 51。
6. **收尾**：51 删除当前效果，回到 50。50 发现表空时：若当前有 token 效果未结束，转 299；否则把行动玩家恢复为 afterEffectPlayer，并按 afterEffectState 回到原来的上下文。
7. **上下文**：applyCardsEffect 在入队时记录「效果结束后要回哪里」。afterEffectState 的取值：1=回合内（回 30）、2=回合末（回 39）、3=新回合（回 21）、4=新年（回 20）、5=回合开始前（回 27）。因此同一套效果队列可以服务于进场、激活、季节变化、回合末、年末等不同时点。
8. **能量检查**：任何「获得能量」的路径最终都会经过 52（或回合内的 31）。保留区超上限时，玩家必须弃到上限；52 结束后回到 51，继续下一条效果，而不是直接回到回合。

这套队列的一个重要副作用是：**效果的结算顺序等于入队顺序，而不是卡牌在桌面上的排列顺序**。实现中插入效果时按卡牌查询结果遍历，因此同一玩家的多张卡之间顺序由数据库返回顺序决定；需要严格顺序的地方（例如回合末的若干被动）由 stPreEndRound 里的专门代码先处理，而不是依赖队列。

### A.9 多激活、激活标记与撤销

BGA 的状态类型决定了「谁能行动」：

- **单人（activeplayer）**：只有当前玩家能提交动作；大部分卡牌子状态属于这一类。
- **同时（multipleactiveplayer）**：所有未掉线玩家同时行动，全部完成后才推进。轮抽（10）、Twist 轮抽（12）、选 token（13）、建库（18）属于这一类。玩家提交后进入「已完成」集合，最后一人完成时统一推进。
- **流程（game）**：进入即自动执行，不等待玩家。
- **管理（manager）**：框架层，例如初始化与终局展示。

「已激活」没有独立的数据库列，而是复用卡牌行的 card_type_arg：0 表示未激活，1 表示已激活。少数卡把同一个字段当模式位使用，例如 Die of Malice 用 1 表示「召唤当回合不能激活」。回合间推进（25）会把所有卡的该字段清 0，但有两类例外：Io’s Transmuter（109）和 Urmian Psychic Cage（215）以及它们的渡鸦副本不清；并且在下一位回到首玩家、即将进入回合结束（39）之前，会先把 109 的激活位翻转一次，让它的「回合末若本回合转化过则得 2 水晶」按已激活状态结算。

撤销是**局部**的，不是整局回退：

- 轮抽、选 token、建库各有专门的撤销动作，只回退本次选择。
- bonus 动作有一步撤销：使用前把 resource 与 resource_on_card 快照到两张 undo 表，撤销时恢复资源并退回 bonus 计数；只允许撤销最近一次 bonus。
- 召唤、激活、弃牌等一旦确认，没有通用撤销。
- 掉线玩家在同时行动状态会被跳过；在 32、36 等需要该玩家决定的单人状态，提供 zombieTurn 兜底，避免整局卡死。

### A.10 时间、季节与年

一局固定三年，每年十二个月，每月对应一个季节。月份从 1 开始，季节顺序是**冬 → 春 → 夏 → 秋**，与常见的「春为一月」相反：

| 月份 | 1–3 | 4–6 | 7–9 | 10–12 |
|---|---|---|---|---|
| 季节 | 冬 | 春 | 夏 | 秋 |

每回合结束（40）时，时间标记前进的格数等于**本回合最后剩下、没有被任何玩家选走的那颗骰子**的时间值（1–3）。因此回合长度由骰子决定，而不是固定值。月份累加后若超过 12，则减 12、年份加 1；年份变为 2 或 3 时，立即把该年的牌库发给对应玩家。年份变为 4 时不会立刻结束，而是先进入状态 20，让「新年/季节变化」效果结算完，再由 20 判终局。

季节变化（跨过 3、6、9、12 的边界）会触发三张卡的 onSeasonChange：Figrim the Avaricious（11）、Hourglass of Time（27）、Statue of Eolis（107）。此外，若本回合时间前进了正好 3 格，还会触发 Chrono-Ring（212）的 onSeasonChange。所有这些效果都走 A.8 的队列；若队列非空，40 以 newYear 或 newRound 为上下文进入 50，效果结算完再回 20 或 21。

首玩家在每回合结束时轮转给下一位（顺时针）。轮转发生在时间前进之前，因此「谁是下回合首玩家」在回合末效果结算时已经确定。

转化（transmute）的收益随季节变化，每次消耗 1 个能量换水晶：

| 季节 | 气 | 水 | 火 | 土 |
|---|---:|---:|---:|---:|
| 冬 | 1 | 1 | 2 | 3 |
| 春 | 2 | 1 | 3 | 1 |
| 夏 | 3 | 2 | 1 | 1 |
| 秋 | 1 | 3 | 1 | 2 |

Staff of Winter 只在冬天生效：此时所有能量都按 3 水晶计算。Io’s Transmuter 不直接加水晶，而是把自身标记为已激活，回合末若本回合用过它则得 2 水晶。Purse of Io 让每个被转化的能量额外 +1 水晶；在 Ishtar 结晶时还有额外加成。转化本身是回合动作，不进入效果队列。

### A.11 能力 token

能力 token 只在 Enchanted Kingdom 或 Path of Destiny 模式出现：

- Enchanted Kingdom：每人发 3 个 token（类型 1–12），同时选 1 个保留，其余在年份开始时弃掉。
- Path of Destiny：每人发 1 个 token（类型 13–18）。
- 两种模式同时开启时，两套 token 都会发。

token 是一次性的：使用后由 299 移到 used 区，之后不能再选。大部分 token 在对应时机通过 playToken 立即结算；其中 2、3、10、11、12、17、18 这七类会进入状态 200 统一分发：

- 2：弃掉或献祭 1 张 Power 卡（进入 202，可用 Zira 代替）。
- 3：获得 2 能量（走 60，再做上限检查）。
- 10：季节标记前进或后退 1–2 格；可以跨年，跨到第 2/3 年时照常发该年牌库。
- 11：查看所有对手手牌（只给使用者看）。
- 12：查看并重排牌堆顶 3 张。
- 17：重掷本回合自己的季节骰；它与 Steadfast Die 共用 217/227 的判定链。
- 18：从自己第 2/3 年的牌库中选 1 张加入手牌。

其余 token 不经过 200，在 playToken 中直接完成，例如抽牌、取弃牌堆顶、回退 bonus、得水晶、转化加成、召唤等级、弃水、看牌等。它们的使用时机由各自动作的前置条件限制，而不是由状态机限制。

## B. 卡牌效果

### B.1 命名与分派规则

效果方法的命名是「卡牌定义名规范化 + `_` + 事件名」：卡名转小写，空格、`-`、`’` 换成 `_`。例如 `Io’s Transmuter` 的 play 效果方法为 `io_s_transmuter_play`。事件名有六种：`play`（进场）、`active`（激活）、`onEndTurn`（回合末）、`onSummon`（召唤/放入时）、`onSeasonChange`（季节变化）、`onDrawOne`（对手只抽 1 张时）。

全表共 92 个方法：play 45、active 30、onEndTurn 8、onSummon 4、onSeasonChange 4、onDrawOne 1。题述的 74 是「play + 有效 active」的口径（45 + 29 = 74）：Steadfast Die 的 active 是空壳，真实逻辑在状态 227；把空壳与 17 个被动触发钩子都算上就是 92。

分派时把当前玩家切到效果拥有者，调用该方法；方法返回值决定下一步：返回状态名则进入该子状态；返回空则继续下一条效果；返回 `do_not_nextState` 表示方法自己控制流程（例如 Servant of Ragfield）。若某张卡没有对应方法：`play` 视为无效果，其他事件视为实现错误。

### B.2 进场（play）效果（45 个）

| 方法 | 卡牌 | 效果规格 | 实现要点 |
|---|---|---|---|
| air_elemental_play | Air Elemental（12 分） | 所有对手保留区中的非气能量全部转为气，数量不变；自己的能量不动。 | 只遍历保留区，不处理水之护符等卡上的能量；一次资源增量完成，不逐个弹选择。 |
| amsug_longneck_play | Amsug Longneck（8 分） | 从施放者开始按玩家顺序，每位拥有魔法物品的玩家（含自己）把 1 件魔法物品收回手牌。 | 返回 amsugTakeback（83），由 83/84 逐个处理；没有魔法物品或掉线的玩家跳过。 |
| amulet_of_air_play | Amulet of Air（6 分） | 召唤等级 +2（上限 15）。 | 直接调用 increaseSummoningGauge，不产生后续选择。 |
| amulet_of_earth_play | Amulet of Earth（6 分） | 获得 9 水晶。 | 经 checkMinion：若场上有 Io’s Minion（218），本次得分变为 0。 |
| amulet_of_fire_play | Amulet of Fire（6 分） | 抽 4 张到选择区，选 1 张入手，其余弃掉。 | 若本回合必须先抽牌（mustDrawPowerCard=1）则禁止使用；返回 amuletFireChoice（73）。 |
| amulet_of_time_play | Amulet of Time（9 分） | 获得 2 能量；随后可弃 X 张手牌并抽 X 张。 | 先进入 gainEnergy（60）；该状态结束时转 91 处理弃/抽，X 等于弃掉的牌数。 |
| amulet_of_water_play | Amulet of Water（6 分） | 获得 4 能量，放在水之护符上；这些能量不占保留区，可在支付水时使用。 | 仍走 gainEnergy（60），由“效果卡是水之护符”这一条件决定放在卡上；保留区上限检查默认不计入它们，但支付水费时可用。 |
| argos_hawk_play | Argos Hawk（4 分） | 召唤等级 +1，并获得 10 水晶。 | 得水晶经 checkMinion；两部分在同一方法内完成。 |
| argosian_tangleweed_play | Argosian Tangleweed（14 分） | 若任一对手场上有 Familiar，选择 1 个放上 Deadbolt token；被锁的 Familiar 效果无效。 | 返回 argosianChoice（172）；没有 Familiar 时只发提示，无后续状态。 |
| arus_s_mimicry_play | Arus’s Mimicry（10 分） | 弃掉或献祭 1 张 Power 卡（手牌或场上），获得 12 水晶。 | 若手牌+场上都没有 Power 卡则无效果；返回 arusSacrifice（171）。 |
| bespelled_grimoire_play | Bespelled Grimoire（8 分） | 保留区上限变为 10（超出部分存卡上），并获得 2 能量。 | 先 adaptReserveSize 再走 gainEnergy（60）；上限修正对之后所有能量检查生效。 |
| crafty_nightshade_play | Crafty Nightshade（4 分） | 抽 2 张加入手牌；然后选择 1 名对手，把 1 张手牌交给该对手。 | 返回 craftyChoice（183）→ 184；卡面写“Power 卡最少的对手”，实现是玩家自行选对手。 |
| cursed_treatise_of_arus_play | Cursed Treatise of Arus（-10 分） | 召唤等级 +1、获得 10 水晶、获得 2 能量。 | 被献祭时弃光保留区能量，这一条不在本方法内，由献祭通用逻辑处理。 |
| damned_soul_of_onys_play | Damned Soul of Onys（-5 分） | 获得 10 水晶和 1 个水能量。 | 返回 checkEnergy（52）做上限检查；回合末 -3 水晶由被动逻辑处理。 |
| demon_of_argos_play | Demon of Argos（16 分） | 所有对手召唤等级 -1，各抽 1 张 Power 卡。 | 2 人局会把最后抽到的牌交给 Speedwall the Escaped 判定（mayUseEscaped）；3 人以上不处理。 |
| dial_of_colof_play | Dial of Colof（12 分） | 召唤等级 +2。 | 回合末“Power 卡最多则可重掷剩余骰”是被动，由 175 dialDualChoice 处理。 |
| die_of_malice_play | Die of Malice（8 分） | 召唤时把自身标记为已激活，因此当回合不能激活；之后激活可重掷季节骰并得 2 水晶。 | 用 card_type_arg=1 实现“ summoning sickness”；激活方法见 die_of_malice_active。 |
| divine_chalice_play | Divine Chalice（10 分） | 抽 4 张到选择区，选 1 张免费召唤，其余弃掉。 | mustDrawPowerCard=1 时禁用；返回 divineChoice（74）。 |
| elemental_amulet_play | Elemental Amulet（2 分） | 根据当前可用能量提供四种一次性选项：水=+2 能量，土=+5 水晶，火=抽 1 张，气=召唤等级 +1；每种只能选一次。 | 至少要有 1 个能量（免费召唤除外）；水之护符上的能量也算；冬天（冬之杖）土选项恒可用；返回 elementalChoice（66）。 |
| familiar_catcher_play | Familiar Catcher（7 分） | 翻牌堆直到出现 Familiar；非 Familiar 直接弃掉。把 Familiar 加入手牌或弃掉；若弃掉，可再发动一次（仅一次）。 | 用循环最多翻 200 张；返回 familiarChoice（90）。 |
| idol_of_the_familiar_play | Idol of the Familiar（0 分） | 新版（cards_version=1）：获得 10 水晶；旧版无进场效果。 | 激活效果另算：每个 Familiar 得 1 分。 |
| igramul_the_banisher_play | Igramul the Banisher（7 分） | 命名 1 张牌；对手展示手牌并弃掉所有同名牌。若有牌被弃，获得该牌召唤费用中的能量。 | 返回 igramulChoice（189）→ 190/191 逐个对手处理。 |
| io_s_minion_play | Io’s Minion（-5 分） | 获得 1 个气能量，召唤等级 +1。 | 被动：不能获得水晶（checkMinion 归零）；激活可弃 1 气传给左手玩家。 |
| io_s_transmuter_play | Io’s Transmuter（6 分） | 若本回合骰面给水晶，则允许本回合转化；回合末若用其转化过，得 2 水晶。 | 只设置 transmutationPossible；回合末 2 水晶由 stEndRound/被动逻辑结算。 |
| lewis_greyface_play | Lewis Greyface（6 分） | 选择 1 名对手，获得与其保留区完全相同数量和类型的能量。 | 返回 lewisChoice（85）；只复制保留区，不复制水之护符等卡上的能量。 |
| mesodae_s_lantern_play | Mesodae’s Lantern（24 分） | 保留区上限 -1。 | 回合末得 3 水晶是被动；此卡不能被其他 Power 卡免费放入场（在免费召唤逻辑中排除）。 |
| naria_the_prophetess_play | Naria the Prophetess（8 分） | 抽等于玩家人数的牌到选择区；自己留 1 张，其余依次分给其他玩家。 | 返回 nariaChoice（82），opponentTarget 从自己开始轮转。 |
| olaf_s_Blessed_Statue_play | Olaf’s Blessed Statue（0 分） | 获得 20 水晶。 | 经 checkMinion，有 218 时归零。 |
| otus_the_oracle_play | Otus the Oracle（10 分） | 抽等于玩家人数的牌放在桌面中央；每人回合可付费召唤其中 1 张。 | 牌放在 otus 区；召唤入口在回合动作中，不经过本方法。 |
| orb_of_ragfield_play | Orb of Ragfield（-5 分） | 获得 20 水晶。 | 被动：手牌中分数 <12 的 Power 卡召唤费变为 5 水晶（在召唤费用计算处处理）。 |
| pendant_of_ragnor_play | Pendant of Ragnor（0 分） | 每件其他魔法物品给 1 能量（不含 Pendant of Ragnor 自己）。 | 返回 gainEnergy（60），数量由场地魔法物品数决定。 |
| ratty_nightshade_play | Ratty Nightshade（8 分） | 从每个对手保留区各取最多 2 个能量，放入自己的保留区。 | 返回 rattyNightshade（92），由玩家选择拿哪些。 |
| raven_the_usurper_play | Raven the Usurper（2 分） | 选择 1 件对手魔法物品，支付其召唤费，永久复制其效果；被复制物离场时献祭渡鸦。 | 返回 ravenChoice（163）；复制关系存 raven 表；没有可选魔法物品时无效果。 |
| scepter_of_greatness_play | Scepter of Greatness（8 分） | 每件其他魔法物品得 3 水晶。 | 若此卡是渡鸦复制的 Scepter，则把自己也算 1 件；真正的 Scepter 会减掉自己。 |
| selenia_s_codex_play | Selenia’s Codex（6 分） | 收回 1 件魔法物品（召唤费含能量、且不是 Selenia’s Codex）。 | 先扫描是否有合法目标；有则返回 seleniaCodex（155），无则无效果。 |
| sepulchral_amulet_play | Sepulchral Amulet（8 分） | 看弃牌堆顶 3 张：1 张加入手牌、1 张放牌堆顶、1 张放牌堆底。 | 弃牌堆为空时只提示；返回 sepuchralAmuletCardChoice（168）→ 169。 |
| servant_of_ragfield_play | Servant of Ragfield（10 分） | 从施放者起按顺序，每位 ≥10 水晶的玩家召唤等级 +1、抽 1 张并选择加入手牌或弃掉。 | 返回 do_not_nextState 自行控制；181 处理抽牌选择，182 找下一位。 |
| scroll_of_ishtar_play | Scroll of Ishtar（7 分） | 命名一种能量，翻牌堆直到出现召唤费含该能量的魔法物品；可加入手牌或弃掉；若弃掉可再发动一次。 | 返回 scrollIshtar（157）→ 158；翻到非匹配牌的处理由状态逻辑完成。 |
| sid_nightshade_play | Sid Nightshade（6 分） | 若自己是唯一水晶最多的玩家，每个对手给你 5 水晶（对手最少扣到 0，你按实际获得）。 | 平局或不是最多则无效果；经 checkMinion。 |
| statue_of_eolis_play | Statue of Eolis（6 分） | 保留区上限 -1；季节变化时触发二选一：得 1 能量，或得 2 水晶并看牌堆顶。 | 进场只改上限；季节效果见 statue_of_eolis_onSeasonChange。 |
| syllas_the_faithful_play | Syllas the Faithful（14 分） | 从下一位玩家起，每位有 Power 卡且付得起献祭代价的对手献祭 1 张。 | 返回 syllasSacrifice（80）/81；付不起泰坦税的对手会被跳过并提示。 |
| temporal_boots_play | Temporal Boots（8 分） | 季节标记前进或后退 1–3 格。 | 返回 temporalBoots（79），由 moveSeason 动作选择方向与格数。 |
| throne_of_renewal_play | Throne of Renewal（10 分） | 弃 1 张手牌，抽 1 张，bonus 轨后退 1 格。 | 无手牌时可用 Shield of Zira 代替；返回 throneDiscard（150）。 |
| vampiric_crown_play | Vampiric Crown（0 分） | 选择抽 1 张或弃 1 张；获得该牌分数等量的能量。 | 返回 vampiricChoice（70）→ 71；分数按卡牌定义计算。 |
| warden_of_argos_play | Warden of Argos（6 分） | 二选一：所有玩家弃 4 个能量，或所有玩家弃 1 张 Power 卡。 | 返回 warden_choice（93）；两条分支分别走 94/95 与 96/97。 |

### B.3 激活（active）效果（30 个）

| 方法 | 卡牌 | 效果规格 | 实现要点 |
|---|---|---|---|
| arcane_telescope_active | Arcane Telescope（8 分） | 支付 2 水晶，抽 3 张到选择区，任意排序后放回牌堆顶。 | mustDrawPowerCard=1 时禁用；返回 telescopeChoice（151）。 |
| argos_hawk_active | Argos Hawk（4 分） | 献祭 Argos Hawk：所有对手召唤等级 -1，但各得 6 水晶。 | 先走 potionSacrificeChoice（162）允许用 Zira 代替；之后才结算献祭。 |
| balance_of_ishtar_active | Balance of Ishtar（4 分） | 第二版：弃 3 个相同能量，得 12 水晶；第一版：弃 4 个。 | 先按版本校验库存（含水之护符；冬天土可混算）；分别返回 discardIshtar2（88）或 discardIshtar（61）。 |
| chalice_of_eternity_active | Chalice of Eternity（10 分） | 弃掉圣杯上的 4 个能量，抽 4 张，选 1 张免费召唤，其余弃掉。 | 卡上不足 4 个不能发动；返回 chaliceEternityChoice（187）。 |
| crystal_orb_active | Crystal Orb（6 分） | 看牌堆顶：可弃 4 能量免费召唤它，或放回；也可弃 3 水晶把顶牌弃掉。 | 两种激活方式共用 86/87；mustDrawPowerCard=1 时禁用。 |
| crystal_titan_active | Crystal Titan（9 分） | 献祭泰坦：弃掉自己全部 Power 卡和全部水晶，然后选择并献祭对手 1 张 Power 卡。 | 需先付 3 水晶 × 对手泰坦数的“过路费”（checkPlayerCanSacrificeCard）；返回 192。 |
| damned_soul_of_onys_active | Damned Soul of Onys（-5 分） | 弃 1 个水能量，重置此卡并传给左手玩家。 | 水可用水之护符上的；传牌后清空激活标记。 |
| die_of_malice_active | Die of Malice（8 分） | 重掷自己的季节骰，获得 2 水晶。 | 若还有 Die of Malice 可继续留在 27；否则转 startTurn。 |
| dragon_skull_active | Dragon Skull（9 分） | 献祭 3 张 Power 卡，获得 15 水晶。 | 场上有 ≥3 张且付得起泰坦税；返回 dragonSkull（76→77→78）。 |
| dragonsoul_active | Dragonsoul（8 分） | 弃 1 水晶，重置 1 张其他已激活的 Power 卡。 | 不能选 Dragonsoul 自己或 Urmian Psychic Cage（215）；返回 174。 |
| eolis_s_replicator_active | Eolis’s Replicator（7 分） | 弃 1 个水能量，从 Replica 牌堆放 1 张 Replica 入场（终局 7 分）。 | 需要还有 Replica 且召唤等级足够；返回 discardEolis（173）。 |
| estorian_harp_active | Estorian Harp（8 分） | 弃 2 个相同能量，召唤等级 +1，获得 3 水晶。 | 先校验有 2 个相同（含水之护符/冬杖）；返回 discardEstorian（170）。 |
| fairy_monolith_active | Fairy Monolith（6 分） | 取回仙灵巨石上任意数量（至少 1）的能量。 | 没有存能量时不能发动；返回 fairyMonolithActive（154）。 |
| glutton_cauldron_active | Glutton Cauldron（0 分） | 放 1 个能量到坩埚；当坩埚集满 7 个时献祭，取回 7 个能量并得 15 水晶。 | 已有 6 个时先校验能否付泰坦税；返回 cauldronPlace（69）。 |
| idol_of_the_familiar_active | Idol of the Familiar（0 分） | 每个己方 Familiar 得 1 分。 | 经 checkMinion；无 Familiar 时为 0 分。 |
| io_s_minion_active | Io’s Minion（-5 分） | 弃 1 个气能量，重置此卡并传给左手玩家。 | 需要 1 个气能量（水之护符存的是水，不能替代）；返回 discardMinion（185）。 |
| jewel_of_the_ancients_active | Jewel of the Ancients（10 分） | 取 3 个相同能量：1 个放卡上，2 个弃掉。 | 终局卡上 ≥3 个得 35 水晶，否则 -10；返回 discardJewel（152）。 |
| kairn_the_destroyer_active | Kairn the Destroyer（9 分） | 弃 1 个能量，所有对手失去 4 水晶。 | 没有能量不能发动；返回 discardKairn（62）。 |
| magma_core_active | Magma Core（0 分） | 献祭熔岩核心，获得 3 个火能量。 | 经 potionSacrificeChoice 可用 Zira 代替。 |
| mirror_of_the_seasons_active | Mirror of the Seasons（8 分） | 弃 X 水晶，把 X 个相同能量转化为另一种同数量的能量。 | 需要至少 1 水晶和 1 能量；返回 discardMirror（64）→ 65。 |
| necrotic_kriss_active | Necrotic Kriss（6 分） | 弃掉或献祭 1 个 Familiar，获得 4 能量。 | 需要 Familiar（手牌或场上）且付得起泰坦税；返回 necroticSacrifice（63）。 |
| potion_of_dreams_active | Potion of Dreams（0 分） | 献祭药水并弃光保留区能量，免费召唤 1 张手牌。 | 手牌不能全是 Mesodae’s Lantern；经 potionSacrificeChoice。 |
| potion_of_knowledge_active | Potion of Knowledge（0 分） | 献祭药水，获得 5 能量。 | 经 potionSacrificeChoice；无额外条件。 |
| potion_of_life_active | Potion of Life（0 分） | 献祭药水，把保留区每个能量转化为 4 水晶。 | 经 potionSacrificeChoice；转化数量按当前保留区。 |
| potion_of_power_active | Potion of Power（0 分） | 献祭药水，抽 1 张 Power 卡，召唤等级 +2。 | 经 potionSacrificeChoice。 |
| potion_of_the_ancients_active | Potion of the Ancients（0 分） | 献祭药水，选择 2 个效果：每个能量换 4 水晶、抽 2 弃 1、召唤等级 +2、得 4 能量。 | 可重复或停止；返回 potionOfAncientChoice（165）→ 166/167/194。 |
| potion_of_resurrection_active | Potion of Resurrection（0 分） | 献祭药水，看弃牌堆顶 5 张，选 1 张加入手牌，其余放回底部。 | 经 potionSacrificeChoice；返回 resurrectionChoice（161）。 |
| staff_of_winter_active | Staff of Winter（6 分） | 弃 1 件魔法物品，获得 3 能量。 | 可用 Shield of Zira 代替；被动“冬天能量视为土”在资源计算处，不在本方法。 |
| steadfast_die_active | Steadfast Die（10 分） | 方法体为空；实际效果在回合开始状态 227 处理：+1 召唤等级、得 1 能量、或本回合可转化。 | 不要在此找逻辑；227 的 steadFast 动作完成选择。 |
| tree_of_light_active | Tree of Light（12 分） | 二选一：弃 3 水晶得 1 能量；或弃 1 能量使本回合可转化。 | 至少要满足其中一种代价；返回 treeOfLifeChoice（67）。 |

### B.4 触发钩子（9 个）

| 方法 | 卡牌 | 触发 | 效果 | 要点 |
|---|---|---|---|---|
| chrono_ring_onSeasonChange | Chrono-Ring | onSeasonChange | 一回合内季节标记前进 ≥3 格时，得 4 水晶或 1 能量。 | 由 stEndRound 在 timeProgression==3 时插入；返回 chronoRingChoice（178）。 |
| figrim_the_avaricious_onSeasonChange | Figrim the Avaricious | onSeasonChange | 每次季节变化，每个有水晶的对手给你 1 水晶。 | 对手扣到 0 为止；你实际获得的点数经 checkMinion。 |
| hourglass_of_time_onSeasonChange | Hourglass of Time | onSeasonChange | 每次季节变化，获得 1 个自选能量。 | 返回 gainEnergy（60）。 |
| magma_core_onSummon | Magma Core | onSummon | 对手召唤 Power 卡时，你得 1 个火能量。 | 实现把火给“当前效果拥有者”（即核心主人），不弹选择。 |
| speedwall_the_escaped_onDrawOne | Speedwall the Escaped | onDrawOne | 对手只抽 1 张时，改为你抽这张，然后把 Speedwall 放入该对手手牌。 | 发动可选（193）；费用 X=你的召唤等级。 |
| statue_of_eolis_onSeasonChange | Statue of Eolis | onSeasonChange | 每次季节变化，二选一：得 1 能量，或得 2 水晶并看牌堆顶。 | 返回 statueOfEolisChoice（159）→ 160。 |
| staff_of_spring_onSummon | Staff of Spring | onSummon | 你召唤 Power 卡时，得 3 水晶。 | 经 checkMinion。 |
| urmian_psychic_cage_onSummon | Urmian Psychic Cage | onSummon | 有 Trap token 时，召唤/放入 Power 卡的玩家必须二选一：弃掉该牌（不结算其效果），或献祭 1 张 Power 卡；然后移除 Trap。 | 先把 active player 切回召唤者（afterEffectPlayer），再进 179/180；token 本身整局留在卡上。 |
| yjang_s_forgotten_vase_onSummon | Yjang’s Forgotten Vase | onSummon | 你召唤 Power 卡时，得 1 能量。 | 返回 gainEnergy（60）。 |

### B.5 回合末钩子（onEndTurn，8 个）

这些方法只负责「打开一个选择」或「转去通用结算」；触发条件大多在 stPreEndRound 里先行判断，满足条件才插入效果。

| 方法 | 卡牌 | 触发条件 | 效果规格 | 实现要点 |
|---|---|---|---|---|
| beggar_s_horn_onEndTurn | Beggar’s Horn（14） | 回合末保留区 ≤1 能量 | 得 1 能量 | 返回 gainEnergy（60），之后由 52 做上限检查。 |
| chalice_of_eternity_onEndTurn | Chalice of Eternity（207） | 回合末 | 可弃 1 个保留区能量放到圣杯上；存满 4 个后，激活时可弃掉它们免费召唤 | 返回 chaliceEternity（186）→ 187；可跳过。 |
| carnivora_strombosea_onEndTurn | Carnivora Strombosea（214） | 回合末保留区没有能量 | 看牌堆顶：放回，或加入手牌并让召唤等级 -1 | 返回 carnivoraChoice（188）。 |
| dial_of_colof_onEndTurn | Dial of Colof（206） | 回合末且 Power 卡多于至少一个对手 | 可重掷本回合未被任何玩家选走的季节骰 | 条件在 preEndRound 判定；返回 dialColofDualChoice（175），可拒绝。 |
| fairy_monolith_onEndTurn | Fairy Monolith（103） | 回合末 | 可从保留区放 1 个能量到巨石上 | 返回 fairyMonolith（153）；激活时可取回任意数量（至少 1）。 |
| heart_of_argos_onEndTurn | Heart of Argos（101） | 回合末 | 把卡上的土能量放回保留区，然后做上限检查 | 返回 checkEnergy（52）；「每回合首次激活 Power 卡时放 1 土」在激活动作的通用逻辑里。 |
| horn_of_plenty_onEndTurn | Horn of Plenty（102） | 回合末 | 弃 1 个能量；若弃的是土（或冬之杖生效）得 5 水晶 | 返回 discardHornPlenty（89）。 |
| titus_deepgaze_onEndTurn | Titus Deepgaze（39） | 回合末，有对手给不出 1 水晶 | 必须献祭泰特斯；若有 Zira 可代替 | 返回 potionSacrificeChoice（162）；无法献祭时跳过。 |

### B.6 没有独立效果方法的卡（13 张）

这些卡的效果由通用结算、被动检查或终局计分完成；分派器找不到方法时，play 视为无效果。

| 卡牌 | 类别 | 规则文本（BGA 英文版） | 实现方式 |
|---|---|---|---|
| 8 Purse of Io | 魔法物品 | 每次转化能量额外获得 1 水晶。 | 转化 action 内结算，无独立方法。 |
| 13 Wondrous Chest | 魔法物品 | 回合结束时若保留区有 ≥4 能量，得 3 水晶。 | preEndRound 通用检查。 |
| 19 Ragfield’s Helm | 魔法物品 | 终局时若你的 Power 卡数量严格多于每个对手，额外得 20 水晶。 | 终局计分。 |
| 20 Hand of Fortune | 魔法物品 | 手牌中 Power 卡的召唤费 -1（最低 1）。 | 召唤费用计算。 |
| 22 Runic Cube of Eolis | 魔法物品 | （BGA 卡表文本为空）按实现为被动/计分卡。 | 无独立方法，效果散在通用逻辑。 |
| 33 Arcano Leech | Familiar | 对手召唤 Power 卡前必须先给你 1 水晶。 | 召唤前置检查。 |
| 41 Thieving Fairies | Familiar | 对手每次激活 Power 卡时给你 1 水晶，你额外再得 1。 | 激活前置检查。 |
| 45 Lantern of Xidit | 魔法物品 | 终局时保留区每个能量额外 3 水晶。 | 终局计分。 |
| 46 Sealed Chest of Urm | 魔法物品 | 终局时若场上只有魔法物品（无 Familiar），得 20 水晶。 | 终局计分。 |
| 113 Shield of Zira | 魔法物品 | 可代替弃掉/献祭 1 张 Power 卡，并得 10 水晶。 | 所有“弃/献祭”选择的通用替代项。 |
| 203 Twist of Fate | 魔法物品 | 建库后移出游戏，抽 2 张留 1 弃 1；开局前从牌堆移除所有 Twist of Fate。 | 轮抽/建库流程。 |
| 205 Ethiel’s Fountain | 魔法物品 | 回合结束时若手牌没有 Power 卡，得 3 水晶。 | preEndRound。 |
| 222 Replica | Power 卡（复制品） | 作为 Eolis’s Replicator 生成的复制品，终局 7 分。 | replica 牌堆/计分。 |

### B.7 实现上的几个注意点

- **先校验，后进子状态**：绝大多数效果方法只做「能不能做」的校验与记账，真正的选择交给返回的子状态；因此读方法体时要顺着返回值去看对应状态，不能只看方法本身。
- **渡鸦与复制品**：渡鸦复制品按原卡名分派；Replica 的 card_type 带「118;」前缀，判断卡牌种类时会剥掉前缀，因此同一张 Replica 可以走原卡的逻辑。
- **替代与加价**：Shield of Zira 可以替代「弃掉/献祭 1 张 Power 卡」，并给 10 水晶；对手场上的每张 Crystal Titan 会让每次献祭额外收 3 水晶；Io’s Minion 在场时，所有「获得水晶」变为 0。
- **空壳方法**：Steadfast Die 的 active 方法为空，实际选择在回合开始的 227；不要因为方法为空就认为这张卡没有激活效果。
- **版本差异**：cards_version=1 时 Idol of the Familiar 进场得 10 水晶、Balance of Ishtar 只需 3 个相同能量；旧版分别是无进场效果与 4 个。

## C. 附录

### C.1 源码文件地图

| 文件 | 体积（字节） | 作用 |
|---|---:|---|
| seasonssk.game.php | 415,835 | 全部规则：状态处理、51 个动作、92 个效果方法、计分与工具函数 |
| states.inc.php | 57,017 | 118 个状态条目（117 游戏态 + 调试态） |
| material.inc.php | 71,301 | 95 张卡的定义、能量/季节/转化表、预组牌库、bonus 费用 |
| seasonssk.action.php | 15,827 | 51 个玩家动作的入口与参数校验 |
| seasonssk.view.php | 2,900 | 模板变量 |
| seasonssk_seasonssk.tpl | 27,772 | 页面骨架 |
| seasonssk.js | 162,747 | 前端交互；线上压缩后 81,288 字节 |
| seasonssk.css | 36,061 | 样式；线上压缩后 29,424 字节 |
| dbmodel.sql | 3,747 | 10 张表 |
| LICENCE_BGA | — | BGA 专用许可，不是开源许可 |

### C.2 数据表

| 表 | 主键 | 作用 |
|---|---|---|
| card | card_id | 所有 Power 卡实例：手牌、抽牌堆、弃牌堆、选择区、桌面、第 1/2/3 年牌库、复制品牌堆。card_type 可能是「118;X」形式的副本；card_type_arg 兼作激活位/模式位；card_location 与 card_location_arg 表示位置与归属。 |
| resource | (resource_player, resource_id) | 玩家保留区的能量数量。resource_id：1 气、2 水、3 火、4 土。水晶不在这里，存在 player_score。 |
| dice | (dice_id, dice_face, dice_season) | 本回合每颗季节骰的面与归属；dice_player_id 为空表示尚未被选走。 |
| effect | effect_id | 待结算效果队列：effect_card（卡实例）、effect_type（事件）、effect_card_type（卡定义 id）。按 effect_id 升序结算。 |
| resource_on_card | (roc_card, roc_id) | 存在卡上的能量：水之护符、圣杯、坩埚、仙灵巨石、阿尔戈斯之心等。roc_player 记录归属，便于查询。 |
| raven | raven_id | 渡鸦复制的原卡 id；复制品仍以 card 表的一行存在，效果分派时按原卡名走。 |
| argosian | argosian_id | Argosian Tangleweed 锁定的 Familiar：记录被锁的卡实例。 |
| ability_token | card_id | 能力 token 实例，复用卡表结构（card_type 为两位编号，如 02、10、18）。 |
| resource_undo | (resource_player, resource_id) | bonus 动作前的保留区快照，用于撤销。 |
| resource_on_card_undo | (roc_card, roc_id) | bonus 动作前的卡上能量快照，用于撤销。 |

### C.3 player 表的游戏专用字段

| 字段 | 含义 |
|---|---|
| player_nb_bonus_used | 已使用的 bonus 次数（决定 bonus 轨位置与费用） |
| player_invocation | 当前召唤等级（上限 15） |
| player_reserve_size | 当前保留区上限（基础 7；Bespelled Grimoire 为 10；每张 Mesodae’s Lantern / Statue of Eolis 减 1） |
| player_score_cristals | 终局时快照的水晶分 |
| player_score_raw_cards | 桌面卡牌的原始分 |
| player_score_eog_cards | 终局效果分 |
| player_score_bonus_actions | bonus 轨惩罚（负数） |
| player_score_remaining_cards | 手牌惩罚（每张 -5，token 05 时每张 +3） |
| player_score_token | 能力 token 分 |
| player_last_draft_card | 轮抽时最后保留的牌，用于撤销/继续轮抽 |
| player_reset_possible | 本回合是否还能重置（用于判断某些一次性效果） |

player_score 在对局中是水晶数；终局再把各类分数累加进去。player_score_aux 记录桌面卡牌数，作为同分时的第一 tiebreaker。

### C.4 关键游戏状态值

| 名称 | 含义 |
|---|---|
| draftmode | 游戏选项：卡池与难度的组合（基础、Enchanted Kingdom、Path of Destiny、两者兼有，共 9 档） |
| cards_version | 卡牌版本；1 表示第二版文本（例如 Idol of the Familiar 进场得 10 水晶、Balance of Ishtar 弃 3 个相同能量） |
| year / month | 当前年份（1–3）与月份（1–12） |
| firstPlayer | 本回合首玩家 |
| diceSeason | 本回合使用的季节骰组 |
| transmutationPossible | 本回合是否可转化；0 否，1 是，2 及以上表示带额外加成 |
| mustDrawPowerCard | 是否被效果强制抽牌；为 1 时禁止使用会抽牌/需要先抽牌的卡 |
| currentEffect | 正在结算的 effect_id |
| currentTokenEffect | 正在结算的 token 类型；非 0 时队列清空后转 299 |
| afterEffectPlayer | 效果队列清空后要恢复的行动玩家 |
| afterEffectState | 效果队列清空后要回到的上下文（1 回合内、2 回合末、3 新回合、4 新年、5 回合开始前） |
| energyNbr | 还需获得几个能量（60 状态逐次递减） |
| toSummon | 当前要召唤的卡实例，用于可变费用与取消 |
| elementalAmulet1–4 | 元素护符四种选项的剩余可用次数 |
| elementalAmuletFree | 元素护符的免费使用次数 |
| opponentTarget | 顺序效果当前指向的对手 |
| lastCardDrawn / lastCardPicked | 最近抽到/选中的卡，供后续子状态使用 |
| steadfast_die_mode | Steadfast Die 本次选择的面/模式 |
| firstActivation | 本回合是否尚未激活过 Power 卡（Heart of Argos 的每回合一次判定） |
| discardPos | 弃牌堆下一个位置 |
| BONUS_JUST_PLAYED | 最近一次 bonus 的 id，用于撤销 |
| CARDS_REMOVED_FROM_DECK | 已从牌堆移除的 Twist of Fate 数量 |
| LAST_TRANSMUTATION_POSSIBLE | 使用转化 bonus 前的状态快照，用于撤销 |

### C.5 术语表

| 术语 | 含义 |
|---|---|
| 保留区（reserve） | 玩家面前存放能量 token 的区域，默认上限 7，可被卡牌修正 |
| 能量（energy） | 气、水、火、土四种；用于支付召唤费、激活费与转化 |
| 水晶（crystal） | 主要货币与分数；对局中直接记在 player_score |
| 召唤等级（summoning gauge） | 桌面可容纳的 Power 卡数量上限；初始 0，上限 15 |
| 魔法物品（magic item，mi） | Power 卡的一类，通常提供持续或激活效果 |
| Familiar（f） | Power 卡的另一类，通常是生物，可被献祭/锁定 |
| 桌面（tableau） | 已进场、持续生效的 Power 卡区域 |
| 已激活（activated） | 本回合已经支付激活费使用过的卡；回合间推进时重置 |
| 转化（transmute） | 弃 1 个能量换水晶，收益随季节变化 |
| 牌库（library 1/2/3） | 建库时把 9 张牌分成三份，分别在三年开始时加入手牌 |
| 抽牌堆（deck） | 公共 Power 卡牌堆 |
| 弃牌堆（discard） | 已弃掉/献祭的牌；部分效果从顶部取牌 |
| 选择区（choice） | 临时展示「抽 N 选 1」的牌的区域 |
| 首玩家（first player） | 每回合先选骰的玩家；每回合结束轮转 |
| 季节标记（season marker） | 指示当前月份/季节的标记；每回合按最后未选骰的时间值前进 |
| 能力 token | Enchanted Kingdom / Path of Destiny 的一次性能力，每人保留 1 个 |
| 渡鸦复制（Raven） | Raven the Usurper 复制的魔法物品，按原卡名分派效果 |
| Replica | Eolis’s Replicator 生成的复制品，7 分，可被当作对应卡使用 |
| bonus 轨 | 召唤等级之外的额外行动轨；使用 bonus 会推进轨道并增加终局惩罚 |
