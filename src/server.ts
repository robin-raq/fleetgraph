import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { z } from "zod";
import { config } from "./config";
import { runFleetGraph } from "./graph";
import { listApprovals, updateApproval } from "./approvalStore";
import type { FleetMode } from "./types";

const app = express();

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

// Serve static test harness (before auth middleware so /test is public)
app.use(express.static(path.resolve(__dirname, "../public")));

function apiKeyMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}

app.use((req, res, next) => {
  if (!config.fleetgraphApiKey) return next();
  const provided = req.header("x-fleetgraph-key");
  if (!apiKeyMatches(provided, config.fleetgraphApiKey)) {
    return res.status(401).json({ error: "Invalid FleetGraph API key" });
  }
  next();
});

const requestSchema = z.object({
  target: z.enum(["local", "prod"]).default("prod"),
  mode: z.enum(["on_demand", "proactive"]).default("on_demand"),
  message: z.string().optional(),
  context: z.object({
    pathname: z.string().optional(),
    entityType: z.enum(["issue", "project", "program", "sprint", "document", "unknown"]).optional(),
    entityId: z.string().optional()
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

function publicErrorMessage(error: unknown): string {
  if (process.env.NODE_ENV === "production") return "Internal server error";
  return error instanceof Error ? error.message : "Unknown server error";
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "fleetgraph" });
});

app.get("/", (_req, res) => {
  res.redirect("/test.html");
});

app.post("/api/chat", async (req, res) => {
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

app.post("/api/proactive/run", async (req, res) => {
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

let proactiveRunInProgress = false;
if (config.proactiveCronEnabled) {
  cron.schedule(config.proactiveCron, async () => {
    if (proactiveRunInProgress) return;
    proactiveRunInProgress = true;
    const targets = ["local", "prod"] as const;
    try {
      const results = await Promise.allSettled(
        targets.map((target) => runFleetGraph({ mode: "proactive", target }))
      );
      results.forEach((outcome, i) => {
        if (outcome.status === "fulfilled") {
          console.log(`[proactive:${targets[i]}]`, {
            severity: outcome.value.severity,
            findings: outcome.value.findings.length,
            tracePath: outcome.value.tracePath
          });
        } else {
          console.error(`[proactive:${targets[i]}] failed`, outcome.reason);
        }
      });
    } finally {
      proactiveRunInProgress = false;
    }
  });
}

app.listen(config.port, () => {
  console.log(`FleetGraph listening on http://localhost:${config.port}`);
});

