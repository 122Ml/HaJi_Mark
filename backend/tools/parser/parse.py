"""Bounded, format-native extraction. stdout is a single JSON result."""
import json
import re
import sys
import zipfile
from pathlib import Path

MAX_UNITS = 200
MAX_CHARS = 2_000_000


def parse(path, extension):
    fragments = []
    total = 0

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
                text = page.extract_text(layout=False) or ""
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
                if page.images and not scanned:
                    add("[本页含图片或图表，请对照原件核对其内容；当前未提取图片语义]", {"page": n, "type": "image_notice"}, review=True)
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
        # Image-only DOCX is not silently treated as complete text extraction.
        if doc.inline_shapes:
            add("[文档含图片，图片/公式语义请对照原件人工核对]", {"type": "image_notice"}, review=True)
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
                elif shape.shape_type == 13:
                    from rapidocr import RapidOCR
                    import numpy as np
                    from PIL import Image
                    import io
                    if ocr is None:
                        ocr = RapidOCR()
                    image = Image.open(io.BytesIO(shape.image.blob)).convert("RGB")
                    image.thumbnail((3000, 3000))
                    result = ocr(np.asarray(image))
                    add("\n".join(result.txts or []) or "[图片无可识别文字，请人工核对]", {"slide": n, "image": j, "method": "ocr"}, heading, True)
    else:
        text = Path(path).read_text(encoding="utf-8-sig")
        if extension in (".html", ".htm"):
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(text, "html.parser")
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
    return {"fragments": fragments}


if __name__ == "__main__":
    try:
        result = parse(sys.argv[1], sys.argv[2])
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        # Only fixed class and safe parser messages; no document text or paths.
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else "解析失败：" + type(exc).__name__}, ensure_ascii=False))
        sys.exit(1)
