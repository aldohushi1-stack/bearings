/**
 * Token estimate. Deliberately pessimistic: code-heavy Markdown tokenizes at
 * roughly 3–3.5 characters per token, prose nearer 4. We use 3.5 so the number
 * in the footer is at or above what the model will actually count.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}
