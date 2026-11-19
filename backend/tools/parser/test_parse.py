"""Unit tests for bounded document parser guards and format handlers."""
import io
import json
import struct
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy  # noqa: F401 - pre-import before mock.patch.dict(sys.modules) tests.

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parse as parser


class ParserTests(unittest.TestCase):
    def test_zip_bomb_entry_count_and_ratio_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "too_many.docx"
            with zipfile.ZipFile(p, "w") as zf:
                for i in range(parser.MAX_ZIP_ENTRIES + 5):
                    zf.writestr(f"entry_{i}.txt", "x")
            with self.assertRaises(ValueError):
                parser.validate_zip_container(p)

            ratio_zip = Path(tmp) / "ratio.docx"
            with zipfile.ZipFile(ratio_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("big.txt", "0" * (2 * 1024 * 1024))
            with self.assertRaises(ValueError):
                parser.validate_zip_container(ratio_zip)

    def test_omml_recursion_bounded(self):
        root = ET.Element("{http://schemas.openxmlformats.org/officeDocument/2006/math}oMath")
        cur = root
        for _ in range(120):
            nxt = ET.SubElement(cur, "{http://schemas.openxmlformats.org/officeDocument/2006/math}sSup")
            cur = ET.SubElement(nxt, "{http://schemas.openxmlformats.org/officeDocument/2006/math}e")
        t = ET.SubElement(cur, "{http://schemas.openxmlformats.org/officeDocument/2006/math}t")
        t.text = "deep"
        out = parser.omml_latex(root)
        self.assertEqual(out.count("deep"), 0)

    def test_csv_preserves_quoted_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_file = Path(tmp) / "grades.csv"
            csv_file.write_text('name,note\nAlice,"line1\nwith, comma"\nBob,ok\n', encoding="utf-8-sig")
            res = parser.parse(str(csv_file), ".csv")
            self.assertEqual(len(res["fragments"]), 1)
            body = res["fragments"][0]["body"]
            self.assertIn("Alice | line1 with, comma", body)
            self.assertIn("Bob | ok", body)

    def test_oversized_text_file_rejected_before_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            txt = Path(tmp) / "huge.txt"
            txt.write_text("hello", encoding="utf-8")
            fake_stat = mock.MagicMock(st_size=parser.MAX_TEXT_BYTES + 1)
            with mock.patch.object(Path, "stat", return_value=fake_stat):
                with self.assertRaises(ValueError):
                    parser.parse(str(txt), ".txt")

    def test_cleanup_removes_orphan_assets_on_error(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            html_path = Path(tmp) / "sample.html"
            img_path = Path(tmp) / "sample_pic.png"
            buf = io.BytesIO()
            Image.new("RGB", (64, 64), "red").save(buf, format="PNG")
            img_path.write_bytes(buf.getvalue())
            html_path.write_text('<img src="sample_pic.png" alt="fig">', encoding="utf-8")

            assets_dir = Path(tmp) / "sample_assets"
            assets_dir.mkdir()
            preexisting = assets_dir / "keep.png"
            preexisting.write_bytes(b"preexisting")

            with mock.patch.object(parser, "validate_manifest", side_effect=ValueError("boom")):
                with self.assertRaises(ValueError):
                    parser.parse(str(html_path), ".html")

            remaining = [p.name for p in assets_dir.iterdir()]
            self.assertEqual(remaining, ["keep.png"])

    def test_pptx_skips_small_images_and_deduplicates_sha256(self):
        from types import SimpleNamespace
        from PIL import Image
        from pptx import Presentation
        from pptx.util import Inches

        with tempfile.TemporaryDirectory() as tmp:
            small_path = Path(tmp) / "small.png"
            big_path = Path(tmp) / "big.png"
            Image.new("RGB", (16, 16), "blue").save(small_path, format="PNG")
            Image.new("RGB", (80, 80), "green").save(big_path, format="PNG")

            prs = Presentation()
            slide = prs.slides.add_slide(prs.slide_layouts[6])
            slide.shapes.add_picture(str(small_path), Inches(0.5), Inches(0.5))
            slide.shapes.add_picture(str(big_path), Inches(1.5), Inches(0.5))
            slide.shapes.add_picture(str(big_path), Inches(3.0), Inches(0.5))
            pptx_path = Path(tmp) / "deck.pptx"
            prs.save(pptx_path)

            fake_ocr = mock.MagicMock(return_value=SimpleNamespace(txts=["slide text"]))
            fake_rapidocr = SimpleNamespace(RapidOCR=mock.MagicMock(return_value=fake_ocr))
            with mock.patch.dict(sys.modules, {"rapidocr": fake_rapidocr}):
                res = parser.parse(str(pptx_path), ".pptx")

            self.assertEqual(len(res["assets"]), 1)
            self.assertEqual(fake_ocr.call_count, 1)

    def test_safe_pdf_resolution_and_oversized_page_rejected(self):
        from PIL import Image

        self.assertEqual(parser.safe_pdf_resolution(612, 792), 140.0)
        self.assertAlmostEqual(parser.safe_pdf_resolution(20000, 20000), 8.64)
        self.assertEqual(parser.safe_pdf_resolution(1_000_000, 1_000_000), 1.0)
        with self.assertRaises(ValueError):
            parser.safe_pdf_resolution(0, 100)

        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "huge.pdf"
            pdf_path.write_bytes(b"%PDF-1.4\n")

            huge_page = mock.MagicMock()
            huge_page.width = 500_000
            huge_page.height = 500_000
            huge_page.images = []
            huge_page.find_tables.return_value = []
            huge_page.filter.return_value.extract_text.return_value = "A" * 40
            huge_pdf = mock.MagicMock()
            huge_pdf.__enter__.return_value = SimpleNamespace(pages=[huge_page])
            huge_pdf.__exit__.return_value = False

            with mock.patch("pdfplumber.open", return_value=huge_pdf):
                with self.assertRaises(ValueError):
                    parser.parse(str(pdf_path), ".pdf")
            huge_page.to_image.assert_not_called()

            large_page = mock.MagicMock()
            large_page.width = 20_000
            large_page.height = 20_000
            large_page.images = []
            large_page.find_tables.return_value = []
            large_page.filter.return_value.extract_text.return_value = "Non-scanned text content " * 3
            large_page.to_image.return_value = SimpleNamespace(original=Image.new("RGB", (2400, 2400), "white"))
            large_pdf = mock.MagicMock()
            large_pdf.__enter__.return_value = SimpleNamespace(pages=[large_page])
            large_pdf.__exit__.return_value = False

            fake_rapidocr = SimpleNamespace(RapidOCR=mock.MagicMock())
            with mock.patch("pdfplumber.open", return_value=large_pdf), \
                 mock.patch.dict(sys.modules, {"rapidocr": fake_rapidocr}):
                res = parser.parse(str(pdf_path), ".pdf")

            called_res = large_page.to_image.call_args.kwargs["resolution"]
            self.assertAlmostEqual(called_res, 8.64)
            self.assertLess(called_res, 72.0)
            fake_rapidocr.RapidOCR.assert_not_called()
            self.assertEqual(len(res["assets"]), 1)

    def test_pdf_scanned_page_downscales_ocr_image_and_keeps_2400_asset(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "scan.pdf"
            pdf_path.write_bytes(b"%PDF-1.4\n")

            scanned_page = mock.MagicMock()
            scanned_page.width = 1200
            scanned_page.height = 1600
            scanned_page.images = []
            scanned_page.find_tables.return_value = []
            scanned_page.filter.return_value.extract_text.return_value = ""
            scanned_page.to_image.return_value = SimpleNamespace(original=Image.new("RGB", (1800, 2400), "white"))
            scan_pdf = mock.MagicMock()
            scan_pdf.__enter__.return_value = SimpleNamespace(pages=[scanned_page])
            scan_pdf.__exit__.return_value = False

            seen_shapes = []

            def fake_ocr_call(arr):
                seen_shapes.append(arr.shape)
                return SimpleNamespace(txts=["scanned line"])

            fake_rapidocr_cls = mock.MagicMock(return_value=fake_ocr_call)
            fake_rapidocr = SimpleNamespace(RapidOCR=fake_rapidocr_cls)
            with mock.patch("pdfplumber.open", return_value=scan_pdf), \
                 mock.patch.dict(sys.modules, {"rapidocr": fake_rapidocr}):
                res = parser.parse(str(pdf_path), ".pdf")

            self.assertEqual(len(seen_shapes), 1)
            self.assertEqual(max(seen_shapes[0][:2]), 1280)
            saved_asset = Path(tmp) / res["assets"][0]["storage_path"]
            with Image.open(saved_asset) as img:
                self.assertEqual(img.size, (1800, 2400))
            params = fake_rapidocr_cls.call_args.kwargs["params"]
            self.assertEqual(params["Global.max_side_len"], 1280)
            self.assertEqual(params["Det.limit_side_len"], 736)
            self.assertEqual(params["Rec.rec_batch_num"], 1)
            self.assertEqual(params["EngineConfig.onnxruntime.intra_op_num_threads"], 1)
            self.assertEqual(params["EngineConfig.onnxruntime.inter_op_num_threads"], 1)

    def test_pptx_charts_normal_empty_plots_and_none_categories(self):
        from pptx import Presentation
        from pptx.chart.data import CategoryChartData
        from pptx.enum.chart import XL_CHART_TYPE
        from pptx.util import Inches

        with tempfile.TemporaryDirectory() as tmp:
            prs = Presentation()
            slide = prs.slides.add_slide(prs.slide_layouts[6])
            chart_data = CategoryChartData()
            chart_data.categories = ["Q1", "Q2"]
            chart_data.add_series("Score", (85.0, 92.5))
            slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1), Inches(4), Inches(3), chart_data)
            pptx_path = Path(tmp) / "chart.pptx"
            prs.save(pptx_path)

            res = parser.parse(str(pptx_path), ".pptx")
            payload = json.loads(res["fragments"][0]["body"])
            self.assertEqual(payload, {"categories": ["Q1", "Q2"], "series": {"Score": [85.0, 92.5]}})

        empty_plots_shape = SimpleNamespace(
            has_text_frame=False,
            has_table=False,
            has_chart=True,
            shape_type=3,
            chart=SimpleNamespace(plots=[], series=[SimpleNamespace(name="S1", values=(1, 2))]),
        )
        none_cats_shape = SimpleNamespace(
            has_text_frame=False,
            has_table=False,
            has_chart=True,
            shape_type=3,
            chart=SimpleNamespace(
                plots=[SimpleNamespace(categories=None)],
                series=[SimpleNamespace(name=None, values=(Decimal("1.5"),))],
            ),
        )
        fake_prs = SimpleNamespace(slides=[
            SimpleNamespace(shapes=mock.MagicMock(title=None, __iter__=lambda self: iter([empty_plots_shape, none_cats_shape])))
        ])
        with tempfile.TemporaryDirectory() as tmp:
            dummy = Path(tmp) / "mock.pptx"
            dummy.write_bytes(b"unused")
            with mock.patch.object(parser, "validate_zip_container"), \
                 mock.patch("pptx.Presentation", return_value=fake_prs):
                res = parser.parse(str(dummy), ".pptx")

        self.assertEqual(json.loads(res["fragments"][0]["body"]), {"categories": [], "series": {"S1": [1, 2]}})
        self.assertEqual(json.loads(res["fragments"][1]["body"]), {"categories": [], "series": {"": ["1.5"]}})

    def test_pptx_single_decode_downscales_ocr_and_caps_image_count(self):
        from PIL import Image
        from pptx import Presentation
        from pptx.util import Inches

        with tempfile.TemporaryDirectory() as tmp:
            hi_path = Path(tmp) / "hires.png"
            Image.new("RGB", (2600, 2600), "navy").save(hi_path, format="PNG")
            prs = Presentation()
            slide = prs.slides.add_slide(prs.slide_layouts[6])
            slide.shapes.add_picture(str(hi_path), Inches(0.5), Inches(0.5))
            pptx_path = Path(tmp) / "hires.pptx"
            prs.save(pptx_path)

            seen_shapes = []

            def fake_ocr_call(arr):
                seen_shapes.append(arr.shape)
                return SimpleNamespace(txts=["hi-res text"])

            fake_rapidocr = SimpleNamespace(RapidOCR=mock.MagicMock(return_value=fake_ocr_call))
            with mock.patch.object(parser, "bounded_image", wraps=parser.bounded_image) as spy_decode, \
                 mock.patch.dict(sys.modules, {"rapidocr": fake_rapidocr}):
                res = parser.parse(str(pptx_path), ".pptx")

            self.assertEqual(spy_decode.call_count, 1)
            self.assertEqual(seen_shapes, [(1280, 1280, 3)])
            saved_asset = Path(tmp) / res["assets"][0]["storage_path"]
            with Image.open(saved_asset) as img:
                self.assertEqual(img.size, (2400, 2400))

        fake_shapes = [
            SimpleNamespace(
                has_text_frame=False,
                has_table=False,
                has_chart=False,
                shape_type=13,
                image=SimpleNamespace(blob=f"img-{i}".encode("ascii")),
            )
            for i in range(parser.MAX_PPTX_IMAGES + 1)
        ]
        fake_prs = SimpleNamespace(slides=[
            SimpleNamespace(shapes=mock.MagicMock(title=None, __iter__=lambda self: iter(fake_shapes)))
        ])
        with tempfile.TemporaryDirectory() as tmp:
            dummy = Path(tmp) / "many.pptx"
            dummy.write_bytes(b"unused")
            with mock.patch.object(parser, "validate_zip_container"), \
                 mock.patch("pptx.Presentation", return_value=fake_prs), \
                 mock.patch.object(parser, "bounded_image", side_effect=lambda _: Image.new("RGB", (64, 64), "red")), \
                 mock.patch.dict(sys.modules, {"rapidocr": fake_rapidocr}):
                with self.assertRaises(ValueError):
                    parser.parse(str(dummy), ".pptx")

    def test_html_img_src_and_manifest_nul_byte_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            html_path = Path(tmp) / "sample.html"
            manifest_path = Path(tmp) / "sample_images.json"
            manifest_path.write_text(json.dumps({
                "mapped.png": {"path": "sample_bad\x00.png", "error": "非法路径"}
            }), encoding="utf-8")
            html_path.write_text(
                '<p>Intro paragraph</p><img src="bad\x00.png" alt="broken"><img src="mapped.png" alt="bad manifest">',
                encoding="utf-8",
            )
            res = parser.parse(str(html_path), ".html")
            bodies = [f["body"] for f in res["fragments"]]
            self.assertIn("[图片未保存：请单独上传或补录] broken", bodies)
            self.assertIn("[图片未保存：非法路径] bad manifest", bodies)
            self.assertEqual(res["assets"], [])

    def test_zip_streaming_caps_xml_and_spoofed_file_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            big_xml = Path(tmp) / "big_xml.docx"
            with zipfile.ZipFile(big_xml, "w", compression=zipfile.ZIP_STORED) as zf:
                zf.writestr("word/document.xml", b"a" * (parser.MAX_ZIP_XML_BYTES + 1024))
            with self.assertRaises(ValueError):
                parser.validate_zip_container(big_xml)

            spoofed = Path(tmp) / "spoofed.docx"
            with zipfile.ZipFile(spoofed, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("word/document.xml", b"<doc>" + b"abc123" * 30000 + b"</doc>")
            raw = bytearray(spoofed.read_bytes())
            cd_idx = raw.rfind(b"PK\x01\x02")
            self.assertNotEqual(cd_idx, -1)
            raw[cd_idx + 24:cd_idx + 28] = struct.pack("<I", 10)
            spoofed.write_bytes(bytes(raw))
            with self.assertRaises(ValueError):
                parser.validate_zip_container(spoofed)

        fake_info = SimpleNamespace(
            filename="word/document.xml",
            file_size=100,
            compress_size=100,
            is_dir=lambda: False,
        )
        stream_payload = io.BytesIO(b"x" * (parser.MAX_ZIP_XML_BYTES + 65536))
        fake_archive = mock.MagicMock()
        fake_archive.__enter__.return_value = fake_archive
        fake_archive.__exit__.return_value = False
        fake_archive.infolist.return_value = [fake_info]
        fake_archive.open.return_value = stream_payload
        with mock.patch("zipfile.ZipFile", return_value=fake_archive):
            with self.assertRaises(ValueError):
                parser.validate_zip_container("fake.docx")


if __name__ == "__main__":
    unittest.main()
