#!/usr/bin/env python3
"""Procedural risograph-style book covers for Farsh!

Matches the style of the existing 12 covers: flat poster shapes, the site's
4-ink palette, uniform multicolor speckle grain, occasional misregistration
offsets. 1200x1600 JPEG output.
"""
import math
import os
import random
import sys

from PIL import Image, ImageDraw

W, H = 1200, 1600
CREAM = (245, 234, 216)   # f5ead8
TERRA = (198, 113, 57)    # c67139
BROWN = (64, 35, 16)      # 402310
GREEN = (77, 96, 51)      # sage, matched to the existing covers' green fields
INKS = [CREAM, TERRA, BROWN, GREEN, (255, 255, 255)]

OUT = sys.argv[1] if len(sys.argv) > 1 else "."


def canvas(bg=CREAM):
    img = Image.new("RGB", (W, H), bg)
    return img, ImageDraw.Draw(img)


def grain(img, density=0.016, seed=1):
    """Uniform multicolor speckle over the whole image, like riso print grain."""
    rnd = random.Random(seed)
    d = ImageDraw.Draw(img)
    n = int(W * H * density / 4)  # each speck ~2x2
    for _ in range(n):
        x = rnd.randrange(W)
        y = rnd.randrange(H)
        c = rnd.choice(INKS)
        s = rnd.choice((1, 2, 2, 3))
        d.rectangle([x, y, x + s - 1, y + s - 1], fill=c)


def rounded(d, box, r, fill):
    d.rounded_rectangle(box, radius=r, fill=fill)


# ----------------------------------------------------------------------------
def night_you_arrived():
    img, d = canvas(GREEN)
    # ground
    d.rectangle([0, 1060, W, H], fill=CREAM)
    # moon with slight misregistration ghost
    d.ellipse([390 + 10, 110 + 8, 810 + 10, 530 + 8], fill=TERRA)
    d.ellipse([390, 110, 810, 530], fill=CREAM)
    # stars
    rnd = random.Random(7)
    for _ in range(26):
        x, y = rnd.randrange(40, W - 40), rnd.randrange(30, 1000)
        if 330 < x < 900 and 60 < y < 590:
            continue
        s = rnd.choice((3, 4, 5, 6))
        d.ellipse([x, y, x + s, y + s], fill=CREAM)
    # house roof (terracotta outer, brown inner)
    d.polygon([(225, 895), (975, 895), (600, 560)], fill=TERRA)
    d.polygon([(322, 862), (878, 862), (600, 622)], fill=BROWN)
    # house body
    d.rectangle([330, 895, 870, 1255], fill=TERRA)
    # lit window: cream frame + warm glow
    d.rectangle([392, 940, 570, 1115], fill=CREAM)
    d.rectangle([420, 968, 542, 1087], fill=TERRA)
    d.line([(481, 968), (481, 1087)], fill=CREAM, width=8)
    d.line([(420, 1027), (542, 1027)], fill=CREAM, width=8)
    # door
    d.rectangle([645, 990, 805, 1255], fill=BROWN)
    d.rectangle([700, 1105, 712, 1140], fill=CREAM)
    # ground line
    d.rectangle([185, 1248, 1015, 1262], fill=BROWN)
    # two baby shoes on the step, left of the door
    for x0 in (352, 462):
        d.rounded_rectangle([x0, 1155, x0 + 88, 1246], radius=30, fill=BROWN)
        d.ellipse([x0 + 8, 1196, x0 + 80, 1250], fill=BROWN)
        d.rectangle([x0, 1238, x0 + 88, 1250], fill=CREAM)
        d.line([(x0 + 24, 1176), (x0 + 62, 1176)], fill=CREAM, width=7)
    grain(img, seed=11)
    return img


def great_adventure():
    img, d = canvas(CREAM)
    # morning sun, misregistered ghost
    d.ellipse([905 + 9, 120 + 7, 1105 + 9, 320 + 7], fill=BROWN)
    d.ellipse([905, 120, 1105, 320], fill=TERRA)
    # birds
    for (bx, by) in ((300, 260), (480, 180), (680, 300)):
        d.arc([bx, by, bx + 60, by + 44], 200, 340, fill=BROWN, width=9)
        d.arc([bx + 52, by, bx + 112, by + 44], 200, 340, fill=BROWN, width=9)
    # stone wall
    d.rectangle([0, 700, W, 1420], fill=TERRA)
    # mortar courses
    for i, y in enumerate(range(700, 1420, 120)):
        d.line([(0, y), (W, y)], fill=BROWN, width=10)
        off = 0 if i % 2 == 0 else 150
        for x in range(off, W + 1, 300):
            d.line([(x, y), (x, min(y + 120, 1420))], fill=BROWN, width=10)
    # round green door set into the wall
    d.ellipse([370, 790, 830, 1250], fill=BROWN)
    d.rectangle([370, 1020, 830, 1420], fill=BROWN)
    d.ellipse([400, 820, 800, 1220], fill=GREEN)
    d.rectangle([400, 1020, 800, 1390], fill=GREEN)
    d.line([(600, 830), (600, 1390)], fill=BROWN, width=8)
    d.line([(505, 845), (505, 1390)], fill=BROWN, width=8)
    d.line([(695, 845), (695, 1390)], fill=BROWN, width=8)
    d.ellipse([640, 1080, 690, 1130], fill=CREAM)
    # grass
    d.rectangle([0, 1390, W, H], fill=GREEN)
    d.rectangle([0, 1390, W, 1402], fill=BROWN)
    grain(img, seed=22)
    return img


