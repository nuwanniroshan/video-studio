import { z } from "zod";
import { Spec } from "./spec.ts";

/** JSON Schema for the spec (CLI, Claude Code skill, future AI prompt). Input shape: defaults are optional. */
export const jsonSchema = () => z.toJSONSchema(Spec, { io: "input", unrepresentable: "any" });
