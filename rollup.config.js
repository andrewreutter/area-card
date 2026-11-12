import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/area-card.ts",
  output: {
    file: "dist/area-card.js",
    format: "es",
  },
  plugins: [
    typescript({
      tsconfig: "./tsconfig.json",
      compilerOptions: {
        declaration: false,
        declarationMap: false,
        sourceMap: false,
      },
    }),
  ],
};
