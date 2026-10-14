#!/usr/bin/env node
// video-studio MCP server entry (stdio). Runs the TypeScript sources through tsx.
import { register } from "tsx/esm/api";
register();
await import("../src/server.ts");
