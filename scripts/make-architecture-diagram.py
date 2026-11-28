#!/usr/bin/env python3
"""生成 BGX 在线桌游架构图（SVG + PNG）。"""
from __future__ import annotations

import html
from pathlib import Path

from PIL import ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "architecture"
OUT_DIR.mkdir(parents=True, exist_ok=True)

W, H = 2200, 3540
SANS = "'Noto Sans CJK SC', 'Noto Sans CJK JP', sans-serif"
MONO = "'DejaVu Sans Mono', 'Noto Sans Mono', monospace"
FONT_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

BG = "#070d13"
PANEL = "#0e1720"
PANEL2 = "#111d29"
PANEL3 = "#0b141d"
BORDER = "#223243"
BORDER_SOFT = "#1a2836"
TEXT = "#e8f0f7"
MUTED = "#93a8bd"
DIM = "#6f8499"
GREEN = "#3ddc97"
BLUE = "#5aa9ff"
AMBER = "#f5c451"
PINK = "#ff7b9c"
PURPLE = "#b794f6"
CYAN = "#4fd1c5"
RED = "#ff6b6b"

_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = ("b" if bold else "r", size)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size=size, index=2)
    return _font_cache[key]


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def tw(s: str, size: int, bold: bool = False) -> float:
    return font(size, bold).getlength(s)


def wrap(s: str, width: float, size: int, bold: bool = False) -> list[str]:
    """按像素宽度逐字换行，尽量在空格/标点后断开。"""
    lines: list[str] = []
    buf = ""
    for ch in s:
        cand = buf + ch
        if tw(cand, size, bold) <= width or not buf:
            buf = cand
            continue
        lines.append(buf.rstrip())
        buf = ch.lstrip()
    if buf:
        lines.append(buf.rstrip())
    return lines or [""]


class SVG:
    def __init__(self) -> None:
        self.parts: list[str] = []

    def add(self, s: str) -> None:
        self.parts.append(s)

    def rect(self, x, y, w, h, fill=PANEL, stroke=BORDER, rx=16, sw=1.2, opacity=1.0):
        self.add(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}" opacity="{opacity}"/>'
        )

    def text(self, x, y, s, size=14, fill=TEXT, weight=400, anchor="start", family=SANS, opacity=1.0, spacing=0):
        s = esc(str(s))
        fam = family
        self.add(
            f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" '
            f'opacity="{opacity}" letter-spacing="{spacing}">{s}</text>'
        )

    def rich(self, x, y, spans, size=14, anchor="start", family=SANS):
        """spans: list[(text, fill, weight)]，用于一行多色。"""
        widths = [tw(t, size, w >= 600) for t, _, w in spans]
        total = sum(widths)
        cx = x - total / 2 if anchor == "middle" else x
        for (t, fill, weight), wd in zip(spans, widths):
            self.text(cx, y, t, size=size, fill=fill, weight=weight, family=family)
            cx += wd

    def circle_num(self, cx, cy, n, color=GREEN, r=17, size=15):
        self.add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}" opacity="0.14"/>')
        self.add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{color}" stroke-width="1.4"/>')
        self.text(cx, cy + size * 0.36, str(n), size=size, fill=color, weight=700, anchor="middle")

    def bullet(self, x, y, text, width, size=13.5, color=MUTED, marker="•", marker_color=GREEN, lh=21):
        self.text(x, y, marker, size=size, fill=marker_color, weight=700)
        lines = wrap(text, width, size)
        for i, line in enumerate(lines):
            self.text(x + 16, y + i * lh, line, size=size, fill=color)
        return y + len(lines) * lh

    def box_title(self, x, y, title, sub=None, color=GREEN, size=17, sub_size=12.5):
        self.text(x, y, title, size=size, fill=TEXT, weight=700)
        if sub:
            self.text(x, y + 21, sub, size=sub_size, fill=color)

    def section(self, n, x, y, title, sub, color=GREEN):
        self.circle_num(x + 18, y - 8, n, color=color, r=19, size=16)
        self.text(x + 50, y, title, size=25, fill=TEXT, weight=700)
        self.text(x + 50, y + 27, sub, size=13.5, fill=MUTED)


