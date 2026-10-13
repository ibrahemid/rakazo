import { expect, type Locator, type Page, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openNewBot, signup } from "./helpers";

type Interval = [number, number];

type VisualLine = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  paragraph: number;
  selected: Interval[];
  breakSelected: boolean;
  caretX: number | null;
};

type FieldLayout = {
  lines: VisualLine[];
  contentBox: { left: number; right: number };
  direction: "ltr" | "rtl";
  spaceWidth: number;
};

const MIXED_LINES = "test ad\nمرحبا بالعالم\nd";
const CASES = [
  "test ad\n\ndas\nd",
  "hello مرحبا world",
  "مرحبا بالعالم",
  MIXED_LINES,
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis",
];

const METHODS = ["select-all", "keyboard", "mouse"] as const;
const TOLERANCE = 1.5;
const RTL_CHAR = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;
const LTR_CHAR = /\p{Script=Latin}/u;

function paragraphDirection(paragraph: string) {
  for (const char of paragraph) {
    if (RTL_CHAR.test(char)) return "rtl";
    if (LTR_CHAR.test(char)) return "ltr";
  }
  return null;
}

/** Lay the field's text out in a hidden mirror with the field's computed styles. */
function readLayout(field: Locator, origin: { x: number; y: number }) {
  return field.evaluate(
    (textarea: HTMLTextAreaElement, [originX, originY]) => {
      const style = getComputedStyle(textarea);
      const mirror = document.createElement("div");
      for (const property of [
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "fontStretch",
        "fontFeatureSettings",
        "fontVariationSettings",
        "letterSpacing",
        "wordSpacing",
        "lineHeight",
        "textAlign",
        "textIndent",
        "textTransform",
        "tabSize",
        "direction",
        "unicodeBidi",
        "whiteSpace",
        "overflowWrap",
        "wordBreak",
      ] as const) {
        mirror.style[property] = style[property];
      }
      const box = textarea.getBoundingClientRect();
      const borderLeft = Number.parseFloat(style.borderLeftWidth);
      const borderTop = Number.parseFloat(style.borderTopWidth);
      const paddingLeft = Number.parseFloat(style.paddingLeft);
      const paddingRight = Number.parseFloat(style.paddingRight);
      Object.assign(mirror.style, {
        position: "fixed",
        left: `${box.left + borderLeft}px`,
        top: `${box.top + borderTop - textarea.scrollTop}px`,
        boxSizing: "content-box",
        width: `${textarea.clientWidth - paddingLeft - paddingRight}px`,
        margin: "0",
        border: "0",
        visibility: "hidden",
      });
      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      const paragraphs = textarea.value.split("\n");
      const nodes: { text: Text; offset: number; empty: boolean }[] = [];
      let offset = 0;
      paragraphs.forEach((paragraph, index) => {
        // A zero-width space gives an empty paragraph a measurable line box.
        const text = document.createTextNode(paragraph.length ? paragraph : "​");
        mirror.append(text);
        nodes.push({ text, offset, empty: paragraph.length === 0 });
        offset += paragraph.length + 1;
        if (index < paragraphs.length - 1) mirror.append("\n");
      });
      document.body.append(mirror);
      const lines: VisualLine[] = [];
      const lineAt = (rect: DOMRect, paragraph: number) => {
        const top = rect.top - originY;
        let line = lines.find((candidate) => Math.abs(candidate.top - top) < 4);
        if (!line) {
          line = {
            top,
            bottom: rect.bottom - originY,
            left: Number.POSITIVE_INFINITY,
            right: Number.NEGATIVE_INFINITY,
            paragraph,
            selected: [],
            breakSelected: false,
            caretX: null,
          };
          lines.push(line);
        }
        return line;
      };
      const range = document.createRange();
      nodes.forEach(({ text, offset: start, empty }, paragraph) => {
        let last: VisualLine | null = null;
        for (let index = 0; index < text.length; index += 1) {
          range.setStart(text, index);
          range.setEnd(text, index + 1);
          for (const rect of range.getClientRects()) {
            if (empty) {
              last = lineAt(rect, paragraph);
              last.caretX = rect.left - originX;
              continue;
            }
            if (rect.width === 0) continue;
            last = lineAt(rect, paragraph);
            last.left = Math.min(last.left, rect.left - originX);
            last.right = Math.max(last.right, rect.right - originX);
            const at = start + index;
            if (at >= selectionStart && at < selectionEnd) {
              last.selected.push([rect.left - originX, rect.right - originX]);
            }
          }
        }
        const breakAt = start + (empty ? 0 : text.length);
        if (last && paragraph < nodes.length - 1) {
          last.breakSelected = breakAt >= selectionStart && breakAt < selectionEnd;
        }
      });
      mirror.remove();
      lines.sort((a, b) => a.top - b.top);
      const context = document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("2d canvas context unavailable");
      context.font = `${style.fontSize} ${style.fontFamily}`;
      return {
        lines,
        contentBox: {
          left: box.left - originX + borderLeft + paddingLeft,
          right: box.left - originX + borderLeft + textarea.clientWidth - paddingRight,
        },
        direction: style.direction === "rtl" ? "rtl" : "ltr",
        spaceWidth: context.measureText(" ").width,
      } satisfies FieldLayout;
    },
    [origin.x, origin.y] as const,
  );
}

