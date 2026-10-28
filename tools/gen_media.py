import numpy as np, cv2, subprocess, sys, os, math
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1440, 900, 30
T = 13.0
N = int(T * FPS)
OUT = sys.argv[2] if len(sys.argv) > 2 else 'media'
GF = '/usr/share/fonts/truetype/google-fonts/'
FB, FM, FR = GF + 'Poppins-Bold.ttf', GF + 'Poppins-Medium.ttf', GF + 'Poppins-Regular.ttf'
FMONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
TAU = 2 * math.pi
_fc, _sc = {}, {}


def font(p, s):
    k = (p, s)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(p, s)
    return _fc[k]


def bgr(c):
    return (int(c[2]), int(c[1]), int(c[0]))


def ip(p):
    return (int(round(p[0])), int(round(p[1])))


def spr(text, size, col, f=FM):
    k = (text, size, col, f)
    if k in _sc:
        return _sc[k]
    ft = font(f, size)
    l, t, r, b = ft.getbbox(text)
    w, h = r + 6, b + size // 3
    im = Image.new('L', (w, h), 0)
    ImageDraw.Draw(im).text((0, 0), text, font=ft, fill=255)
    a = np.asarray(im, np.float32) / 255
    c = np.zeros((h, w, 3), np.uint8)
    c[:] = bgr(col)
    _sc[k] = (c, a)
    return _sc[k]


def blit(img, sp, x, y, a=1.0):
    c, al = sp
    h, w = al.shape
    x, y = int(x), int(y)
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x1 <= x0 or y1 <= y0 or a <= 0:
        return
    al = al[y0 - y:y1 - y, x0 - x:x1 - x] * a
    roi = img[y0:y1, x0:x1].astype(np.float32)
    img[y0:y1, x0:x1] = (roi * (1 - al[..., None]) + c[y0 - y:y1 - y, x0 - x:x1 - x] * al[..., None]).astype(np.uint8)


def text(img, s, x, y, size, col, f=FM, a=1.0):
    blit(img, spr(s, size, col, f), x, y, a)