def goodnight_little_one():
    img, d = canvas(GREEN)
    # floor
    d.rectangle([0, 1180, W, H], fill=CREAM)
    # crescent moon (cream circle minus sky-colored overlay)
    d.ellipse([700, 130, 1040, 470], fill=CREAM)
    d.ellipse([640, 90, 950, 400], fill=GREEN)
    # stars
    rnd = random.Random(5)
    for _ in range(22):
        x, y = rnd.randrange(60, W - 60), rnd.randrange(60, 1050)
        if 600 < x < 1100 and 80 < y < 520:
            continue
        s = rnd.choice((3, 4, 5, 6))
        d.ellipse([x, y, x + s, y + s], fill=CREAM)
    # bed: headboard, mattress, blanket, pillow
    d.rectangle([215, 800, 300, 1265], fill=BROWN)          # headboard
    d.rectangle([880, 950, 950, 1265], fill=BROWN)          # footboard
    d.rectangle([300, 1010, 880, 1240], fill=TERRA)         # blanket
    # blanket scallop edge
    for x in range(300, 880, 58):
        d.ellipse([x, 985, x + 58, 1043], fill=TERRA)
    d.rounded_rectangle([315, 915, 560, 1015], radius=34, fill=CREAM)  # pillow
    # teddy peeking over the blanket
    d.ellipse([648, 890, 792, 1034], fill=BROWN)            # head
    d.ellipse([642, 868, 692, 918], fill=BROWN)             # ear
    d.ellipse([748, 868, 798, 918], fill=BROWN)             # ear
    d.ellipse([694, 952, 746, 996], fill=CREAM)             # snout
    d.ellipse([668, 928, 686, 946], fill=CREAM)             # eye
    d.ellipse([754, 928, 772, 946], fill=CREAM)             # eye
    # legs
    d.rectangle([300, 1240, 340, 1330], fill=BROWN)
    d.rectangle([840, 1240, 880, 1330], fill=BROWN)
    grain(img, seed=33)
    return img


def dragons_cave_quest():
    img, d = canvas(CREAM)
    # far hills
    d.ellipse([-500, 900, 500, 2100], fill=GREEN)
    d.ellipse([700, 950, 1700, 2100], fill=GREEN)
    # main hill (misregistration ghost then body)
    d.ellipse([88 + 10, 568 + 8, 1112 + 10, 2168 + 8], fill=TERRA)
    d.ellipse([88, 568, 1112, 2168], fill=GREEN)
    # cave mouth: brown arch, then torch glow arches
    def arch(cx, base, r, fill):
        d.ellipse([cx - r, base - 2 * r, cx + r, base], fill=fill)
        d.rectangle([cx - r, base - r, cx + r, base], fill=fill)
    arch(600, 1520, 300, BROWN)
    arch(600, 1520, 195, TERRA)
    arch(600, 1520, 100, CREAM)
    # dragon tail curling out of the cave edge onto the grass
    pts = [(880, 1500), (1020, 1430), (1080, 1310), (1035, 1210)]
    widths = [64, 46, 30, 16]
    for (p, q, w1, w2) in zip(pts, pts[1:], widths, widths[1:]):
        d.line([p, q], fill=TERRA, width=w1)
        d.ellipse([q[0] - w2, q[1] - w2, q[0] + w2, q[1] + w2], fill=TERRA)
    d.ellipse([pts[0][0] - 32, pts[0][1] - 32, pts[0][0] + 32, pts[0][1] + 32], fill=TERRA)
    # spikes along the tail
    for (sx, sy, a) in ((985, 1408, -50), (1062, 1300, -85), (1032, 1218, -120)):
        rad = math.radians(a)
        tip = (sx + 52 * math.cos(rad), sy + 52 * math.sin(rad))
        left = (sx + 20 * math.cos(rad + 1.9), sy + 20 * math.sin(rad + 1.9))
        right = (sx + 20 * math.cos(rad - 1.9), sy + 20 * math.sin(rad - 1.9))
        d.polygon([left, tip, right], fill=BROWN)
    # ground strip
    d.rectangle([0, 1520, W, H], fill=BROWN)
    grain(img, seed=44)
    return img


