import cors from "cors";
import express from "express";
import type { Server } from "node:http";
import { exec } from "node:child_process";
import { appConfig } from "./config.js";
import { createFundService } from "./domain/funds/service.js";
import { createFundDataClient } from "./infrastructure/fund-data/fundDataClient.js";
import { createUpstreamHttpClient } from "./infrastructure/http/upstreamHttpClient.js";
import { createSqliteDatabase } from "./infrastructure/sqlite/database.js";
import { createFundWatchlistRepository } from "./infrastructure/sqlite/fundWatchlistRepository.js";
import { asyncHandler, errorHandler } from "./shared/http.js";
import {
  optionalBoolean,
  optionalInteger,
  optionalTrimmedString,
  optionalNumber,
  requireDateString,
  requireFundCode,
  requireNonEmptyString
} from "./shared/validation.js";

export type ApiServerOptions = {
  port?: number;
  host?: string;
};

export function createApiApp() {
  const app = express();
  const database = createSqliteDatabase();
  const fundService = createFundService(
    createFundDataClient(createUpstreamHttpClient({ timeoutMs: appConfig.upstream.timeoutMs })),
    createFundWatchlistRepository(database.connection)
  );
  app.locals.closeDatabase = () => database.close();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      name: appConfig.app.name,
      version: appConfig.app.version,
      service: "backend",
      storage: {
        sqlite: true
      },
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/profile", (_request, response) => {
    response.json({
      appName: appConfig.app.name,
      version: appConfig.app.version,
      mode: appConfig.app.mode,
      message: appConfig.app.profileMessage
    });
  });

  app.get(
    "/api/funds/search",
    asyncHandler(async (request, response) => {
      const keyword = requireNonEmptyString(request.query.keyword, "keyword");
      response.json({ items: await fundService.searchFunds(keyword) });
    })
  );

  app.get(
    "/api/funds/watchlist",
    asyncHandler(async (_request, response) => {
      response.json({ items: await fundService.listWatchlist() });
    })
  );

  app.post(
    "/api/funds/watchlist",
    asyncHandler(async (request, response) => {
      const code = requireFundCode(request.body?.code);
      const name = optionalTrimmedString(request.body?.name, "name");
      response.status(201).json(await fundService.upsertWatchlistItem({ code, name }));
    })
  );

  app.patch(
    "/api/funds/watchlist/:code",
    asyncHandler(async (request, response) => {
      const code = requireFundCode(request.params.code);
      const holdingShares = optionalNumber(request.body?.holdingShares, "holdingShares");
      const costPrice = optionalNumber(request.body?.costPrice, "costPrice");
      response.json(await fundService.updateWatchlistItemHoldings(code, { holdingShares, costPrice }));
    })
  );

  app.delete(
    "/api/funds/watchlist/:code",
    asyncHandler(async (request, response) => {
      const code = requireFundCode(request.params.code);
      await fundService.removeWatchlistItem(code);
      response.status(204).end();
    })
  );

  app.get(
    "/api/funds/:code/net-value/next",
    asyncHandler(async (request, response) => {
      const code = requireFundCode(request.params.code);
      const startDate = requireDateString(request.query.startDate, "startDate");
      const maxDays = optionalInteger(request.query.maxDays, appConfig.funds.smartNetValueDefaultMaxDays, {
        name: "maxDays",
        min: 1,
        max: appConfig.funds.smartNetValueMaxDays
      });
      response.json(await fundService.getSmartFundNetValue(code, startDate, maxDays));
    })
  );

  app.get(
    "/api/funds/:code/net-value",
    asyncHandler(async (request, response) => {
      const code = requireFundCode(request.params.code);
      const date = requireDateString(request.query.date, "date");
      response.json(await fundService.getFundNetValue(code, date));
    })
  );

  app.get(
    "/api/funds/:code/intraday",
    asyncHandler(async (request, response) => {
      const code = requireFundCode(request.params.code);
      response.json(await fundService.getFundIntraday(code));
    })
  );

  app.get(
    "/api/funds/:code",
    asyncHandler(async (request, response) => {
      const code = requireFundCode(request.params.code);
      response.json(
        await fundService.getFundDetail(code, {
          includeHoldings: optionalBoolean(request.query.includeHoldings, true),
          includeTrend: optionalBoolean(request.query.includeTrend, true)
        })
      );
    })
  );

  app.get(
    "/api/market/shanghai-index/date",
    asyncHandler(async (_request, response) => {
      response.json(await fundService.getShanghaiIndexDate());
    })
  );

  app.get(
    "/api/market/indices",
    asyncHandler(async (_request, response) => {
      response.json(await fundService.getMarketIndices());
    })
  );

  app.post(
    "/api/notify/mail",
    asyncHandler(async (request, response) => {
      const subject = optionalTrimmedString(request.body?.subject, "subject") ?? `${appConfig.app.name} 今日净值汇总`;
      const funds: Array<{ code: string; name: string; nav: string; zzl: string; zzlRaw: number; dailyProfit: string | null }> =
        Array.isArray(request.body?.funds) ? (request.body.funds as Array<{ code: string; name: string; nav: string; zzl: string; zzlRaw: number; dailyProfit: string | null }>) : [];
      const totalDailyProfit: string = optionalTrimmedString(request.body?.totalDailyProfit, "totalDailyProfit") ?? "";

      const runScript = (script: string) =>
        new Promise<string>((resolve, reject) => {
          exec(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, (error, stdout) => {
            if (error) { reject(error); } else { resolve(stdout.trim()); }
          });
        });

      const selfEmail = await runScript(
        `tell application "Mail" to get user name of item 1 of accounts`
      );

      const fundRows = funds.map((f) => {
        const up = f.zzlRaw > 0; const dn = f.zzlRaw < 0;
        const rC = up ? "#ff6b6b" : dn ? "#81c995" : "#b0b3b8";
        const rB = up ? "rgba(255,107,107,0.15)" : dn ? "rgba(129,201,149,0.15)" : "#2a2a2a";
        const pC = f.dailyProfit ? (f.dailyProfit.startsWith("+") ? "#ff6b6b" : f.dailyProfit.startsWith("-") ? "#81c995" : "#b0b3b8") : "#b0b3b8";
        return `<tr><td style="padding:12px 16px;border-bottom:1px solid #333333;max-width:260px;"><div style="font-size:13px;font-weight:600;color:#f0f0f0;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.name}</div><div style="font-size:11px;color:#888888;font-family:monospace;">${f.code}</div></td><td style="padding:12px 16px;border-bottom:1px solid #333333;text-align:center;white-space:nowrap;"><span style="display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;background:${rB};color:${rC};">${f.zzl}</span></td><td style="padding:12px 16px;border-bottom:1px solid #333333;text-align:right;font-family:monospace;font-size:13px;font-weight:700;color:${pC};white-space:nowrap;">${f.dailyProfit != null ? `&yen;&nbsp;${f.dailyProfit}` : "&mdash;"}</td></tr>`;
      }).join("");

      const tC = totalDailyProfit.startsWith("+") ? "#ff6b6b" : totalDailyProfit.startsWith("-") ? "#81c995" : "#b0b3b8";
      const tB = totalDailyProfit.startsWith("+") ? "rgba(255,107,107,0.08)" : totalDailyProfit.startsWith("-") ? "rgba(129,201,149,0.08)" : "#1e1e1e";
      const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

      const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#141414;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#141414;padding:32px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;"><tr><td style="background:#1e1e1e;border-radius:16px 16px 0 0;padding:32px 40px;border-bottom:1px solid #333333;"><div style="color:#888888;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">NET VALUE RADAR</div><div style="color:#f0f0f0;font-size:22px;font-weight:800;letter-spacing:-0.03em;margin-top:6px;">净值雷达</div><div style="margin-top:16px;color:#888888;font-size:13px;">今日净值已全部更新 &nbsp;·&nbsp; ${now}</div></td></tr><tr><td style="background:#1e1e1e;padding:28px 40px 8px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:${tB};border-radius:14px;padding:0;border:1px solid #333333;"><tr><td style="padding:20px 24px;"><div style="font-size:11px;font-weight:700;color:#888888;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">今日估算总收益</div><div style="font-size:30px;font-weight:800;color:${tC};letter-spacing:-0.02em;">&#165; ${totalDailyProfit || "--"}</div></td></tr></table></td></tr><tr><td style="background:#1e1e1e;padding:20px 40px 28px;"><div style="font-size:11px;font-weight:700;color:#888888;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;">自选基金明细</div><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #333333;border-radius:12px;overflow:hidden;"><thead><tr style="background:#2a2a2a;"><th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#888888;letter-spacing:0.05em;border-bottom:1px solid #333333;">基金名称</th><th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:700;color:#888888;border-bottom:1px solid #333333;">涨跌幅</th><th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:700;color:#888888;border-bottom:1px solid #333333;">估算收益</th></tr></thead><tbody>${fundRows}</tbody></table></td></tr><tr><td style="background:#1e1e1e;border-radius:0 0 16px 16px;padding:16px 40px 28px;border-top:1px solid #333333;text-align:center;"><div style="color:#888888;font-size:12px;line-height:1.8;">此邮件由 <strong style="color:#f0f0f0;">净值雷达</strong> 自动发送 &nbsp;·&nbsp; 数据来源天天基金<br>仅供参考，不构成投资建议</div></td></tr></table></td></tr></table></body></html>`;
      const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const sendScript = `tell application "Mail"\nset m to make new outgoing message with properties {subject:"${esc(subject)}", html content:"${esc(html)}", visible:false}\ntell m\nmake new to recipient with properties {address:"${esc(selfEmail)}"}\nend tell\nsend m\nend tell`;

      await runScript(sendScript);
      response.json({ ok: true, to: selfEmail });
    })
  );

  app.use(errorHandler);

  return app;
}

export async function startApiServer(options: ApiServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? appConfig.api.port);
  const host = options.host ?? process.env.HOST ?? appConfig.api.host;
  const app = createApiApp();

  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(port, host, () => resolve(instance));
    instance.on("error", reject);
  });

  return {
    app,
    server,
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          const closeDatabase = app.locals.closeDatabase as (() => void) | undefined;
          closeDatabase?.();
          resolve();
        });
      })
  };
}
