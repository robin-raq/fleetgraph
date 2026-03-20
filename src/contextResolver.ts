import type { FleetRequestInput, FleetMode, ShipTarget, RouteContext } from "./types";

export interface ResolvedContext {
  mode: FleetMode;
  target: ShipTarget;
  message?: string;
  entityType?: RouteContext["entityType"];
  entityId?: string;
  pathname?: string;
  viewDescription: string;
}

/**
 * Context node: resolves who is invoking the graph, what they are looking at,
 * and produces a human-readable view description for downstream LLM prompts.
 *
 * Runs before fetch — establishes context without making any API calls.
 */
export function resolveContext(input: FleetRequestInput): ResolvedContext {
  const context = input.context;

  if (!context) {
    return {
      mode: input.mode,
      target: input.target,
      message: input.message,
      viewDescription: ""
    };
  }

  const entityType = context.entityType;
  const entityId = context.entityId;
  const pathname = context.pathname;

  let viewDescription = "";
  if (entityType && entityType !== "unknown" && entityId) {
    viewDescription = `The user is currently viewing: ${entityType} ${entityId} (path: ${pathname ?? "/"})`;
  } else if (pathname) {
    viewDescription = `The user is currently viewing: ${pathname}`;
  }

  return {
    mode: input.mode,
    target: input.target,
    message: input.message,
    entityType,
    entityId,
    pathname,
    viewDescription
  };
}
