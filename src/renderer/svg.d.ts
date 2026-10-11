// esbuild bundles .svg files as text (see scripts/build.ts).
declare module '*.svg' {
  const markup: string;
  export default markup;
}
