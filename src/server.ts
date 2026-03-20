import cron from "node-cron";
import { config } from "./config";
import { runFleetGraph } from "./graph";
import { app } from "./app";

let proactiveRunInProgress = false;
if (config.proactiveCronEnabled) {
  cron.schedule(config.proactiveCron, async () => {
    if (proactiveRunInProgress) return;
    proactiveRunInProgress = true;
    const targets = config.proactiveTargets;
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
  if (!config.fleetgraphApiKey) {
    console.warn("⚠ FLEETGRAPH_API_KEY is not set — all endpoints are unauthenticated. Set it in production.");
  }
  if (process.env.NODE_ENV === "production") {
    console.log("Production mode: test harness disabled, security headers active");
  }
});
