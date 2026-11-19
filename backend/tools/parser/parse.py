"""Bounded, format-native extraction. stdout is a single JSON result."""
import csv
import gc
import hashlib
import io
import json
import re
import sys
import uuid
import zipfile
import zlib
from pathlib import Path

MAX_UNITS = 200
MAX_CHARS = 2_000_000
MAX_IMAGE_PIXELS = 24_000_000
MAX_ZIP_BYTES = 50 * 1024 * 1024
MAX_ZIP_XML_BYTES = 15 * 1024 * 1024
MAX_ZIP_ENTRIES = 2000
MAX_ZIP_RATIO = 100
MAX_TEXT_BYTES = 20 * 1024 * 1024
MAX_DOCX_BLOCKS = 5000
MAX_DOCX_IMAGES = 200
MAX_PPTX_IMAGES = 200
MAX_OMML_DEPTH = 64


def create_ocr():
    """Lazily instantiate RapidOCR with memory-bounded single-thread ONNX settings."""
    from rapidocr import RapidOCR
    return RapidOCR(params={
        "Global.max_side_len": 1280,
        "Det.limit_side_len": 736,
        "Rec.rec_batch_num": 1,
        "EngineConfig.onnxruntime.intra_op_num_threads": 1,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    })


def safe_pdf_resolution(w, h):
    """Compute bounded PDF raster DPI without enforcing an unsafe 72 DPI floor."""
    if w <= 0 or h <= 0:
        raise ValueError("PDF页面尺寸无效")
    return max(1.0, min(140.0, 2400.0 * 72.0 / max(w, h)))


def bounded_image(data):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        image = Image.open(io.BytesIO(data))
        if image.width <= 0 or image.height <= 0 or image.width * image.height > MAX_IMAGE_PIXELS:
            raise ValueError("图片像素超限或尺寸无效，请压缩或裁剪后上传")
        return image.convert("RGB")
    except Image.DecompressionBombError as exc:
        raise ValueError("图片像素超限，请压缩或裁剪后上传") from exc


def validate_zip_container(path):
    """Validate zip metadata and stream-verify member byte counts against spoofed headers."""
    total_size = 0
    actual_total_bytes = 0
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_ZIP_ENTRIES:
                raise ValueError("压缩包条目过多，请拆分文件")
            for info in infos:
                total_size += info.file_size
                if total_size > MAX_ZIP_BYTES:
                    raise ValueError("压缩包展开大小超限（上限50MiB）")
                if info.filename.lower().endswith(".xml") and info.file_size > MAX_ZIP_XML_BYTES:
                    raise ValueError("压缩包XML条目大小超限（上限15MiB）")
                if info.file_size > 1024 * 1024 and info.file_size > MAX_ZIP_RATIO * max(1, info.compress_size):
                    raise ValueError("压缩包压缩比异常，请检查文件后重新上传")
            for info in infos:
                if info.is_dir():
                    continue
                member_bytes = 0
                is_xml = info.filename.lower().endswith(".xml")
                with archive.open(info) as member:
                    while True:
                        chunk = member.read(65536)
                        if not chunk:
                            break
                        chunk_len = len(chunk)
                        member_bytes += chunk_len
                        actual_total_bytes += chunk_len
                        if actual_total_bytes > MAX_ZIP_BYTES:
                            raise ValueError("压缩包展开大小超限（上限50MiB）")
                        if is_xml and member_bytes > MAX_ZIP_XML_BYTES:
                            raise ValueError("压缩包XML条目大小超限（上限15MiB）")
                        if member_bytes > 1024 * 1024 and member_bytes > MAX_ZIP_RATIO * max(1, info.compress_size):
                            raise ValueError("压缩包压缩比异常，请检查文件后重新上传")
                if member_bytes != info.file_size:
                    raise ValueError("压缩包成员大小与文件头声明不一致")
    except (zipfile.BadZipFile, EOFError, zlib.error) as exc:
        raise ValueError("压缩包校验失败，文件可能已损坏或格式异常") from exc


