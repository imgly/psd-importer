import * as esbuild from "esbuild";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

// Function to generate TypeScript definitions using the tsc command
async function generateDts(entry: string, outfile: string): Promise<void> {
  try {
    const { stdout, stderr } = await execPromise(
      `./node_modules/.bin/dts-bundle-generator -o ${outfile} ${entry}`
    );
    console.log(stdout);
    if (stderr) {
      console.error(stderr);
    }
  } catch (error) {
    console.error(`Error generating .d.ts files: ${error}`);
    throw error; // Rethrow to be caught by calling function
  }
}

// Build configuration for Node.js
async function buildNode(): Promise<void> {
  try {
    await esbuild.build({
      entryPoints: ["./entries/node.ts"],
      bundle: true,
      outfile: "./dist/node.js",
      format: "cjs",
      platform: "node",
      minify: true,
      target: ["node20"],
    });
    console.log("Node build complete");
    await generateDts("./entries/node.ts", "./dist/node.d.ts");
  } catch (error) {
    console.error("Node build failed:", error);
  }
}

// Build configuration for the browser
async function buildBrowser(): Promise<void> {
  try {
    await esbuild.build({
      entryPoints: ["./entries/browser.ts"],
      bundle: true,
      outfile: "./dist/browser.js",
      format: "esm",
      platform: "browser",
      minify: true,
      target: ["es2022"],
    });
    console.log("Browser build complete");
    await generateDts("./entries/browser.ts", "./dist/browser.d.ts");
  } catch (error) {
    console.error("Browser build failed:", error);
  }
}

// Run builds
(async () => {
  await buildNode();
  await buildBrowser();
})();
