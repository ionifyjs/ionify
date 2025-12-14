declare module "postcss-load-config" {
  import type { AcceptedPlugin, ProcessOptions } from "postcss";
  interface PostcssConfigResult {
    plugins: AcceptedPlugin[];
    options?: ProcessOptions;
  }
  export default function postcssLoadConfig(
    ctx?: Record<string, unknown>,
    path?: string
  ): Promise<PostcssConfigResult>;
}

declare module "postcss-modules" {
  import type { PluginCreator } from "postcss";
  interface PostcssModulesOptions {
    generateScopedName?: (name: string, filename: string, css: string) => string;
    getJSON?: (cssFileName: string, json: Record<string, string>) => void;
    localsConvention?: "camelCase" | "camelCaseOnly" | "dashes" | "dashesOnly" | ((original: string, generated: string) => string);
  }
  const creator: PluginCreator<PostcssModulesOptions>;
  export default creator;
}
