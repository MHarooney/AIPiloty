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
    model: str = ""
    provider: str = ""
    # When set, caller should ask the user (model choice / missing API key)
    needs_input: Optional[Dict[str, Any]] = None


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



class OpenAIImagesProvider(ImageProvider):
    """OpenAI Images API (DALL·E 3) — ChatGPT-class quality via cloud API.

    Requires OPENAI_API_KEY. Uses response_format=b64_json so no second download hop.
    """

    def __init__(
        self,
        api_key: str,
        model: str = "dall-e-3",
        quality: str = "hd",
        base_url: str = "https://api.openai.com/v1",
    ) -> None:
        self._api_key = api_key.strip()
        self._model = model
        self._quality = quality if model.startswith("dall-e-3") else "standard"
        self._base_url = base_url.rstrip("/")

    @property
    def name(self) -> str:
        return f"openai:{self._model}"

    async def is_available(self) -> bool:
        return bool(self._api_key)

    @staticmethod
    def _pick_size(width: int, height: int) -> str:
        ratio = width / max(height, 1)
        if ratio >= 1.4:
            return "1792x1024"
        if ratio <= 0.75:
            return "1024x1792"
        return "1024x1024"

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        steps: int = 20,
        seed: Optional[int] = None,
    ) -> bytes:
        full_prompt = prompt.strip()
        if negative_prompt:
            full_prompt = f"{full_prompt}. Avoid: {negative_prompt[:200]}"
        size = self._pick_size(width, height)
        # Newer Images API rejects response_format; prefer URL then download.
        payload: dict[str, Any] = {
            "model": self._model,
            "prompt": full_prompt[:4000],
            "n": 1,
            "size": size,
        }
        if self._model.startswith("dall-e-3"):
            payload["quality"] = self._quality
        # Legacy dall-e-2 still accepts b64; try only for that model
        if self._model.startswith("dall-e-2"):
            payload["response_format"] = "b64_json"

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                f"{self._base_url}/images/generations",
                headers=headers,
                json=payload,
            )
            # Some API keys only expose gpt-image-*; soft-fallback from classic DALL·E ids
            if (
                resp.status_code >= 400
                and self._model.startswith("dall-e")
                and "does not exist" in (resp.text or "").lower()
            ):
                logger.warning(
                    "OpenAI model %s unavailable for this key — falling back to gpt-image-1",
                    self._model,
                )
                self._model = "gpt-image-1"
                payload.pop("quality", None)
                payload["model"] = "gpt-image-1"
                resp = await client.post(
                    f"{self._base_url}/images/generations",
                    headers=headers,
                    json=payload,
                )
            if resp.status_code >= 400:
                detail = resp.text[:500]
                raise RuntimeError(f"OpenAI Images API {resp.status_code}: {detail}")
            data = resp.json()
            items = data.get("data") or []
            if not items:
                raise RuntimeError("OpenAI Images API returned no image data")
            b64 = items[0].get("b64_json")
            if b64:
                return base64.b64decode(b64)
            url = items[0].get("url")
            if not url:
                raise RuntimeError("OpenAI Images API: missing b64_json and url")
            img_resp = await client.get(url)
            img_resp.raise_for_status()
            return img_resp.content


class GeminiImagesProvider(ImageProvider):
    """Google Gemini native image models (Nano Banana family) via generateContent."""

    # Prefer newer ids; keep retired ids as remap targets for old Settings defaults.
    _MODEL_ALIASES = {
        "gemini-2.0-flash-preview-image-generation": "gemini-2.5-flash-image",
        "imagen-3.0-generate-002": "gemini-3.1-flash-image",
        "imagen-3": "gemini-3.1-flash-image",
        "nano-banana": "gemini-2.5-flash-image",
    }

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-2.5-flash-image",
        base_url: str = "https://generativelanguage.googleapis.com/v1beta",
    ) -> None:
        self._api_key = (api_key or "").strip()
        raw = (model or "gemini-2.5-flash-image").strip()
        self._model = self._MODEL_ALIASES.get(raw, raw)
        self._base_url = base_url.rstrip("/")

    @property
    def name(self) -> str:
        return f"gemini:{self._model}"

    async def is_available(self) -> bool:
        return bool(self._api_key)

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        steps: int = 20,
        seed: Optional[int] = None,
    ) -> bytes:
        full_prompt = prompt.strip()
        if negative_prompt:
            full_prompt = f"{full_prompt}. Avoid: {negative_prompt[:200]}"

        headers = {"Content-Type": "application/json", "x-goog-api-key": self._api_key}
        # Try requested model, then known-good Nano Banana fallbacks.
        candidates = [self._model]
        for alt in ("gemini-2.5-flash-image", "gemini-3.1-flash-image"):
            if alt not in candidates:
                candidates.append(alt)

        last_err = "Gemini Image API failed"
        async with httpx.AsyncClient(timeout=180.0) as client:
            for mid in candidates:
                url = f"{self._base_url}/models/{mid}:generateContent"
                payload = {
                    "contents": [{"role": "user", "parts": [{"text": full_prompt[:4000]}]}],
                    "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
                }
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code >= 400:
                    last_err = f"Gemini Image API {resp.status_code}: {resp.text[:500]}"
                    # Remap retired / missing models
                    if resp.status_code in (404, 400) and mid != candidates[-1]:
                        logger.warning("Gemini model %s failed (%s); trying fallback", mid, resp.status_code)
                        continue
                    raise RuntimeError(last_err)
                data = resp.json()
                for cand in data.get("candidates") or []:
                    for part in (cand.get("content") or {}).get("parts") or []:
                        inline = part.get("inlineData") or part.get("inline_data") or {}
                        b64 = inline.get("data")
                        if b64:
                            self._model = mid
                            return base64.b64decode(b64)
                last_err = f"Gemini model {mid} returned no image parts"
                if mid != candidates[-1]:
                    continue
                raise RuntimeError(last_err)
        raise RuntimeError(last_err)


