from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
import requests

ROOT = Path(".tmp-video-work")
ROOT.mkdir(exist_ok=True)
FRAMES_DIR = ROOT / "original_frames"
MASKS_DIR = ROOT / "masks"
OUT_DIR = ROOT / "output_frames"
KEY_DIR = ROOT / "keyframes"
for directory in (FRAMES_DIR, MASKS_DIR, OUT_DIR, KEY_DIR):
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)


def download(url: str, path: Path) -> None:
    with requests.get(url, stream=True, timeout=180) as response:
        response.raise_for_status()
        with path.open("wb") as handle:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    handle.write(chunk)


def run(command: list[str]) -> None:
    print("$", " ".join(command), flush=True)
    subprocess.run(command, check=True)


def interp(keys: dict[int, tuple[float, float, float, float]], index: int):
    frames = sorted(keys)
    if index < frames[0] or index > frames[-1]:
        return None
    if index in keys:
        return keys[index]
    before = max(frame for frame in frames if frame < index)
    after = min(frame for frame in frames if frame > index)
    amount = (index - before) / (after - before)
    return tuple((1 - amount) * keys[before][j] + amount * keys[after][j] for j in range(4))


def draw_human(mask: np.ndarray, box, seated: bool = False, woman: bool = False) -> None:
    if box is None:
        return
    x, y, width, height = box

    def point(u: float, v: float) -> tuple[int, int]:
        return int(round(x + u * width)), int(round(y + v * height))

    if seated:
        cv2.ellipse(mask, point(0.5, 0.12), (max(4, int(0.27 * width)), max(5, int(0.11 * height))), 0, 0, 360, 255, -1)
        polygon = np.array([
            point(0.15, 0.18), point(0.85, 0.18), point(0.98, 0.58), point(0.80, 0.74),
            point(0.66, 0.67), point(0.62, 1.0), point(0.30, 1.0), point(0.36, 0.66), point(0.03, 0.55),
        ], np.int32)
        cv2.fillPoly(mask, [polygon], 255)
        return

    if woman:
        cv2.ellipse(mask, point(0.50, 0.10), (max(5, int(0.25 * width)), max(6, int(0.09 * height))), 0, 0, 360, 255, -1)
        cv2.ellipse(mask, point(0.50, 0.21), (max(6, int(0.34 * width)), max(8, int(0.18 * height))), 0, 0, 360, 255, -1)
        polygon = np.array([
            point(0.18, 0.15), point(0.82, 0.15), point(0.94, 0.36), point(0.84, 0.56),
            point(0.94, 0.84), point(0.78, 1.0), point(0.54, 1.0), point(0.48, 0.76),
            point(0.38, 1.0), point(0.12, 1.0), point(0.02, 0.78), point(0.15, 0.54), point(0.04, 0.35),
        ], np.int32)
        cv2.fillPoly(mask, [polygon], 255)
        cv2.line(mask, point(0.25, 0.27), point(-0.05, 0.62), 255, max(8, int(0.18 * width)))
        cv2.line(mask, point(0.75, 0.27), point(1.05, 0.64), 255, max(8, int(0.18 * width)))
        return

    cv2.ellipse(mask, point(0.5, 0.10), (max(4, int(0.27 * width)), max(5, int(0.10 * height))), 0, 0, 360, 255, -1)
    polygon = np.array([
        point(0.14, 0.17), point(0.86, 0.17), point(0.97, 0.56), point(0.76, 1.0),
        point(0.50, 1.0), point(0.23, 1.0), point(0.03, 0.55),
    ], np.int32)
    cv2.fillPoly(mask, [polygon], 255)


