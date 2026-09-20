import MarkdownIt from "markdown-it";

export const STARTER_STORY = `# Overview

# Hook

# Sections

## Intro

## Beat

## Outro
`;

export const storyMarkdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

export function storySectionHeadings(source) {
  const tokens = storyMarkdown.parse(source, {});
  const headings = [];
  let inSections = false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== "heading_open" || token.level !== 0) continue;
    const title = tokens[index + 1]?.content?.trim() || "";
    if (token.tag === "h1") {
      inSections = title.toLowerCase() === "sections";
      continue;
    }
    if (inSections && token.tag === "h2")
      headings.push({ title, line: token.map[0] });
  }
  return headings;
}
