import { createContext, useContext } from "react";
import type { CSSProperties } from "react";
import { defaultEnvironments } from "./environmentModel";
import type { Environment } from "./environmentModel";

export {
  createEnvironmentId,
  defaultEnvironments,
  deriveEnvironmentBadge,
  environmentColors,
  maxEnvironmentBadgeLength,
  normalizeEnvironments,
} from "./environmentModel";
export type { Environment, EnvironmentColor } from "./environmentModel";

/** Components read the environment list from EnvironmentsContext instead of having it passed down every level. */
export const EnvironmentsContext = createContext<Environment[]>(defaultEnvironments);

export function useEnvironments() {
  return useContext(EnvironmentsContext);
}

/** The environment a host points at, or null when unset or deleted. */
export function useEnvironment(environmentId: string | undefined) {
  const environments = useEnvironments();
  return environmentId ? environments.find((environment) => environment.id === environmentId) ?? null : null;
}

/** Inline style that feeds an environment's color token to .sh-env / .sh-env-* rules. */
export function environmentStyle(environment: Pick<Environment, "color">): CSSProperties {
  return { "--env": `var(--ui-env-${environment.color})` } as CSSProperties;
}

type EnvironmentBadgeProps = {
  environmentId: string | undefined;
  className?: string;
};

export function EnvironmentBadge({ environmentId, className }: EnvironmentBadgeProps) {
  const environment = useEnvironment(environmentId);

  if (!environment) {
    return null;
  }

  return (
    <span className={`sh-env${className ? ` ${className}` : ""}`} style={environmentStyle(environment)} title={environment.name}>
      {environment.badge}
    </span>
  );
}
