#!/usr/bin/env python3
"""Procedural risograph-style interior page plates for Farsh!

Companions to riso_covers.py — same palette, grain, and flat-shape language,
but landscape 1600x1200 to fit the 4:3 page-plate containers on the landing
reader and Book Preview. Each plate matches the chapter text it sits beside.

Usage: python3 tools/riso_pages.py [output_dir]   (default: uploads/pages)
"""
import math
import os
import random
import sys

from PIL import Image, ImageDraw

W, H = 1600, 1200
CREAM = (245, 234, 216)
TERRA = (198, 113, 57)
BROWN = (64, 35, 16)
GREEN = (77, 96, 51)
INKS = [CREAM, TERRA, BROWN, GREEN, (255, 255, 255)]

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "uploads", "pages")


def canvas(bg=CREAM):
    img = Image.new("RGB", (W, H), bg)
    return img, ImageDraw.Draw(img)


def grain(img, density=0.016, seed=1):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(img)
    n = int(W * H * density / 4)
    for _ in range(n):
        x, y = rnd.randrange(W), rnd.randrange(H)
        c = rnd.choice(INKS)
        s = rnd.choice((1, 2, 2, 3))
        d.rectangle([x, y, x + s - 1, y + s - 1], fill=c)


# --------------------------------------------------------------------------
def waking_up():
    """Ch.1: woke before the sun; through the window, the garden wall has
    grown a small green door."""
    img, d = canvas(CREAM)
    # bedroom wall
    d.rectangle([0, 0, W, H], fill=CREAM)
    # big window on the right, misregistration ghost on frame
    d.rectangle([850 + 10, 130 + 8, 1490 + 10, 830 + 8], fill=TERRA)
    d.rectangle([850, 130, 1490, 830], fill=BROWN)
    d.rectangle([890, 170, 1450, 790], fill=CREAM)
    # view: sunrise over the garden wall with the small green door
    d.rectangle([890, 170, 1450, 560], fill=CREAM)
    d.ellipse([1080, 260, 1280, 460], fill=TERRA)          # rising sun
    d.rectangle([890, 480, 1450, 790], fill=TERRA)          # brick wall
    for y in (560, 640, 720):
        d.line([(890, y), (1450, y)], fill=BROWN, width=7)
    for x in (1010, 1150, 1290):
        d.line([(x, 480), (x, 790)], fill=BROWN, width=7)
    d.ellipse([1105, 560, 1235, 690], fill=GREEN)           # round green door
    d.rectangle([1105, 625, 1235, 790], fill=GREEN)
    d.ellipse([1200, 680, 1222, 702], fill=CREAM)
    # window cross bars
    d.line([(1170, 170), (1170, 790)], fill=BROWN, width=14)
    d.line([(890, 480), (1450, 480)], fill=BROWN, width=14)
    # bed in the foreground, child-sized lump under blanket
    d.rectangle([120, 760, 210, 1120], fill=BROWN)          # headboard
    d.rectangle([210, 880, 790, 1100], fill=TERRA)          # blanket
    for x in range(210, 790, 58):
        d.ellipse([x, 856, x + 58, 914], fill=TERRA)        # scallop edge
    d.ellipse([300, 800, 470, 905], fill=TERRA)             # sleepy lump
    d.rounded_rectangle([215, 795, 300, 880], radius=26, fill=CREAM)  # pillow
    d.rectangle([210, 1100, 250, 1180], fill=BROWN)
    d.rectangle([750, 1100, 790, 1180], fill=BROWN)
    # floor line
    d.rectangle([0, 1160, W, H], fill=GREEN)
    grain(img, seed=71)
    return img


