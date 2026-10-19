"""Create a clean static release without archives, source material, or Git data."""
from pathlib import Path
import argparse
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def prepare(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "index.html", destination / "index.html")
    (destination / "m2").mkdir(exist_ok=True)
    for name in ("index.html", "model-loader.mjs"):
        shutil.copy2(ROOT / "m2" / name, destination / "m2" / name)
    for name in ("assets/island_tree_glb.glb", "vendor/gesture_recognizer.task", "vendor/gesture_recognizer.task.gz",
                 "vendor/vision_bundle.mjs", "vendor/MEDIAPIPE-NOTICE.md"):
        target = destination / "m2" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "m2" / name, target)
    for name in ("vendor/three", "vendor/wasm"):
        shutil.copytree(ROOT / "m2" / name, destination / "m2" / name, dirs_exist_ok=True)
    shutil.copytree(ROOT / "media", destination / "media", dirs_exist_ok=True)
    (destination / "_headers").write_text(
        "/m2/vendor/*\n  Cache-Control: public, max-age=86400\n"
        "/m2/vendor/wasm/*.wasm\n  Content-Type: application/wasm\n"
        "/m2/vendor/*.mjs\n  Content-Type: application/javascript\n"
        "/m2/*.mjs\n  Content-Type: application/javascript\n", encoding="utf-8")
    files = sorted(path for path in destination.rglob("*") if path.is_file())
    oversized = [str(path.relative_to(destination)) for path in files if path.stat().st_size > 25 * 1024 * 1024]
    if oversized:
        raise ValueError(f"Files exceed the 25 MiB free-hosting limit: {oversized}")
    print(f"Prepared {len(files)} static files ({sum(p.stat().st_size for p in files) / 1000000:.1f} MB): {destination}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--zip", type=Path)
    args = parser.parse_args()
    prepare(args.out.resolve())
    if args.zip:
        args.zip.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.zip, "w", compression=zipfile.ZIP_DEFLATED) as release:
            for path in sorted(args.out.rglob("*")):
                if path.is_file():
                    release.write(path, path.relative_to(args.out).as_posix())
        print(f"Upload ZIP: {args.zip.resolve()}")
