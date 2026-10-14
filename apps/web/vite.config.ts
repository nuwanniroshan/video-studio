import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = "http://127.0.0.1:5190";
export default defineConfig({
  plugins: [react()],
  build: { assetsDir: "ui" }, // /assets/* is the runtime's content-addressed asset store
  server: { port: 5191, proxy: Object.fromEntries(["/api", "/files", "/runtime", "/brand", "/assets"].map((p) => [p, api])) },
});
