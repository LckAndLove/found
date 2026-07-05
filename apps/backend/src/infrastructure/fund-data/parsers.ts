import { UpstreamError } from "../../shared/errors.js";

export function parseJsonp(text: string, callback: string): unknown {
  const pattern = new RegExp(`^\\s*${escapeRegExp(callback)}\\((.*)\\);?\\s*$`, "s");
  const match = text.match(pattern);
  if (!match) {
    throw new UpstreamError("上游 JSONP 格式异常", { callback });
  }

  try {
    return JSON.parse(match[1]) as unknown;
  } catch (error) {
    throw new UpstreamError("上游 JSONP 内容不是有效 JSON", {
      callback,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

export function parseScriptVariable(text: string, variableName: string) {
  const match = text.match(new RegExp(`${escapeRegExp(variableName)}="([\\s\\S]*?)";?`));
  return match?.[1] ?? null;
}

export function parseApidataContent(text: string) {
  const match = text.match(/content\s*:\s*(['"])([\s\S]*?)\1\s*[,}]/);
  if (!match) {
    return "";
  }

  return decodeScriptString(match[2]);
}

export function parseNetWorthTrend(text: string): Array<Record<string, unknown>> {
  const match = text.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    return [];
  }

  try {
    return JSON.parse(match[1]) as Array<Record<string, unknown>>;
  } catch (error) {
    throw new UpstreamError("上游净值走势内容不是有效 JSON", {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

export function extractTableCells(html: string, tag: "td" | "th") {
  const pattern = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
  return (html.match(pattern) ?? []).map(stripHtml);
}

export function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function toNullableString(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const text = String(value);
  return text ? text : null;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeScriptString(value: string) {
  return value
    .replace(/\\'/g, "'")
    .replace(/\\"/g, "\"")
    .replace(/\\\//g, "/")
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}
