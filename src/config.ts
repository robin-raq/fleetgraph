import dotenv from "dotenv";
import { z } from "zod";
import type { ShipTarget } from "./types";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  FLEETGRAPH_API_KEY: z.string().optional(),
  CORS_ORIGINS: z.string().default("*"),
  SHIP_API_BASE_URL_LOCAL: z.string().url().default("http://localhost:3000"),
  SHIP_API_TOKEN_LOCAL: z.string().min(1, "SHIP_API_TOKEN_LOCAL is required"),
  SHIP_API_BASE_URL_PROD: z.string().url().default("https://ship-app-production.up.railway.app"),
  SHIP_API_TOKEN_PROD: z.string().min(1, "SHIP_API_TOKEN_PROD is required"),
  SHIP_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  ENABLE_PROACTIVE_CRON: z.string().default("false"),
  PROACTIVE_CRON: z.string().default("0,30 8-18 * * 1-5"),
  MAX_APPROVAL_RECORDS: z.coerce.number().int().min(50).max(10000).default(500)
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid FleetGraph env:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;
const corsOrigins = env.CORS_ORIGINS === "*"
  ? "*"
  : env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);

export const config = {
  port: env.PORT,
  fleetgraphApiKey: env.FLEETGRAPH_API_KEY,
  corsOrigins,
  openAiApiKey: env.OPENAI_API_KEY,
  openAiModel: env.OPENAI_MODEL,
  shipApiTimeoutMs: env.SHIP_API_TIMEOUT_MS,
  proactiveCronEnabled: env.ENABLE_PROACTIVE_CRON === "true",
  proactiveCron: env.PROACTIVE_CRON,
  maxApprovalRecords: env.MAX_APPROVAL_RECORDS,
  shipTargets: {
    local: {
      baseUrl: env.SHIP_API_BASE_URL_LOCAL,
      token: env.SHIP_API_TOKEN_LOCAL
    },
    prod: {
      baseUrl: env.SHIP_API_BASE_URL_PROD,
      token: env.SHIP_API_TOKEN_PROD
    }
  }
};

export function resolveShipTarget(target: ShipTarget): { baseUrl: string; token: string } {
  return config.shipTargets[target];
}