/** Per pixel row, the x-runs where the selected screenshot differs from the unselected one. */
function paintedRuns(page: Page, selected: Buffer, unselected: Buffer) {
  return page.evaluate(
    async ([selectedPng, unselectedPng]) => {
      const pixels = async (png: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2d canvas context unavailable");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const [after, before] = await Promise.all([pixels(selectedPng), pixels(unselectedPng)]);
      const rows: [number, number][][] = [];
      for (let y = 0; y < after.height; y += 1) {
        const runs: [number, number][] = [];
        let start = -1;
        for (let x = 0; x <= after.width; x += 1) {
          const i = (y * after.width + x) * 4;
          let difference = 0;
          for (let channel = i; channel < i + 3; channel += 1) {
            difference += Math.abs((after.data[channel] ?? 0) - (before.data[channel] ?? 0));
          }
          const changed = x < after.width && difference > 24;
          if (changed && start < 0) start = x;
          if (!changed && start >= 0) {
            runs.push([start, x]);
            start = -1;
          }
        }
        rows.push(runs);
      }
      return rows;
    },
    [selected.toString("base64"), unselected.toString("base64")] as const,
  );
}

function merge(intervals: Interval[]) {
  const merged: Interval[] = [];
  for (const [left, right] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && left <= last[1] + 0.5) last[1] = Math.max(last[1], right);
    else merged.push([left, right]);
  }
  return merged;
}

function lengthOutside(run: Interval, allowed: Interval[]) {
  let length = run[1] - run[0];
  for (const [left, right] of allowed) {
    length -= Math.max(0, Math.min(run[1], right) - Math.max(run[0], left));
  }
  return Math.max(0, length);
}

/**
 * Where a selection may paint on one visual line: the selected glyphs, plus what the engine
 * natively paints for a selected line end. Chromium paints one space width for a selected
 * break and for the space hanging at a soft wrap. WebKit fills selection gaps to the content
 * box edge: from the start edge on every line after the first, to the end edge on every line
 * before the last.
 */
function allowedPaint(
  line: VisualLine,
  layout: FieldLayout,
  engine: string,
  position: { first: boolean; last: boolean },
) {
  const allowed: Interval[] = line.selected.map(([l, r]) => [l - TOLERANCE, r + TOLERANCE]);
  if (!line.selected.length && !line.breakSelected) return allowed;
  const hasGlyphs = line.right >= line.left;
  const { left: boxLeft, right: boxRight } = layout.contentBox;
  if (engine === "webkit") {
    const anchor = line.caretX ?? boxLeft;
    const selectedLeft = line.selected.length ? Math.min(...line.selected.map(([l]) => l)) : anchor;
    const selectedRight = line.selected.length
      ? Math.max(...line.selected.map(([, r]) => r))
      : anchor;
    const ltr = layout.direction === "ltr";
    if (!position.first) allowed.push(ltr ? [boxLeft, selectedLeft] : [selectedRight, boxRight]);
    if (!position.last) allowed.push(ltr ? [selectedRight, boxRight] : [boxLeft, selectedLeft]);
  } else if (!position.last) {
    const strip = layout.spaceWidth + TOLERANCE + 1;
    if (hasGlyphs) {
      allowed.push([line.right - TOLERANCE, line.right + strip]);
      allowed.push([line.left - strip, line.left + TOLERANCE]);
    } else {
      const x = line.caretX ?? boxLeft;
      allowed.push([x - strip, x + strip]);
    }
  }
  return merge(allowed);
}

async function selectText(
  page: Page,
  field: Locator,
  method: (typeof METHODS)[number],
  layout: FieldLayout,
) {
  if (method === "select-all") {
    await page.keyboard.press("ControlOrMeta+a");
    return;
  }
  if (method === "keyboard") {
    await field.evaluate((textarea: HTMLTextAreaElement) => textarea.setSelectionRange(0, 0));
    for (let step = 0; step <= layout.lines.length; step += 1) {
      await page.keyboard.press("Shift+ArrowDown");
    }
    return;
  }
  const box = await field.boundingBox();
  if (!box) throw new Error("text field has no layout box");
  const first = layout.lines[0];
  const last = layout.lines.at(-1);
  if (!first || !last) throw new Error("text field has no lines");
  const { left, right } = layout.contentBox;
  const firstIsRtl = layout.direction === "rtl";
  await page.mouse.move(
    box.x + (firstIsRtl ? right - 1 : left + 1),
    box.y + (first.top + first.bottom) / 2,
  );
  await page.mouse.down();
  await page.mouse.move(box.x + (left + right) / 2, box.y + (last.top + last.bottom) / 2, {
    steps: 4,
  });
  await page.mouse.move(
    box.x + (firstIsRtl ? left + 1 : right - 1),
    box.y + (last.top + last.bottom) / 2,
    {
      steps: 4,
    },
  );
  await page.mouse.up();
}