def validate_manifest(result):
    if not isinstance(result, dict):
        raise ValueError("解析输出结构无效")
    frags = result.get("fragments")
    assets_list = result.get("assets")
    if not isinstance(frags, list) or not isinstance(assets_list, list) or not frags:
        raise ValueError("未提取到内容，请检查文件或人工补录")
    for frag in frags:
        if not isinstance(frag, dict) or not isinstance(frag.get("body"), str) or not frag["body"].strip():
            raise ValueError("解析片段结构无效")
    return result


def parse(path, extension):
    fragments = []
    assets = []
    total = 0
    created_targets = []
    asset_folder = Path(path).parent / (Path(path).stem + "_assets")

    def cleanup_assets():
        for target in created_targets:
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
        try:
            if asset_folder.exists() and not any(asset_folder.iterdir()):
                asset_folder.rmdir()
        except OSError:
            pass

    def asset(data, locator, kind="image", native=None, image=None):
        if image is None:
            image = bounded_image(data)
        else:
            if image.width <= 0 or image.height <= 0 or image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError("图片像素超限或尺寸无效，请压缩或裁剪后上传")
            if image.mode != "RGB":
                image = image.convert("RGB")
        image.thumbnail((2400, 2400))
        asset_folder.mkdir(exist_ok=True)
        key = uuid.uuid4().hex
        target = asset_folder / (key + ".png")
        image.save(target, format="PNG")
        created_targets.append(target)
        add("[图文资产待核对]", dict(locator, asset_key=key), review=True)
        assets.append(dict(
            key=key,
            position=len(fragments) - 1,
            storage_path=str(target.relative_to(Path(path).parent)),
            kind=kind,
            media_type="image/png",
            locator=locator,
            native_data=native or {},
        ))

    def add(text, locator, heading="", review=False):
        nonlocal total
        text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text).strip()
        if not text:
            return
        total += len(text)
        if total > MAX_CHARS or len(fragments) >= 10000:
            raise ValueError("解析内容超限，请拆分文件")
        fragments.append(dict(
            body=text,
            heading=heading,
            locator=locator,
            quality="needs_review" if review else "ready",
        ))

    try:
        if extension in (".docx", ".pptx"):
            validate_zip_container(path)

        if extension == ".pdf":
            import pdfplumber
            ocr = None
            with pdfplumber.open(path) as pdf:
                if len(pdf.pages) > MAX_UNITS:
                    raise ValueError("PDF超过200页，请拆分文件")
                for n, page in enumerate(pdf.pages, 1):
                    scanned = False
                    try:
                        if not page.width or not page.height or page.width <= 0 or page.height <= 0:
                            continue
                        table_objects = page.find_tables()
                        without_tables = page.filter(lambda obj: not any(
                            t.bbox[0] <= obj.get("x0", -1) < t.bbox[2] and t.bbox[1] <= obj.get("top", -1) < t.bbox[3]
                            for t in table_objects))
                        text = without_tables.extract_text(layout=False) or ""
                        scanned = len(re.sub(r"\s", "", text)) < 25
                        resolution = safe_pdf_resolution(page.width, page.height)
                        if (page.width * resolution / 72.0) * (page.height * resolution / 72.0) > MAX_IMAGE_PIXELS:
                            raise ValueError("PDF页面像素尺寸超限，请压缩或拆分后上传")
                        rendered = page.to_image(resolution=resolution).original
                        if scanned:
                            import numpy as np
                            if ocr is None:
                                ocr = create_ocr()
                            ocr_img = rendered.copy()
                            ocr_img.thumbnail((1280, 1280))
                            result = ocr(np.asarray(ocr_img))
                            text = "\n".join(result.txts or [])
                            del ocr_img, result
                        tables = [] if scanned else [t.extract() for t in table_objects]
                        add(text or "[本页无法提取文字，请人工补录]", {"page": n, "method": "ocr" if scanned else "text"}, review=scanned)
                        for t, rows in enumerate(tables, 1):
                            add("\n".join(" | ".join((c or "").replace("\n", " ") for c in row) for row in rows), {"page": n, "table": t}, review=False)
                        asset(None, {"page": n, "bbox": [0, 0, 1, 1]}, "page", image=rendered)
                        del rendered
                        for im in page.images[:30]:
                            box = (max(0, im["x0"]), max(0, im["top"]), min(page.width, im["x1"]), min(page.height, im["bottom"]))
                            bw, bh = box[2] - box[0], box[3] - box[1]
                            if bw <= 0 or bh <= 0:
                                continue
                            crop_res = safe_pdf_resolution(bw, bh)
                            if (page.width * crop_res / 72.0) * (page.height * crop_res / 72.0) > MAX_IMAGE_PIXELS:
                                crop_res = min(crop_res, resolution)
                            if (
                                (bw * crop_res / 72.0) * (bh * crop_res / 72.0) > MAX_IMAGE_PIXELS
                                or (page.width * crop_res / 72.0) * (page.height * crop_res / 72.0) > MAX_IMAGE_PIXELS
                            ):
                                continue
                            cropped = page.crop(box)
                            crop = cropped.to_image(resolution=crop_res).original
                            if hasattr(cropped, "flush_cache"):
                                cropped.flush_cache()
                            del cropped
                            asset(None, {"page": n, "bbox": [box[0] / page.width, box[1] / page.height, box[2] / page.width, box[3] / page.height]}, image=crop)
                            del crop
                    finally:
                        if hasattr(page, "flush_cache"):
                            page.flush_cache()
                        if scanned:
                            gc.collect()
        elif extension == ".docx":
            from docx import Document
            doc = Document(path)
            heading = ""
            seen_rids = set()
            image_count = 0
            for n, block in enumerate(doc.iter_inner_content(), 1):
                if n > MAX_DOCX_BLOCKS:
                    raise ValueError("Word段落或表格数量超限（上限5000块），请拆分文档")
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
                    if rid and rid not in seen_rids and rid in doc.part.related_parts:
                        seen_rids.add(rid)
                        image_count += 1
                        if image_count > MAX_DOCX_IMAGES:
                            raise ValueError("Word内嵌图片数量超限（上限200张），请拆分文档")
                        asset(doc.part.related_parts[rid].blob, {"block": n, "type": "image"})
        elif extension == ".pptx":
            from pptx import Presentation
            prs = Presentation(path)
            if len(prs.slides) > MAX_UNITS:
                raise ValueError("PPT超过200页，请拆分文件")
            ocr = None
            seen_hashes = set()
            image_count = 0
            for n, slide in enumerate(prs.slides, 1):
                heading = slide.shapes.title.text if slide.shapes.title else ""
                for j, shape in enumerate(slide.shapes, 1):
                    if shape.has_text_frame:
                        add(shape.text, {"slide": n, "shape": j}, heading)
                    elif shape.has_table:
                        add("\n".join(" | ".join(c.text for c in row.cells) for row in shape.table.rows), {"slide": n, "table": j}, heading)
                    elif shape.has_chart:
                        chart = shape.chart
                        plots = getattr(chart, "plots", None) or ()
                        raw_categories = getattr(plots[0], "categories", None) if plots else None
                        categories = [getattr(c, "label", str(c)) for c in (raw_categories or ())]
                        data = {}
                        for series in (getattr(chart, "series", None) or ()):
                            raw_name = getattr(series, "name", "")
                            series_name = "" if raw_name is None else str(raw_name)
                            data[series_name] = list(getattr(series, "values", ()) or ())
                        add(json.dumps({"categories": categories, "series": data}, ensure_ascii=False, default=str),
                            {"slide": n, "shape": j, "type": "native_chart"}, heading)
                    elif shape.shape_type == 13:
                        blob = shape.image.blob
                        digest = hashlib.sha256(blob).hexdigest()
                        if digest in seen_hashes:
                            continue
                        image = bounded_image(blob)
                        if image.width < 48 or image.height < 48:
                            continue
                        seen_hashes.add(digest)
                        image_count += 1
                        if image_count > MAX_PPTX_IMAGES:
                            raise ValueError("PPT内嵌图片数量超限（上限200张），请拆分文档")
                        import numpy as np
                        if ocr is None:
                            ocr = create_ocr()
                        ocr_img = image.copy()
                        ocr_img.thumbnail((1280, 1280))
                        result = ocr(np.asarray(ocr_img))
                        del ocr_img
                        add("\n".join(result.txts or []) or "[图片无可识别文字，请人工核对]", {"slide": n, "image": j, "method": "ocr"}, heading, True)
                        asset(blob, {"slide": n, "shape": j}, image=image)
        else:
            file_bytes = Path(path).stat().st_size
            if file_bytes > MAX_TEXT_BYTES:
                raise ValueError("文本、表格或网页文件超过20MiB，请拆分文件")
            text = Path(path).read_text(encoding="utf-8-sig")
            if extension == ".csv":
                reader = csv.reader(io.StringIO(text))
                chunk_lines = []
                row_idx = 0
                for row_idx, row in enumerate(reader, 1):
                    formatted = " | ".join(cell.replace("\r", " ").replace("\n", " ").strip() for cell in row)
                    if formatted.strip(" |"):
                        chunk_lines.append(formatted)
                    if len(chunk_lines) >= 50:
                        add("\n".join(chunk_lines), {"row_end": row_idx, "type": "csv"}, "CSV 数据")
                        chunk_lines = []
                if chunk_lines:
                    add("\n".join(chunk_lines), {"row_end": row_idx, "type": "csv"}, "CSV 数据")
            else:
                if extension in (".html", ".htm"):
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(text, "html.parser")
                    manifest_path = Path(path).with_name(Path(path).stem + "_images.json")
                    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
                    for n, img in enumerate(soup.find_all("img"), 1):
                        raw_src = img.get("src") or ""
                        alt = img.get("alt") or ""
                        if not isinstance(alt, str):
                            alt = " ".join(str(x) for x in alt)
                        entry = manifest.get(raw_src, {}) if isinstance(raw_src, str) and isinstance(manifest, dict) else {}
                        if not isinstance(entry, dict):
                            entry = {}
                        raw_path = entry.get("path")
                        candidate = raw_path if isinstance(raw_path, str) and raw_path else raw_src
                        is_local = False
                        local = None
                        if isinstance(candidate, str) and candidate and isinstance(raw_src, str) and "\x00" not in raw_src and "\x00" not in candidate and len(candidate) <= 512:
                            local = Path(path).parent / candidate
                            try:
                                is_local = (
                                    local.is_file()
                                    and local.name.startswith(Path(path).stem + "_")
                                    and local.resolve().parent == Path(path).resolve().parent
                                )
                            except OSError:
                                is_local = False
                        if is_local and local is not None:
                            asset(local.read_bytes(), {"image": n, "alt": alt})
                        else:
                            err = entry.get("error") or "请单独上传或补录"
                            add(f"[图片未保存：{err}] {alt}", {"image": n}, review=True)
                    for tag in soup(["script", "style", "noscript"]):
                        tag.decompose()
                    text = soup.get_text("\n")
                heading = ""
                for n, paragraph in enumerate(re.split(r"\n\s*\n", text), 1):
                    if paragraph.lstrip().startswith("#"):
                        heading = paragraph.splitlines()[0].lstrip("# ")
                    add(paragraph, {"paragraph": n}, heading)

        return validate_manifest({"fragments": fragments, "assets": assets})
    except Exception:
        cleanup_assets()
        raise


def omml_latex(node, depth=0):
    if depth >= MAX_OMML_DEPTH:
        return ""
    name = node.tag.rsplit('}', 1)[-1]
    children = list(node)

    def part(tag):
        return "".join(omml_latex(c, depth + 1) for c in children if c.tag.rsplit('}', 1)[-1] == tag)

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
    return ''.join(omml_latex(c, depth + 1) for c in children)


if __name__ == "__main__":
    try:
        result = parse(sys.argv[1], sys.argv[2])
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        # Only fixed class and safe parser messages; no document text or paths.
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else "解析失败：" + type(exc).__name__}, ensure_ascii=False))
        sys.exit(1)
