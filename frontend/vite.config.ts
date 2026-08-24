import fs from "fs";
import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

/** A linked `@r4pm/components` must not be pre-bundled: vite caches the copy from when the dev
 *  server started, so every rebuild of the local checkout stays invisible until a restart. */
const componentsIsLinked = (() => {
  try {
    const real = fs.realpathSync(path.resolve(__dirname, "node_modules/@r4pm/components"));
    return !real.includes(`${path.sep}.pnpm${path.sep}`);
  } catch {
    return false;
  }
})();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: componentsIsLinked ? ["@r4pm/components"] : [] },
  server: {
    watch: {
      ignored: ["**/*.bck"],
    },
    // Allow importing source files from the sibling propel checkout, for when @r4pm/components is
    // temporarily link:ed to it instead of installed from npm.
    fs: { allow: [path.resolve(__dirname, "."), path.resolve(__dirname, "../../propel")] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // React + xyflow hold React context singletons; a second copy breaks hooks/provider lookup.
    dedupe: ["react", "react-dom", "@xyflow/react"],
  },
});
