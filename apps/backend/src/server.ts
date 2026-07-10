import cors from "cors";
import express from "express";
import type { Server } from "node:http";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { appConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
      const funds: Array<{ code: string; name: string; nav: string; zzl: string; zzlRaw: number; dailyProfit: string | null; isSettled?: boolean }> =
        Array.isArray(request.body?.funds) ? (request.body.funds as Array<{ code: string; name: string; nav: string; zzl: string; zzlRaw: number; dailyProfit: string | null; isSettled?: boolean }>) : [];
      const totalDailyProfit: string = optionalTrimmedString(request.body?.totalDailyProfit, "totalDailyProfit") ?? "";

      const runScript = (script: string) =>
        new Promise<string>((resolve, reject) => {
          exec(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, (error, stdout) => {
            if (error) { reject(error); } else { resolve(stdout.trim()); }
          });
        });

      const selfEmail = "918382809@qq.com";

      // 尝试查找并加载 Google SMTP 配置
      let mailConfig: { user: string; pass: string } | null = null;
      const configPaths = [
        path.join(process.cwd(), "config", "mail.config.json"),
        path.join(process.cwd(), "..", "..", "config", "mail.config.json"),
        path.join(__dirname, "../../../config/mail.config.json"),
        path.join(__dirname, "../../../../config/mail.config.json")
      ];

      for (const p of configPaths) {
        if (fs.existsSync(p)) {
          try {
            mailConfig = JSON.parse(fs.readFileSync(p, "utf-8"));
            break;
          } catch (e) {
            // ignore
          }
        }
      }

      const fundRows = funds.map((f) => {
        const up = f.zzlRaw > 0; const dn = f.zzlRaw < 0;
        const rC = up ? "#d93025" : dn ? "#188038" : "#5f6368";
        const rB = up ? "#fce8e6" : dn ? "#e6f4ea" : "#f1f3f4";
        const pC = f.dailyProfit ? (f.dailyProfit.startsWith("+") ? "#d93025" : f.dailyProfit.startsWith("-") ? "#188038" : "#5f6368") : "#5f6368";
        const statusBadge = f.isSettled
          ? `<span style="display:inline-block;font-size:10px;font-weight:700;color:#188038;background:#e6f4ea;padding:1px 4px;border-radius:4px;margin-left:6px;vertical-align:middle;white-space:nowrap;">已更新</span>`
          : `<span style="display:inline-block;font-size:10px;font-weight:700;color:#5f6368;background:#f1f3f4;padding:1px 4px;border-radius:4px;margin-left:6px;vertical-align:middle;white-space:nowrap;">估算中</span>`;
        return `<tr><td style="padding:12px 16px;border-bottom:1px solid #e9ecef;max-width:260px;"><div style="font-size:13px;font-weight:600;color:#202124;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.name}</div><div style="font-size:11px;color:#5f6368;font-family:monospace;"><span style="vertical-align:middle;">${f.code}</span>${statusBadge}</div></td><td style="padding:12px 16px;border-bottom:1px solid #e9ecef;text-align:center;white-space:nowrap;"><span style="display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;background:${rB};color:${rC};">${f.zzl}</span></td><td style="padding:12px 16px;border-bottom:1px solid #e9ecef;text-align:right;font-family:monospace;font-size:13px;font-weight:700;color:${pC};white-space:nowrap;">${f.dailyProfit != null ? `&yen;&nbsp;${f.dailyProfit}` : "&mdash;"}</td></tr>`;
      }).join("");

      const tC = totalDailyProfit.startsWith("+") ? "#d93025" : totalDailyProfit.startsWith("-") ? "#188038" : "#5f6368";
      const tB = totalDailyProfit.startsWith("+") ? "#fce8e6" : totalDailyProfit.startsWith("-") ? "#e6f4ea" : "#f1f3f4";
      const tBorder = totalDailyProfit.startsWith("+") ? "#fad2cf" : totalDailyProfit.startsWith("-") ? "#ceead6" : "#e8eaed";
      const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

      const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f7f8;color:#202124;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f8;padding:32px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;"><tr><td style="background:#ffffff;border-radius:16px 16px 0 0;padding:32px 40px;border-bottom:1px solid #e9ecef;border-top:4px solid #1a73e8;"><div style="color:#5f6368;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">NET VALUE RADAR</div><div style="color:#202124;font-size:22px;font-weight:800;letter-spacing:-0.03em;margin-top:6px;">净值雷达</div><div style="margin-top:16px;color:#5f6368;font-size:13px;">今日净值已全部更新 &nbsp;·&nbsp; ${now}</div></td></tr><tr><td style="background:#ffffff;padding:28px 40px 8px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:${tB};border-radius:14px;padding:0;border:1px solid ${tBorder};"><tr><td style="padding:20px 24px;"><div style="font-size:11px;font-weight:700;color:#5f6368;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">今日估算总收益</div><div style="font-size:30px;font-weight:800;color:${tC};letter-spacing:-0.02em;">&#165; ${totalDailyProfit || "--"}</div></td></tr></table></td></tr><tr><td style="background:#ffffff;padding:20px 40px 28px;"><div style="font-size:11px;font-weight:700;color:#5f6368;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;">自选基金明细</div><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e9ecef;border-radius:12px;overflow:hidden;"><thead><tr style="background:#f8f9fa;"><th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#5f6368;letter-spacing:0.05em;border-bottom:1px solid #e9ecef;">基金名称</th><th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:700;color:#5f6368;border-bottom:1px solid #e9ecef;">涨跌幅</th><th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:700;color:#5f6368;border-bottom:1px solid #e9ecef;">估算收益</th></tr></thead><tbody>${fundRows}</tbody></table></td></tr><tr><td style="background:#ffffff;border-radius:0 0 16px 16px;padding:16px 40px 28px;border-top:1px solid #e9ecef;text-align:center;"><div style="color:#9aa0a6;font-size:12px;line-height:1.8;">此邮件由 <strong style="color:#5f6368;">净值雷达</strong> 自动发送 &nbsp;·&nbsp; 数据来源天天基金<br>仅供参考，不构成投资建议</div></td></tr></table></td></tr></table></body></html>`;

      if (mailConfig && mailConfig.user && mailConfig.pass) {
        try {
          const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
              user: mailConfig.user,
              pass: mailConfig.pass
            }
          });
          await transporter.sendMail({
            from: `"净值雷达" <${mailConfig.user}>`,
            to: selfEmail,
            subject: subject,
            html: html
          });
          response.json({ ok: true, to: selfEmail, method: "smtp" });
          return;
        } catch (smtpError) {
          console.error("SMTP send failed, falling back to Mail.app:", smtpError);
        }
      }

      // Fallback to AppleScript Mail.app

      const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const sendScript = `tell application "Mail"\nset m to make new outgoing message with properties {subject:"${esc(subject)}", html content:"${esc(html)}", visible:false}\nset message signature of m to missing value\ntell m\nmake new to recipient with properties {address:"${esc(selfEmail)}"}\nend tell\nsend m\nend tell\nlaunch application "Mail"`;

      await runScript(sendScript);
      response.json({ ok: true, to: selfEmail, method: "mail.app" });
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
