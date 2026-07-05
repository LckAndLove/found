import cors from "cors";
import express from "express";
import type { Server } from "node:http";
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
