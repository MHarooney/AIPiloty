"""Image generation service with pluggable provider architecture."""

from __future__ import annotations

import abc
import asyncio
import base64
import json
import logging
import os
import random
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

GENERATED_IMAGES_DIR = "generated/images"
SAFETY_NEGATIVE = "nsfw, nude, naked, violent, gore, blood, disturbing"


@dataclass
class ImageResult:
    success: bool
    relative_path: str = ""
    absolute_path: str = ""
    seed: int = 0
    width: int = 512
    height: int = 512
    generation_time_ms: int = 0
    file_size: int = 0
    error: str = ""


class ImageProvider(abc.ABC):
    """Abstract interface for image generation backends."""

    @property
    @abc.abstractmethod
    def name(self) -> str:
        ...

    @abc.abstractmethod
    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        steps: int = 20,
        seed: Optional[int] = None,
    ) -> bytes:
        """Generate image and return raw PNG bytes."""
        ...

    @abc.abstractmethod
    async def is_available(self) -> bool:
        ...


class PlaceholderProvider(ImageProvider):
    """Generates a simple placeholder PNG when no real provider is configured.
    Uses Pillow to draw a text overlay on a solid color background.
    """

    @property
    def name(self) -> str:
        return "placeholder"

    async def is_available(self) -> bool:
        try:
            from PIL import Image  # noqa: F401
            return True
        except ImportError:
            return False

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        steps: int = 20,
        seed: Optional[int] = None,
    ) -> bytes:
        from PIL import Image, ImageDraw, ImageFont
        import io

        seed = seed or random.randint(0, 2**31)
        rng = random.Random(seed)

        bg_color = (rng.randint(20, 80), rng.randint(20, 80), rng.randint(40, 120))
        img = Image.new("RGB", (width, height), bg_color)
        draw = ImageDraw.Draw(img)

        # Draw a gradient-like pattern
        for i in range(0, height, 4):
            r = min(255, bg_color[0] + i // 4)
            g = min(255, bg_color[1] + i // 6)
            b = min(255, bg_color[2] + i // 3)
            draw.line([(0, i), (width, i)], fill=(r, g, b))

        # Add prompt text
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size=max(14, width // 25))
        except (OSError, IOError):
            font = ImageFont.load_default()

        lines = _wrap_text(prompt, max_chars=width // 10)
        y = height // 3
        for line in lines[:6]:
            bbox = draw.textbbox((0, 0), line, font=font)
            tw = bbox[2] - bbox[0]
            x = (width - tw) // 2
            draw.text((x + 1, y + 1), line, fill=(0, 0, 0), font=font)
            draw.text((x, y), line, fill=(220, 220, 255), font=font)
            y += bbox[3] - bbox[1] + 6

        # Label
        label = f"Placeholder • {width}x{height} • seed:{seed}"
        try:
            small_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size=11)
        except (OSError, IOError):
            small_font = ImageFont.load_default()
        draw.text((8, height - 20), label, fill=(150, 150, 180), font=small_font)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


class SDXLTurboProvider(ImageProvider):
    """Local SDXL Turbo image generation using diffusers + PyTorch/MPS.

    SDXL Turbo generates 512x512 images in 1-4 steps, ideal for fast local
    generation on Apple Silicon (MPS) or CUDA GPUs.  The model (~3.5 GB) is
    loaded lazily on first request and kept resident for subsequent calls.
    """

    MODEL_ID = "stabilityai/sdxl-turbo"

    def __init__(self, model_id: Optional[str] = None, offload: bool = True) -> None:
        self._model_id = model_id or self.MODEL_ID
        self._offload = offload
        self._pipe: Any = None
        self._lock = asyncio.Lock()

    @property
    def name(self) -> str:
        return "sdxl_turbo"

    async def is_available(self) -> bool:
        try:
            import torch  # noqa: F401
            from diffusers import AutoPipelineForText2Image  # noqa: F401
            return True
        except ImportError:
            return False

    def _get_device(self) -> str:
        import torch
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"

    def _load_pipeline(self) -> Any:
        import torch
        from diffusers import AutoPipelineForText2Image

        device = self._get_device()
        dtype = torch.float16 if device in ("cuda", "mps") else torch.float32

        pipe = AutoPipelineForText2Image.from_pretrained(
            self._model_id,
            torch_dtype=dtype,
            variant="fp16" if dtype == torch.float16 else None,
        )
        pipe = pipe.to(device)

        # Disable safety checker for speed (we add our own negative prompt safety)
        if hasattr(pipe, "safety_checker"):
            pipe.safety_checker = None
        if hasattr(pipe, "feature_extractor"):
            pipe.feature_extractor = None

        return pipe

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        steps: int = 4,
        seed: Optional[int] = None,
    ) -> bytes:
        import io
        import torch

        async with self._lock:
            if self._pipe is None:
                logger.info("Loading SDXL Turbo model %s …", self._model_id)
                self._pipe = await asyncio.get_event_loop().run_in_executor(
                    None, self._load_pipeline
                )
                logger.info("SDXL Turbo model loaded on %s", self._get_device())

        pipe = self._pipe
        device = self._get_device()
        gen = torch.Generator(device=device if device != "mps" else "cpu")
        if seed is not None:
            gen.manual_seed(seed)

        # SDXL Turbo works best with guidance_scale=0.0 and 1-4 steps
        steps = max(1, min(steps, 8))

        def _run() -> bytes:
            result = pipe(
                prompt=prompt,
                negative_prompt=negative_prompt or None,
                num_inference_steps=steps,
                guidance_scale=0.0,
                width=width,
                height=height,
                generator=gen,
            )
            img = result.images[0]
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()

        return await asyncio.get_event_loop().run_in_executor(None, _run)


class ExternalAPIProvider(ImageProvider):
    """Calls an external image generation API (Replicate, Stability, ComfyUI, etc.)."""

    def __init__(self, api_url: str) -> None:
        self._api_url = api_url.rstrip("/")

    @property
    def name(self) -> str:
        return "external_api"

    async def is_available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self._api_url}/health")
                return resp.status_code < 500
        except Exception:
            return False

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        steps: int = 20,
        seed: Optional[int] = None,
    ) -> bytes:
        payload = {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "width": width,
            "height": height,
            "steps": steps,
        }
        if seed is not None:
            payload["seed"] = seed

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{self._api_url}/generate", json=payload)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "image" in content_type:
                return resp.content
            elif "json" in content_type:
                data = resp.json()
                img_b64 = data.get("image") or data.get("images", [None])[0]
                if not img_b64:
                    raise RuntimeError("API returned no image data")
                return base64.b64decode(img_b64)
            else:
                raise RuntimeError(f"Unexpected content type: {content_type}")


class ImageGenerationService:
    """Orchestrates image generation, storage, and history."""

    def __init__(self, workspace_root: str, provider: Optional[ImageProvider] = None) -> None:
        self._workspace = Path(workspace_root).resolve()
        self._images_dir = self._workspace / GENERATED_IMAGES_DIR
        self._images_dir.mkdir(parents=True, exist_ok=True)
        self._provider = provider

    @property
    def provider_name(self) -> str:
        return self._provider.name if self._provider else "none"

    async def is_configured(self) -> bool:
        if not self._provider:
            return False
        return await self._provider.is_available()

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        steps: int = 20,
        seed: Optional[int] = None,
        model: Optional[str] = None,
    ) -> ImageResult:
        if not self._provider:
            return ImageResult(success=False, error="Image generation not configured. No provider available.")

        # Clamp dimensions
        width = max(64, min(int(width), 2048))
        height = max(64, min(int(height), 2048))
        steps = max(1, min(int(steps), 100))
        seed = seed or random.randint(0, 2**31)

        # Safety: append negative prompt
        full_negative = f"{negative_prompt}, {SAFETY_NEGATIVE}" if negative_prompt else SAFETY_NEGATIVE

        fname = f"img_{uuid.uuid4().hex[:12]}.png"
        out_path = self._images_dir / fname

        start = time.monotonic()
        try:
            img_bytes = await self._provider.generate(
                prompt=prompt,
                negative_prompt=full_negative,
                width=width,
                height=height,
                steps=steps,
                seed=seed,
            )
        except Exception as e:
            logger.error("Image generation failed: %s", e)
            return ImageResult(success=False, error=str(e))

        elapsed_ms = int((time.monotonic() - start) * 1000)

        out_path.write_bytes(img_bytes)
        rel_path = str(out_path.relative_to(self._workspace))

        return ImageResult(
            success=True,
            relative_path=rel_path,
            absolute_path=str(out_path),
            seed=seed,
            width=width,
            height=height,
            generation_time_ms=elapsed_ms,
            file_size=len(img_bytes),
        )


