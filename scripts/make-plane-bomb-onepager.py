from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path

W, H = 1400, 3220
CJK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
CJK_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

BG = (10, 14, 19)
CARD = (18, 26, 36)
CARD2 = (22, 32, 45)
BORDER = (36, 48, 61)
TEXT = (233, 239, 246)
MUTED = (142, 160, 179)
ACCENT = (55, 211, 153)
ACCENT_DIM = (36, 169, 122)
BLUE = (96, 165, 250)
AMBER = (251, 191, 36)
RED = (248, 113, 113)
WATER = (11, 36, 56)
WATER2 = (8, 23, 37)

OUT_PNG = Path("/home/squid/DSH_workspace/bgx/docs/games/plane-bomb-one-pager.png")

_font_cache = {}
def font(size, bold=False):
    key = (size, bold)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(CJK_BOLD if bold else CJK, size, index=2)
    return _font_cache[key]

def text_len(draw, s, f):
    b = draw.textbbox((0, 0), s, font=f)
    return b[2] - b[0]

def text(draw, xy, s, size, fill=TEXT, bold=False, anchor="lt", spacing=0):
    f = font(size, bold)
    if spacing:
        # manual letterspacing for short labels
        x, y = xy
        for ch in s:
            draw.text((x, y), ch, font=f, fill=fill, anchor=anchor)
            x += text_len(draw, ch, f) + spacing
        return
    draw.text(xy, s, font=f, fill=fill, anchor=anchor)

def wrap(draw, s, f, maxw):
    lines, cur = [], ""
    for ch in s:
        if ch == "\n":
            lines.append(cur); cur = ""; continue
        if text_len(draw, cur + ch, f) > maxw and cur:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines

def para(draw, xy, s, size, fill=MUTED, maxw=520, lh=1.55, bold=False):
    f = font(size, bold)
    x, y = xy
    for line in wrap(draw, s, f, maxw):
        draw.text((x, y), line, font=f, fill=fill)
        y += int(size * lh)
    return y