def rrect(img, x0, y0, x1, y1, r, col, th=-1, a=1.0):
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    cx0, cy0, cx1, cy1 = max(x0 - 2, 0), max(y0 - 2, 0), min(x1 + 2, W), min(y1 + 2, H)
    if cx1 <= cx0 or cy1 <= cy0 or a <= 0:
        return
    roi = img[cy0:cy1, cx0:cx1].copy() if a < 1 else None
    tgt = img
    c = bgr(col)
    r = min(r, (x1 - x0) // 2, (y1 - y0) // 2)
    if th < 0:
        cv2.rectangle(tgt, (x0 + r, y0), (x1 - r, y1), c, -1, cv2.LINE_AA)
        cv2.rectangle(tgt, (x0, y0 + r), (x1, y1 - r), c, -1, cv2.LINE_AA)
        for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
            cv2.circle(tgt, (cx, cy), r, c, -1, cv2.LINE_AA)
    else:
        cv2.line(tgt, (x0 + r, y0), (x1 - r, y0), c, th, cv2.LINE_AA)
        cv2.line(tgt, (x0 + r, y1), (x1 - r, y1), c, th, cv2.LINE_AA)
        cv2.line(tgt, (x0, y0 + r), (x0, y1 - r), c, th, cv2.LINE_AA)
        cv2.line(tgt, (x1, y0 + r), (x1, y1 - r), c, th, cv2.LINE_AA)
        for (cx, cy), ang in (((x0 + r, y0 + r), 180), ((x1 - r, y0 + r), 270), ((x0 + r, y1 - r), 90), ((x1 - r, y1 - r), 0)):
            cv2.ellipse(tgt, (cx, cy), (r, r), 0, ang, ang + 90, c, th, cv2.LINE_AA)
    if roi is not None:
        cur = img[cy0:cy1, cx0:cx1].astype(np.float32)
        img[cy0:cy1, cx0:cx1] = (roi * (1 - a) + cur * a).astype(np.uint8)


class Cv:
    def __init__(s, base):
        s.f = base.copy()
        s.e = np.zeros((H // 4, W // 4, 3), np.uint8)

    def line(s, p, q, col, th=2, glow=0.0):
        cv2.line(s.f, ip(p), ip(q), bgr(col), th, cv2.LINE_AA)
        if glow:
            cv2.line(s.e, ip((p[0] / 4, p[1] / 4)), ip((q[0] / 4, q[1] / 4)), bgr([c * glow for c in col]), max(1, th // 2), cv2.LINE_AA)

    def circ(s, c, r, col, th=-1, glow=0.0):
        if th > 0 and max(col) < 40:
            return
        cv2.circle(s.f, ip(c), int(r), bgr(col), th, cv2.LINE_AA)
        if glow:
            cv2.circle(s.e, ip((c[0] / 4, c[1] / 4)), max(1, int(r / 4)), bgr([x * glow for x in col]), -1 if th < 0 else max(1, th // 3), cv2.LINE_AA)

    def poly(s, pts, col, th=2, closed=False, glow=0.0):
        a = np.array([ip(p) for p in pts], np.int32)
        cv2.polylines(s.f, [a], closed, bgr(col), th, cv2.LINE_AA)
        if glow:
            cv2.polylines(s.e, [a // 4], closed, bgr([c * glow for c in col]), max(1, th // 2), cv2.LINE_AA)

    def done(s, k=1.0):
        g = cv2.GaussianBlur(s.e, (0, 0), 5)
        g = cv2.resize(g, (W, H), interpolation=cv2.INTER_LINEAR)
        return cv2.add(s.f, (g.astype(np.float32) * k).astype(np.uint8))


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def sm(t):
    t = min(1, max(0, t))
    return t * t * (3 - 2 * t)


def mix(c, k):
    return tuple(int(x * k) for x in c)


def bez(p0, p1, p2, t):
    a, b = lerp(p0, p1, t), lerp(p1, p2, t)
    return lerp(a, b, t)


def make_base(sc):
    y = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    c1, c2 = np.array(sc['bg1'], np.float32), np.array(sc['bg2'], np.float32)
    g = (c1 * (1 - y) + c2 * y) * np.ones((1, W, 1), np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    gl = np.exp(-(((xx - 1070) / 460) ** 2 + ((yy - 460) / 400) ** 2))
    g += gl[..., None] * np.array(sc['acc'], np.float32) * 0.16
    img = np.clip(g, 0, 255).astype(np.uint8)[..., ::-1].copy()
    for gx in range(70, W, 70):
        for gy in range(70, H, 70):
            cv2.circle(img, (gx, gy), 1, bgr(mix(sc['acc'], 0.35)), -1)
    cv2.circle(img, (96, 74), 9, bgr(sc['acc']), -1, cv2.LINE_AA)
    text(img, 'godspeed', 116, 52, 28, (240, 240, 244), FB)
    for i, n in enumerate(('work', 'about', 'contact')):
        text(img, n, 1090 + i * 110, 56, 20, (150, 154, 166), FM)
    y0 = 270 - (len(sc['head']) - 3) * 30
    for i, ln in enumerate(sc['head']):
        text(img, ln, 88, y0 + i * 88, 70, (246, 246, 250), FB)
    text(img, sc['sub'], 92, y0 + len(sc['head']) * 88 + 24, 24, (170, 175, 190), FR)
    x = 92
    for t in sc['tags']:
        w = spr(t, 20, (220, 224, 236), FM)[1].shape[1]
        rrect(img, x, 760, x + w + 36, 806, 23, mix(sc['acc'], 0.55), 2)
        text(img, t, x + 18, 766, 20, (226, 230, 240), FM)
        x += w + 52
    return img


# ---------------------------------------------------------------- scenes
def s_target(c, ph, A):
    cx, cy = 1070, 450
    ids = []
    for k in range(4):
        a = TAU * (k + 0.5) / 4
        ids.append((cx + 235 * math.cos(a), cy + 205 * math.sin(a), a))
    links = []
    for (x, y, a) in ids:
        links.append(((cx, cy), (x, y)))
        for j, da in enumerate((-0.62, 0, 0.62)):
            links.append(((x, y), (x + 105 * math.cos(a + da), y + 105 * math.sin(a + da))))
    for p, q in links:
        c.line(p, q, mix(A, 0.4), 2)
    for j, (p, q) in enumerate(links):
        s = ((ph * 3 + j * 0.173) % 1)
        if j % 2:
            s = 1 - s
        c.circ(lerp(p, q, s), 6, (255, 255, 255), -1, 1.0)
    u = (ph * 2) % 1
    c.circ((cx, cy), 36 + 60 * u, mix(A, 1 - u), 2, 0.6)
    c.circ((cx, cy), 36, A, -1, 0.7)
    text(c.f, 'MDF', cx - 24, cy - 17, 22, (6, 12, 18), FB)
    cols = [(120, 180, 255), (255, 190, 90), (200, 140, 255)]
    labs = ('AP', 'POS', 'CAM')
    for k, (x, y, a) in enumerate(ids):
        c.circ((x, y), 24, (30, 36, 52), -1)
        c.circ((x, y), 24, A, 2, 0.4)
        text(c.f, 'IDF', x - 15, y - 12, 16, (230, 235, 245), FB)
        for j, da in enumerate((-0.62, 0, 0.62)):
            lx, ly = x + 105 * math.cos(a + da), y + 105 * math.sin(a + da)
            c.circ((lx, ly), 13, cols[j], -1, 0.5)
            text(c.f, labs[j], lx - 12, ly + 15, 13, (170, 176, 190), FM)


def s_sdwan(c, ph, A):
    hub = (880, 460)
    stores = [(1290, 190 + k * 100) for k in range(7)]
    lat = ['12 ms', '9 ms', '14 ms', '11 ms', '8 ms', '15 ms', '10 ms']
    for k, st in enumerate(stores):
        mid = (1090, (hub[1] + st[1]) / 2 + (k - 3) * 22)
        pts = [bez(hub, mid, st, i / 60) for i in range(61)]
        for i in range(60):
            if ((i - int(ph * 40)) % 4) < 2:
                c.line(pts[i], pts[i + 1], mix(A, 0.85), 3, 0.5)
        s = (ph * 2 + k / 7) % 1
        c.circ(bez(hub, mid, st, s), 7, (255, 255, 255), -1, 1.0)
        c.circ(st, 15, (24, 30, 46), -1)
        c.circ(st, 15, A, 2, 0.5)
        text(c.f, 'S%02d' % (k + 1), st[0] - 14, st[1] - 10, 14, (225, 230, 240), FB)
        text(c.f, lat[k], st[0] + 24, st[1] - 12, 17, (150, 160, 178), FM)
    u = (ph * 2) % 1
    c.circ(hub, 44 + 40 * u, mix(A, 1 - u), 2, 0.6)
    c.circ(hub, 44, A, -1, 0.7)
    text(c.f, 'HQ', hub[0] - 18, hub[1] - 22, 28, (6, 12, 20), FB)
    text(c.f, 'SD-WAN', hub[0] - 40, hub[1] + 60, 20, (210, 216, 232), FB)


_chat = None


def s_slack(c, ph, A):
    global _chat
    msgs = [('Store T-1423', 'POS lane 4 is offline', 0), ('Kinettix NOC', 'On it. Checking the switch port and VLAN.', 1),
            ('Kinettix NOC', 'Port was flapping. Config fixed, link is up.', 1), ('Store T-1423', 'Lane 4 is back. Thank you!', 0),
            ('Kinettix NOC', 'Ticket closed in 4 minutes.', 1)]
    if _chat is None:
        _chat = []
        for who, tx, noc in msgs:
            bw = 330 if len(tx) < 26 else 520
            im = Image.new('RGB', (bw, 84), (0, 0, 0))
            d = ImageDraw.Draw(im)
            d.rounded_rectangle([0, 0, bw - 1, 83], 14, fill=(52, 70, 60) if noc else (40, 44, 58))
            d.text((16, 8), who, font=font(FB, 17), fill=(150, 235, 180) if noc else (160, 170, 200))
            d.text((16, 38), tx, font=font(FM, 21), fill=(236, 240, 246))
            a = np.zeros((84, bw), np.float32)
            m = Image.new('L', (bw, 84), 0)
            ImageDraw.Draw(m).rounded_rectangle([0, 0, bw - 1, 83], 14, fill=255)
            _chat.append((np.asarray(im)[..., ::-1].copy(), np.asarray(m, np.float32) / 255, bw))
    rrect(c.f, 780, 150, 1370, 770, 22, (20, 22, 30))
    rrect(c.f, 780, 150, 1370, 770, 22, mix(A, 0.5), 2)
    text(c.f, '# target-escalations', 808, 168, 22, (230, 234, 244), FB)
    c.circ((1340, 190), 7, A, -1, 0.9)
    fade = 1 - sm((ph - 0.9) / 0.09)
    for k, (bgi, m, bw) in enumerate(_chat):
        t0 = 0.07 + 0.165 * k
        a = sm((ph - t0) / 0.035) * fade
        if a <= 0:
            continue
        y = 224 + k * 100 + int(14 * (1 - sm((ph - t0) / 0.035)))
        x = 810 if not msgs[k][2] else 1340 - bw
        blit(c.f, (bgi, m), x, y, a)


def s_switch(c, ph, A):
    rrect(c.f, 780, 210, 1370, 440, 16, (28, 31, 42))
    rrect(c.f, 780, 210, 1370, 440, 16, (70, 76, 96), 2)
    text(c.f, 'CATALYST  24-PORT', 806, 222, 18, (170, 176, 192), FB)
    vl = [(74, 222, 128), (90, 170, 255), (255, 190, 90), (200, 140, 255)]
    for r in range(2):
        for i in range(12):
            x, y = 806 + i * 46, 276 + r * 74
            k = r * 12 + i
            col = vl[k % 4]
            br = 0.35 + 0.65 * (0.5 + 0.5 * math.sin(TAU * (1 + k % 4) * ph + k * 1.7))
            rrect(c.f, x, y + 18, x + 34, y + 50, 4, (12, 14, 20))
            c.circ((x + 17, y + 6), 5, mix(col, br), -1, br * 0.6)
    for k in range(6):
        x = 823 + k * 92
        c.line((x, 350), (x, 560), mix(vl[k % 4], 0.7), 3)
        s = (ph * 2 + k * 0.21) % 1
        c.circ((x, 350 + 210 * s), 5, (255, 255, 255), -1, 0.9)
    for i in range(24):
        h = 20 + 70 * (0.5 + 0.5 * math.sin(TAU * (1 + i % 3) * ph + i * 0.9))
        x = 806 + i * 23
        cv2.rectangle(c.f, (x, int(700 - h)), (x + 15, 700), bgr(mix(vl[i % 4], 0.85)), -1)
    for i, n in enumerate(('VLAN 10', 'VLAN 20', 'VLAN 30', 'VLAN 40')):
        c.circ((812 + i * 140, 735), 6, vl[i], -1)
        text(c.f, n, 826 + i * 140, 722, 16, (190, 196, 210), FM)


def s_wifi(c, ph, A):
    cv2.rectangle(c.f, (790, 170), (1360, 760), bgr((70, 78, 98)), 2, cv2.LINE_AA)
    for (p, q) in (((790, 400), (1010, 400)), ((1010, 170), (1010, 400)), ((1180, 400), (1360, 400)), ((1180, 400), (1180, 600)), ((1010, 600), (1010, 760)), ((790, 600), (1010, 600))):
        c.line(p, q, (70, 78, 98), 2)
    aps = [(900, 285), (1270, 285), (1095, 500), (900, 680), (1270, 640)]
    for j, p in enumerate(aps):
        for r in range(3):
            u = (ph * 2 + r / 3 + j * 0.13) % 1
            c.circ(p, 20 + 150 * u, mix(A, (1 - u) * 0.9), 2, 0.5)
        c.circ(p, 12, A, -1, 0.9)
    for k in range(8):
        x = 1075 + 250 * math.sin(TAU * (1 + k % 3) * ph + k * 1.3) * (0.9 if k % 2 else 0.7)
        y = 465 + 250 * math.cos(TAU * (1 + (k + 1) % 3) * ph + k * 0.8) * 0.9
        x, y = min(max(x, 810), 1340), min(max(y, 190), 740)
        near = min(aps, key=lambda p: (p[0] - x) ** 2 + (p[1] - y) ** 2)
        c.line((x, y), near, mix(A, 0.35), 1)
        c.circ((x, y), 7, (255, 255, 255), -1, 0.7)
    text(c.f, 'MIST  /  MERAKI', 808, 718, 16, (170, 176, 192), FB)


def s_cctv(c, ph, A):
    hot = int(ph * 9)
    for r in range(3):
        for i in range(3):
            k = r * 3 + i
            x0, y0 = 772 + i * 204, 190 + r * 164
            cv2.rectangle(c.f, (x0, y0), (x0 + 190, y0 + 150), bgr((14, 17, 24)), -1)
            for yy in range(0, 150, 3):
                cv2.line(c.f, (x0, y0 + yy), (x0 + 190, y0 + yy), bgr((18 + yy // 12, 22 + yy // 12, 30 + yy // 10)), 3)
            px = x0 + 95 + 55 * math.sin(TAU * (1 + k % 2) * ph + k)
            cv2.circle(c.f, (int(px), y0 + 62), 12, bgr((70, 78, 98)), -1, cv2.LINE_AA)
            cv2.ellipse(c.f, (int(px), y0 + 118), (22, 40), 0, 180, 360, bgr((70, 78, 98)), -1, cv2.LINE_AA)
            sy = y0 + int(150 * ((ph * 2 + k * 0.11) % 1))
            cv2.line(c.f, (x0, sy), (x0 + 190, sy), bgr(mix(A, 0.55)), 1)
            on = 1 if (int(ph * 8 + k * 0.5) % 2 == 0) else 0.25
            c.circ((x0 + 16, y0 + 16), 5, mix((255, 70, 70), on), -1, on * 0.5)
            text(c.f, 'CAM %02d' % (k + 1), x0 + 28, y0 + 5, 14, (200, 206, 220), FM)
            if k == hot:
                cv2.rectangle(c.f, (x0, y0), (x0 + 190, y0 + 150), bgr(A), 3, cv2.LINE_AA)
                cv2.rectangle(c.e, (x0 // 4, y0 // 4), ((x0 + 190) // 4, (y0 + 150) // 4), bgr(A), 2)
    text(c.f, 'LIVE  -  AIU CENTRE BACOLOD', 774, 700, 18, (200, 206, 220), FB)
    c.circ((1360, 710), 6, (255, 70, 70), -1, 0.8)


def s_branches(c, ph, A):
    rng = np.random.default_rng(4)

    def isl(cx, cy, rx, ry, seed):
        r = np.random.default_rng(seed)
        ph0 = r.uniform(0, TAU, 4)
        pts = []
        for a in np.linspace(0, TAU, 40, endpoint=False):
            k = 1 + 0.18 * math.sin(2 * a + ph0[0]) + 0.1 * math.sin(3 * a + ph0[1]) + 0.06 * math.sin(5 * a + ph0[2])
            pts.append((cx + rx * k * math.cos(a), cy + ry * k * math.sin(a)))
        return pts
    for pts in (isl(930, 560, 120, 150, 1), isl(1230, 300, 90, 110, 2), isl(1010, 250, 70, 80, 3), isl(1260, 620, 80, 90, 5)):
        a = np.array([ip(p) for p in pts], np.int32)
        cv2.fillPoly(c.f, [a], bgr((26, 32, 46)), cv2.LINE_AA)
        cv2.polylines(c.f, [a], True, bgr((70, 78, 100)), 2, cv2.LINE_AA)
    sites = [((930, 560), 'Bacolod SJA'), ((1230, 290), 'Masbate Palanas'), ((1270, 340), 'Masbate Placers'), ((1010, 250), 'Mindoro'), ((1260, 625), 'Teresita Hospital')]
    hub = (1100, 450)
    for k, (p, n) in enumerate(sites):
        c.line(hub, p, mix(A, 0.35), 1)
        s = (ph * 2 + k * 0.2) % 1
        c.circ(lerp(hub, p, s), 4, (255, 255, 255), -1, 0.8)
        u = (ph * 2 + k * 0.2) % 1
        c.circ(p, 8 + 26 * u, mix(A, 1 - u), 2, 0.5)
        c.circ(p, 8, A, -1, 0.9)
    c.circ(hub, 16, (255, 255, 255), -1, 0.7)
    text(c.f, 'NVR', hub[0] - 16, hub[1] + 22, 16, (220, 226, 238), FB)
    lbl = [(850, 600), (1255, 255), (1290, 355), (1030, 215), (1190, 668)]
    for (p, n), (lx, ly) in zip(sites, lbl):
        text(c.f, n, lx, ly, 17, (210, 216, 232), FM)


_cards = None


def s_kanban(c, ph, A):
    global _cards
    names = ['RMA-1042  AP replace', 'RMA-1043  Switch swap', 'TKT-2210  POS offline', 'TKT-2211  Printer fix', 'RMA-1044  UPS check']
    if _cards is None:
        _cards = []
        for n in names:
            im = Image.new('RGB', (176, 78), (0, 0, 0))
            d = ImageDraw.Draw(im)
            d.rounded_rectangle([0, 0, 175, 77], 12, fill=(34, 38, 52), outline=(70, 80, 104), width=2)
            d.text((12, 10), n.split('  ')[0], font=font(FB, 16), fill=(150, 235, 180))
            d.text((12, 38), n.split('  ')[1], font=font(FM, 16), fill=(226, 230, 240))
            m = Image.new('L', (176, 78), 0)
            ImageDraw.Draw(m).rounded_rectangle([0, 0, 175, 77], 12, fill=255)
            _cards.append((np.asarray(im)[..., ::-1].copy(), np.asarray(m, np.float32) / 255))
    cx = [772, 978, 1184]
    for i, n in enumerate(('OPEN', 'IN PROGRESS', 'RESOLVED')):
        rrect(c.f, cx[i], 180, cx[i] + 196, 740, 16, (20, 23, 32))
        text(c.f, n, cx[i] + 16, 192, 16, (170, 176, 192), FB)
    for k in range(5):
        u = ((ph + k / 5) % 1) * 3
        seg = int(u)
        f = sm((u - seg - 0.45) / 0.45)
        x = cx[seg] + (cx[min(seg + 1, 2)] - cx[seg]) * f + 10 if seg < 2 else cx[2] + 10
        a = 1.0
        if seg == 2:
            a = 1 - sm((u - 2.55) / 0.45)
        if seg == 0:
            a = sm(u / 0.25)
        y = 240 + (k * 97) % 460
        blit(c.f, _cards[k], x, y, a)


def s_cable(c, ph, A):
    cv2.rectangle(c.f, (780, 160), (1370, 760), bgr((60, 90, 150)), 2, cv2.LINE_AA)
    for gx in range(780, 1371, 40):
        cv2.line(c.f, (gx, 160), (gx, 760), bgr((24, 44, 84)), 1)
    for gy in range(160, 761, 40):
        cv2.line(c.f, (780, gy), (1370, gy), bgr((24, 44, 84)), 1)
    for (p, q) in (((780, 380), (1000, 380)), ((1000, 160), (1000, 380)), ((1180, 380), (1370, 380)), ((1180, 380), (1180, 620)), ((1000, 620), (1000, 760)), ((780, 620), (1180, 620))):
        c.line(p, q, (110, 150, 220), 3)
    P = [(820, 200), (960, 200), (960, 330), (1100, 330), (1100, 500), (1260, 500), (1260, 680), (1120, 680), (1120, 720)]
    g = sm((ph - 0.05) / 0.7) * (len(P) - 1)
    fade = 1 - sm((ph - 0.9) / 0.09)
    pts = [P[0]]
    for i in range(len(P) - 1):
        if g >= i + 1:
            pts.append(P[i + 1])
        elif g > i:
            pts.append(lerp(P[i], P[i + 1], g - i))
            break
    if len(pts) > 1:
        c.poly(pts, mix(A, fade), 4, False, 0.8 * fade)
    for i, p in enumerate(P):
        if g >= i and fade > 0.05:
            c.circ(p, 9, mix((255, 255, 255), fade), -1, 0.6 * fade)
            if i % 2 == 0:
                text(c.f, 'CAM-%02d' % (i // 2 + 1), p[0] + 14, p[1] - 28, 15, mix((200, 215, 245), fade), FM)
    text(c.f, 'FREECAD  -  CABLE PLAN  1:50', 786, 722, 16, (150, 180, 235), FB)


def s_itil(c, ph, A):
    cx, cy = 1070, 440
    cols = [(74, 222, 128), (90, 170, 255), (255, 190, 90), (200, 140, 255), (255, 120, 150), (110, 230, 230)]
    labs = ['Plan', 'Improve', 'Engage', 'Design', 'Build', 'Deliver']
    for k in range(6):
        a0 = k * 60 + 4
        cv2.ellipse(c.f, (cx, cy), (190, 190), 0, a0, a0 + 52, bgr(mix(cols[k], 0.45)), 26, cv2.LINE_AA)
        mid = math.radians(k * 60 + 30)
        text(c.f, labs[k], int(cx + 248 * math.cos(mid) - 24), int(cy + 248 * math.sin(mid) - 12), 18, (210, 216, 232), FM)
    ang = (ph * 360) % 360
    cv2.ellipse(c.f, (cx, cy), (190, 190), 0, ang - 22, ang + 22, bgr((255, 255, 255)), 26, cv2.LINE_AA)
    cv2.ellipse(c.e, (cx // 4, cy // 4), (47, 47), 0, ang - 22, ang + 22, bgr((200, 200, 200)), 8, cv2.LINE_AA)
    c.circ((cx, cy), 120, (18, 21, 30), -1)
    c.circ((cx, cy), 120, A, 2, 0.4)
    text(c.f, 'ITIL', cx - 62, cy - 62, 62, (246, 246, 250), FB)
    text(c.f, 'Level 4', cx - 52, cy + 14, 30, A, FB)
    rrect(c.f, 900, 722, 1240, 764, 21, mix(A, 0.5), 2)
    text(c.f, 'Alison  -  Certified  Oct 2026', 918, 728, 18, (220, 226, 238), FM)


def s_security(c, ph, A):
    sx, sy = 1060, 440
    shield = [(sx, sy - 190), (sx + 140, sy - 130), (sx + 140, sy + 20), (sx, sy + 190), (sx - 140, sy + 20), (sx - 140, sy - 130)]
    a = np.array([ip(p) for p in shield], np.int32)
    cv2.fillPoly(c.f, [a], bgr((18, 24, 36)), cv2.LINE_AA)
    c.poly(shield, A, 4, True, 0.9)
    ly = sy - 170 + 340 * ((ph * 2) % 1)
    c.line((sx - 120, ly), (sx + 120, ly), mix(A, 0.6), 2, 0.5)
    cv2.rectangle(c.f, (sx - 34, sy - 10), (sx + 34, sy + 52), bgr(A), -1, cv2.LINE_AA)
    cv2.ellipse(c.f, (sx, sy - 10), (22, 28), 0, 180, 360, bgr(A), 8, cv2.LINE_AA)
    c.circ((sx, sy + 22), 7, (10, 16, 24), -1)
    lanes = [250, 330, 410, 490, 570, 650]
    for k, ly in enumerate(lanes):
        bad = k % 2 == 0
        c.line((790, ly), (1350, ly), (34, 40, 56), 1)
        s = (ph * 2 + k * 0.23) % 1
        x = 790 + 560 * s
        if bad:
            if x < sx - 150:
                c.circ((x, ly), 8, (255, 90, 90), -1, 0.9)
            elif x < sx - 90:
                r = (x - (sx - 150)) * 1.2 + 8
                c.circ((sx - 150, ly), r, (255, 90, 90), 2, 0.8)
        else:
            c.circ((x, ly), 8, (140, 255, 180), -1, 0.9)
    text(c.f, 'BLOCKED', 790, 215, 15, (255, 110, 110), FB)
    text(c.f, 'ALLOWED', 1270, 215, 15, (140, 255, 180), FB)


_code = None


def s_vibe(c, ph, A):
    global _code
    lines = [[('const ', (200, 140, 255)), ('portfolio', (120, 200, 255)), (' = ', (220, 224, 236)), ('vibe', (255, 200, 110)), ('(', (220, 224, 236)), ('"Godspeed"', (150, 235, 160)), (');', (220, 224, 236))],
             [('await ', (200, 140, 255)), ('ai', (120, 200, 255)), ('.build({', (220, 224, 236))],
             [('  stack', (120, 200, 255)), (': ', (220, 224, 236)), ('"react"', (150, 235, 160)), (',', (220, 224, 236))],
             [('  pages', (120, 200, 255)), (': ', (220, 224, 236)), ('["about","work"]', (150, 235, 160))],
             [('});', (220, 224, 236))],
             [('// networks . automation . web', (110, 120, 140))],
             [('deploy', (255, 200, 110)), ('(portfolio)', (220, 224, 236))],
             [('  .to(', (220, 224, 236)), ('"github-pages"', (150, 235, 160)), (');', (220, 224, 236))]]
    if _code is None:
        _code = []
        for ln in lines:
            full = ''.join(t for t, _ in ln)
            w = int(font(FMONO, 24).getlength(full)) + 8
            im = Image.new('RGB', (w, 34), (0, 0, 0))
            m = Image.new('L', (w, 34), 0)
            x = 0
            for t, col in ln:
                ImageDraw.Draw(im).text((x, 2), t, font=font(FMONO, 24), fill=col)
                ImageDraw.Draw(m).text((x, 2), t, font=font(FMONO, 24), fill=255)
                x += font(FMONO, 24).getlength(t)
            _code.append((np.asarray(im)[..., ::-1].copy(), np.asarray(m, np.float32) / 255, w))
    rrect(c.f, 770, 150, 1380, 770, 20, (16, 18, 26))
    rrect(c.f, 770, 150, 1380, 770, 20, mix(A, 0.5), 2)
    for i, col in enumerate(((255, 95, 90), (255, 190, 60), (40, 200, 80))):
        c.circ((800 + i * 26, 182), 7, col, -1)
    rrect(c.f, 800, 214, 1350, 262, 24, (30, 34, 48))
    text(c.f, 'prompt:  build my portfolio, make it fast', 822, 222, 20, (190, 200, 225), FM)
    fade = 1 - sm((ph - 0.9) / 0.09)
    cur = None
    for k, (bgi, m, w) in enumerate(_code):
        t0 = 0.1 + k * 0.095
        f = min(1, max(0, (ph - t0) / 0.085))
        if f <= 0:
            continue
        vw = max(1, int(w * f))
        blit(c.f, (bgi[:, :vw], m[:, :vw]), 810, 300 + k * 48, fade)
        if f < 1:
            cur = (810 + vw, 300 + k * 48)
        elif k == len(_code) - 1:
            cur = (810 + w, 300 + k * 48)
    if cur and fade > 0.2 and int(ph * 30) % 2 == 0:
        cv2.rectangle(c.f, (cur[0] + 2, cur[1] + 2), (cur[0] + 14, cur[1] + 30), bgr(A), -1)


def s_ai(c, ph, A):
    nodes = {'in': (860, 450, 'Ticket In'), 'ai': (1070, 450, 'AI Triage'), 'sl': (1280, 290, 'Notify Slack'), 'rm': (1280, 450, 'Update RMA'), 'ok': (1280, 610, 'Resolve')}
    edges = [('in', 'ai'), ('ai', 'sl'), ('ai', 'rm'), ('ai', 'ok')]
    for a, b in edges:
        pa, pb = nodes[a][:2], nodes[b][:2]
        mid = ((pa[0] + pb[0]) / 2, pa[1])
        pts = [bez(pa, (pb[0], pa[1]) if a == 'ai' and b != 'rm' else mid, pb, i / 40) for i in range(41)]
        c.poly(pts, mix(A, 0.45), 3)
    for j, (a, b) in enumerate(edges):
        pa, pb = nodes[a][:2], nodes[b][:2]
        ctrl = (pb[0], pa[1]) if a == 'ai' and b != 'rm' else ((pa[0] + pb[0]) / 2, pa[1])
        s = (ph * 2 + j * 0.25) % 1
        c.circ(bez(pa, ctrl, pb, s), 7, (255, 255, 255), -1, 1.0)
    for k, (x, y, n) in nodes.items():
        pulse = 0.5 + 0.5 * math.sin(TAU * 2 * ph - (0 if k == 'in' else 1.2 if k == 'ai' else 2.4))
        rrect(c.f, x - 80, y - 36, x + 80, y + 36, 16, (24, 28, 40))
        rrect(c.f, x - 80, y - 36, x + 80, y + 36, 16, mix(A, 0.5 + 0.5 * pulse), 2)
        text(c.f, n, x - 66, y - 16, 22, (236, 240, 248), FB)
        cv2.rectangle(c.e, ((x - 80) // 4, (y - 36) // 4), ((x + 80) // 4, (y + 36) // 4), bgr(mix(A, 0.5 * pulse)), -1)


def s_web(c, ph, A):
    rrect(c.f, 770, 150, 1380, 770, 20, (232, 234, 240))
    rrect(c.f, 770, 150, 1380, 200, 20, (214, 217, 226))
    for i, col in enumerate(((255, 95, 90), (255, 190, 60), (40, 200, 80))):
        c.circ((798 + i * 24, 175), 6, col, -1)
    rrect(c.f, 900, 160, 1300, 190, 14, (246, 247, 250))
    text(c.f, 'yourbrand.com', 920, 160, 17, (120, 124, 140), FM)
    fade = 1 - sm((ph - 0.92) / 0.07)
    blocks = [(790, 220, 1360, 400, A, 0.1), (790, 420, 960, 600, (90, 170, 255), 0.22), (985, 420, 1155, 600, (255, 190, 90), 0.3), (1180, 420, 1360, 600, (200, 140, 255), 0.38)]
    for (x0, y0, x1, y1, col, t0) in blocks:
        a = sm((ph - t0) / 0.06) * fade
        if a > 0:
            dy = int(30 * (1 - sm((ph - t0) / 0.06)))
            rrect(c.f, x0, y0 + dy, x1, y1 + dy, 14, col, -1, a)
    for k, (w, t0) in enumerate(((540, 0.46), (420, 0.5), (480, 0.54))):
        a = sm((ph - t0) / 0.05) * fade
        if a > 0:
            rrect(c.f, 790, 630 + k * 40, 790 + w, 650 + k * 40, 8, (176, 180, 194), -1, a)
    text(c.f, 'Hello, I build things.', 812, 276, 40, (255, 255, 255), FB) if fade > 0.5 and ph > 0.13 else None
    tgt = [(900, 300), (1070, 520), (1260, 520), (1000, 660), (900, 300)]
    u = ph * 4
    seg = min(int(u), 3)
    p = lerp(tgt[seg], tgt[seg + 1], sm(u - seg))
    cv2.fillPoly(c.f, [np.array([ip(p), ip((p[0] + 4, p[1] + 26)), ip((p[0] + 12, p[1] + 19)), ip((p[0] + 22, p[1] + 20))], np.int32)], bgr((20, 22, 30)), cv2.LINE_AA)


SCENES = [
    dict(slug='target-network', title='target network', fn=s_target, start=7.0, bg1=(5, 10, 16), bg2=(4, 22, 22), acc=(74, 222, 128), head=['Target store', 'networks,', 'kept online.'], sub='Network Admin  -  Kinettix Inc.', tags=['MDF / IDF', 'Switches', 'Wi-Fi', 'POS']),
    dict(slug='sd-wan', title='sd-wan', fn=s_sdwan, start=6.0, bg1=(6, 9, 20), bg2=(8, 14, 36), acc=(90, 170, 255), head=['SD-WAN', 'installed &', 'tuned.'], sub='Install, configure, troubleshoot', tags=['SD-WAN', 'Tunnels', 'Uptime']),
    dict(slug='slack-escalation', title='slack escalation', fn=s_slack, start=8.5, bg1=(14, 8, 20), bg2=(24, 10, 34), acc=(200, 140, 255), head=['Fast Slack', 'escalation', 'support.'], sub='On-point support for Target stores', tags=['Slack', 'Queues', 'Email']),
    dict(slug='cisco-edgecore', title='cisco & edgecore', fn=s_switch, start=5.0, bg1=(8, 12, 20), bg2=(6, 20, 30), acc=(110, 230, 230), head=['Cisco &', 'Edgecore', 'switching.'], sub='Switches, DHCP and VLANs', tags=['Cisco', 'Edgecore', 'VLAN', 'DHCP']),
    dict(slug='mist-meraki', title='mist & meraki', fn=s_wifi, start=4.0, bg1=(6, 12, 14), bg2=(8, 26, 26), acc=(90, 230, 190), head=['Wi-Fi that', 'just works.'], sub='Cisco, Mist and Meraki access points', tags=['Mist', 'Meraki', 'Coverage']),
    dict(slug='aiu-centre-cctv', title='aiu centre cctv', fn=s_cctv, start=3.0, bg1=(14, 8, 8), bg2=(26, 10, 12), acc=(255, 110, 110), head=['AIU Centre', 'CCTV', 'rollout.'], sub='Led by IT Specialist  -  Teranova', tags=['IP cameras', 'NAS', 'Install']),
    dict(slug='cctv-branches', title='cctv branches', fn=s_branches, start=6.5, bg1=(8, 10, 22), bg2=(10, 16, 38), acc=(120, 160, 255), head=['CCTV across', 'branches &', 'hospitals.'], sub='Bread Box Negros and more', tags=['Bacolod', 'Masbate', 'Mindoro']),
    dict(slug='ticketing-rma', title='ticketing & rma', fn=s_kanban, start=5.5, bg1=(14, 12, 6), bg2=(30, 20, 8), acc=(255, 190, 90), head=['Tickets &', 'RMA, sorted.'], sub='Warranty processing in QuickBooks', tags=['Tickets', 'RMA', 'Helpdesk']),
    dict(slug='cable-plans', title='cable plans', fn=s_cable, start=7.5, bg1=(6, 12, 32), bg2=(8, 22, 58), acc=(110, 160, 255), head=['Cable plans', 'drawn in', 'FreeCAD.'], sub='Clean cable installation plans', tags=['FreeCAD', 'Layouts', 'Cabling']),
    dict(slug='itil-4', title='itil 4', fn=s_itil, start=6.0, bg1=(8, 12, 20), bg2=(12, 20, 34), acc=(74, 222, 128), head=['ITIL 4', 'service', 'management.'], sub='IT Service Management and ITIL Level 4', tags=['ITSM', 'ITIL 4', 'Alison']),
    dict(slug='network-security', title='network security', fn=s_security, start=5.0, bg1=(6, 8, 14), bg2=(8, 20, 24), acc=(74, 222, 160), head=['Digital', 'network', 'security.'], sub='Computer Networking - Digital Network Security', tags=['Firewall', 'Threats', 'Alison']),
    dict(slug='vibe-coding', title='vibe coding', fn=s_vibe, start=9.0, bg1=(12, 8, 22), bg2=(22, 12, 40), acc=(190, 130, 255), head=['Vibe coding', 'ideas into', 'apps.'], sub='AI-assisted building, shipped fast', tags=['AI', 'React', 'Deploy']),
    dict(slug='ai-automation', title='ai automation', fn=s_ai, start=4.5, bg1=(6, 12, 18), bg2=(8, 26, 30), acc=(80, 220, 210), head=['AI-powered', 'workflows', 'that run.'], sub='Automate the busywork', tags=['Triage', 'Slack', 'Flows']),
    dict(slug='website-creation', title='website creation', fn=s_web, start=8.0, bg1=(14, 10, 8), bg2=(30, 16, 12), acc=(255, 150, 90), head=['Websites', 'built fast', 'and clean.'], sub='Responsive sites for your brand', tags=['Design', 'Build', 'Launch']),
]


def render(sc, ph):
    c = Cv(sc['_base'])
    sc['fn'](c, ph, sc['acc'])
    return c.done(0.9)


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    os.makedirs(OUT, exist_ok=True)
    for sc in SCENES:
        if which not in ('all', sc['slug']) and not which.startswith('test'):
            continue
        sc['_base'] = make_base(sc)
        if which.startswith('test'):
            fr = [render(sc, p) for p in (0.35, 0.7)]
            Image.fromarray(np.hstack([f[..., ::-1] for f in fr]).astype(np.uint8)).resize((1440, 450)).save('%s/test_%s.png' % (OUT, sc['slug']))
            continue
        p = Image.fromarray(render(sc, (sc['start'] / T) % 1)[..., ::-1])
        p.save('%s/case-%s-1440.webp' % (OUT, sc['slug']), quality=84)
        p.resize((960, 600), Image.LANCZOS).save('%s/case-%s-960.webp' % (OUT, sc['slug']), quality=84)
        pr = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '%dx%d' % (W, H), '-r', str(FPS), '-i', '-',
                               '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '%s/case-%s.mp4' % (OUT, sc['slug'])], stdin=subprocess.PIPE)
        for i in range(N):
            pr.stdin.write(render(sc, i / N).tobytes())
        pr.stdin.close()
        pr.wait()
        print('done', sc['slug'], flush=True)


main()
