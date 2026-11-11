"""Bounded, format-native extraction. stdout is a single JSON result."""
import json
import re
import sys
import zipfile
import io
import uuid
from pathlib import Path

MAX_UNITS = 200
MAX_CHARS = 2_000_000
MAX_IMAGE_PIXELS = 24_000_000


def bounded_image(data):
    from PIL import Image
    image = Image.open(io.BytesIO(data))
    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise ValueError("图片像素超限，请压缩或裁剪后上传")
    return image.convert("RGB")


def parse(path, extension):
    fragments = []
    assets = []
    total = 0

    def asset(data, locator, kind="image", native=None):
        from PIL import Image
        image = bounded_image(data)
        image.thumbnail((2400, 2400))
        folder = Path(path).parent / (Path(path).stem + "_assets")
        folder.mkdir(exist_ok=True)
        key = uuid.uuid4().hex
        target = folder / (key + ".png")
        image.save(target, format="PNG")
        add("[图文资产待核对]", dict(locator, asset_key=key), review=True)
        assets.append(dict(key=key, position=len(fragments)-1, storage_path=str(target.relative_to(Path(path).parent)),
                           kind=kind, media_type="image/png", locator=locator, native_data=native or {}))

    def add(text, locator, heading="", review=False):
        nonlocal total
        text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text).strip()
        if not text:
            return
        total += len(text)
        if total > MAX_CHARS or len(fragments) >= 10000:
            raise ValueError("解析内容超限，请拆分文件")
        fragments.append(dict(body=text, heading=heading, locator=locator,
                              quality="needs_review" if review else "ready"))

    if extension in (".docx", ".pptx"):
        with zipfile.ZipFile(path) as archive:
            if sum(i.file_size for i in archive.infolist()) > 200 * 1024 * 1024:
                raise ValueError("压缩包展开大小超限")
    if extension == ".pdf":
        import pdfplumber
        from rapidocr import RapidOCR
        import numpy as np
        ocr = None
        with pdfplumber.open(path) as pdf:
            if len(pdf.pages) > MAX_UNITS:
                raise ValueError("PDF超过200页，请拆分文件")
            for n, page in enumerate(pdf.pages, 1):
                table_objects = page.find_tables()
                without_tables = page.filter(lambda obj: not any(
                    t.bbox[0] <= obj.get("x0", -1) < t.bbox[2] and t.bbox[1] <= obj.get("top", -1) < t.bbox[3]
                    for t in table_objects))
                text = without_tables.extract_text(layout=False) or ""
                scanned = len(re.sub(r"\s", "", text)) < 25
                if scanned:
                    if ocr is None:
                        ocr = RapidOCR()
                    resolution = min(140, 3000 * 72 / max(page.width, page.height))
                    result = ocr(np.asarray(page.to_image(resolution=resolution).original))
                    text = "\n".join(result.txts or [])
                tables = [] if scanned else page.extract_tables()
                add(text or "[本页无法提取文字，请人工补录]", {"page": n, "method": "ocr" if scanned else "text"}, review=scanned)
                for t, rows in enumerate(tables, 1):
                    add("\n".join(" | ".join((c or "").replace("\n", " ") for c in row) for row in rows), {"page": n, "table": t}, review=False)
                rendered = page.to_image(resolution=min(140, 2400 * 72 / max(page.width, page.height))).original
                page_buffer = io.BytesIO(); rendered.save(page_buffer, format="PNG")
                asset(page_buffer.getvalue(), {"page": n, "bbox": [0, 0, 1, 1]}, "page")
                for im in page.images[:30]:
                    box = (max(0, im["x0"]), max(0, im["top"]), min(page.width, im["x1"]), min(page.height, im["bottom"]))
                    if box[2] <= box[0] or box[3] <= box[1]:
                        continue
                    crop = page.crop(box).to_image(resolution=140).original
                    buffer = io.BytesIO(); crop.save(buffer, format="PNG")
                    asset(buffer.getvalue(), {"page": n, "bbox": [box[0]/page.width, box[1]/page.height, box[2]/page.width, box[3]/page.height]})
    elif extension == ".docx":
        from docx import Document
        doc = Document(path)
        heading = ""
        for n, block in enumerate(doc.iter_inner_content(), 1):
            if hasattr(block, "rows"):
                add("\n".join(" | ".join(c.text for c in row.cells) for row in block.rows), {"block": n, "type": "table"}, heading)
            else:
                if block.style and block.style.name.startswith("Heading"):
                    heading = block.text
                add(block.text, {"block": n, "type": "paragraph"}, heading)
            for formula in block._element.xpath('.//m:oMath'):
                add("$$" + omml_latex(formula) + "$$", {"block": n, "type": "native_formula"}, heading, True)
            for picture in block._element.xpath('.//a:blip'):
                rid = picture.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
                if rid in doc.part.related_parts:
                    asset(doc.part.related_parts[rid].blob, {"block": n, "type": "image"})
    elif extension == ".pptx":
        from pptx import Presentation
        prs = Presentation(path)
        if len(prs.slides) > MAX_UNITS:
            raise ValueError("PPT超过200页，请拆分文件")
        ocr = None
        for n, slide in enumerate(prs.slides, 1):
            heading = slide.shapes.title.text if slide.shapes.title else ""
            for j, shape in enumerate(slide.shapes, 1):
                if shape.has_text_frame:
                    add(shape.text, {"slide": n, "shape": j}, heading)
                elif shape.has_table:
                    add("\n".join(" | ".join(c.text for c in row.cells) for row in shape.table.rows), {"slide": n, "table": j}, heading)
                elif shape.has_chart:
                    chart = shape.chart
                    categories = [c.label for c in chart.plots[0].categories]
                    data = {series.name: list(series.values) for series in chart.series}
                    add(json.dumps({"categories": categories, "series": data}, ensure_ascii=False),
                        {"slide": n, "shape": j, "type": "native_chart"}, heading)
                elif shape.shape_type == 13:
                    from rapidocr import RapidOCR
                    import numpy as np
                    from PIL import Image
                    if ocr is None:
                        ocr = RapidOCR()
                    image = bounded_image(shape.image.blob)
                    image.thumbnail((3000, 3000))
                    result = ocr(np.asarray(image))
                    add("\n".join(result.txts or []) or "[图片无可识别文字，请人工核对]", {"slide": n, "image": j, "method": "ocr"}, heading, True)
                    asset(shape.image.blob, {"slide": n, "shape": j})
    else:
        text = Path(path).read_text(encoding="utf-8-sig")
        if extension in (".html", ".htm"):
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(text, "html.parser")
            manifest_path = Path(path).with_name(Path(path).stem + "_images.json")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
            for n, img in enumerate(soup.find_all("img"), 1):
                entry = manifest.get(img.get("src", ""), {})
                local = Path(path).parent / entry.get("path", img.get("src", ""))
                if local.is_file() and local.name.startswith(Path(path).stem + "_") and local.resolve().parent == Path(path).resolve().parent:
                    asset(local.read_bytes(), {"image": n, "alt": img.get("alt", "")})
                else:
                    add("[图片未保存：" + entry.get("error", "请单独上传或补录") + "] " + img.get("alt", ""), {"image": n}, review=True)
            for tag in soup(["script", "style", "noscript"]):
                tag.decompose()
            text = soup.get_text("\n")
        heading = ""
        for n, paragraph in enumerate(re.split(r"\n\s*\n", text), 1):
            if paragraph.lstrip().startswith("#"):
                heading = paragraph.splitlines()[0].lstrip("# ")
            add(paragraph, {"paragraph": n}, heading)
    if not fragments:
        raise ValueError("未提取到内容，请检查文件或人工补录")
    return {"fragments": fragments, "assets": assets}


def omml_latex(node):
    name = node.tag.rsplit('}', 1)[-1]
    children = list(node)
    def part(tag):
        return "".join(omml_latex(c) for c in children if c.tag.rsplit('}', 1)[-1] == tag)
    if name == 't':
        return node.text or ''
    if name.endswith('Pr'):
        return ''
    if name == 'f':
        return r'\frac{' + part('num') + '}{' + part('den') + '}'
    if name == 'sSup':
        return '{' + part('e') + '}^{' + part('sup') + '}'
    if name == 'sSub':
        return '{' + part('e') + '}_{' + part('sub') + '}'
    if name == 'sSubSup':
        return '{' + part('e') + '}_{' + part('sub') + '}^{' + part('sup') + '}'
    if name == 'rad':
        degree = part('deg')
        return r'\sqrt' + ('[' + degree + ']' if degree else '') + '{' + part('e') + '}'
    return ''.join(omml_latex(c) for c in children)


if __name__ == "__main__":
    try:
        result = parse(sys.argv[1], sys.argv[2])
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        # Only fixed class and safe parser messages; no document text or paths.
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else "解析失败：" + type(exc).__name__}, ensure_ascii=False))
        sys.exit(1)