def card(draw, box, fill=CARD, outline=BORDER, radius=22, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

def chip(draw, xy, s, size=18, fg=ACCENT, bg=None, padx=14, pady=7):
    x, y = xy
    f = font(size, True)
    w = text_len(draw, s, f)
    if bg:
        draw.rounded_rectangle((x, y, x + w + padx * 2, y + size + pady * 2), radius=10, fill=bg, outline=None)
    draw.text((x + padx, y + pady), s, font=f, fill=fg)

def footprint(cockpit, orientation):
    dirs = [(-1, 0), (0, 1), (1, 0), (0, -1)]
    dr, dc = dirs[orientation]
    br, bc = -dr, -dc
    pr, pc = dc, -dr
    r0, c0 = cockpit // 10, cockpit % 10
    offs = [(0, 0)]
    for k in range(-2, 3):
        offs.append((br + pr * k, bc + pc * k))
    offs.append((2 * br, 2 * bc))
    for k in range(-1, 2):
        offs.append((3 * br + pr * k, 3 * bc + pc * k))
    out = []
    for rr, cc in offs:
        r, c = r0 + rr, c0 + cc
        if not (0 <= r < 10 and 0 <= c < 10):
            return None
        out.append(r * 10 + c)
    return sorted(set(out))

def board(draw, x, y, cell, planes=None, marks=None, hidden=False, gap=2, dim=False, seat_label=None):
    """10x10 board; planes list of (cells, cockpit); marks dict cell->'miss'/'body'/'cockpit'."""
    planes = planes or []
    marks = marks or {}
    plane_map = {}
    for cells, cockpit in planes:
        for c in cells:
            plane_map[c] = (cockpit == c)
    # board frame
    bw = cell * 10 + gap * 9
    draw.rounded_rectangle((x - 8, y - 8, x + bw + 8, y + bw + 8), radius=14, fill=(7, 18, 29), outline=(32, 58, 82), width=1)
    for idx in range(100):
        r, c = divmod(idx, 10)
        cx, cy = x + c * (cell + gap), y + r * (cell + gap)
        fill = (255, 255, 255, 10)
        if idx in plane_map:
            is_head = plane_map[idx]
            fill = (55, 211, 153, 150 if is_head else 62)
        if idx in marks:
            m = marks[idx]
            fill = {"miss": (120, 137, 155, 90), "body": (251, 191, 36, 235), "cockpit": (248, 113, 113, 245)}[m]
        draw.rounded_rectangle((cx, cy, cx + cell, cy + cell), radius=max(2, cell // 12), fill=fill)
        # glyphs
        if idx in marks:
            m = marks[idx]
            if m == "miss":
                draw.ellipse((cx + cell*0.42, cy + cell*0.42, cx + cell*0.58, cy + cell*0.58), fill=(190, 202, 214))
            elif m == "body":
                text(draw, (cx + cell/2, cy + cell/2 - 1), "×", int(cell*0.62), (15, 23, 32), bold=True, anchor="mm")
            else:
                burst(draw, cx + cell/2, cy + cell/2, cell*0.32)
        elif idx in plane_map and plane_map[idx]:
            text(draw, (cx + cell/2, cy + cell/2 - 1), "▲", int(cell*0.5), (6, 40, 28), bold=True, anchor="mm")
    if hidden:
        draw.rounded_rectangle((x + 10, y + 10, x + bw - 10, y + bw - 10), radius=10, fill=(8, 15, 24))
        text(draw, (x + bw/2, y + bw/2 - 26), "?", int(cell*3.2), (52, 70, 88), bold=True, anchor="mm")
        text(draw, (x + bw/2, y + bw/2 + cell*1.8), "对方舰队不可见", 15, MUTED, anchor="mm")
    if seat_label:
        text(draw, (x + bw/2, y + bw + 18), seat_label, 16, MUTED, anchor="mt")
    return bw

def plane_icon(draw, cx, cy, s, fill=ACCENT):
    pts = [(0.0, -1.0), (0.18, -0.55), (0.95, 0.05), (0.95, 0.22), (0.20, 0.05), (0.16, 0.55), (0.50, 0.82), (0.50, 0.98), (0.0, 0.82), (-0.50, 0.98), (-0.50, 0.82), (-0.16, 0.55), (-0.20, 0.05), (-0.95, 0.22), (-0.95, 0.05), (-0.18, -0.55)]
    draw.polygon([(cx + x * s, cy + y * s) for x, y in pts], fill=fill)

def burst(draw, cx, cy, r, fill=(255, 255, 255)):
    import math
    pts = []
    for i in range(16):
        rr = r if i % 2 == 0 else r * 0.38
        a = math.pi * i / 8 - math.pi / 2
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    draw.polygon(pts, fill=fill)

def arrow(draw, x, y, color=ACCENT, size=22, direction="right"):
    if direction == "right":
        draw.line((x, y, x + size, y), fill=color, width=3)
        draw.line((x + size - 7, y - 6, x + size, y), fill=color, width=3)
        draw.line((x + size - 7, y + 6, x + size, y), fill=color, width=3)

# ---------- background ----------
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
for y in range(H):
    t = y / H
    r = int(10 + 4 * t)
    g = int(14 + 7 * t)
    b = int(19 + 10 * t)
    d.line((0, y, W, y), fill=(r, g, b))
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((-300, -420, 900, 520), fill=(55, 211, 153, 26))
gd.ellipse((820, -500, 1750, 420), fill=(96, 165, 250, 20))
gd.ellipse((350, 2100, 1500, 3300), fill=(251, 191, 36, 10))
glow = glow.filter(ImageFilter.GaussianBlur(160))
img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
d = ImageDraw.Draw(img)

M = 70

# ---------- header ----------
text(d, (M, 66), "BGX · 在线桌游 · 一图流", 20, ACCENT, bold=True, spacing=1)
text(d, (M - 4, 104), "炸飞机", 112, TEXT, bold=True)
text(d, (M + 2, 246), "秘密布阵 · 同轮对轰 · 先击落对方 3 架者胜", 28, MUTED)
# badge
bx0, by0, bx1, by1 = 1000, 106, 1330, 190
card(d, (bx0, by0, bx1, by1), fill=CARD, outline=(45, 70, 60), radius=18)
text(d, ((bx0 + bx1)//2, by0 + 18), "2 人 · 10–15 分钟", 22, ACCENT, bold=True, anchor="mt")
# 3 planes motif
for i in range(3):
    plane_icon(d, 1072 + i * 86, 244, 20, ACCENT)
text(d, (M, 308), "https://thinktwice.top/bgx/", 18, (86, 106, 126))
d.line((M, 352, W - M, 352), fill=(30, 42, 55), width=2)

# ---------- 01 objective ----------
y = 382
card(d, (M, y, W - M, y + 206), fill=CARD, outline=(38, 58, 72))
text(d, (M + 34, y + 30), "01", 22, ACCENT, bold=True)
text(d, (M + 78, y + 30), "目标", 22, MUTED)
text(d, (M + 34, y + 72), "先击落对方 3 架飞机", 46, TEXT, bold=True)
para(d, (M + 36, y + 142), "机头被炸 = 这架飞机被击落；机身被炸只是普通命中。同轮双方都击落第 3 架，判平局。", 20, MUTED, maxw=800, lh=1.5)
# right 3 kill marks
for i in range(3):
    cx = 1150 + i * 72
    d.ellipse((cx - 24, y + 72, cx + 24, y + 120), fill=(34, 50, 62), outline=ACCENT if i < 3 else BORDER, width=2)
    plane_icon(d, cx, y + 98, 15, ACCENT)
text(d, (1186, y + 138), "击落 3 架", 18, ACCENT, anchor="mt")

# ---------- 02 plane shape ----------
y = 620
text(d, (M, y), "02", 24, ACCENT, bold=True)
text(d, (M + 54, y), "一架飞机 = 10 格", 38, TEXT, bold=True)
text(d, (M + 2, y + 54), "机头 1 格 + 机翼 5 格 + 机身 1 格 + 机尾 3 格", 21, MUTED)
# big board C3 up
board(d, 110, y + 124, 27, planes=[(footprint(22, 0), 22)], seat_label="示例：机头 C3，朝上")
text(d, (110, y + 124 + 270 + 62), "▲ 机头   ■ 机体（机翼 / 机身 / 机尾）", 16, MUTED)
# orientation cards
cards = [
    ("↑", "机头朝上", 0, 22),
    ("→", "机头朝右", 1, 22),
    ("↓", "机头朝下", 2, 82),
    ("←", "机头朝左", 3, 22),
]
cx0 = 468
for i, (arw, label, ori, cockpit) in enumerate(cards):
    x = cx0 + i * 216
    card(d, (x, y + 106, x + 200, y + 420), fill=CARD, outline=BORDER, radius=18)
    text(d, (x + 18, y + 122), arw, 26, ACCENT, bold=True)
    text(d, (x + 46, y + 126), label, 17, MUTED)
    # 7x7 mini grid
    cell = 20
    gx, gy = x + 30, y + 176
    d.rounded_rectangle((gx - 5, gy - 5, gx + cell*7 + 5, gy + cell*7 + 5), radius=8, fill=WATER2)
    # use local 7x7 coordinates: shift footprint to center
    # draw mini plane directly with pattern relative to cockpit (3,3)
    dirs = [(-1, 0), (0, 1), (1, 0), (0, -1)][ori]
    br, bc = -dirs[0], -dirs[1]
    pr, pc = dirs[1], -dirs[0]
    offs = [(0, 0)]
    for k in range(-2, 3):
        offs.append((br + pr*k, bc + pc*k))
    offs.append((2*br, 2*bc))
    for k in range(-1, 2):
        offs.append((3*br + pr*k, 3*bc + pc*k))
    for rr, cc in offs:
        r, c = 3 + rr, 3 + cc
        if 0 <= r < 7 and 0 <= c < 7:
            fill = (55, 211, 153, 60)
            if (rr, cc) == (0, 0):
                fill = (55, 211, 153, 160)
            d.rounded_rectangle((gx + c*cell + 1, gy + r*cell + 1, gx + (c+1)*cell - 1, gy + (r+1)*cell - 1), radius=3, fill=fill)
            if (rr, cc) == (0, 0):
                text(d, (gx + c*cell + cell/2, gy + r*cell + cell/2 - 1), "▲", 11, (6, 40, 28), bold=True, anchor="mm")
    text(d, (x + 100, y + 392), "10 格，形状不变", 14, MUTED, anchor="mt")

# ---------- 03 placement ----------
y = 1160
text(d, (M, y), "03", 24, ACCENT, bold=True)
text(d, (M + 54, y), "布阵：秘密摆 3 架", 38, TEXT, bold=True)
para(d, (M + 2, y + 62), "点击格子放机头，再用旋转按钮调整方向。三架不能重叠，也不能越出 10×10 海域；可以贴边，也可以相邻。", 20, MUTED, maxw=560, lh=1.65)
# bullet rows
bullets = [
    ("机头 + 朝向 = 整架飞机的位置", ACCENT),
    ("双方都提交后才开战，提交前可反复修改", BLUE),
    ("布阵阶段，对方看不到你的舰队", AMBER),
]
by = y + 220
for s, col in bullets:
    d.ellipse((M + 4, by + 7, M + 18, by + 21), fill=col)
    text(d, (M + 32, by), s, 20, TEXT)
    by += 48
# two boards
board(d, 760, y + 92, 22, planes=[(footprint(22, 0), 22), (footprint(59, 1), 59), (footprint(94, 2), 94)], seat_label="你的海域：三架已就位")
board(d, 1080, y + 92, 22, hidden=True, seat_label="对方海域：看不到")

# ---------- 04 rounds ----------
y = 1640
text(d, (M, y), "04", 24, ACCENT, bold=True)
text(d, (M + 54, y), "每轮：同时报点，同时结算", 38, TEXT, bold=True)
text(d, (M + 2, y + 58), "没有先后手。你和对手在同一轮各报一个格子，两边都报完后两炮一起生效。", 20, MUTED)

steps = [
    ("1", "双方各报 1 格", "你选一个没炸过的格子\n对方也选一个"),
    ("2", "两边都报完", "两炮同时结算\n不存在谁先开炮"),
    ("3", "进入下一轮", "再各报 1 格\n直到一方击落 3 架"),
]
sy = y + 122
for i, (n, title_s, desc) in enumerate(steps):
    x = M + i * 424
    card(d, (x, sy, x + 384, sy + 190), fill=CARD, outline=BORDER, radius=20)
    d.ellipse((x + 22, sy + 24, x + 68, sy + 70), fill=(26, 45, 38), outline=ACCENT, width=2)
    text(d, (x + 45, sy + 31), n, 24, ACCENT, bold=True, anchor="ma")
    text(d, (x + 84, sy + 28), title_s, 24, TEXT, bold=True)
    yy = sy + 84
    for line in desc.split("\n"):
        text(d, (x + 26, yy), line, 18, MUTED)
        yy += 32
    if i < 2:
        arrow(d, x + 390, sy + 95, color=(70, 96, 86), size=26)
# callout
card(d, (M, sy + 222, W - M, sy + 292), fill=(18, 34, 30), outline=(37, 76, 60), radius=16)
text(d, (M + 26, sy + 240), "没有先后手", 18, ACCENT, bold=True)
text(d, (M + 190, sy + 240), "·  每轮每人 1 炮  ·  命中不连击  ·  同一格不能重复报", 18, MUTED)

# ---------- 05 results ----------
y = 2150
text(d, (M, y), "05", 24, ACCENT, bold=True)
text(d, (M + 54, y), "炸到之后，只有三种结果", 38, TEXT, bold=True)
items = [
    ("miss", "炸空", "没炸中。这个格子之后不能再报。", (120, 137, 155), "·"),
    ("body", "命中机身", "算命中。即使这架飞机已经被击落，炸到机身仍然算命中。", AMBER, "×"),
    ("cockpit", "命中机头", "立即击落这架飞机。击落对方 3 架，你就赢了。", RED, None),
]
cy = y + 82
for i, (kind, title_s, desc, col, glyph) in enumerate(items):
    x = M + i * 424
    card(d, (x, cy, x + 384, cy + 244), fill=CARD, outline=BORDER, radius=20)
    # sample cell
    d.rounded_rectangle((x + 24, cy + 26, x + 104, cy + 106), radius=10, fill={"miss": (60, 72, 84), "body": AMBER, "cockpit": RED}[kind])
    if kind == "miss":
        d.ellipse((x + 54, cy + 56, x + 74, cy + 76), fill=(205, 214, 223))
    elif kind == "cockpit":
        burst(d, x + 64, cy + 66, 28, (255, 255, 255))
    else:
        text(d, (x + 64, cy + 62), glyph, 50, (15, 23, 32), bold=True, anchor="mm")
    text(d, (x + 124, cy + 30), title_s, 25, col if kind != "miss" else TEXT, bold=True)
    para(d, (x + 24, cy + 130), desc, 17, MUTED, maxw=336, lh=1.6)

# ---------- 06 win / start ----------
y = 2520
text(d, (M, y), "06", 24, ACCENT, bold=True)
text(d, (M + 54, y), "胜负 & 快速开始", 38, TEXT, bold=True)
card(d, (M, y + 74, 720, y + 330), fill=CARD, outline=BORDER, radius=20)
text(d, (M + 26, y + 100), "怎样算赢", 22, ACCENT, bold=True)
wins = [
    ("plane", "击落对方 3 架", "获胜"),
    ("=", "同轮双方都到 3 架", "平局"),
    ("←", "任何时候认输", "对手获胜"),
]
wy = y + 146
for icon, a, b in wins:
    if icon == "plane":
        plane_icon(d, M + 39, wy + 10, 12, ACCENT)
    else:
        text(d, (M + 30, wy), icon, 20, ACCENT, bold=True)
    text(d, (M + 66, wy), a, 19, TEXT)
    text(d, (M + 520, wy), b, 17, ACCENT if b == "获胜" else MUTED, anchor="rt")
    wy += 52
card(d, (760, y + 74, W - M, y + 330), fill=CARD, outline=(46, 66, 86), radius=20)
text(d, (786, y + 100), "第一次玩", 22, BLUE, bold=True)
steps2 = ["大厅选择「炸飞机」", "创建公开或私密房间", "把房间号 / 链接发给朋友", "双方布阵后开始对轰"]
for i, s in enumerate(steps2):
    xx = 786 + (i % 2) * 286
    yy = y + 148 + (i // 2) * 66
    d.ellipse((xx, yy + 1, xx + 26, yy + 27), fill=(24, 38, 52), outline=(50, 74, 96))
    text(d, (xx + 13, yy + 6), str(i + 1), 14, BLUE, bold=True, anchor="ma")
    text(d, (xx + 38, yy + 4), s, 17, TEXT)

# memory strip
sy2 = 2890
card(d, (M, sy2, W - M, sy2 + 92), fill=(14, 26, 34), outline=(37, 76, 60), radius=18)
text(d, (M + 30, sy2 + 26), "记住三件事", 21, ACCENT, bold=True)
for xx, mark, phrase in [(260, "①", "只有机头被炸才算击落"), (600, "②", "双方都报完才同时结算"), (950, "③", "同轮 3:3 是平局")]:
    text(d, (xx, sy2 + 28), mark, 18, ACCENT, bold=True)
    text(d, (xx + 28, sy2 + 28), phrase, 18, TEXT)

# footer
fy = 3080
d.line((M, fy, W - M, fy), fill=(30, 42, 55), width=2)
text(d, (M, fy + 26), "https://thinktwice.top/bgx/", 24, ACCENT, bold=True)
text(d, (M, fy + 66), "打开就能玩 · 不用注册 · 房间链接直接发给朋友", 17, MUTED)
text(d, (W - M, fy + 30), "BGX", 34, (52, 68, 84), bold=True, anchor="rt")
text(d, (W - M, fy + 72), "规则文档 · v1.1", 16, (86, 106, 126), anchor="rt")

img.save(OUT_PNG, optimize=True)
print(OUT_PNG, img.size)
