/**
 * Lightweight, robust Markdown to HTML parser for news & updates.
 * Parses headers, bold, italics, lists, blockquotes, horizontal rules, links, and code.
 */
export function parseMarkdown(md: string): string {
  if (!md) return "";

  const lines = md.split(/\r?\n/);
  let html = "";
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();

    if (!trimmed) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      continue;
    }

    // Horizontal Rule
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += "<hr class='md-hr' />";
      continue;
    }

    // Headers
    if (trimmed.startsWith("#### ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h4 class='md-h4'>${parseInlineMarkdown(trimmed.slice(5))}</h4>`;
      continue;
    }
    if (trimmed.startsWith("### ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h3 class='md-h3'>${parseInlineMarkdown(trimmed.slice(4))}</h3>`;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h2 class='md-h2'>${parseInlineMarkdown(trimmed.slice(3))}</h2>`;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h1 class='md-h1'>${parseInlineMarkdown(trimmed.slice(2))}</h1>`;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<blockquote class='md-quote'>${parseInlineMarkdown(trimmed.slice(2))}</blockquote>`;
      continue;
    }

    // Bullet List Item
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) {
        html += "<ul class='md-list'>";
        inList = true;
      }
      html += `<li class='md-li'>${parseInlineMarkdown(trimmed.slice(2))}</li>`;
      continue;
    }

    // Close list if non-list line
    if (inList) {
      html += "</ul>";
      inList = false;
    }

    // Regular Paragraph
    html += `<p class='md-p'>${parseInlineMarkdown(trimmed)}</p>`;
  }

  if (inList) {
    html += "</ul>";
  }

  return html;
}

function parseInlineMarkdown(text: string): string {
  let result = text;
  // Escape unsafe HTML entities first
  result = result.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code spans `code`
  result = result.replace(/`([^`]+)`/g, "<code class='md-code'>$1</code>");

  // Bold **text**
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italics *text*
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Links [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
  );

  return result;
}
