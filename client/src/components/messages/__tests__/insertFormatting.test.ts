import { describe, expect, it } from "vitest";

function applyFormatting(
  content: string, selectionStart: number, selectionEnd: number, before: string, after: string,
): { newContent: string; cursorPos: number } {
  const selected = content.slice(selectionStart, selectionEnd);
  const newContent = content.slice(0, selectionStart) + before + selected + after + content.slice(selectionEnd);
  const cursorPos = selected.length > 0
    ? selectionStart + before.length + selected.length + after.length
    : selectionStart + before.length;
  return { newContent, cursorPos };
}

describe("insertFormatting", () => {
  it("wraps selected text with markers", () => {
    const result = applyFormatting("hello world", 6, 11, "**", "**");
    expect(result.newContent).toBe("hello **world**");
    expect(result.cursorPos).toBe(15);
  });

  it("inserts empty markers at cursor when no selection", () => {
    const result = applyFormatting("hello world", 5, 5, "**", "**");
    expect(result.newContent).toBe("hello**** world");
    expect(result.cursorPos).toBe(7);
  });

  it("handles bold formatting", () => {
    const result = applyFormatting("some text", 5, 9, "**", "**");
    expect(result.newContent).toBe("some **text**");
  });

  it("handles italic formatting", () => {
    const result = applyFormatting("some text", 5, 9, "*", "*");
    expect(result.newContent).toBe("some *text*");
  });

  it("handles inline code formatting", () => {
    const result = applyFormatting("some text", 5, 9, "`", "`");
    expect(result.newContent).toBe("some `text`");
  });

  it("handles spoiler formatting", () => {
    const result = applyFormatting("some text", 5, 9, "||", "||");
    expect(result.newContent).toBe("some ||text||");
  });

  it("handles empty content", () => {
    const result = applyFormatting("", 0, 0, "**", "**");
    expect(result.newContent).toBe("****");
    expect(result.cursorPos).toBe(2);
  });

  it("handles formatting at start of content", () => {
    const result = applyFormatting("hello", 0, 5, "**", "**");
    expect(result.newContent).toBe("**hello**");
    expect(result.cursorPos).toBe(9);
  });
});