def manual_mask(index: int, width: int, height: int) -> np.ndarray:
    scale_x = width / 478.0
    scale_y = height / 850.0
    mask = np.zeros((height, width), np.uint8)

    tracks = {
        "desk": {
            1: (265, 365, 120, 220), 30: (240, 372, 125, 220), 60: (195, 377, 135, 225),
            90: (125, 382, 150, 230), 110: (65, 385, 165, 235), 125: (5, 386, 170, 240),
            140: (-55, 388, 175, 245), 155: (-110, 390, 180, 250),
        },
        "standing": {
            112: (470, 245, 60, 205), 125: (442, 248, 62, 208), 140: (400, 250, 65, 215),
            155: (330, 248, 72, 225), 175: (190, 245, 82, 240), 195: (42, 242, 90, 250),
            215: (-95, 240, 95, 260),
        },
        "red": {
            120: (470, 290, 70, 205), 140: (435, 292, 72, 210), 160: (375, 292, 78, 220),
            185: (275, 294, 84, 235), 210: (170, 298, 90, 250), 235: (65, 302, 96, 265),
            265: (-55, 308, 105, 280),
        },
        "white": {
            120: (485, 285, 72, 215), 140: (455, 286, 76, 220), 160: (410, 288, 82, 230),
            185: (305, 290, 90, 245), 210: (200, 294, 98, 260), 235: (95, 298, 105, 275),
            260: (-8, 302, 112, 290), 275: (-70, 305, 118, 300),
        },
        "woman": {
            132: (472, 520, 35, 330), 142: (450, 485, 65, 365), 151: (370, 410, 125, 440),
            161: (300, 370, 180, 480), 176: (190, 335, 220, 515), 201: (125, 310, 250, 540),
            226: (85, 280, 265, 585), 251: (70, 205, 290, 660), 263: (45, 145, 365, 720),
            275: (-10, 25, 500, 835),
        },
        "rightman": {
            138: (475, 315, 55, 500), 151: (455, 320, 65, 495), 165: (420, 325, 78, 485),
            180: (392, 335, 95, 470), 195: (410, 350, 80, 455), 212: (462, 375, 45, 430),
        },
    }

    for name, keys in tracks.items():
        box = interp(keys, index)
        if box is None:
            continue
        scaled = (box[0] * scale_x, box[1] * scale_y, box[2] * scale_x, box[3] * scale_y)
        draw_human(mask, scaled, seated=name in {"red", "white"}, woman=name == "woman")

    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    return cv2.dilate(mask, np.ones((11, 11), np.uint8), iterations=1)


