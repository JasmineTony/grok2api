import { marked } from "marked";

const safeAssistantHTMLTags = new Set([
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

const discardedAssistantHTMLTags = new Set([
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

export function renderAssistantMarkup(content: string): string {
  const rendered = marked.parse(content, { async: false, breaks: true, gfm: true });
  return sanitizeAssistantHTML(typeof rendered === "string" ? rendered : "");
}

export function sanitizeAssistantHTML(content: string): string {
  if (typeof DOMParser === "undefined") return "";
  const source = content.trim();
  if (!/<\/?[a-z][^>]*>/i.test(source)) return "";
  const documentValue = new DOMParser().parseFromString(source, "text/html");
  const elements = Array.from(documentValue.body.querySelectorAll("*"));
  for (const element of elements) sanitizeAssistantElement(element);
  return documentValue.body.innerHTML;
}

function sanitizeAssistantElement(element: Element): void {
  if (!element.isConnected) return;
  const tag = element.tagName.toLowerCase();
  if (discardedAssistantHTMLTags.has(tag)) {
    element.remove();
    return;
  }
  if (!safeAssistantHTMLTags.has(tag)) {
    element.replaceWith(...Array.from(element.childNodes));
    return;
  }
  const attributes = readAssistantAttributes(element, tag);
  for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
  applyAssistantAttributes(element, tag, attributes);
}

type AssistantAttributes = {
  href: string;
  title: string;
  imageSource: string;
  imageAlt: string;
  colSpan: string;
  rowSpan: string;
  open: boolean;
};

function readAssistantAttributes(element: Element, tag: string): AssistantAttributes {
  const isImage = tag === "img";
  const isTableCell = tag === "td" || tag === "th";
  return {
    href: tag === "a" ? safeAssistantLink(element.getAttribute("href")) : "",
    title: tag === "a" ? (element.getAttribute("title")?.slice(0, 512) ?? "") : "",
    imageSource: isImage ? safeAssistantImage(element.getAttribute("src")) : "",
    imageAlt: isImage ? (element.getAttribute("alt")?.slice(0, 512) ?? "") : "",
    colSpan: isTableCell ? boundedTableSpan(element.getAttribute("colspan")) : "",
    rowSpan: isTableCell ? boundedTableSpan(element.getAttribute("rowspan")) : "",
    open: tag === "details" && element.hasAttribute("open"),
  };
}

function applyAssistantAttributes(element: Element, tag: string, attributes: AssistantAttributes): void {
  if (attributes.href) {
    element.setAttribute("href", attributes.href);
    element.setAttribute("target", "_blank");
    element.setAttribute("rel", "nofollow noopener noreferrer");
  }
  if (attributes.title) element.setAttribute("title", attributes.title);
  if (attributes.imageSource) {
    element.setAttribute("src", attributes.imageSource);
    element.setAttribute("alt", attributes.imageAlt);
    element.setAttribute("loading", "lazy");
    element.setAttribute("decoding", "async");
    element.setAttribute("referrerpolicy", "no-referrer");
  } else if (tag === "img") {
    element.remove();
    return;
  }
  if (attributes.colSpan) element.setAttribute("colspan", attributes.colSpan);
  if (attributes.rowSpan) element.setAttribute("rowspan", attributes.rowSpan);
  if (attributes.open) element.setAttribute("open", "");
}

export function safeAssistantLink(value: string | null): string {
  const link = value?.trim() ?? "";
  if (!link) return "";
  try {
    const parsed = new URL(link);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

export function safeAssistantImage(value: string | null): string {
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

export function boundedTableSpan(value: string | null): string {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? String(parsed) : "";
}
