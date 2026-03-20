import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Mock runFleetGraph before importing the app
vi.mock("./graph", () => ({
  runFleetGraph: vi.fn()
}));

import { app, publicErrorMessage } from "./app";
import { runFleetGraph } from "./graph";
import { createApproval, clearApprovals } from "./approvalStore";
import { config } from "./config";

const mockedRunFleetGraph = vi.mocked(runFleetGraph);

const mockResult = {
  findings: [],
  severity: "clean" as const,
  summary: "All clear",
  tracePath: "clean_path" as const,
  needsApproval: false,
  chatResponse: "Test response"
};

describe("server", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearApprovals();
    mockedRunFleetGraph.mockResolvedValue(mockResult);
  });

  // --- Auth middleware ---

  describe("auth middleware", () => {
    it("returns 401 without API key when key is configured", async () => {
      const originalKey = config.fleetgraphApiKey;
      (config as Record<string, unknown>).fleetgraphApiKey = "test-secret";
      try {
        const res = await request(app).post("/api/chat").send({ target: "prod" });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/Invalid/i);
      } finally {
        (config as Record<string, unknown>).fleetgraphApiKey = originalKey;
      }
    });

    it("returns 401 with wrong API key", async () => {
      const originalKey = config.fleetgraphApiKey;
      (config as Record<string, unknown>).fleetgraphApiKey = "test-secret";
      try {
        const res = await request(app)
          .post("/api/chat")
          .set("x-fleetgraph-key", "wrong-key")
          .send({ target: "prod" });
        expect(res.status).toBe(401);
      } finally {
        (config as Record<string, unknown>).fleetgraphApiKey = originalKey;
      }
    });

    it("passes with correct API key", async () => {
      const originalKey = config.fleetgraphApiKey;
      (config as Record<string, unknown>).fleetgraphApiKey = "test-secret";
      try {
        const res = await request(app)
          .post("/api/chat")
          .set("x-fleetgraph-key", "test-secret")
          .send({ target: "prod" });
        expect(res.status).toBe(200);
      } finally {
        (config as Record<string, unknown>).fleetgraphApiKey = originalKey;
      }
    });

    it("skips auth when FLEETGRAPH_API_KEY is unset", async () => {
      const originalKey = config.fleetgraphApiKey;
      (config as Record<string, unknown>).fleetgraphApiKey = undefined;
      try {
        const res = await request(app).post("/api/chat").send({ target: "prod" });
        expect(res.status).toBe(200);
      } finally {
        (config as Record<string, unknown>).fleetgraphApiKey = originalKey;
      }
    });
  });

  // --- Input validation ---

  describe("input validation", () => {
    it("rejects message exceeding 2000 chars", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ target: "prod", message: "a".repeat(2001) });
      expect(res.status).toBe(400);
    });

    it("rejects entityId with special characters", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ target: "prod", context: { entityId: "'; DROP TABLE--" } });
      expect(res.status).toBe(400);
    });

    it("accepts valid entityId with dashes and underscores", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ target: "prod", context: { entityId: "abc-123_def" } });
      expect(res.status).toBe(200);
    });

    it("rejects invalid approval decision", async () => {
      const res = await request(app)
        .post("/api/approvals/some-id")
        .send({ decision: "maybe" });
      expect(res.status).toBe(400);
    });

    it("rejects invalid target enum", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ target: "staging" });
      expect(res.status).toBe(400);
    });
  });

  // --- Health & routes ---

  describe("routes", () => {
    it("GET /health returns ok", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok", service: "fleetgraph" });
    });

    it("POST /api/chat calls runFleetGraph with on_demand mode", async () => {
      await request(app).post("/api/chat").send({ target: "prod", message: "hello" });
      expect(mockedRunFleetGraph).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "on_demand", target: "prod", message: "hello" })
      );
    });

    it("POST /api/proactive/run calls runFleetGraph with proactive mode", async () => {
      await request(app).post("/api/proactive/run").send({ target: "prod" });
      expect(mockedRunFleetGraph).toHaveBeenCalledWith({ mode: "proactive", target: "prod" });
    });

    it("returns 404 for unknown approval id", async () => {
      const res = await request(app)
        .post("/api/approvals/nonexistent")
        .send({ decision: "approved" });
      expect(res.status).toBe(404);
    });

    it("approves an existing approval", async () => {
      const approval = createApproval("prod", []);
      const res = await request(app)
        .post(`/api/approvals/${approval.id}`)
        .send({ decision: "approved" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("approved");
    });

    it("lists approvals filtered by status", async () => {
      createApproval("prod", []);
      const res = await request(app).get("/api/approvals?status=pending");
      expect(res.status).toBe(200);
      expect(res.body.approvals).toHaveLength(1);
    });
  });

  // --- Error handling ---

  describe("error handling", () => {
    it("returns 500 when runFleetGraph throws", async () => {
      mockedRunFleetGraph.mockRejectedValue(new Error("LLM down"));
      const res = await request(app).post("/api/chat").send({ target: "prod" });
      expect(res.status).toBe(500);
      expect(res.body.error).toBeTruthy();
    });

    it("shows error details in non-production", () => {
      const msg = publicErrorMessage(new Error("specific failure"));
      expect(msg).toBe("specific failure");
    });

    it("hides error details in production", () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const msg = publicErrorMessage(new Error("specific failure"));
        expect(msg).toBe("Internal server error");
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it("handles non-Error objects", () => {
      const msg = publicErrorMessage("string error");
      expect(msg).toBe("Unknown server error");
    });
  });
});