# ---------------------------------------------------------------------------
# Gemini website session fallback (same engine as gemini.google.com)
# Developer API free-tier image quota is often 0; the consumer app still works.
# Uses browser Google cookies (or GEMINI_SECURE_1PSID / GEMINI_SECURE_1PSIDTS).
# ---------------------------------------------------------------------------

_gemini_web_client: Any = None
_gemini_web_lock = asyncio.Lock()
_gemini_web_init_error: str = ""


def gemini_web_fallback_enabled() -> bool:
    raw = (os.environ.get("GEMINI_WEB_FALLBACK") or "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _gemini_web_model_for(api_model: str) -> Any:
    """Map API catalog ids → gemini.google.com Flash / Pro tiers."""
    try:
        from gemini_webapi.constants import Model
    except ImportError:
        return None
    mid = (api_model or "").lower()
    if "pro" in mid:
        return getattr(Model, "BASIC_PRO", None) or Model.UNSPECIFIED
    # Flash-Lite / Nano Banana → free Flash tier (matches website Flash-Lite)
    return getattr(Model, "BASIC_FLASH", None) or Model.UNSPECIFIED


async def _get_gemini_web_client() -> Any:
    """Lazy singleton GeminiClient from browser cookies or env Secure-1PSID*."""
    global _gemini_web_client, _gemini_web_init_error
    if _gemini_web_client is not None:
        return _gemini_web_client
    async with _gemini_web_lock:
        if _gemini_web_client is not None:
            return _gemini_web_client
        try:
            from gemini_webapi import GeminiClient
        except ImportError as e:
            _gemini_web_init_error = (
                "gemini_webapi not installed — pip install 'gemini_webapi[browser]'"
            )
            raise RuntimeError(_gemini_web_init_error) from e

        psid = (os.environ.get("GEMINI_SECURE_1PSID") or "").strip() or None
        psidts = (os.environ.get("GEMINI_SECURE_1PSIDTS") or "").strip() or None
        client = GeminiClient(secure_1psid=psid, secure_1psidts=psidts)
        try:
            await client.init(timeout=60)
        except Exception as e:
            _gemini_web_init_error = str(e)
            raise RuntimeError(
                f"Gemini website session unavailable ({e}). "
                "Log into gemini.google.com in Chrome, or set "
                "GEMINI_SECURE_1PSID + GEMINI_SECURE_1PSIDTS."
            ) from e
        _gemini_web_client = client
        _gemini_web_init_error = ""
        return client


class GeminiWebImagesProvider(ImageProvider):
    """Generate via gemini.google.com (consumer session) — not the Developer API.

    This is how the website works when AI Studio free-tier image quota is 0.
    """

    def __init__(self, model: str = "gemini-2.5-flash-image") -> None:
        self._api_model = (model or "gemini-2.5-flash-image").strip()
        self._web_model_label = "BASIC_FLASH"

    @property
    def name(self) -> str:
        return f"gemini-web:{self._web_model_label}"

    async def is_available(self) -> bool:
        if not gemini_web_fallback_enabled():
            return False
        try:
            await _get_gemini_web_client()
            return True
        except Exception:
            return False

    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        steps: int = 20,
        seed: Optional[int] = None,
    ) -> bytes:
        import tempfile

        full_prompt = prompt.strip()
        if negative_prompt:
            full_prompt = f"{full_prompt}. Avoid: {negative_prompt[:200]}"
        # Consumer Gemini only generates when asked to "generate/create" an image
        lowered = full_prompt.lower()
        if not any(
            k in lowered for k in ("generate", "create", "draw", "image of", "picture")
        ):
            full_prompt = f"Generate an image: {full_prompt}"

        client = await _get_gemini_web_client()
        web_model = _gemini_web_model_for(self._api_model)
        try:
            resp = await client.generate_content(full_prompt[:4000], model=web_model)
        except Exception as e:
            raise RuntimeError(f"Gemini website generate failed: {e}") from e

        images = list(getattr(resp, "images", None) or [])
        if not images:
            text = (getattr(resp, "text", None) or "").strip()
            raise RuntimeError(
                text
                or "Gemini website returned no image (quota may be exhausted — "
                "check gemini.google.com Settings)."
            )

        img = images[0]
        self._web_model_label = getattr(web_model, "name", None) or str(web_model)
        with tempfile.TemporaryDirectory(prefix="aipiloty_gweb_") as td:
            fname = "out.png"
            await img.save(path=td, filename=fname)
            path = Path(td) / fname
            if not path.exists() or path.stat().st_size < 100:
                raise RuntimeError("Gemini website image save produced an empty file")
            return path.read_bytes()


