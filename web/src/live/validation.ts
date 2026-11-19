import type { Rule } from "antd/es/form";

const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).length;
}

export function hasControlNull(value: string): boolean {
  return value.includes("\u0000");
}

export function trimRequiredRule(message: string): Rule {
  return {
    validator: (_, value) => {
      const str = typeof value === "string" ? value : "";
      if (!str.trim()) return Promise.reject(new Error(message));
      if (hasControlNull(str)) return Promise.reject(new Error("内容包含非法空字符"));
      return Promise.resolve();
    },
  };
}

export function utf8ByteRangeRule(
  minBytes: number,
  maxBytes: number,
  label: string,
): Rule {
  return {
    validator: (_, value) => {
      const str = typeof value === "string" ? value : "";
      if (hasControlNull(str)) return Promise.reject(new Error(`${label}包含非法字符`));
      const bytes = utf8ByteLength(str);
      if (minBytes > 0 && bytes < minBytes) {
        return Promise.reject(new Error(`${label}至少需要 ${minBytes} 字节`));
      }
      if (bytes > maxBytes) {
        return Promise.reject(new Error(`${label}不能超过 ${maxBytes} 字节（当前 ${bytes} 字节）`));
      }
      return Promise.resolve();
    },
  };
}

export function httpUrlRule(required = false): Rule {
  return {
    validator: (_, value) => {
      const raw = typeof value === "string" ? value.trim() : "";
      if (!raw) {
        return required ? Promise.reject(new Error("请输入有效的网页地址")) : Promise.resolve();
      }
      if (utf8ByteLength(raw) > 2000) {
        return Promise.reject(new Error("链接长度不能超过 2000 字节"));
      }
      try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return Promise.reject(new Error("仅支持 http:// 或 https:// 链接"));
        }
        return Promise.resolve();
      } catch {
        return Promise.reject(new Error("请输入完整的 http:// 或 https:// 链接"));
      }
    },
  };
}

export function isValidHTTPUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || utf8ByteLength(trimmed) > 2000) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const clean = item.trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

export function cleanTags(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const clean = item.trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}
