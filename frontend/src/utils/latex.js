/**
 * Wraps "pure" LaTeX patterns in standard MathJax delimiters ($...$) 
 * if they are not already wrapped.
 */
export function wrapPureLatex(text) {
  if (!text) return "";

  // If the text already has delimiters, we still might need to wrap 
  // other parts, but let's avoid double wrapping.
  
  // This regex finds sequences that look like LaTeX commands but are not wrapped in $.
  // It looks for a backslash followed by letters, and includes braces/brackets/punctuation.
  // We avoid wrapping if there's a $ before or after.
  
  // We'll use a regex that matches LaTeX-like strings:
  // Starts with \ and followed by letters or symbols, and can contain { } [ ]
  
  // Simple heuristic: find anything starting with \ and wrap the whole math block.
  // A math block usually ends with a space, punctuation (not followed by {), or end of string.
  
  // We use a regex that captures common LaTeX structures.
  return text.replace(/(?<!\$)\\(?:[a-z]+|[^a-z\s])(?:\{[^{}]*\}|\[[^\]]*\]|[^{}\[\]\s\$])*/gi, (match) => {
    // Skip common non-math escapes
    if (/^\\[ntr"']/.test(match)) return match;
    return `$${match}$`;
  });
}
