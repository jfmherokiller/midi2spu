import {defineConfig} from "vite";

export default defineConfig({
    base: "/midi2spu/",
    build: {
        // lightningcss (Vite's default CSS minifier) chokes on a selector pattern in xp.css's
        // bundled output, and this Vite build has no esbuild fallback available. xp.css's own
        // dist output is already minified, so turning this off costs little.
        cssMinify: false,
    },
});
