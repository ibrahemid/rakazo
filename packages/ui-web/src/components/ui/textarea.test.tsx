import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Textarea } from "./textarea.js";

describe("Textarea", () => {
  it("resolves direction per paragraph from the content by default", () => {
    expect(renderToStaticMarkup(<Textarea />)).toContain('dir="auto"');
  });

  it("keeps a direction set by the caller", () => {
    const html = renderToStaticMarkup(<Textarea dir="rtl" />);
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('dir="auto"');
  });
});
