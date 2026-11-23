"""Independently decode the PNGs, check original page geometry, and make comparison sheets."""

import sys
from pathlib import Path

import fitz
from PIL import Image, ImageDraw


def bar_heights(image):
    bars = []
    heights = []
    for x in range(510, image.width):
        count = sum(0 <= r <= 50 and 117 <= g <= 145 and 138 <= b <= 172
                    for r, g, b in (image.getpixel((x, y)) for y in range(185, 540)))
        if count > 45:
            heights.append(count)
        elif heights:
            bars.append(max(heights))
            heights = []
    return bars


def compare(root):
    candidates = ("office", "webppt", "browser")
    names = ("PowerPoint native", "@web-ppt/core 0.8.0", "pptx-preview 1.0.7")
    for case, width, points in (("wide", 1600, 960), ("standard", 1200, 720)):
        with fitz.open(root / "office" / f"{case}.pdf") as pdf:
            assert len(pdf) == 2 and all(tuple(p.rect)[2:] == (points, 540) for p in pdf)
            assert "中文排版与母版" in pdf[0].get_text() and "第二组" in pdf[1].get_text()
        tile = 510
        height = round(tile * 900 / width)
        sheet = Image.new("RGB", (20 + 3 * (tile + 12), 55 + 3 * (height + 29)), "#edf1f6")
        draw = ImageDraw.Draw(sheet)
        draw.text((14, 12), f"M3 PPTX selection / {case} / {width} x 900 px", fill="#21344e")
        for col, (candidate, label) in enumerate(zip(candidates, names)):
            left = 12 + col * (tile + 12)
            draw.text((left, 34), label, fill="#21344e")
            images = []
            for index in (1, 2, 3):
                with Image.open(root / candidate / f"{case}-{index}.png") as png:
                    images.append(png.convert("RGB"))
            assert all(im.size == (width, 900) for im in images), (case, candidate)
            master = [im.getpixel((12, 12)) for im in images]
            if candidate in {"office", "webppt"}:
                assert master == [(161, 34, 112)] * 3, (case, candidate, master)
                green = images[2].getpixel((120, 310))
                assert max(abs(a - b) for a, b in zip(green, (20, 137, 105))) <= 3, (case, candidate, green)
                bars = bar_heights(images[1])
                assert len(bars) == 3 and bars[0] < bars[2] < bars[1], (case, candidate, bars)
            else:
                bars = []
                assert master != [(161, 34, 112)] * 3, (case, candidate)
            print(case, candidate, master, "column heights (px)", bars)
            for index, image in enumerate(images, 1):
                top = 53 + (index - 1) * (height + 29)
                sheet.paste(image.resize((tile, height), Image.Resampling.LANCZOS), (left, top))
                draw.text((left, top + height + 4), f"{index:02d}" + (" / hidden" if index == 3 else ""), fill="#21344e")
        sheet.save(root / f"comparison-{case}.png")


if __name__ == "__main__":
    compare(Path(sys.argv[1]))