def _wrap_text(text: str, max_chars: int = 40) -> List[str]:
    words = text.split()
    lines: List[str] = []
    current = ""
    for w in words:
        if len(current) + len(w) + 1 > max_chars:
            lines.append(current)
            current = w
        else:
            current = f"{current} {w}" if current else w
    if current:
        lines.append(current)
    return lines


def create_image_service(
    workspace_root: str,
    image_gen_api_url: Optional[str] = None,
    image_provider: Optional[str] = None,
    sdxl_model_id: Optional[str] = None,
) -> ImageGenerationService:
    """Factory to create the image service with the best available provider.

    Provider selection priority:
    1. ``image_provider="sdxl_turbo"`` → local SDXL Turbo (requires diffusers+torch)
    2. ``image_gen_api_url`` set → external API
    3. Fallback → Pillow placeholder
    """
    provider: Optional[ImageProvider] = None

    if image_provider == "sdxl_turbo":
        sdxl = SDXLTurboProvider(model_id=sdxl_model_id)
        # Check at startup whether the required packages are installed
        try:
            import torch  # noqa: F401
            from diffusers import AutoPipelineForText2Image  # noqa: F401
            provider = sdxl
            logger.info("Image generation: using SDXL Turbo (%s)", sdxl._model_id)
        except ImportError:
            logger.warning(
                "SDXL Turbo requested but diffusers/torch not installed. "
                "Install with: pip install diffusers[torch] transformers accelerate. "
                "Falling back to placeholder."
            )
            provider = PlaceholderProvider()
    elif image_gen_api_url:
        provider = ExternalAPIProvider(image_gen_api_url)
        logger.info("Image generation: using external API at %s", image_gen_api_url)
    else:
        provider = PlaceholderProvider()
        logger.info("Image generation: using placeholder provider (Pillow)")

    return ImageGenerationService(workspace_root, provider)
