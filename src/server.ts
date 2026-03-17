import express from "express";
import cors from "cors";
import cron from "node-cron";
import { z } from "zod";
import { config } from "./config";
import { runFleetGraph } from "./graph";
import { listApprovals, updateApproval } from "./approvalStore";
import type { FleetMode, ShipTarget } from "./types";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  if (!config.fleetgraphApiKey) return next();
  const provided = req.header("x-fleetgraph-key");
  if (provided !== config.fleetgraphApiKey) {
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

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "fleetgraph" });
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
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/proactive/run", async (req, res) => {
  const target = (req.body?.target ?? "prod") as ShipTarget;
  if (target !== "local" && target !== "prod") return res.status(400).json({ error: "Invalid target" });

  try {
    const result = await runFleetGraph({ mode: "proactive", target });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/approvals", (req, res) => {
  const status = req.query.status;
  if (status && status !== "pending" && status !== "approved" && status !== "rejected") {
    return res.status(400).json({ error: "Invalid status" });
  }
  res.json({ approvals: listApprovals(status as "pending" | "approved" | "rejected" | undefined) });
});

app.post("/api/approvals/:id", (req, res) => {
  const id = req.params.id;
  const decision = req.body?.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return res.status(400).json({ error: "decision must be approved|rejected" });
  }

  const record = updateApproval(id, decision);
  if (!record) return res.status(404).json({ error: "Approval not found" });
  return res.json(record);
});

if (config.proactiveCronEnabled) {
  cron.schedule(config.proactiveCron, async () => {
    for (const target of ["local", "prod"] as const) {
      try {
        const result = await runFleetGraph({ mode: "proactive", target });
        console.log(`[proactive:${target}]`, {
          severity: result.severity,
          findings: result.findings.length,
          tracePath: result.tracePath
        });
      } catch (error) {
        console.error(`[proactive:${target}] failed`, error);
      }
    }
  });
}

app.listen(config.port, () => {
  console.log(`FleetGraph listening on http://localhost:${config.port}`);
});

