import { marked } from "marked";

const safeHTMLTags = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const discardedHTMLTags = new Set([
  "applet",
  "audio",
  "base",
  "button",
  "canvas",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "input",
  "link",
  "math",
  "meta",
  "object",
  "picture",
  "script",
  "select",
  "source",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
]);

export function renderSafeMarkdown(content: string): string {
  const rendered = marked.parse(content, {
    async: false,
    breaks: true,
    gfm: true,
  });
  return sanitizeHTML(typeof rendered === "string" ? rendered : "");
}

export function sanitizeHTML(content: string): string {
  if (typeof DOMParser === "undefined") return "";
  const source = content.trim();
  if (!/<\/?[a-z][^>]*>/i.test(source)) return "";
  const documentValue = new DOMParser().parseFromString(source, "text/html");
  for (const element of Array.from(documentValue.body.querySelectorAll("*"))) {
    if (!element.isConnected) continue;
    const tag = element.tagName.toLowerCase();
    if (discardedHTMLTags.has(tag)) {
      element.remove();
      continue;
    }
    if (!safeHTMLTags.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    const href = tag === "a" ? safeLink(element.getAttribute("href")) : "";
    const title =
      tag === "a" ? (element.getAttribute("title")?.slice(0, 512) ?? "") : "";
    const imageSource =
      tag === "img" ? safeImage(element.getAttribute("src")) : "";
    const imageAlt =
      tag === "img" ? (element.getAttribute("alt")?.slice(0, 512) ?? "") : "";
    const colSpan =
      tag === "td" || tag === "th"
        ? boundedTableSpan(element.getAttribute("colspan"))
        : "";
    const rowSpan =
      tag === "td" || tag === "th"
        ? boundedTableSpan(element.getAttribute("rowspan"))
        : "";
    const open = tag === "details" && element.hasAttribute("open");
    for (const attribute of Array.from(element.attributes))
      element.removeAttribute(attribute.name);
    if (href) {
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "nofollow noopener noreferrer");
    }
    if (title) element.setAttribute("title", title);
    if (imageSource) {
      element.setAttribute("src", imageSource);
      element.setAttribute("alt", imageAlt);
      element.setAttribute("loading", "lazy");
      element.setAttribute("decoding", "async");
      element.setAttribute("referrerpolicy", "no-referrer");
    } else if (tag === "img") {
      element.remove();
      continue;
    }
    if (colSpan) element.setAttribute("colspan", colSpan);
    if (rowSpan) element.setAttribute("rowspan", rowSpan);
    if (open) element.setAttribute("open", "");
  }
  return documentValue.body.innerHTML;
}

function safeLink(value: string | null): string {
  const link = value?.trim() ?? "";
  if (!link) return "";
  try {
    const parsed = new URL(link);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol)
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function safeImage(value: string | null): string {
  const source = value?.trim() ?? "";
  if (!source) return "";
  if (source.startsWith("/v1/media/images/")) return source;
  try {
    const parsed = new URL(source);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function boundedTableSpan(value: string | null): string {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100
    ? String(parsed)
    : "";
}
