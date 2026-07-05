import { UpstreamError } from "../../shared/errors.js";

export type UpstreamHttpClient = {
  getText(url: string | URL): Promise<string>;
  getJson<T>(url: string | URL): Promise<T>;
};

export function createUpstreamHttpClient(options: { timeoutMs?: number } = {}): UpstreamHttpClient {
  const timeoutMs = options.timeoutMs ?? 8000;

  async function request(url: string | URL) {
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent": "3.found/0.1.0"
        }
      });
    } catch (error) {
      throw new UpstreamError("上游数据源请求失败", {
        url: String(url),
        reason: error instanceof Error ? error.message : String(error)
      });
    }

    if (!response.ok) {
      throw new UpstreamError("上游数据源返回错误状态", {
        url: String(url),
        status: response.status
      });
    }

    return response;
  }

  return {
    async getText(url) {
      const response = await request(url);
      return response.text();
    },

    async getJson<T>(url: string | URL) {
      const response = await request(url);
      try {
        return (await response.json()) as T;
      } catch (error) {
        throw new UpstreamError("上游数据源返回无效 JSON", {
          url: String(url),
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };
}