async function expectSelectionPaintMatchesText(
  page: Page,
  field: Locator,
  engine: string,
  value: string,
  method: (typeof METHODS)[number],
) {
  const label = `${method}: ${JSON.stringify(value)}`;
  await field.fill(value);
  let previousBox = "";
  await expect
    .poll(
      async () => {
        const current = JSON.stringify(await field.boundingBox());
        const steady = current === previousBox;
        previousBox = current;
        return steady;
      },
      { intervals: [100] },
    )
    .toBe(true);
  await field.evaluate((textarea: HTMLTextAreaElement) => {
    textarea.scrollTop = 0;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });
  await page.evaluate(() => document.fonts.ready);
  const box = await field.boundingBox();
  if (!box) throw new Error("text field has no layout box");
  const shot = { clip: box, caret: "hide", animations: "disabled", scale: "css" } as const;
  const unselected = await page.screenshot(shot);
  await selectText(page, field, method, await readLayout(field, box));

  const selection = await field.evaluate((textarea: HTMLTextAreaElement) => ({
    text: window.getSelection()?.toString() ?? "",
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
  }));
  expect(selection, label).toEqual({ text: value, start: 0, end: value.length });

  const selected = await page.screenshot(shot);
  const rows = await paintedRuns(page, selected, unselected);
  const layout = await readLayout(field, box);
  const paragraphs = value.split("\n");
  const selectedLines = layout.lines.filter((line) => line.selected.length || line.breakSelected);
  for (const [index, line] of layout.lines.entries()) {
    const lineLabel = `${label} line ${index + 1}`;
    const direction = paragraphDirection(paragraphs[line.paragraph] ?? "");
    if (direction && line.right >= line.left) {
      const { left, right } = layout.contentBox;
      const edge = direction === "rtl" ? line.right - right : line.left - left;
      expect(Math.abs(edge), `${lineLabel} starts at its ${direction} start edge`).toBeLessThan(
        TOLERANCE,
      );
    }
    const allowed = allowedPaint(line, layout, engine, {
      first: line === selectedLines[0],
      last: line === selectedLines.at(-1),
    });
    const middle = Math.round((line.top + line.bottom) / 2);
    const painted = merge(
      [-2, -1, 0, 1, 2].flatMap((offset) => rows[middle + offset] ?? []) as Interval[],
    );
    const stray = painted.reduce((sum, run) => sum + lengthOutside(run, allowed), 0);
    expect(
      stray,
      `${lineLabel} paints ${JSON.stringify(painted)} outside ${JSON.stringify(allowed)}`,
    ).toBe(0);
    for (const [left, right] of merge(line.selected)) {
      const over = painted.filter(([l, r]) => r > left && l < right);
      const glyphLabel = `${lineLabel} paints across its selected glyphs ${JSON.stringify([left, right])}`;
      expect(Math.min(...over.map(([l]) => l)) - left, glyphLabel).toBeLessThan(2.5);
      expect(right - Math.max(...over.map(([, r]) => r)), glyphLabel).toBeLessThan(2.5);
    }
  }
}

async function openWorkspace(page: Page, prefix: string) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signup(page, `${prefix}-${Date.now()}@rakazo.test`, "password12", "Selection Test");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect(page.getByRole("combobox", { name: /Message/ })).toBeVisible();
}

async function checkField(
  page: Page,
  field: Locator,
  engine: string,
  method: (typeof METHODS)[number],
) {
  await expect(field).toBeVisible();
  // Spell-check underlines arrive asynchronously and would show up in the pixel diff.
  await field.evaluate((textarea: HTMLTextAreaElement) => {
    textarea.spellcheck = false;
  });
  for (const value of CASES) {
    await expectSelectionPaintMatchesText(page, field, engine, value, method);
  }
}

for (const method of METHODS) {
  test(`composer ${method} selection paints only the selected text`, async ({
    page,
    browserName,
  }) => {
    await openWorkspace(page, `selection-composer-${method}`);
    await checkField(page, page.locator("textarea[name='chat-message']"), browserName, method);
  });

  test(`shared textarea ${method} selection keeps each line's direction and paints only the selection`, async ({
    page,
    browserName,
  }, testInfo) => {
    await openWorkspace(page, `selection-textarea-${method}`);
    await openNewBot(page);
    const field = page
      .getByTestId("create-bot-form")
      .locator("label:has-text('Description') textarea");
    await checkField(page, field, browserName, method);
    if (method === "select-all") {
      await field.fill(MIXED_LINES);
      await field.selectText();
      await captureScreenshot(page, testInfo, "text-selection-mixed-direction-textarea");
    }
  });
}