def birthday_wish():
    img, d = canvas(CREAM)
    # table
    d.rectangle([0, 1270, W, H], fill=GREEN)
    d.rectangle([0, 1270, W, 1284], fill=BROWN)
    # plate
    d.ellipse([230, 1205, 970, 1300], fill=BROWN)
    # cake tiers (misregistration ghost on top tier)
    d.rectangle([330, 1010, 870, 1235], fill=TERRA)
    d.rectangle([424 + 8, 838 + 7, 776 + 8, 1018 + 7], fill=BROWN)
    d.rectangle([424, 838, 776, 1018], fill=TERRA)
    # icing scallops
    for x in range(330, 870, 60):
        d.ellipse([x, 982, x + 60, 1042], fill=CREAM)
    for x in range(424, 776, 44):
        d.ellipse([x, 812, x + 44, 856], fill=CREAM)
    def flame(cx, base, w, h):
        # solid teardrop: triangle tip over an ellipse, small cream core low inside
        d.polygon([(cx, base - h), (cx - w // 2, base - h // 3), (cx + w // 2, base - h // 3)], fill=TERRA)
        d.ellipse([cx - w // 2, base - int(h * 0.62), cx + w // 2, base], fill=TERRA)
        cw = max(6, w // 3)
        d.ellipse([cx - cw, base - cw * 2 - 6, cx + cw, base - 6], fill=CREAM)

    # three small candles
    for cx in (470, 600, 730):
        d.rectangle([cx - 12, 712, cx + 12, 840], fill=BROWN)
        flame(cx, 706, 34, 62)
    # one giant candle, far too tall for the cake
    d.rectangle([556, 300, 644, 860], fill=BROWN)
    for y in range(340, 860, 110):
        d.polygon([(556, y), (644, y - 44), (644, y), (556, y + 44)], fill=CREAM)
    flame(600, 292, 76, 140)
    grain(img, seed=55)
    return img


def under_the_sea():
    img, d = canvas(GREEN)
    # sun rays from the surface far above
    d.polygon([(340, 0), (470, 0), (280, 620)], fill=CREAM)
    d.polygon([(620, 0), (760, 0), (700, 520)], fill=CREAM)
    d.polygon([(900, 0), (1010, 0), (1060, 430)], fill=CREAM)
    # sand
    d.rectangle([0, 1440, W, H], fill=CREAM)
    d.rectangle([0, 1440, W, 1452], fill=BROWN)
    # seaweed
    for (sx, ph) in ((160, 0.0), (250, 1.4), (1000, 0.7)):
        pts = []
        for t in range(0, 11):
            y = 1450 - t * 36
            x = sx + int(26 * math.sin(t * 0.9 + ph))
            pts.append((x, y))
        d.line(pts, fill=BROWN, width=22)
    # bubbles rising
    for (bx, by, r) in ((915, 640, 20), (950, 500, 28), (900, 350, 36), (960, 200, 24)):
        d.ellipse([bx - r, by - r, bx + r, by + r], outline=CREAM, width=10)
    # fish (misregistration ghost then body)
    d.ellipse([400 + 10, 690 + 8, 830 + 10, 950 + 8], fill=BROWN)
    d.ellipse([400, 690, 830, 950], fill=TERRA)
    # tail
    d.polygon([(430, 820), (300, 700), (300, 940)], fill=BROWN)
    # fin
    d.polygon([(580, 810), (680, 810), (620, 900)], fill=BROWN)
    # eye
    d.ellipse([718, 762, 782, 826], fill=CREAM)
    d.ellipse([742, 782, 774, 814], fill=BROWN)
    # mouth
    d.arc([760, 850, 830, 910], 300, 60, fill=BROWN, width=10)
    grain(img, seed=66)
    return img


COVERS = {
    "the-night-you-arrived.jpg": night_you_arrived,
    "great-adventure.jpg": great_adventure,
    "goodnight-little-one.jpg": goodnight_little_one,
    "dragons-cave-quest.jpg": dragons_cave_quest,
    "birthday-wish.jpg": birthday_wish,
    "under-the-sea.jpg": under_the_sea,
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, fn in COVERS.items():
        img = fn()
        img.save(os.path.join(OUT, name), "JPEG", quality=92)
        print("wrote", name)
