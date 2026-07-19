/**
 * Diagram export helpers — SVG / PNG / PDF from a Mermaid SVG element.
 * Zero extra deps: flattens foreignObject labels so canvas export works.
 */

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function stampFilename(ext: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `diagram-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

/** Ensure root SVG has explicit width/height/viewBox for rasterization. */
function normalizeSvgRoot(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const vb = clone.getAttribute("viewBox");
  let w = Number.parseFloat(clone.getAttribute("width") || "");
  let h = Number.parseFloat(clone.getAttribute("height") || "");
  if ((!w || !h) && vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      w = parts[2];
      h = parts[3];
    }
  }
  if (!w || !h) {
    try {
      const box = svg.getBBox();
      w = Math.max(box.width + box.x, 320);
      h = Math.max(box.height + box.y, 180);
    } catch {
      w = 800;
      h = 600;
    }
  }
  clone.setAttribute("width", String(Math.ceil(w)));
  clone.setAttribute("height", String(Math.ceil(h)));
  if (!vb) clone.setAttribute("viewBox", `0 0 ${Math.ceil(w)} ${Math.ceil(h)}`);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Opaque background so exports aren't transparent-on-black
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#0f172a");
  clone.insertBefore(bg, clone.firstChild);
  return clone;
}

/**
 * Replace HTML foreignObject labels with SVG <text> so canvas can rasterize.
 * Mermaid mindmaps often use foreignObject → canvas drawImage fails otherwise.
 */
function flattenForeignObjects(svg: SVGSVGElement): void {
  const fos = Array.from(svg.querySelectorAll("foreignObject"));
  for (const fo of fos) {
    const label =
      fo.textContent?.replace(/\s+/g, " ").trim() ||
      (fo.querySelector("div, span, p") as HTMLElement | null)?.innerText?.trim() ||
      "";
    if (!label) {
      fo.remove();
      continue;
    }
    const x = Number.parseFloat(fo.getAttribute("x") || "0");
    const y = Number.parseFloat(fo.getAttribute("y") || "0");
    const w = Number.parseFloat(fo.getAttribute("width") || "0");
    const h = Number.parseFloat(fo.getAttribute("height") || "0");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(x + (w || 0) / 2));
    text.setAttribute("y", String(y + (h || 16) / 2 + 4));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("fill", "#f8fafc");
    text.setAttribute("font-size", "13");
    text.setAttribute("font-family", "ui-sans-serif, system-ui, sans-serif");
    text.setAttribute("font-weight", "600");
    text.textContent = label;
    fo.replaceWith(text);
  }
}

/** Inject high-contrast text/edge CSS into an SVG markup string. */
export function enhanceMermaidSvgContrast(svgMarkup: string): string {
  const style = `<style type="text/css"><![CDATA[
    text, tspan { fill: #f8fafc !important; }
    .nodeLabel, .edgeLabel, .label { color: #f8fafc !important; fill: #f8fafc !important; }
    foreignObject, foreignObject div, foreignObject span, foreignObject p {
      color: #f8fafc !important;
      background: transparent !important;
    }
    .edgePath .path, .flowchart-link, line, path.path {
      stroke: #94a3b8 !important;
    }
    .mindmap-node text, .section text { fill: #ffffff !important; font-weight: 600 !important; }
  ]]></style>`;
  if (/<svg[^>]*>/i.test(svgMarkup) && !svgMarkup.includes("CDATA[")) {
    return svgMarkup.replace(/<svg([^>]*)>/i, `<svg$1>${style}`);
  }
  return svgMarkup;
}

export function serializeSvgElement(svg: SVGSVGElement): string {
  const clone = normalizeSvgRoot(svg);
  flattenForeignObjects(clone);
  return enhanceMermaidSvgContrast(new XMLSerializer().serializeToString(clone));
}

export async function svgElementToPngBlob(
  svg: SVGSVGElement,
  scale = 2,
): Promise<Blob> {
  const markup = serializeSvgElement(svg);
  const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const w = Math.max(1, Math.ceil(img.naturalWidth || img.width));
    const h = Math.max(1, Math.ceil(img.naturalHeight || img.height));
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))),
        "image/png",
      );
    });
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to rasterize diagram SVG"));
    img.src = url;
  });
}

/** Minimal single-page PDF embedding a JPEG (no external libs). */
export async function pngBlobToPdfBlob(png: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(png);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const jpegBase64 = jpegDataUrl.split(",")[1] || "";
  const jpegBytes = Uint8Array.from(atob(jpegBase64), (c) => c.charCodeAt(0));

  // Fit image on A4-ish page in points (1pt = 1/72")
  const pageW = 842; // landscape A4
  const pageH = 595;
  const margin = 24;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
  const drawW = canvas.width * scale;
  const drawH = canvas.height * scale;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;

  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  const push = (s: string | Uint8Array) => {
    const bytes = typeof s === "string" ? encoder.encode(s) : s;
    parts.push(bytes);
    cursor += bytes.length;
  };

  const addObj = (body: string | ((start: number) => void)) => {
    offsets.push(cursor);
    if (typeof body === "string") {
      push(body);
    } else {
      body(cursor);
    }
  };

  push("%PDF-1.4\n");
  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  addObj(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n`,
  );
  const content = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
  addObj(
    `4 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`,
  );
  addObj(() => {
    push(
      `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
    );
    push(jpegBytes);
    push("\nendstream\nendobj\n");
  });

  const xrefStart = cursor;
  push(`xref\n0 ${offsets.length + 1}\n`);
  push("0000000000 65535 f \n");
  for (const off of offsets) {
    push(`${String(off).padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  );

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return new Blob([out], { type: "application/pdf" });
}

export async function downloadDiagramSvg(svg: SVGSVGElement) {
  const markup = serializeSvgElement(svg);
  downloadBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), stampFilename("svg"));
}

export async function downloadDiagramPng(svg: SVGSVGElement) {
  const png = await svgElementToPngBlob(svg, 2);
  downloadBlob(png, stampFilename("png"));
}

export async function downloadDiagramPdf(svg: SVGSVGElement) {
  const png = await svgElementToPngBlob(svg, 2);
  const pdf = await pngBlobToPdfBlob(png);
  downloadBlob(pdf, stampFilename("pdf"));
}
