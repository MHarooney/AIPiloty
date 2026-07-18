# Image generation — quality + inline chat

## Why your cover looked like a placeholder

AIPiloty was using the **Pillow placeholder** provider (text on a gradient). That is **not** an AI image model. ChatGPT uses **DALL·E 3**; Gemini uses **Imagen**. Local Ollama chat models do **not** draw images.

## What we fixed

1. **Inline chat preview** — images failed silently because `<img>` cannot send `X-API-Key`. Frontend now fetches with the API key and shows a blob preview (like ChatGPT).
2. **OpenAI DALL·E 3 provider** — ChatGPT-class quality when you set an API key.
3. **Correct download URLs** for generated files.

## How to get ChatGPT-like quality

In `aipiloty/backend/.env`:

```env
IMAGE_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here
OPENAI_IMAGE_MODEL=dall-e-3
OPENAI_IMAGE_QUALITY=hd
```

Restart the backend. Ask again: *generate a course cover for AIPiloty*.

### Alternatives

| Provider | Quality | Cost | Setup |
|----------|---------|------|--------|
| `openai` (DALL·E 3) | ChatGPT-class | Paid API | `OPENAI_API_KEY` |
| `sdxl_turbo` | Good local | Free (GPU RAM) | `pip install diffusers[torch] …` + `IMAGE_PROVIDER=sdxl_turbo` |
| External ComfyUI/Replicate | Varies | Varies | `IMAGE_GEN_API_URL=…` |
| placeholder | Demo only | Free | Default today |

## Prompt tip

Better prompts → better images. Example:

> Professional course cover for AIPiloty AI DevOps platform, modern dark navy and cyan, clean typography space for title, cinematic lighting, 16:9, no watermark, no placeholder text
