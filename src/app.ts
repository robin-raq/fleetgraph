import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "./config";
import { runFleetGraph } from "./graph";
import { listApprovals, updateApproval } from "./approvalStore";
import type { FleetMode } from "./types";

export const app = express();

// Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
app.use(helmet());

const corsOptions: cors.CorsOptions = config.corsOrigins === "*"
  ? { origin: true }
  : {
      origin: (origin, callback) => {
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
      }
    };

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// Rate limit expensive routes (LLM calls + Ship API)
const llmLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — try again in a minute" }
});

// Serve static test harness only in non-production
if (process.env.NODE_ENV !== "production") {
  app.use(express.static(path.resolve(__dirname, "../public")));
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function apiKeyMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  // Hash both values to normalize length — prevents timing side-channel on key length
  return timingSafeEqual(sha256(provided), sha256(expected));
}

app.use((req, res, next) => {
  if (!config.fleetgraphApiKey) {
    // Health check always open; warn logged at startup (see server.ts)
    return next();
  }
  const provided = req.header("x-fleetgraph-key");
  if (!apiKeyMatches(provided, config.fleetgraphApiKey)) {
    return res.status(401).json({ error: "Invalid FleetGraph API key" });
  }
  next();
});

const requestSchema = z.object({
  target: z.enum(["local", "prod"]).default("prod"),
  mode: z.enum(["on_demand", "proactive"]).default("on_demand"),
  message: z.string().max(2000).optional(),
  context: z.object({
    pathname: z.string().max(500).optional(),
    entityType: z.enum(["issue", "project", "program", "sprint", "document", "unknown"]).optional(),
    entityId: z.string().max(200).regex(/^[\w-]+$/, "entityId must be alphanumeric/dashes/underscores").optional()
  }).optional()
});

const proactiveRequestSchema = z.object({
  target: z.enum(["local", "prod"]).default("prod")
});

const approvalListQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional()
});

const approvalDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"])
});

export function publicErrorMessage(error: unknown): string {
  if (process.env.NODE_ENV === "production") return "Internal server error";
  return error instanceof Error ? error.message : "Unknown server error";
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "fleetgraph" });
});

app.get("/", (_req, res) => {
  res.redirect("/test.html");
});

app.post("/api/chat", llmLimiter, async (req, res) => {
  const parsed = requestSchema.safeParse({
    ...req.body,
    mode: "on_demand" satisfies FleetMode
  });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await runFleetGraph(parsed.data);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: publicErrorMessage(error) });
  }
});

app.post("/api/proactive/run", llmLimiter, async (req, res) => {
  const parsed = proactiveRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await runFleetGraph({ mode: "proactive", target: parsed.data.target });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: publicErrorMessage(error) });
  }
});

app.get("/api/approvals", (req, res) => {
  const parsed = approvalListQuerySchema.safeParse({ status: req.query.status });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json({ approvals: listApprovals(parsed.data.status) });
});

app.post("/api/approvals/:id", (req, res) => {
  const id = req.params.id;
  const parsed = approvalDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const record = updateApproval(id, parsed.data.decision);
  if (!record) return res.status(404).json({ error: "Approval not found" });
  return res.json(record);
});
