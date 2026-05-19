"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/app-shell";
import {
  generateImage,
  getImageHistory,
  getImageProviderStatus,
  deleteImage,
  imageUrl,
  type ImageInfo,
  type ImageGenRequest,
} from "@/lib/api";
import {
  Image as ImageIcon,
  Loader2,
  Trash2,
  Download,
  RefreshCw,
  Sparkles,
  X,
  Copy,
  ChevronLeft,
  ChevronRight,
  Clock,
  Maximize2,
} from "lucide-react";
import { toast } from "sonner";

export default function ImagesPage() {
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageInfo | null>(null);
  const [providerInfo, setProviderInfo] = useState<{ provider: string; available: boolean } | null>(null);

  // Form state
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(20);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const perPage = 12;

  const loadImages = useCallback(async () => {
    try {
      const data = await getImageHistory(page, perPage);
      setImages(data.images);
      setTotal(data.total);
    } catch {
      toast.error("Failed to load image history");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  useEffect(() => {
    getImageProviderStatus().then(setProviderInfo).catch(() => {});
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    try {
      const req: ImageGenRequest = {
        prompt: prompt.trim(),
        negative_prompt: negativePrompt.trim() || undefined,
        width,
        height,
        steps,
      };
      const result = await generateImage(req);
      if (result.success) {
        toast.success(`Image generated in ${result.generation_time_ms}ms`);
        setPrompt("");
        setPage(1);
        await loadImages();
      } else {
        toast.error(result.error || "Generation failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (img: ImageInfo) => {
    if (!confirm("Delete this image?")) return;
    try {
      await deleteImage(img.image_id);
      toast.success("Image deleted");
      await loadImages();
      if (selectedImage?.image_id === img.image_id) setSelectedImage(null);
    } catch {
      toast.error("Delete failed");
    }
  };

  const handleRegenerate = (img: ImageInfo) => {
    setPrompt(img.prompt);
    setNegativePrompt(img.negative_prompt || "");
    setWidth(img.width);
    setHeight(img.height);
    setSteps(img.steps);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto animate-fade-in">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-indigo-600/10 border border-indigo-500/20">
                <ImageIcon size={20} className="text-indigo-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-100">Image Generation</h1>
                <p className="text-xs text-gray-500">Generate images from text prompts</p>
              </div>
            </div>
            {providerInfo && (
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${providerInfo.available ? "bg-emerald-400" : "bg-red-400"}`} />
                <span className="text-xs text-gray-400">
                  {providerInfo.provider === "sdxl_turbo" ? "SDXL Turbo" : providerInfo.provider === "external_api" ? "External API" : "Placeholder"}
                </span>
              </div>
            )}
          </div>

          {/* Generation Form */}
          <div className="bg-gray-900/50 border border-gray-800/50 rounded-xl p-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 resize-none"
                placeholder="Describe the image you want to generate..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                }}
              />
            </div>

            {/* Advanced options toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showAdvanced ? "Hide" : "Show"} advanced options
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-gray-500">Negative Prompt</label>
                  <input
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    className="w-full mt-1 bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-gray-300"
                    placeholder="What to avoid..."
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Width</label>
                  <select
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                    className="w-full mt-1 bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-gray-300"
                  >
                    {[256, 384, 512, 640, 768, 1024].map((v) => (
                      <option key={v} value={v}>
                        {v}px
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Height</label>
                  <select
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value))}
                    className="w-full mt-1 bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-gray-300"
                  >
                    {[256, 384, 512, 640, 768, 1024].map((v) => (
                      <option key={v} value={v}>
                        {v}px
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Steps</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={steps}
                    onChange={(e) => setSteps(Number(e.target.value))}
                    className="w-full mt-1 bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-gray-300"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim() || generating}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 rounded-lg text-sm font-medium text-white transition-colors"
              >
                {generating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                {generating ? "Generating..." : "Generate"}
              </button>
              <span className="text-[10px] text-gray-600">⌘↵ to generate</span>
            </div>
          </div>

          {/* Gallery */}
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-gray-500" size={28} />
            </div>
          ) : images.length === 0 ? (
            <div className="text-center py-20">
              <ImageIcon size={48} className="mx-auto mb-3 text-gray-700 opacity-30" />
              <p className="text-gray-500 text-sm">No images generated yet</p>
              <p className="text-gray-600 text-xs mt-1">
                Describe an image above and click Generate
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {images.map((img) => (
                  <div
                    key={img.image_id}
                    className="group relative bg-gray-900/50 border border-gray-800/50 rounded-xl overflow-hidden hover:border-indigo-500/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedImage(img)}
                  >
                    <div className="aspect-square relative">
                      {img.status === "completed" ? (
                        <img
                          src={imageUrl(img.relative_path)}
                          alt={img.prompt}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-red-900/20">
                          <X size={24} className="text-red-500" />
                        </div>
                      )}
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                        <div className="flex gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRegenerate(img);
                            }}
                            className="p-1.5 rounded-lg bg-gray-800/80 text-gray-300 hover:text-white transition-colors"
                            title="Regenerate"
                          >
                            <RefreshCw size={12} />
                          </button>
                          <a
                            href={imageUrl(img.relative_path)}
                            download
                            onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded-lg bg-gray-800/80 text-gray-300 hover:text-white transition-colors"
                            title="Download"
                          >
                            <Download size={12} />
                          </a>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(img);
                            }}
                            className="p-1.5 rounded-lg bg-gray-800/80 text-gray-300 hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="p-2.5">
                      <p className="text-xs text-gray-400 truncate">{img.prompt}</p>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-600">
                        <span>
                          {img.width}×{img.height}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-0.5">
                          <Clock size={9} />
                          {img.generation_time_ms}ms
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-4">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="p-2 rounded-lg bg-gray-800/50 text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs text-gray-500">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-2 rounded-lg bg-gray-800/50 text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Lightbox Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-gray-900 border border-gray-800 rounded-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-800/50">
              <span className="text-sm text-gray-300 truncate pr-4">
                {selectedImage.prompt}
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedImage.prompt);
                    toast.success("Prompt copied");
                  }}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 transition-colors"
                  title="Copy prompt"
                >
                  <Copy size={14} />
                </button>
                <button
                  onClick={() => setSelectedImage(null)}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            {selectedImage.status === "completed" ? (
              <img
                src={imageUrl(selectedImage.relative_path)}
                alt={selectedImage.prompt}
                className="w-full max-h-[70vh] object-contain bg-black"
              />
            ) : (
              <div className="flex items-center justify-center h-64 text-red-400 text-sm">
                Generation failed: {selectedImage.error_message || "Unknown error"}
              </div>
            )}
            <div className="px-4 py-3 border-t border-gray-800/50 flex items-center gap-4 text-[11px] text-gray-500">
              <span>
                {selectedImage.width}×{selectedImage.height}
              </span>
              <span>Seed: {selectedImage.seed ?? "—"}</span>
              <span>Steps: {selectedImage.steps}</span>
              <span>Provider: {selectedImage.provider}</span>
              <span>
                {selectedImage.generation_time_ms}ms
              </span>
              <span>{(selectedImage.file_size / 1024).toFixed(1)} KB</span>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