def card(svg: SVG, x, y, w, h, title, items, accent=GREEN, title_size=17, body_size=13.2, lh=20.5, pad=18, mono_items=False):
    svg.rect(x, y, w, h, fill=PANEL2, stroke=BORDER, rx=14)
    svg.add(f'<rect x="{x}" y="{y + 14}" width="3.5" height="{h - 28}" rx="2" fill="{accent}" opacity="0.75"/>')
    svg.text(x + pad, y + 30, title, size=title_size, fill=TEXT, weight=700, family=MONO if mono_items else SANS)
    yy = y + 54
    for item in items:
        lines = wrap(item, w - pad * 2, body_size)
        for line in lines:
            if yy > y + h - 12:
                break
            svg.text(x + pad, yy, line, size=body_size, fill=MUTED)
            yy += lh
    return yy


def add_arrow(svg: SVG, d: str, color=BLUE, width=2.0, dash=None):
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    svg.add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow-{color.lstrip("#")})"{dash_attr}/>')


def build() -> SVG:
    svg = SVG()
    svg.add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
    # defs
    marker_colors = {
        BLUE: "5aa9ff", GREEN: "3ddc97", AMBER: "f5c451", MUTED: "93a8bd", PINK: "ff7b9c", PURPLE: "b794f6",
    }
    svg.add("<defs>")
    for c, name in marker_colors.items():
        svg.add(
            f'<marker id="arrow-{name}" viewBox="0 0 10 10" refX="8.4" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M 0 0 L 10 5 L 0 10 z" fill="{c}"/></marker>'
        )
    svg.add(
        '<pattern id="dotgrid" width="26" height="26" patternUnits="userSpaceOnUse">'
        f'<circle cx="1.5" cy="1.5" r="1.1" fill="#1b2b3a" opacity="0.55"/></pattern>'
    )
    svg.add("</defs>")

    # background
    svg.add(f'<rect width="{W}" height="{H}" fill="{BG}"/>')
    svg.add(f'<rect width="{W}" height="620" fill="url(#dotgrid)" opacity="0.6"/>')
    svg.add(f'<rect x="0" y="0" width="{W}" height="6" fill="{GREEN}" opacity="0.7"/>')

    # header
    svg.text(70, 66, "BGX  ·  ONLINE BOARD GAMES  ·  ARCHITECTURE", size=13, fill=GREEN, weight=700, spacing=2.4)
    svg.text(68, 146, "BGX 在线桌游架构", size=62, fill=TEXT, weight=700)
    svg.text(72, 196, "单服务器 · 前后端分离 · 服务端权威 · 状态与事件持久化", size=21, fill=MUTED)
    svg.rect(1555, 62, 575, 118, fill=PANEL, stroke=BORDER, rx=16)
    svg.text(1585, 100, "线上实例", size=12, fill=DIM, weight=700, spacing=1.4)
    svg.text(1585, 130, "https://thinktwice.top/bgx/", size=17, fill=GREEN, family=MONO)
    svg.text(1585, 158, "Apache2  ·  Node 22  ·  SQLite  ·  systemd", size=12.5, fill=MUTED)
    svg.add(f'<line x1="60" y1="238" x2="2140" y2="238" stroke="{BORDER}" stroke-width="1"/>')

    # legend
    lx = 72
    ly = 262
    for label, color, kind in [
        ("HTTPS / REST", BLUE, "line"),
        ("WebSocket", GREEN, "line"),
        ("SQL / 持久化", AMBER, "line"),
        ("服务端权威", PINK, "dot"),
    ]:
        if kind == "line":
            svg.add(f'<line x1="{lx}" y1="{ly - 5}" x2="{lx + 30}" y2="{ly - 5}" stroke="{color}" stroke-width="3"/>')
        else:
            svg.add(f'<circle cx="{lx + 15}" cy="{ly - 5}" r="6" fill="{color}"/>')
        svg.text(lx + 40, ly, label, size=13, fill=MUTED)
        lx += 230

    # ============ 1. client ============
    svg.rect(60, 290, 2080, 330, fill=PANEL, stroke=BORDER, rx=20)
    svg.section(1, 88, 336, "浏览器端 · React 19 SPA", "只负责界面与输入；棋盘、比分、按钮状态全部来自服务端 view", GREEN)
    pages = [
        ("/", "大厅 Lobby", "创建公开 / 私密房间 · 选择游戏（黑白棋 / 炸飞机）· 公开房 3s 轮询 · 房间号加入 / 观战", "私密房不进大厅；复制邀请链接即可直接入座。", BLUE),
        ("/m/:matchId", "对局 Match", "Socket join → snapshot / update · 房主开始 · 棋盘与比分 · 聊天 · 认输 / 再来一局", "断线重连自动重新 snapshot；观战者看到公开视图。", GREEN),
        ("/p/:userId", "玩家主页 Profile", "玩家资料与统计 · 历史对局 · 私密对局过滤 · 仅本人显示「修改昵称」", "胜 / 负 / 和 / 进行中；对局行可点进房间。", PURPLE),
    ]
    for i, (route, name, desc, extra, color) in enumerate(pages):
        x = 90 + i * 670
        svg.rect(x, 372, 640, 166, fill=PANEL2, stroke=BORDER, rx=14)
        svg.add(f'<rect x="{x}" y="{372}" width="640" height="3" rx="1.5" fill="{color}" opacity="0.8"/>')
        svg.text(x + 20, 405, route, size=15, fill=color, weight=700, family=MONO)
        name_x = x + max(118, 20 + tw(route, 15, True) + 14)
        svg.text(name_x, 405, name, size=15, fill=TEXT, weight=700)
        yy = 438
        for line in wrap(desc, 596, 13.5):
            svg.text(x + 20, yy, line, size=13.5, fill=MUTED)
            yy += 21
        yy += 5
        for line in wrap(extra, 596, 12.4):
            svg.text(x + 20, yy, line, size=12.4, fill=DIM)
            yy += 19
        source = {
            "/": "数据源：GET /api/matches?status=  ·  POST /api/matches",
            "/m/:matchId": "数据源：socket snapshot / update  ·  POST join / rematch",
            "/p/:userId": "数据源：GET /api/users/:id  ·  私密局仅参与者可见",
        }[route]
        svg.text(x + 20, 513, source, size=10.8, fill=DIM)
    modules = [
        ("lib/api.ts", "fetch + credentials"),
        ("socket.io-client", "transports: websocket"),
        ("React Router 7", "basename=/bgx"),
        ("useMe / usePageMeta", "会话与页面元信息"),
        ("Toast / AuthDialog", "反馈与登录注册"),
        ("@bgx/protocol", "共享类型与 Zod"),
        ("Vite 6 · TypeScript", "构建静态资源"),
    ]
    mx = 90
    widths = [235, 300, 235, 285, 260, 280, 295]
    for (name, sub), wd in zip(modules, widths):
        svg.rect(mx, 558, wd, 46, fill=PANEL3, stroke=BORDER_SOFT, rx=10)
        svg.text(mx + 14, 578, name, size=12.5, fill=TEXT, weight=700, family=MONO)
        svg.text(mx + 14, 595, sub, size=11, fill=DIM)
        mx += wd + 20

    # client -> apache
    add_arrow(svg, "M1100 620 V666", color=BLUE, width=2.6)
    svg.text(1116, 654, "HTTPS 443 · /bgx", size=12.5, fill=BLUE, family=MONO)

    # ============ 2. apache ============
    svg.rect(60, 670, 2080, 200, fill=PANEL, stroke=BORDER, rx=20)
    svg.section(2, 88, 714, "Apache2 · TLS 入口与路径路由", "根站 piwigo 不受影响；/bgx 独立挂载，静态资源与 API 同源", BLUE)
    routes = [
        ("/bgx/", "/var/www/bgx", "静态 SPA · 长缓存 assets · SPA fallback", BLUE),
        ("/bgx/api/*", "127.0.0.1:8787/api", "HTTP 反向代理 · 同源 Cookie", GREEN),
        ("/bgx/socket.io", "ws://127.0.0.1:8787/socket.io", "WebSocket 升级 · proxy_wstunnel", AMBER),
    ]
    for i, (path, target, note, color) in enumerate(routes):
        x = 90 + i * 670
        svg.rect(x, 755, 640, 78, fill=PANEL2, stroke=BORDER, rx=12)
        svg.text(x + 16, 781, path, size=13.5, fill=color, weight=700, family=MONO)
        svg.text(x + 16, 801, "→ " + target, size=12, fill=TEXT, family=MONO)
        svg.text(x + 16, 820, note, size=11.5, fill=MUTED)
    svg.text(90, 855, "Let's Encrypt 证书  ·  TLS 1.2/1.3  ·  gzip  ·  index.html no-cache", size=11.5, fill=DIM)

    # apache -> node
    add_arrow(svg, "M1080 833 V900 H560 V986", color=GREEN, width=2.4)
    svg.text(620, 922, "HTTP /api", size=12, fill=GREEN, family=MONO)
    add_arrow(svg, "M1760 833 V986", color=AMBER, width=2.4)
    svg.text(1776, 910, "WebSocket", size=12, fill=AMBER, family=MONO)

    # ============ 3. node ============
    svg.rect(60, 900, 2080, 1030, fill=PANEL, stroke=BORDER, rx=20)
    svg.section(3, 88, 938, "Node.js 22 进程 · Fastify 5 + Socket.IO 4", "systemd: bgx.service  ·  127.0.0.1:8787  ·  User=bgx  ·  /opt/bgx/app", GREEN)
    svg.text(2080, 938, "单进程 · 内存事件总线 · 无 Redis / MQ", size=12.5, fill=DIM, anchor="end")

    # row A: HTTP + socket
    # Fastify
    svg.rect(90, 990, 980, 180, fill=PANEL2, stroke=BORDER, rx=14)
    svg.text(110, 1022, "Fastify HTTP API", size=19, fill=TEXT, weight=700)
    svg.text(110, 1044, "Zod 校验 · Cookie 会话 · 统一错误结构", size=12.5, fill=GREEN)
    http_items = [
        ("账号与会话", "/api/me · /api/auth/register|login|logout", BLUE),
        ("房间与对局", "/api/games · /api/matches/*", GREEN),
        ("玩家主页", "/api/users/:id", PURPLE),
        ("健康检查", "/healthz", MUTED),
    ]
    yy = 1074
    for k, (label, path, color) in enumerate(http_items):
        svg.text(112, yy, label, size=13, fill=color, weight=700)
        svg.text(240, yy, path, size=12.5, fill=MUTED, family=MONO)
        yy += 26
    # Socket.IO
    svg.rect(1100, 990, 980, 180, fill=PANEL2, stroke=BORDER, rx=14)
    svg.text(1120, 1022, "Socket.IO 实时层", size=19, fill=TEXT, weight=700)
    svg.text(1120, 1044, "WebSocket only · Cookie 握手鉴权 · 房间广播", size=12.5, fill=AMBER)
    socket_items = [
        ("入站", "join · action · chat · leave", GREEN),
        ("出站", "snapshot · update · chat · rematch · error", BLUE),
        ("推送", "每个 socket 按自己的 userId 重算 buildView", PURPLE),
        ("约束", "动作幂等 · 聊天限流 400ms · 无动作限流", MUTED),
    ]
    yy = 1074
    for label, path, color in socket_items:
        svg.text(1122, yy, label, size=13, fill=color, weight=700)
        svg.text(1190, yy, path, size=12.5, fill=MUTED)
        yy += 26

    # arrows into domain
    add_arrow(svg, "M560 1170 V1206", color=GREEN, width=2.2)
    add_arrow(svg, "M1590 1170 V1206", color=AMBER, width=2.2)

    # row B: services + engines
    svg.rect(90, 1210, 980, 370, fill=PANEL2, stroke=BORDER, rx=14)
    svg.text(110, 1244, "领域服务层", size=19, fill=TEXT, weight=700)
    svg.text(110, 1265, "业务编排 · 权限与视图 · 持久化入口", size=12.5, fill=GREEN)
    # four mini cards
    mini = [
        (110, 1282, 450, 115, "matches.ts", "创建 / 加入 / 开始 / 动作 / 重开 / 视图 / 清理", "对局生命周期与 buildView", GREEN),
        (580, 1282, 470, 115, "profiles.ts", "战绩 · 历史对局 · 私密过滤", "GET /api/users/:id 的数据源", PURPLE),
        (110, 1412, 450, 145, "auth / session", "游客自动建号 · 注册升级 · 登录换发 session", "scrypt 密码 · HttpOnly Cookie", BLUE),
        (580, 1412, 470, 145, "realtime bus", "EventEmitter('update')", "动作落库后通知实时层重算视图", AMBER),
    ]
    for x, y, w, h, title, l1, l2, color in mini:
        svg.rect(x, y, w, h, fill=PANEL3, stroke=BORDER_SOFT, rx=10)
        svg.text(x + 14, y + 24, title, size=13.5, fill=color, weight=700, family=MONO)
        yy2 = y + 46
        for line in wrap(l1, w - 28, 12.3):
            svg.text(x + 14, yy2, line, size=12.3, fill=TEXT)
            yy2 += 18
        for line in wrap(l2, w - 28, 11.5):
            svg.text(x + 14, yy2 + 2, line, size=11.5, fill=MUTED)
            yy2 += 17

    # engines
    svg.rect(1100, 1210, 980, 370, fill=PANEL2, stroke=BORDER, rx=14)
    svg.text(1120, 1244, "游戏插件 · 自动发现", size=19, fill=TEXT, weight=700)
    svg.text(1120, 1265, "服务端唯一裁判；客户端只提交动作意图", size=12.5, fill=PINK)
    for x, title, sub, lines, color in [
        (1120, "Reversi", "8×8 · 黑先 · 八方向翻转", ["终局按棋子数判定胜负", "动作：move / resign"], GREEN),
        (1600, "PlaneBomb", "10×10 · 三架「士」字形飞机", ["四朝向 · 同轮报点 · 同时结算", "机头击落 · 3:3 平局", "动作：place / fire / resign"], AMBER),
    ]:
        svg.rect(x, 1282, 460, 190, fill=PANEL3, stroke=BORDER_SOFT, rx=10)
        svg.text(x + 16, 1308, title, size=15, fill=color, weight=700, family=MONO)
        svg.text(x + 16, 1328, sub, size=11.5, fill=TEXT)
        yy2 = 1354
        for line in lines:
            for l in wrap(line, 428, 11.8):
                svg.text(x + 16, yy2, l, size=11.8, fill=MUTED)
                yy2 += 18
    svg.text(1120, 1498, "GamePlugin = { meta, optionSchema, defaultOptions,", size=11.4, fill=CYAN, family=MONO)
    svg.text(1120, 1518, "               actionSchema, actionType, ...GameEngine<S,V,A,O> }", size=11.4, fill=CYAN, family=MONO)
    svg.text(1120, 1542, "无 DB / 无时钟 / 无随机；状态 JSON 可序列化，可重放、可测试", size=11.8, fill=MUTED)
    svg.text(1120, 1566, "loader 自动发现后，GET /api/games 与大厅自动感知", size=11.8, fill=MUTED)

    # row C: cross-cutting
    svg.text(90, 1624, "横切机制", size=16, fill=TEXT, weight=700)
    svg.add(f'<line x1="180" y1="1618" x2="2060" y2="1618" stroke="{BORDER_SOFT}" stroke-width="1"/>')
    cross = [
        (90, "事务与幂等", [
            "BEGIN IMMEDIATE 事务",
            "动作 / 事件 / 状态 / version / seq 原子提交",
            "match_actions 唯一键拦截重复 actionId",
        ], GREEN),
        (760, "生命周期", [
            "waiting（无引擎状态）—房主 start→ active → finished",
            "入座只加入；start 按实际人数 setup",
            "24h 无活动的未结束房间清理；finished 保留",
        ], AMBER),
        (1430, "后台任务", [
            "过期 session：启动 + 每 6h",
            "废弃房间：启动 + 每小时",
            "SIGTERM / SIGINT 优雅关闭",
        ], BLUE),
    ]
    for x, title, items, color in cross:
        svg.rect(x, 1645, 640, 190, fill=PANEL2, stroke=BORDER, rx=12)
        svg.text(x + 18, 1677, title, size=15, fill=color, weight=700)
        yy2 = 1704
        for item in items:
            for line in wrap(item, 600, 12.3):
                svg.text(x + 18, yy2, line, size=12.3, fill=MUTED)
                yy2 += 19
    svg.text(90, 1870, "每个动作：校验 → 幂等 → engine.reduce → 事务落库 → bus 广播 → 逐用户投影", size=12.5, fill=GREEN)

    # node -> sqlite
    add_arrow(svg, "M1100 1930 V1956", color=AMBER, width=3.0)
    svg.text(1118, 1948, "SQLite prepared statements", size=12, fill=AMBER, family=MONO)

    # ============ 4. sqlite ============
    svg.rect(60, 1960, 2080, 370, fill=PANEL, stroke=BORDER, rx=20)
    svg.section(4, 88, 2004, "SQLite · /var/lib/bgx/bgx.db", "WAL  ·  foreign_keys=ON  ·  busy_timeout  ·  单文件、零外部依赖", AMBER)
    tables = [
        ("users", ["id", "name", "username", "password_hash", "created_at"], GREEN),
        ("sessions", ["id", "user_id", "created_at", "expires_at"], BLUE),
        ("matches", ["id · game_id", "host_id", "status · visibility", "options JSON", "seed · aborted", "state JSON", "version · seq", "created / started / ended_at"], AMBER),
        ("match_seats", ["match_id", "seat", "user_id", "name", "joined_at"], PURPLE),
        ("match_events", ["match_id", "seq", "actor", "type", "payload", "created_at"], CYAN),
        ("match_actions", ["match_id", "action_id", "seat", "seq", "payload", "created_at"], PINK),
        ("chat_messages", ["id", "match_id", "user_id", "name", "body", "created_at"], MUTED),
    ]
    for i, (name, fields, color) in enumerate(tables):
        x = 90 + i * 290
        svg.rect(x, 2042, 272, 188, fill=PANEL2, stroke=BORDER, rx=11)
        svg.add(f'<rect x="{x}" y="{2042}" width="272" height="3" rx="1.5" fill="{color}" opacity="0.75"/>')
        svg.text(x + 14, 2070, name, size=13.5, fill=color, weight=700, family=MONO)
        yy2 = 2094
        for field in fields:
            for line in wrap(field, 244, 10.9):
                svg.text(x + 14, yy2, line, size=10.9, fill=MUTED, family=MONO)
                yy2 += 16
    svg.text(90, 2262, "matches.state = 当前权威快照；events 用于审计与增量；actions 只保留幂等键；FK ON DELETE CASCADE", size=11.8, fill=MUTED)
    svg.text(90, 2290, "finished 不自动删除；未结束且 24h 无活动才清理；seed 只存服务端；match_rankings 存终局名次", size=11.8, fill=DIM)

    # ============ 5. flows ============
    svg.section(5, 88, 2384, "关键链路", "从浏览器输入到服务端裁决，再到每个玩家看到的视图", GREEN)
    # http flow
    svg.rect(90, 2420, 1010, 235, fill=PANEL, stroke=BORDER, rx=14)
    svg.text(112, 2452, "HTTP 请求链路", size=17, fill=BLUE, weight=700)
    svg.text(112, 2472, "GET /api/...  ·  POST /api/...", size=11.5, fill=DIM, family=MONO)
    http_steps = [
        ("1", "SPA fetch：同源 /bgx/api，携带 Cookie"),
        ("2", "Apache 反代到 127.0.0.1:8787/api"),
        ("3", "Fastify 路由 → Zod 校验 → userFromRequest"),
        ("4", "service 读写 SQLite，事务提交"),
        ("5", "返回 JSON；错误统一 {error:{code,message}}"),
    ]
    yy = 2502
    for n, text in http_steps:
        svg.circle_num(126, yy - 5, n, color=BLUE, r=11, size=10)
        svg.text(148, yy, text, size=12.8, fill=MUTED)
        yy += 27
    # ws flow
    svg.rect(90, 2675, 1010, 390, fill=PANEL, stroke=BORDER, rx=14)
    svg.text(112, 2707, "WebSocket 对局链路", size=17, fill=GREEN, weight=700)
    svg.text(112, 2727, "一次动作如何变成双方看到的 update", size=11.5, fill=DIM)
    ws_steps = [
        ("1", "握手：Cookie bgx_sid → sessionUser（io.use）"),
        ("2", "join {matchId} → buildView → snapshot"),
        ("3", "action {actionId, action} → zod 校验"),
        ("4", "matches.applyAction：座位 / 阶段 / 幂等"),
        ("5", "engine.reduce 纯函数推进状态"),
        ("6", "事务：action + event + state + version + seq"),
        ("7", "bus.emit('update') → 逐 socket 重算 view → update"),
    ]
    yy = 2757
    for n, text in ws_steps:
        svg.circle_num(126, yy - 5, n, color=GREEN, r=11, size=10)
        svg.text(148, yy, text, size=12.6, fill=MUTED)
        yy += 27
    svg.text(148, yy + 4, "chat：400ms 限流 → 落库 → 房间广播；重连后重新 join 拿 snapshot", size=11.5, fill=DIM)
    svg.add(f'<line x1="112" y1="{yy + 24}" x2="1078" y2="{yy + 24}" stroke="{BORDER_SOFT}" stroke-width="1"/>')
    svg.text(112, yy + 48, "错误与限流", size=12.5, fill=PINK, weight=700)
    svg.text(112, yy + 72, "统一错误 { code, message, actionId? }；常见 bad_message / not_in_match / game_over / already_queued", size=11.3, fill=MUTED)
    svg.text(112, yy + 94, "动作不做时间限流（幂等键兜底）；聊天 400ms；登录 10 次 / 5 分钟", size=11.3, fill=MUTED)
    # recovery
    svg.rect(90, 3085, 1010, 130, fill=PANEL2, stroke=BORDER, rx=14)
    svg.text(112, 3117, "断线 / 刷新恢复", size=15, fill=AMBER, weight=700)
    svg.text(112, 3142, "客户端不保存权威棋局状态；重连后 join → snapshot", size=12.2, fill=MUTED)
    svg.text(112, 3166, "秘密舰队 / 未结算报点只在本人 view 中出现，不进入对方视图", size=12.2, fill=MUTED)
    svg.text(112, 3190, "SQLite 中 pending 报点也持久化，重启不丢半回合", size=12.2, fill=MUTED)

    # ============ 6. interfaces ============
    svg.section(6, 1168, 2384, "接口清单", "REST + WebSocket；所有入站消息先过 zod", PURPLE)
    # REST
    svg.rect(1140, 2420, 1000, 380, fill=PANEL, stroke=BORDER, rx=14)
    svg.text(1162, 2452, "REST · JSON · Cookie 会话", size=17, fill=BLUE, weight=700)
    svg.text(1162, 2472, "路径均以 /bgx 为前缀；错误：{error:{code,message}}", size=11, fill=DIM)
    rest = [
        ("GET  /healthz", "健康检查"),
        ("GET  /api/me", "当前用户；无会话自动建游客"),
        ("POST /api/me/name", "修改昵称"),
        ("POST /api/auth/register", "注册；游客升级保留 id"),
        ("POST /api/auth/login", "登录；换发 session"),
        ("POST /api/auth/logout", "退出；生成新游客"),
        ("GET  /api/games", "游戏注册表"),
        ("GET  /api/users/:id", "玩家资料 + 历史对局"),
        ("GET  /api/matches?status=", "公开房间列表"),
        ("POST /api/matches", "创建 {gameId, visibility, options}"),
        ("GET  /api/matches/:id", "房间摘要"),
        ("POST /api/matches/:id/join", "入座（等待中）"),
        ("POST /api/matches/:id/start", "房主开始对局"),
        ("POST /api/matches/:id/rematch", "再来一局"),
        ("PATCH /api/matches/:id/options", "房主修改开局选项"),
        ("GET  /api/matches/:id/chat", "聊天历史"),
    ]
    yy = 2502
    for i, (path, desc) in enumerate(rest):
        if i % 2 == 0 and i:
            pass
        svg.text(1162, yy, path, size=11.4, fill=CYAN, family=MONO)
        svg.text(1520, yy, desc, size=11.4, fill=MUTED)
        yy += 21
    # WS
    svg.rect(1140, 2820, 1000, 395, fill=PANEL, stroke=BORDER, rx=14)
    svg.text(1162, 2852, "WebSocket · Socket.IO", size=17, fill=GREEN, weight=700)
    svg.text(1162, 2872, "客户端 → 服务端", size=11.5, fill=GREEN, weight=700)
    c2s = [
        ("join", "{ matchId }"),
        ("action", "{ matchId, actionId, action }"),
        ("chat", "{ matchId, text }"),
        ("leave", "{ matchId }"),
    ]
    yy = 2898
    for name, payload in c2s:
        svg.text(1162, yy, name, size=11.8, fill=TEXT, weight=700, family=MONO)
        svg.text(1240, yy, payload, size=11.4, fill=MUTED, family=MONO)
        yy += 21
    svg.text(1162, 3000, "服务端 → 客户端", size=11.5, fill=BLUE, weight=700)
    s2c = [
        ("snapshot", "{ view }"),
        ("update", "{ view, events }"),
        ("chat", "{ message }"),
        ("rematch", "{ matchId }"),
        ("error", "{ code, message, actionId? }"),
    ]
    yy = 3026
    for name, payload in s2c:
        svg.text(1162, yy, name, size=11.8, fill=TEXT, weight=700, family=MONO)
        svg.text(1260, yy, payload, size=11.4, fill=MUTED, family=MONO)
        yy += 21
    svg.text(1162, 3160, "action 类型：move（黑白棋）· place / fire / resign（炸飞机）", size=11.2, fill=AMBER)
    svg.text(1162, 3182, "actionId 由客户端生成；重复提交返回当前 view，不重复执行", size=11.2, fill=DIM)

    # ============ 7. design ============
    svg.section(7, 88, 3278, "设计要点", "为什么这样拆分，以及新增游戏时接哪里", GREEN)
    design = [
        ("服务端权威", "客户端只发意图；引擎纯函数推进，view 是唯一输出，前端不能改棋局。", GREEN),
        ("按玩家投影", "同一 snapshot 按 userId 裁剪；炸飞机藏舰队与未结算格，观战者结束后看轮廓。", PURPLE),
        ("幂等与恢复", "actionId 唯一键 + 事务；断线重连 snapshot；state + events 可审计与重放。", AMBER),
        ("新游戏接入", "协议/引擎/UI 三件套放进各自 games 目录，自动发现，框架不改。", BLUE),
    ]
    for i, (title, desc, color) in enumerate(design):
        x = 60 + i * 515
        svg.rect(x, 3308, 490, 150, fill=PANEL, stroke=BORDER, rx=14)
        svg.add(f'<rect x="{x}" y="{3308}" width="4" height="150" rx="2" fill="{color}" opacity="0.7"/>')
        svg.text(x + 22, 3342, title, size=15.5, fill=color, weight=700)
        yy2 = 3368
        for line in wrap(desc, 444, 12.0):
            svg.text(x + 22, yy2, line, size=12.0, fill=MUTED)
            yy2 += 19

    # footer
    svg.add(f'<line x1="60" y1="3490" x2="2140" y2="3490" stroke="{BORDER}" stroke-width="1"/>')
    svg.text(70, 3520, "BGX  ·  单服务器部署  ·  代码 /opt/bgx/app  ·  数据 /var/lib/bgx/bgx.db  ·  站点 /var/www/bgx", size=11.5, fill=DIM)
    svg.text(2130, 3520, "架构图 v1.0  ·  2026-11", size=11.5, fill=DIM, anchor="end")

    svg.add("</svg>")
    return svg


def main() -> None:
    svg = build()
    svg_path = OUT_DIR / "bgx-architecture.svg"
    svg_path.write_text("\n".join(svg.parts), encoding="utf-8")

    import cairosvg

    png_path = OUT_DIR / "bgx-architecture.png"
    cairosvg.svg2png(url=str(svg_path), write_to=str(png_path), output_width=W, output_height=H)
    print(png_path)
    print(svg_path)


if __name__ == "__main__":
    main()
