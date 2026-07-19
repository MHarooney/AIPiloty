import { describe, it, expect } from "vitest";
import { enhanceMermaidSvgContrast } from "./export-diagram";

describe("enhanceMermaidSvgContrast", () => {
  it("injects high-contrast style into svg root", () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text fill="#000">Hi</text></svg>`;
    const out = enhanceMermaidSvgContrast(raw);
    expect(out).toContain("CDATA");
    expect(out).toContain("#f8fafc");
    expect(out).toContain("<text fill=\"#000\">Hi</text>");
  });

  it("is idempotent when style already present", () => {
    const once = enhanceMermaidSvgContrast(
      `<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>`,
    );
    const twice = enhanceMermaidSvgContrast(once);
    expect(twice).toBe(once);
  });
});
