import { describe, expect, it } from "vitest";
import { sentences, speechChunks } from "../../apps/web/app/lib/voice";

const reply = "Overpaying €500 each month would cut the total interest from about €55,500 to roughly €36,100, a saving of around €19,360. It also shortens the loan by about 81 months. The trade-off is cash flow: your free cash flow is €568 per month, so adding a €500 overpayment leaves only about €68 of discretionary cash each month. Because your rate is low at 2.15%, the saving is modest compared with investing elsewhere.";

describe("speech chunking", () => {
  it("keeps every chunk within the provider limit", () => {
    for (const size of [190, 400, 800]) {
      for (const chunk of speechChunks(reply, size)) expect(chunk.length).toBeLessThanOrEqual(size);
    }
  });

  it("loses no words", () => {
    const words = (text: string) => text.replace(/\s+/g, " ").trim();
    expect(words(speechChunks(reply, 190).join(" "))).toBe(words(reply));
    expect(words(speechChunks(reply, 800).join(" "))).toBe(words(reply));
  });

  it("makes fewer requests when the provider accepts more text", () => {
    expect(speechChunks(reply, 800).length).toBeLessThan(speechChunks(reply, 190).length);
  });

  it("never splits in the middle of a number", () => {
    for (const size of [120, 190, 400]) {
      const chunks = speechChunks(reply, size);
      chunks.forEach((chunk, index) => {
        const next = chunks[index + 1];
        // A thousands separator must never end a chunk with digits continuing in the next.
        if (next) expect(/\d[.,]$/.test(chunk) && /^\d/.test(next)).toBe(false);
        expect(chunk).not.toMatch(/^[.,]\d/);
      });
    }
  });

  it("handles a sentence longer than the whole limit", () => {
    const long = `This is one very long sentence without any terminal punctuation that simply keeps going ${"and going ".repeat(30)}until it finally stops`;
    const chunks = speechChunks(long, 150);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(150);
  });

  it("keeps decimals, percentages and abbreviations in one piece", () => {
    expect(sentences("Your rate is low at 2.15%, so the saving is modest.")).toHaveLength(1);
    expect(sentences("It costs 1.5 million. That is a lot.")).toHaveLength(2);
    expect(sentences("Sie zahlen 3,5 % bzw. 2.15% im Jahr.")).toHaveLength(1);
    for (const chunk of speechChunks("Your rate is low at 2.15%, so the saving is modest over time.", 120)) {
      expect(chunk).not.toMatch(/\d\.$/);
    }
  });

  it("returns nothing for empty input", () => {
    expect(speechChunks("", 200)).toEqual([]);
    expect(speechChunks("   ", 200)).toEqual([]);
  });
});