def meeting_favorite():
    """Ch.2: on the other side sat someone very large and very shy."""
    img, d = canvas(GREEN)
    # clearing ground
    d.rectangle([0, 900, W, H], fill=CREAM)
    d.rectangle([0, 900, W, 914], fill=BROWN)
    # the open door arch at left (where the child peeks from)
    d.ellipse([60, 240, 480, 660], fill=BROWN)
    d.rectangle([60, 450, 480, 900], fill=BROWN)
    d.ellipse([95, 275, 445, 625], fill=CREAM)
    d.rectangle([95, 450, 445, 865], fill=CREAM)
    # the very large, very shy someone — round, knees drawn up, tiny eyes
    d.ellipse([760 + 12, 210 + 9, 1460 + 12, 910 + 9], fill=BROWN)   # ghost
    d.ellipse([760, 210, 1460, 910], fill=TERRA)                     # body
    d.ellipse([880, 90, 1010, 220], fill=TERRA)                      # ear
    d.ellipse([1210, 90, 1340, 220], fill=TERRA)                     # ear
    d.ellipse([912, 122, 978, 188], fill=BROWN)                      # inner ear
    d.ellipse([1242, 122, 1308, 188], fill=BROWN)
    # shy eyes looking sideways-down
    d.ellipse([990, 420, 1070, 500], fill=CREAM)
    d.ellipse([1150, 420, 1230, 500], fill=CREAM)
    d.ellipse([1000, 455, 1040, 495], fill=BROWN)
    d.ellipse([1160, 455, 1200, 495], fill=BROWN)
    # small bashful mouth
    d.arc([1060, 560, 1160, 640], 20, 160, fill=BROWN, width=12)
    # feet tucked in front
    d.ellipse([880, 820, 1040, 940], fill=BROWN)
    d.ellipse([1180, 820, 1340, 940], fill=BROWN)
    # a small flower it is offering, laid on the ground between
    d.line([(640, 900), (640, 800)], fill=GREEN, width=0)
    d.line([(620, 905), (600, 810)], fill=BROWN, width=10)
    for a in range(0, 360, 72):
        rad = math.radians(a)
        d.ellipse([596 + 36 * math.cos(rad) - 22, 790 + 36 * math.sin(rad) - 22,
                   596 + 36 * math.cos(rad) + 22, 790 + 36 * math.sin(rad) + 22], fill=CREAM)
    d.ellipse([574, 768, 618, 812], fill=TERRA)
    grain(img, seed=82)
    return img


def saving_the_day():
    """Ch.4-5: the trouble was smaller than it looked — a kite stuck in a
    tree, and a ladder already leaning against it."""
    img, d = canvas(CREAM)
    # ground
    d.rectangle([0, 980, W, H], fill=GREEN)
    d.rectangle([0, 980, W, 994], fill=BROWN)
    # tree: trunk + leafy blobs (misregistration ghost on canopy)
    d.rectangle([640, 560, 760, 1000], fill=BROWN)
    d.ellipse([380 + 12, 160 + 9, 1030 + 12, 680 + 9], fill=BROWN)
    d.ellipse([380, 160, 1030, 680], fill=GREEN)
    d.ellipse([300, 330, 640, 640], fill=GREEN)
    d.ellipse([780, 300, 1120, 620], fill=GREEN)
    # the kite caught in the canopy
    d.polygon([(870, 300), (960, 380), (870, 470), (780, 380)], fill=TERRA)
    d.line([(870, 300), (870, 470)], fill=BROWN, width=8)
    d.line([(780, 380), (960, 380)], fill=BROWN, width=8)
    # kite tail dangling out of the leaves
    tail = [(870, 470), (900, 560), (860, 640), (905, 720), (870, 800)]
    d.line(tail, fill=BROWN, width=7)
    for (bx, by) in tail[1:]:
        d.polygon([(bx - 22, by), (bx, by - 16), (bx + 22, by), (bx, by + 16)], fill=TERRA)
    # ladder leaning on the trunk
    x1, y1, x2, y2 = 1050, 990, 800, 620   # rails from ground to canopy
    d.line([(x1, y1), (x2, y2)], fill=BROWN, width=16)
    d.line([(x1 + 90, y1), (x2 + 90, y2)], fill=BROWN, width=16)
    for t in range(1, 7):
        ax = x1 + (x2 - x1) * t / 7
        ay = y1 + (y2 - y1) * t / 7
        d.line([(ax, ay), (ax + 90, ay)], fill=BROWN, width=12)
    # the sun, unbothered
    d.ellipse([1330, 110, 1500, 280], fill=TERRA)
    grain(img, seed=93)
    return img


PLATES = {
    "waking-up.jpg": waking_up,
    "meeting-favorite.jpg": meeting_favorite,
    "saving-the-day.jpg": saving_the_day,
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, fn in PLATES.items():
        fn().save(os.path.join(OUT, name), "JPEG", quality=92)
        print("wrote", name)
