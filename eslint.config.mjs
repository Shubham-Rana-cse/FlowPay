import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // added to eascape being caught by 'npm run lint' command
    "cat > .eslintignore << 'EOF'",
    "node_modules",
    ".next",
    "dist",
    "build",
    "src/generated",
    "EOF",
  ]),
]);

export default eslintConfig;
