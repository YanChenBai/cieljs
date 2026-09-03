export function normalizeSearchText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

export function tokenizeSearchText(text: string): string[] {
  return [...segmenter.segment(normalizeSearchText(text))]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
}

export function chunkText(text: string, maxChars = 2000, overlap = 200): string[] {
  const characters = Array.from(text);
  const chunks: string[] = [];

  for (let start = 0; start < characters.length; start += maxChars - overlap) {
    chunks.push(characters.slice(start, start + maxChars).join(""));
    if (start + maxChars >= characters.length) break;
  }

  return chunks;
}
