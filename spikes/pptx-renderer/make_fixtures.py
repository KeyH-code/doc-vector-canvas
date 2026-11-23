"""Build synthetic, native PowerPoint samples for the M3 rendering comparison."""

import io
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Inches, Pt


def font(style, name="Microsoft YaHei", size=18, color="203650", bold=False):
    style.name = name
    style.size = Pt(size)
    style.color.rgb = RGBColor.from_string(color)
    style.bold = bold
    east_asian = OxmlElement("a:ea")
    east_asian.set("typeface", name)
    style._element.insert_element_before(east_asian, "a:cs", "a:sym")


def label(shapes, text, x, y, w, h, **style):
    frame = shapes.add_textbox(*map(Inches, (x, y, w, h))).text_frame
    frame.word_wrap = True
    frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
    for i, line in enumerate(text.split("\n")):
        p = frame.add_paragraph() if i else frame.paragraphs[0]
        run = p.add_run()
        run.text = line
        font(run.font, **style)
    return frame._parent


def box(shapes, shape, x, y, w, h, color):
    s = shapes.add_shape(shape, *map(Inches, (x, y, w, h)))
    s.fill.solid()
    s.fill.fore_color.rgb = RGBColor.from_string(color)
    s.line.fill.background()
    return s


def marker_image():
    image = Image.new("RGBA", (440, 200), (13, 72, 108, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((16, 14, 423, 185), fill=(38, 155, 182, 255))
    draw.polygon([(58, 156), (150, 48), (213, 156)], fill=(241, 193, 67, 255))
    draw.ellipse((247, 27, 380, 160), fill=(247, 249, 238, 255))
    draw.rectangle((265, 56, 364, 130), fill=(225, 98, 90, 96))
    out = io.BytesIO()
    image.save(out, "PNG")
    out.seek(0)
    return out


def make(path, width, ratio):
    p = Presentation()
    p.slide_width, p.slide_height = Inches(width), Inches(7.5)
    slides = [p.slides.add_slide(p.slide_layouts[6]) for _ in range(3)]
    master = p.slide_masters[0]
    # Move the native shape to the slide master, not into the slides' z-order.
    band = box(slides[0].shapes, MSO_SHAPE.RECTANGLE, 0, 0, width, .22, "A12270")
    master_ids = (int(node.get("id")) for node in master.shapes._spTree.xpath(".//p:cNvPr"))
    band._element.nvSpPr.cNvPr.id = max(master_ids) + 1
    master.shapes._spTree.insert_element_before(band._element, "p:extLst")

    for i, slide in enumerate(slides, 1):
        label(slide.shapes, f"{ratio} / {i:02d}", width - 2.1, 6.95, 1.65, .34, size=16)

    first = slides[0].shapes
    label(first, "中文排版与母版", .55, .63, width - 1.1, .65, size=34, bold=True)
    box(first, MSO_SHAPE.RECTANGLE, .55, 1.62, 4.25, 2.33, "E8F3F6")
    label(first, "窄文字框用于观察中文是否自然换行，以及中英文与标点在同一行时的排版。中英混排 Office 2026。",
          .77, 1.85, 3.8, 1.82, size=22)
    label(first, "字体回退：即使字体未安装，这一行仍应可读。", .57, 4.42, width - 1.1, .68,
          name="M3MissingFontQA-ZZ", size=22)
    first.add_picture(marker_image(), *map(Inches, (5.1, 1.62, 4.25, 1.93)))

    second = slides[1].shapes
    label(second, "表格、图表与组合图形", .55, .63, width - 1.1, .65, size=34, bold=True)
    table = second.add_table(3, 2, *map(Inches, (.55, 1.55, 3.45, 1.8))).table
    for row, texts in enumerate((("类别", "数量"), ("第一组", "12"), ("第二组", "26"))):
        for column, content in enumerate(texts):
            cell = table.cell(row, column)
            cell.fill.solid()
            cell.fill.fore_color.rgb = RGBColor.from_string(["285377", "E8F3F6", "F4F8FA"][row])
            run = cell.text_frame.paragraphs[0].add_run()
            run.text = content
            font(run.font, color="FFFFFF" if row == 0 else "203650", bold=row == 0, size=16)
    data = CategoryChartData()
    data.categories = ["2024", "2025", "2026"]
    data.add_series("样例数据", (12, 26, 18))
    chart = second.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, *map(Inches, (4.35, 1.42, width - 4.9, 3.5)), data).chart
    chart.has_title = False
    chart.has_legend = False
    chart.series[0].format.fill.solid()
    chart.series[0].format.fill.fore_color.rgb = RGBColor.from_string("187F9A")
    group = second.add_group_shape()
    box(group.shapes, MSO_SHAPE.ROUNDED_RECTANGLE, .65, 4.23, 3.08, 1.02, "568378")
    box(group.shapes, MSO_SHAPE.DIAMOND, 1.56, 4.05, 1.1, 1.38, "EBAC3B")
    group.rotation = 14

    label(slides[2].shapes, "隐藏页 · 顺序检查", .55, .63, width - 1.1, .65, size=34, bold=True)
    box(slides[2].shapes, MSO_SHAPE.RECTANGLE, .6, 2.2, 3.5, 1.65, "148969")
    slides[2]._element.set("show", "0")
    p.save(path)

    with ZipFile(path) as package:
        assert "ppt/charts/chart1.xml" in package.namelist()
        assert not any("vbaProject" in name for name in package.namelist())
        assert not any(rel.get("TargetMode") == "External" for name in package.namelist() if name.endswith(".rels")
                       for rel in ET.fromstring(package.read(name))), "Only self-contained samples may go to Office"
    print(path.name, len(slides), p.slide_width, p.slide_height)


def make_external_probe(source, target):
    """Browser-only case. Example.invalid stays blocked by the test harness."""
    image_rels = "ppt/slides/_rels/slide1.xml.rels"
    with ZipFile(source) as original, ZipFile(target, "w", compression=ZIP_DEFLATED) as copy:
        for entry in original.namelist():
            contents = original.read(entry)
            if entry == image_rels:
                rels = ET.fromstring(contents)
                rel = next(rel for rel in rels if rel.get("Type", "").endswith("/image"))
                rel.set("Target", "https://example.invalid/presentation-image.png")
                rel.set("TargetMode", "External")
                contents = ET.tostring(rels, encoding="utf-8", xml_declaration=True)
            copy.writestr(entry, contents)


def make_macro_probe(source, target):
    """Mark the package macro-enabled; it intentionally contains no executable macro."""
    with ZipFile(source) as original, ZipFile(target, "w", compression=ZIP_DEFLATED) as copy:
        for entry in original.namelist():
            contents = original.read(entry)
            if entry == "[Content_Types].xml":
                contents = contents.replace(b"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
                                            b"application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml")
            copy.writestr(entry, contents)


def make_relationship_probes(source, output):
    slide_rels = "ppt/_rels/presentation.xml.rels"
    manifest = "ppt/presentation.xml"
    with ZipFile(source) as original:
        rels = ET.fromstring(original.read(slide_rels))
        first, second, *_ = [r for r in rels if r.get("Type", "").endswith("/slide")]
        duplicate = dict(second.attrib, Id=first.get("Id"), Type=second.get("Type").rsplit("/", 1)[0] + "/image")
        ET.SubElement(rels, first.tag, duplicate)
        enc = original.read("ppt/slides/slide2.xml").decode("utf-8").replace("UTF-8", "UTF-16")
        src = original.read(manifest)
        items = re.findall(rb'<p:sldId\s[^>]+/>', src)
        assert len(items) == 3 and b"".join(items) in src
        for name, replacements in {
            "duplicate-link": {slide_rels: ET.tostring(rels, encoding="utf-8")},
            "missing-image": {"ppt/media/image1.png": None},
            "utf16": {"ppt/slides/slide2.xml": enc.encode("utf-16")},
            "reordered": {manifest: src.replace(b"".join(items), b"".join(reversed(items)))},
        }.items():
            with ZipFile(output / f"{name}.pptx", "w", compression=ZIP_DEFLATED) as copy:
                for entry in original.namelist():
                    contents = replacements[entry] if entry in replacements else original.read(entry)
                    if contents is not None:
                        copy.writestr(entry, contents)


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    make(out / "wide.pptx", 40 / 3, "16:9")
    make(out / "standard.pptx", 10, "4:3")
    make_external_probe(out / "wide.pptx", out / "external.pptx")
    make_macro_probe(out / "wide.pptx", out / "macro.pptx")
    make_relationship_probes(out / "wide.pptx", out)
