"""Unit tests for bounded document parser guards and format handlers."""
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np  # noqa: F401 - pre-import before mock.patch.dict(sys.modules) tests.

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

    def test_merge_speech_segments_caps_600_dense_utterances_and_normalizes(self):
        self.assertEqual(parser.merge_speech_segments([(0, 1000, "   \t\n ")]), [])

        normalized = parser.merge_speech_segments([
            (-250, -10, "开场"),
            (500, 500, "相等时间"),
            (800, 600, "倒挂时间"),
        ])
        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized[0]["heading"], "")
        self.assertEqual(normalized[0]["quality"], "ready")
        self.assertEqual(normalized[0]["locator"], {"time_start_ms": 0, "time_end_ms": 801})
        self.assertEqual(normalized[0]["body"], "开场 相等时间 倒挂时间")

        # 600 dense utterances (~120 chars each) force Pass 1 (>120 buckets) and Pass 2 coalescing.
        utterances = []
        for idx in range(600):
            s = idx * 4000
            e = s + 3800
            utterances.append((s, e, f"第{idx:03d}句_" + "讲解内容" * 28))

        fragments = parser.merge_speech_segments(utterances)
        self.assertGreater(len(fragments), 0)
        self.assertLessEqual(len(fragments), parser.MAX_VIDEO_FRAGMENTS)
        self.assertEqual(fragments[0]["locator"]["time_start_ms"], 0)
        self.assertEqual(fragments[-1]["locator"]["time_end_ms"], utterances[-1][1])

        for i, frag in enumerate(fragments):
            self.assertEqual(frag["heading"], "")
            self.assertEqual(frag["quality"], "ready")
            loc = frag["locator"]
            self.assertGreaterEqual(loc["time_start_ms"], 0)
            self.assertLess(loc["time_start_ms"], loc["time_end_ms"])
            if i > 0:
                prev_loc = fragments[i - 1]["locator"]
                self.assertLessEqual(prev_loc["time_end_ms"], loc["time_start_ms"])

        combined_body = " ".join(frag["body"] for frag in fragments)
        expected_body = " ".join(text for _s, _e, text in utterances)
        self.assertEqual(combined_body, expected_body)

    def test_transcribe_video_multi_chunk_offsets_and_dispatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            video_path = Path(tmp) / "lecture.mp4"
            video_path.write_bytes(b"fake-mp4")

            created = []
            transcribe_calls = []

            class FakeWhisperModel:
                def __init__(self, model_size, **kwargs):
                    created.append((model_size, kwargs))

                def transcribe(self, audio, **kwargs):
                    transcribe_calls.append((audio.dtype, len(audio), kwargs))
                    if len(transcribe_calls) == 1:
                        segs = [
                            SimpleNamespace(start=0.5, end=2.0, text="第一段讲解"),
                            SimpleNamespace(start=2.0, end=2.5, text="   "),
                            SimpleNamespace(start=298.0, end=299.5, text="跨块前半"),
                        ]
                    else:
                        segs = [
                            SimpleNamespace(start=1.25, end=3.5, text="跨块后半"),
                        ]
                    return iter(segs), SimpleNamespace(language="zh")

            fake_fw = SimpleNamespace(WhisperModel=FakeWhisperModel)
            chunks = [
                (0.0, np.zeros(1600, dtype=np.float32)),
                (300.0, np.ones(1600, dtype=np.float32)),
            ]
            env = {
                "WHISPER_MODEL_SIZE": "medium",
                "WHISPER_MODEL_DIR": "/opt/custom-whisper",
                "WHISPER_COMPUTE_TYPE": "int8",
                "WHISPER_CPU_THREADS": "2",
                "HF_HUB_OFFLINE": "1",
            }
            with mock.patch.dict(sys.modules, {"faster_whisper": fake_fw}), \
                 mock.patch.dict(os.environ, env, clear=False), \
                 mock.patch.object(parser, "iter_video_audio_chunks", return_value=iter(chunks)):
                res = parser.parse(str(video_path), ".MP4")

            self.assertEqual(res["assets"], [])
            self.assertEqual(len(res["fragments"]), 2)
            self.assertEqual(res["fragments"][0], {
                "heading": "",
                "body": "第一段讲解",
                "locator": {"time_start_ms": 500, "time_end_ms": 2000},
                "quality": "ready",
            })
            self.assertEqual(res["fragments"][1], {
                "heading": "",
                "body": "跨块前半 跨块后半",
                "locator": {"time_start_ms": 298000, "time_end_ms": 303500},
                "quality": "ready",
            })

            self.assertEqual(len(created), 1)
            self.assertEqual(created[0][0], "medium")
            self.assertEqual(created[0][1], {
                "device": "cpu",
                "compute_type": "int8",
                "download_root": "/opt/custom-whisper",
                "cpu_threads": 2,
                "num_workers": 1,
                "local_files_only": True,
            })
            self.assertEqual(len(transcribe_calls), 2)
            for dtype, _n, kwargs in transcribe_calls:
                self.assertEqual(dtype, np.float32)
                self.assertEqual(kwargs["language"], "zh")
                self.assertTrue(kwargs["vad_filter"])
                self.assertEqual(kwargs["vad_parameters"], {"min_silence_duration_ms": 500})

    def test_transcribe_video_empty_speech_and_runtime_or_model_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            video_path = Path(tmp) / "secret_lecture_dir_marker.mp4"
            video_path.write_bytes(b"fake-mp4")

            # Empty speech (only whitespace segments returned).
            class EmptySpeechModel:
                def __init__(self, *args, **kwargs):
                    pass

                def transcribe(self, audio, **kwargs):
                    return iter([SimpleNamespace(start=0.0, end=1.0, text="  \n ")]), SimpleNamespace()

            fake_fw_empty = SimpleNamespace(WhisperModel=EmptySpeechModel)
            with mock.patch.dict(sys.modules, {"faster_whisper": fake_fw_empty}), \
                 mock.patch.object(parser, "iter_video_audio_chunks", return_value=iter([(0.0, np.zeros(800, dtype=np.float32))])):
                with self.assertRaises(ValueError) as ctx:
                    parser.transcribe_video(str(video_path))
                self.assertEqual(str(ctx.exception), "未识别到讲解语音，无法切分")

            # Missing local model files must never leak container paths.
            class MissingModel:
                def __init__(self, *args, **kwargs):
                    raise FileNotFoundError("missing /opt/whisper/models--small/model.bin")

            fake_fw_missing = SimpleNamespace(WhisperModel=MissingModel)
            with mock.patch.dict(sys.modules, {"faster_whisper": fake_fw_missing}):
                with self.assertRaises(ValueError) as ctx:
                    parser.transcribe_video(str(video_path))
                self.assertEqual(str(ctx.exception), "本地语音转写模型未就绪，请联系管理员配置后重试")
                self.assertNotIn("/opt/whisper", str(ctx.exception))
                self.assertNotIn("secret_lecture_dir_marker", str(ctx.exception))

            # Local ASR disabled (faster_whisper and av absent).
            with mock.patch.dict(sys.modules, {"faster_whisper": None}):
                with self.assertRaises(ValueError) as ctx:
                    parser.parse(str(video_path), ".mp4")
                self.assertEqual(str(ctx.exception), "当前服务未启用本地视频语音转写组件，请在启用本地转写构建或挂载语音模型后重试")
                self.assertNotIn("secret_lecture_dir_marker", str(ctx.exception))

            with mock.patch.dict(sys.modules, {"av": None}):
                with self.assertRaises(ValueError) as ctx:
                    list(parser.iter_video_audio_chunks(str(video_path)))
                self.assertEqual(str(ctx.exception), "当前服务未启用本地视频语音转写组件，请在启用本地转写构建或挂载语音模型后重试")
                self.assertNotIn("secret_lecture_dir_marker", str(ctx.exception))

            proc = subprocess.run(
                [sys.executable, str(Path(parser.__file__).resolve()), str(video_path), ".mp4"],
                capture_output=True,
                text=True,
                timeout=15,
            )
            self.assertEqual(proc.returncode, 1)
            self.assertEqual(proc.stderr.strip(), "")
            payload = json.loads(proc.stdout)
            self.assertIsInstance(payload.get("error"), str)
            self.assertTrue(payload["error"])
            self.assertNotIn("secret_lecture_dir_marker", payload["error"])
            self.assertNotIn("/opt/whisper", payload["error"])

    def test_iter_video_audio_chunks_no_audio_forged_duration_and_averror(self):
        class FakeAVError(Exception):
            pass

        def make_fake_av(open_fn, resampler_cls=None):
            return SimpleNamespace(
                AVError=FakeAVError,
                FFmpegError=FakeAVError,
                open=open_fn,
                AudioResampler=resampler_cls or mock.MagicMock(),
            )

        with tempfile.TemporaryDirectory() as tmp:
            video_path = Path(tmp) / "clip_sensitive_name.mp4"
            video_path.write_bytes(b"fake-mp4")

            # 1) No audio stream.
            no_audio_container = mock.MagicMock()
            no_audio_container.__enter__.return_value = SimpleNamespace(streams=SimpleNamespace(audio=[]))
            no_audio_container.__exit__.return_value = False
            fake_av = make_fake_av(lambda _p: no_audio_container)
            fake_model = mock.MagicMock()
            fake_model.transcribe.side_effect = lambda *a, **kw: (iter([]), SimpleNamespace())
            fake_fw = SimpleNamespace(WhisperModel=mock.MagicMock(return_value=fake_model))
            with mock.patch.dict(sys.modules, {"av": fake_av, "faster_whisper": fake_fw}):
                with self.assertRaises(ValueError) as ctx:
                    parser.transcribe_video(str(video_path))
                self.assertEqual(str(ctx.exception), "视频不包含音轨，无法转写")

            # 2) >45 minute audio stream rejected by decoded samples even if header duration is forged to 0.
            one_sec_pcm = np.full((1, 16000), 16384, dtype=np.int16)
            over_frames = [
                SimpleNamespace(to_ndarray=lambda arr=one_sec_pcm: arr)
                for _ in range(10)
            ]
            one_min_pcm = np.zeros((1, 60 * 16000), dtype=np.int16)
            one_sample_pcm = np.zeros((1, 1), dtype=np.int16)
            decoded_packets = 0

            class FakeResampler:
                def __init__(self, **kwargs):
                    pass

                def resample(self, frame):
                    if frame is None:
                        return []
                    return [frame]

            def make_packet(frame):
                def decode():
                    nonlocal decoded_packets
                    decoded_packets += 1
                    return [frame]
                return SimpleNamespace(decode=decode)

            over_packets = (
                [make_packet(SimpleNamespace(to_ndarray=lambda arr=one_min_pcm: arr)) for _ in range(45)]
                + [make_packet(SimpleNamespace(to_ndarray=lambda arr=one_sample_pcm: arr))]
                + [make_packet(SimpleNamespace(to_ndarray=lambda arr=one_min_pcm: arr))]
            )
            over_container = mock.MagicMock()
            over_container.__enter__.return_value = SimpleNamespace(
                duration=0,  # Forged header
                streams=SimpleNamespace(audio=[SimpleNamespace()]),
                demux=lambda _s: iter(over_packets),
            )
            over_container.__exit__.return_value = False
            fake_av_over = make_fake_av(lambda _p: over_container, FakeResampler)
            with mock.patch.dict(sys.modules, {"av": fake_av_over, "faster_whisper": fake_fw}):
                with self.assertRaises(ValueError) as ctx:
                    parser.transcribe_video(str(video_path))
                self.assertEqual(str(ctx.exception), "视频超过45分钟，请先拆分后上传")
            self.assertEqual(decoded_packets, 46)

            # 3) Multi-chunk PCM -> float32 streaming accuracy + resampler flush.
            chunk_packets = [
                SimpleNamespace(decode=lambda: over_frames[:6]),
                SimpleNamespace(decode=lambda: over_frames[6:]),
            ]
            chunk_container = mock.MagicMock()
            chunk_container.__enter__.return_value = SimpleNamespace(
                streams=SimpleNamespace(audio=[SimpleNamespace()]),
                demux=lambda _s: iter(chunk_packets),
            )
            chunk_container.__exit__.return_value = False
            fake_av_chunks = make_fake_av(lambda _p: chunk_container, FakeResampler)
            with mock.patch.dict(sys.modules, {"av": fake_av_chunks}):
                got = list(parser.iter_video_audio_chunks(str(video_path), chunk_sec=4.0, max_duration_sec=10.0))
            self.assertEqual(len(got), 3)
            self.assertAlmostEqual(got[0][0], 0.0)
            self.assertEqual(len(got[0][1]), 4 * 16000)
            self.assertEqual(got[0][1].dtype, np.float32)
            self.assertAlmostEqual(float(got[0][1][0]), 0.5, places=4)
            self.assertAlmostEqual(got[1][0], 4.0)
            self.assertEqual(len(got[1][1]), 4 * 16000)
            self.assertAlmostEqual(got[2][0], 8.0)
            self.assertEqual(len(got[2][1]), 2 * 16000)

            # 4) AVError sanitized without leaking path.
            def failing_open(p):
                raise FakeAVError(f"cannot open {p}")

            fake_av_err = make_fake_av(failing_open)
            with mock.patch.dict(sys.modules, {"av": fake_av_err}):
                with self.assertRaises(ValueError) as ctx:
                    list(parser.iter_video_audio_chunks(str(video_path)))
                self.assertEqual(str(ctx.exception), "视频解码失败，请确认文件未损坏且包含有效音轨")
                self.assertNotIn("clip_sensitive_name", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