async def try_gemini_web_fallback(
    prompt: str,
    negative_prompt: str = "",
    width: int = 1024,
    height: int = 1024,
    steps: int = 20,
    seed: Optional[int] = None,
    model: str = "gemini-2.5-flash-image",
) -> Optional[tuple[bytes, str]]:
    """Return (bytes, provider_name) or None if web fallback unavailable/disabled."""
    if not gemini_web_fallback_enabled():
        return None
    try:
        provider = GeminiWebImagesProvider(model=model)
        data = await provider.generate(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            steps=steps,
            seed=seed,
        )
        return data, provider.name
    except Exception as e:
        logger.warning("Gemini website fallback skipped: %s", e)
        return None


def build_provider_from_secret(provider: str, api_key: str, model: str) -> ImageProvider:
    if provider == "openai":
        return OpenAIImagesProvider(api_key=api_key, model=model)
    if provider == "gemini":
        return GeminiImagesProvider(api_key=api_key, model=model)
    raise ValueError(f"Unsupported image provider: {provider}")


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
    """Orchestrates image generation, storage, and history.

    Cloud providers (OpenAI / Gemini) are resolved per-request from encrypted
    DB secrets — not from .env. The boot-time ``_provider`` is only a fallback
    (external URL / placeholder / optional local SDXL).
    """

    def __init__(self, workspace_root: str, provider: Optional[ImageProvider] = None) -> None:
        self._workspace = Path(workspace_root).resolve()
        self._images_dir = self._workspace / GENERATED_IMAGES_DIR
        self._images_dir.mkdir(parents=True, exist_ok=True)
        self._provider = provider

    @property
    def provider_name(self) -> str:
        return self._provider.name if self._provider else "none"

    async def is_configured(self) -> bool:
        try:
            from ..provider_secrets import configured_provider_ids

            if await configured_provider_ids():
                return True
        except Exception as e:
            logger.debug("provider secret probe failed: %s", e)
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
        provider: Optional[str] = None,
    ) -> ImageResult:
        width = max(64, min(int(width), 2048))
        height = max(64, min(int(height), 2048))
        steps = max(1, min(int(steps), 100))
        seed = seed or random.randint(0, 2**31)
        full_negative = f"{negative_prompt}, {SAFETY_NEGATIVE}" if negative_prompt else SAFETY_NEGATIVE

        active_provider = self._provider
        used_model = model or ""
        used_provider_name = self.provider_name

        # Prefer encrypted DB secrets (Settings → Image Providers)
        try:
            from ..provider_secrets import resolve_image_backend

            backend, needs = await resolve_image_backend(model=model, provider=provider)
            if needs:
                status = needs.get("status")
                # Allow non-placeholder boot fallback (e.g. external Comfy URL)
                if (
                    status == "needs_api_key"
                    and self._provider
                    and not isinstance(self._provider, PlaceholderProvider)
                ):
                    active_provider = self._provider
                    used_provider_name = self.provider_name
                else:
                    return ImageResult(
                        success=False,
                        error=needs.get("message") or "Image provider not ready",
                        needs_input=needs,
                    )
            elif backend:
                active_provider = build_provider_from_secret(
                    backend.provider, backend.api_key, backend.model
                )
                used_model = backend.model
                used_provider_name = active_provider.name
        except Exception as e:
            logger.warning("DB secret resolve failed, using boot provider: %s", e)

        if not active_provider:
            return ImageResult(
                success=False,
                error=(
                    "No image provider ready. Add an OpenAI or Gemini API key in "
                    "Settings → Image Providers."
                ),
                needs_input={
                    "status": "needs_api_key",
                    "message": "Add an image API key in Settings → Image Providers.",
                    "options": [],
                },
            )

        # Avoid burning cloud quota on accidental placeholder when secrets exist
        if (
            isinstance(active_provider, PlaceholderProvider)
            and not model
            and not provider
        ):
            # Still allow placeholder only if explicitly no secrets (already handled)
            pass

        fname = f"img_{uuid.uuid4().hex[:12]}.png"
        out_path = self._images_dir / fname

        start = time.monotonic()
        try:
            img_bytes = await active_provider.generate(
                prompt=prompt,
                negative_prompt=full_negative,
                width=width,
                height=height,
                steps=steps,
                seed=seed,
            )
        except Exception as e:
            err_text = str(e)
            logger.error("Image generation failed: %s", e)
            # Soft-fallback chain when Developer API fails:
            # 1) gemini.google.com session (same as the website / Flash-Lite)
            # 2) OpenAI gpt-image-1 if configured
            if (
                used_provider_name.startswith("gemini")
                and ("429" in err_text or "404" in err_text or "quota" in err_text.lower())
            ):
                web = await try_gemini_web_fallback(
                    prompt=prompt,
                    negative_prompt=full_negative,
                    width=width,
                    height=height,
                    steps=steps,
                    seed=seed,
                    model=used_model or "gemini-2.5-flash-image",
                )
                if web:
                    img_bytes, used_provider_name = web
                    logger.warning(
                        "Gemini API failed (%s); used gemini.google.com session instead",
                        err_text[:120],
                    )
                else:
                    try:
                        from ..provider_secrets import resolve_image_backend

                        openai_backend, _ = await resolve_image_backend(
                            model="gpt-image-1", provider="openai"
                        )
                        if openai_backend:
                            logger.warning(
                                "Gemini API+web failed (%s); falling back to OpenAI gpt-image-1",
                                err_text[:120],
                            )
                            active_provider = build_provider_from_secret(
                                openai_backend.provider,
                                openai_backend.api_key,
                                openai_backend.model,
                            )
                            used_model = openai_backend.model
                            used_provider_name = active_provider.name
                            img_bytes = await active_provider.generate(
                                prompt=prompt,
                                negative_prompt=full_negative,
                                width=width,
                                height=height,
                                steps=steps,
                                seed=seed,
                            )
                        else:
                            return ImageResult(
                                success=False,
                                error=(
                                    f"{err_text}\n\nGemini Developer API quota unavailable. "
                                    "Log into gemini.google.com in Chrome (web fallback), "
                                    "enable AI Studio billing, or use OpenAI."
                                ),
                                model=used_model,
                                provider=used_provider_name,
                            )
                    except Exception as fallback_err:
                        return ImageResult(
                            success=False,
                            error=f"{err_text} | OpenAI fallback also failed: {fallback_err}",
                            model=used_model,
                            provider=used_provider_name,
                        )
            else:
                return ImageResult(
                    success=False,
                    error=err_text,
                    model=used_model,
                    provider=used_provider_name,
                )

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
            model=used_model,
            provider=used_provider_name,
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
    openai_api_key: Optional[str] = None,
    openai_image_model: Optional[str] = None,
    openai_image_quality: Optional[str] = None,
) -> ImageGenerationService:
    """Boot-time factory. Cloud keys come from Settings UI (DB), not .env.

    Boot fallback order:
    1. Explicit external IMAGE_GEN_API_URL
    2. Optional local sdxl_turbo if requested
    3. Placeholder (until user adds keys in Settings)
    """
    _ = (openai_api_key, openai_image_model, openai_image_quality)  # deprecated for secrets
    provider: Optional[ImageProvider] = None
    provider_pref = (image_provider or "").strip().lower()

    if provider_pref == "sdxl_turbo":
        sdxl = SDXLTurboProvider(model_id=sdxl_model_id)
        try:
            import torch  # noqa: F401
            from diffusers import AutoPipelineForText2Image  # noqa: F401

            provider = sdxl
            logger.info("Image generation fallback: SDXL Turbo (%s)", sdxl._model_id)
        except ImportError:
            logger.warning("SDXL Turbo requested but deps missing — using placeholder.")
            provider = PlaceholderProvider()
    elif image_gen_api_url:
        provider = ExternalAPIProvider(image_gen_api_url)
        logger.info("Image generation fallback: external API at %s", image_gen_api_url)
    else:
        provider = PlaceholderProvider()
        logger.info(
            "Image generation: placeholder until API keys are added in Settings → Image Providers."
        )

    return ImageGenerationService(workspace_root, provider)
