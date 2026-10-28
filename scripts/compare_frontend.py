"""Compare matched source/local captures, never fetch pages or infer functional coverage.

Optional research dependencies: Pillow, numpy, opencv-python.
Input: source route-desktop.png and local-route-desktop.png at the same viewport.
"""
from pathlib import Path
import argparse
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw


def ssim(left, right):
    """Mean grayscale SSIM, Gaussian 11x11/1.5, data range 255."""
    a = cv2.cvtColor(np.asarray(left), cv2.COLOR_RGB2GRAY).astype(float)
    b = cv2.cvtColor(np.asarray(right), cv2.COLOR_RGB2GRAY).astype(float)
    x = cv2.GaussianBlur(a, (11, 11), 1.5)
    y = cv2.GaussianBlur(b, (11, 11), 1.5)
    v = cv2.GaussianBlur(a * a, (11, 11), 1.5) - x * x
    w = cv2.GaussianBlur(b * b, (11, 11), 1.5) - y * y
    c = cv2.GaussianBlur(a * b, (11, 11), 1.5) - x * y
    return float((((2*x*y + 6.5025) * (2*c + 58.5225)) /
                  ((x*x + y*y + 6.5025) * (v + w + 58.5225))).mean())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("captures", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for local_path in sorted(args.captures.glob("local-*-desktop.png")):
        source_path = local_path.with_name(local_path.name.removeprefix("local-"))
        if not source_path.exists():
            continue
        a = Image.open(source_path).convert("RGB")
        b = Image.open(local_path).convert("RGB")
        width = min(a.width, b.width)
        viewport_height = min(a.height, b.height, 1000)
        shared_height = min(a.height, b.height)
        viewport = (0, 0, width, viewport_height)
        shared = (0, 0, width, shared_height)
        score = ssim(a.crop(viewport), b.crop(viewport))
        full_score = ssim(a.crop(shared), b.crop(shared))
        route = source_path.stem.removesuffix("-desktop")
        result = {"page": route, "sourceSize": list(a.size), "localSize": list(b.size),
                  "viewportSsim": round(score, 4), "sharedHeightSsim": round(full_score, 4),
                  "heightAgreement": round(shared_height / max(a.height, b.height), 4)}
        results.append(result)
        montage = Image.new("RGB", (1440, 524), "white")
        montage.paste(a.crop((0, 0, 1440, 1000)).resize((720, 500)), (0, 24))
        montage.paste(b.crop((0, 0, 1440, 1000)).resize((720, 500)), (720, 24))
        draw = ImageDraw.Draw(montage)
        draw.text((12, 6), "SOURCE | 1440 x 1000", fill="black")
        draw.text((732, 6), "LOCAL | 1440 x 1000", fill="black")
        montage.save(args.output / f"{route}.webp", quality=88)
        print(f"{route}: viewport={score:.3f} shared-height={full_score:.3f}")
    if not results:
        raise SystemExit("No matched capture pairs found")
    report = {"method": "grayscale Gaussian SSIM; K1=.01 K2=.03; no resizing before scoring",
              "viewport": [1440, 1000], "count": len(results),
              "meanViewportSsim": round(sum(r["viewportSsim"] for r in results)/len(results), 4),
              "meanSharedHeightSsim": round(sum(r["sharedHeightSsim"] for r in results)/len(results), 4),
              "pages": results}
    (args.output / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Mean viewport SSIM: {report['meanViewportSsim']}")


if __name__ == "__main__":
    main()
