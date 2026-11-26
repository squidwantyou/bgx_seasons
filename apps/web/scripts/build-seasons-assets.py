#!/usr/bin/env python3
"""把旧项目的卡图/骰子/元素图标转成 webp，输出到 apps/web/src/assets/seasons/。

用法：
  python3 apps/web/scripts/build-seasons-assets.py [--src 旧项目 public/assets] [--out 输出目录]

旧项目只读；脚本可重复运行（覆盖输出）。
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from PIL import Image

CARD_WIDTH = 320
DICE_SIZE = 108
ELEMENT_SIZE = 120
QUALITY = 80

ELEMENT_FILE = {
    'water': 'Water',
    'earth': 'Earth',
    'fire': 'Fire',
    'air': 'Air',
}


def convert(src: Path, dst: Path, size: tuple[int, int] | None) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = im.convert('RGB')
        if size is not None and im.size != size:
            im = im.resize(size, Image.LANCZOS)
        im.save(dst, 'WEBP', quality=QUALITY, method=6)
    return dst.stat().st_size


def main() -> int:
    here = Path(__file__).resolve()
    default_src = Path('/home/squid/seasons_web/seasons-web/public/assets')
    default_out = here.parents[1] / 'src' / 'assets' / 'seasons'
    parser = argparse.ArgumentParser()
    parser.add_argument('--src', type=Path, default=default_src)
    parser.add_argument('--out', type=Path, default=default_out)
    args = parser.parse_args()

    cards_dir = args.src / 'cards'
    dice_dir = args.src / 'dice'
    elements_dir = args.src / 'elements'
    if not cards_dir.is_dir():
        print(f'找不到卡图目录：{cards_dir}', file=sys.stderr)
        return 1

    total = 0
    count = 0

    # 卡图：1.png..50.png + back.png → cards/<id>.webp
    for png in sorted(cards_dir.glob('*.png')):
        name = png.stem
        if name != 'back' and not re.fullmatch(r'\d+', name):
            continue
        total += convert(png, args.out / 'cards' / f'{name}.webp', (CARD_WIDTH, round(CARD_WIDTH * 634 / 455)))
        count += 1

    # 骰面：<letter><die>r<roll>.png → dice/<letter><die>r<roll>.webp
    if dice_dir.is_dir():
        for png in sorted(dice_dir.glob('*.png')):
            if not re.fullmatch(r'[wsuf]\d+r\d+', png.stem):
                continue
            total += convert(png, args.out / 'dice' / f'{png.stem}.webp', (DICE_SIZE, DICE_SIZE))
            count += 1

    # 元素图标
    if elements_dir.is_dir():
        for element, file_name in ELEMENT_FILE.items():
            png = elements_dir / f'{file_name}.png'
            if not png.is_file():
                continue
            total += convert(png, args.out / 'elements' / f'{element}.webp', (ELEMENT_SIZE, ELEMENT_SIZE))
            count += 1

    # 旧素材里冬季 2 号骰的第 4/6 面文件名互换了：w2r4 画的是 r6（召唤+2 水，3 点），
    # w2r6 画的是 r4（1 水晶+2 水，2 点），与 dice.json 正好相反。转换后交换文件，
    # 让 <letter><die>r<roll> 的名字与骰面内容一致（否则前端图与奖励文字对不上）。
    dice_out = args.out / 'dice'
    swap_pairs = [('w2r4', 'w2r6')]
    for left, right in swap_pairs:
        a = dice_out / f'{left}.webp'
        b = dice_out / f'{right}.webp'
        if a.is_file() and b.is_file():
            tmp = dice_out / f'.{left}.swap'
            a.replace(tmp)
            b.replace(a)
            tmp.replace(b)

    print(f'转换 {count} 个文件 → {args.out}（{total / 1024:.0f} KB）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