def align_clean(clean: np.ndarray, original: np.ndarray, mask: np.ndarray) -> np.ndarray:
    clean = cv2.resize(clean, (original.shape[1], original.shape[0]), interpolation=cv2.INTER_LANCZOS4)
    gray_clean = cv2.cvtColor(clean, cv2.COLOR_BGR2GRAY)
    gray_orig = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY)
    safe = cv2.bitwise_not(cv2.dilate(mask, np.ones((31, 31), np.uint8), iterations=1))
    detector = cv2.SIFT_create(nfeatures=5000, contrastThreshold=0.015, edgeThreshold=15)
    key_clean, desc_clean = detector.detectAndCompute(gray_clean, safe)
    key_orig, desc_orig = detector.detectAndCompute(gray_orig, safe)
    homography = None
    if desc_clean is not None and desc_orig is not None:
        matches = cv2.BFMatcher(cv2.NORM_L2).knnMatch(desc_clean, desc_orig, k=2)
        good = [first for first, second in matches if first.distance < 0.72 * second.distance]
        if len(good) >= 10:
            source = np.float32([key_clean[item.queryIdx].pt for item in good])
            target = np.float32([key_orig[item.trainIdx].pt for item in good])
            homography, inliers = cv2.findHomography(source, target, cv2.USAC_MAGSAC, 3.0, maxIters=12000, confidence=0.999)
            if homography is not None and (inliers is None or int(inliers.sum()) < 8):
                homography = None
    if homography is None:
        return clean
    return cv2.warpPerspective(clean, homography, (original.shape[1], original.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)


def estimate_adjacent(frames: list[np.ndarray], masks: list[np.ndarray]) -> list[np.ndarray]:
    detector = cv2.ORB_create(3000, scaleFactor=1.2, nlevels=8, edgeThreshold=12, fastThreshold=7)
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    transforms: list[np.ndarray] = []
    for pos in range(len(frames) - 1):
        first = frames[pos]
        second = frames[pos + 1]
        valid_first = cv2.bitwise_not(cv2.dilate(masks[pos], np.ones((15, 15), np.uint8), 1))
        valid_second = cv2.bitwise_not(cv2.dilate(masks[pos + 1], np.ones((15, 15), np.uint8), 1))
        gray_first = cv2.cvtColor(first, cv2.COLOR_BGR2GRAY)
        gray_second = cv2.cvtColor(second, cv2.COLOR_BGR2GRAY)
        keys_first, desc_first = detector.detectAndCompute(gray_first, valid_first)
        keys_second, desc_second = detector.detectAndCompute(gray_second, valid_second)
        transform = np.eye(3, dtype=np.float64)
        if desc_first is not None and desc_second is not None:
            pairs = matcher.knnMatch(desc_first, desc_second, k=2)
            good = [first_match for first_match, second_match in pairs if first_match.distance < 0.78 * second_match.distance]
            if len(good) >= 8:
                source = np.float32([keys_first[item.queryIdx].pt for item in good])
                target = np.float32([keys_second[item.trainIdx].pt for item in good])
                affine, inliers = cv2.estimateAffinePartial2D(source, target, method=cv2.RANSAC, ransacReprojThreshold=2.0, maxIters=4000, confidence=0.997, refineIters=20)
                if affine is not None:
                    transform = np.vstack([affine, [0.0, 0.0, 1.0]]).astype(np.float64)
        transforms.append(transform)
        if (pos + 1) % 50 == 0:
            print("motion", pos + 1, flush=True)
    return transforms


def compose_coordinates(transforms: list[np.ndarray]) -> np.ndarray:
    cumulative = [np.eye(3, dtype=np.float64)]
    for transform in transforms:
        cumulative.append(cumulative[-1] @ np.linalg.inv(transform))
    return np.stack(cumulative)


def color_match(warped: np.ndarray, original: np.ndarray, mask: np.ndarray, valid: np.ndarray) -> np.ndarray:
    expanded = cv2.dilate(mask, np.ones((31, 31), np.uint8), 1)
    inner = cv2.dilate(mask, np.ones((5, 5), np.uint8), 1)
    ring = (expanded > 0) & (inner == 0) & valid
    if int(ring.sum()) < 120:
        return warped
    delta = np.median(original[ring].astype(np.float32) - warped[ring].astype(np.float32), axis=0)
    delta = np.clip(delta, -16, 16)
    return np.clip(warped.astype(np.float32) + delta, 0, 255).astype(np.uint8)


def make_contact_sheet(originals: list[np.ndarray], masks: list[np.ndarray], plates: dict[int, np.ndarray], outputs: list[np.ndarray], keys: list[int]) -> None:
    thumb_width, thumb_height = 239, 425
    sheet = np.full((len(keys) * thumb_height, 4 * thumb_width, 3), 28, np.uint8)
    for row, key in enumerate(keys):
        original = originals[key - 1]
        overlay = original.copy()
        overlay[masks[key - 1] > 0] = (0, 0, 255)
        overlay = cv2.addWeighted(original, 0.45, overlay, 0.55, 0)
        panels = [original, overlay, plates[key], outputs[key - 1]]
        for column, panel in enumerate(panels):
            resized = cv2.resize(panel, (thumb_width, thumb_height), interpolation=cv2.INTER_AREA)
            sheet[row * thumb_height:(row + 1) * thumb_height, column * thumb_width:(column + 1) * thumb_width] = resized
        cv2.putText(sheet, str(key), (5, row * thumb_height + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2, cv2.LINE_AA)
    cv2.imwrite("diagnostics.jpg", sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])


def main() -> None:
    config = json.loads(Path(".tmp-video-cleanup-config.json").read_text())
    video_path = ROOT / "source.mov"
    mask_video_path = ROOT / "people_removed.webm"
    download(config["video_url"], video_path)
    download(config["mask_video_url"], mask_video_path)

    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video_path), "-vf", "fps=30", str(FRAMES_DIR / "f%04d.png")])
    alpha_command = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(mask_video_path), "-vf", "fps=30,format=rgba,alphaextract", str(MASKS_DIR / "a%04d.png")]
    try:
        run(alpha_command)
    except subprocess.CalledProcessError:
        print("Alpha extraction failed; using conservative tracked masks.", flush=True)

    frame_paths = sorted(FRAMES_DIR.glob("f*.png"))
    frames = [cv2.imread(str(path)) for path in frame_paths]
    if not frames:
        raise RuntimeError("No frames extracted")
    height, width = frames[0].shape[:2]
    frame_count = len(frames)
    print("frames", frame_count, "size", width, height, flush=True)

    masks: list[np.ndarray] = []
    alpha_paths = sorted(MASKS_DIR.glob("a*.png"))
    for index in range(1, frame_count + 1):
        conservative = manual_mask(index, width, height)
        if index <= len(alpha_paths):
            alpha = cv2.imread(str(alpha_paths[index - 1]), cv2.IMREAD_GRAYSCALE)
            if alpha is not None:
                alpha = cv2.resize(alpha, (width, height), interpolation=cv2.INTER_NEAREST)
                segmented = cv2.threshold(255 - alpha, 20, 255, cv2.THRESH_BINARY)[1]
                segmented = cv2.morphologyEx(segmented, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
                segmented = cv2.dilate(segmented, np.ones((7, 7), np.uint8), 1)
                conservative = cv2.max(conservative, segmented)
        masks.append(conservative)

    key_indices = [int(item["frame"]) for item in config["keyframes"]]
    clean_images: dict[int, np.ndarray] = {}
    for item in config["keyframes"]:
        key = int(item["frame"])
        destination = KEY_DIR / f"clean_{key:04d}.png"
        download(item["url"], destination)
        clean = cv2.imread(str(destination))
        if clean is None:
            raise RuntimeError(f"Unable to read clean keyframe {key}")
        clean_images[key] = clean

    plates: dict[int, np.ndarray] = {}
    for key in key_indices:
        original = frames[key - 1]
        mask = masks[key - 1]
        aligned = align_clean(clean_images[key], original, mask)
        plate = original.copy()
        plate[mask > 0] = aligned[mask > 0]
        plates[key] = plate
        cv2.imwrite(str(KEY_DIR / f"plate_{key:04d}.jpg"), plate, [cv2.IMWRITE_JPEG_QUALITY, 95])

    transforms = estimate_adjacent(frames, masks)
    cumulative = compose_coordinates(transforms)

    outputs: list[np.ndarray] = []
    previous_output = None
    for index in range(1, frame_count + 1):
        original = frames[index - 1]
        mask = masks[index - 1]
        inside = mask > 0
        previous_key = max((key for key in key_indices if key <= index), default=key_indices[0])
        next_key = min((key for key in key_indices if key >= index), default=key_indices[-1])

        estimates = []
        weights = []
        for key in sorted({previous_key, next_key}):
            transform = np.linalg.inv(cumulative[index - 1]) @ cumulative[key - 1]
            warped = cv2.warpPerspective(plates[key], transform, (width, height), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
            valid = cv2.warpPerspective(np.full((height, width), 255, np.uint8), transform, (width, height), flags=cv2.INTER_NEAREST, borderValue=0) > 0
            warped = color_match(warped, original, mask, valid)
            estimates.append((warped, valid))
            if previous_key == next_key:
                weights.append(1.0)
            elif key == previous_key:
                weights.append((next_key - index) / (next_key - previous_key))
            else:
                weights.append((index - previous_key) / (next_key - previous_key))

        numerator = np.zeros_like(original, dtype=np.float32)
        denominator = np.zeros((height, width), dtype=np.float32)
        for (estimate, valid), weight in zip(estimates, weights):
            effective = valid.astype(np.float32) * max(weight, 0.001)
            numerator += estimate.astype(np.float32) * effective[..., None]
            denominator += effective
        fill = numerator / np.maximum(denominator[..., None], 1e-4)
        fill = np.clip(fill, 0, 255).astype(np.uint8)

        output = original.copy()
        usable = inside & (denominator > 0.01)
        output[usable] = fill[usable]
        holes = (inside & ~usable).astype(np.uint8) * 255
        if holes.any():
            output = cv2.inpaint(output, holes, 3, cv2.INPAINT_TELEA)

        if previous_output is not None:
            warped_previous = cv2.warpPerspective(previous_output, transforms[index - 2], (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            deep = cv2.distanceTransform(inside.astype(np.uint8), cv2.DIST_L2, 5) > 10
            output[deep] = (0.90 * output[deep].astype(np.float32) + 0.10 * warped_previous[deep].astype(np.float32)).astype(np.uint8)

        distance = cv2.distanceTransform(inside.astype(np.uint8), cv2.DIST_L2, 5)
        alpha = np.clip(distance / 4.0, 0, 1)
        outer = cv2.GaussianBlur(inside.astype(np.float32), (0, 0), 1.2)
        alpha = np.maximum(alpha, outer * 0.72)
        output = (output.astype(np.float32) * alpha[..., None] + original.astype(np.float32) * (1 - alpha[..., None])).astype(np.uint8)

        cv2.imwrite(str(OUT_DIR / f"f{index:04d}.png"), output, [cv2.IMWRITE_PNG_COMPRESSION, 3])
        outputs.append(output)
        previous_output = output
        if index % 50 == 0:
            print("render", index, flush=True)

    make_contact_sheet(frames, masks, plates, outputs, key_indices)

    run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", str(OUT_DIR / "f%04d.png"), "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "silent.mp4"])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", "silent.mp4", "-i", str(video_path), "-map", "0:v:0", "-map", "1:a?", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "video_sem_pessoas_v2.mp4"])
    print("Finished video_sem_pessoas_v2.mp4", flush=True)


if __name__ == "__main__":
    main()
