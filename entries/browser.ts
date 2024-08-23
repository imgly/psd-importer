/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { PSDParser as P } from "../src/lib/psd-parser/index";
import { Logger as L } from "../src/lib/psd-parser/logger";
import { createWebEncodeBufferToPNG as C } from "../src/lib/psd-parser/image-encoder-browser";
import { addGoogleFontsAssetLibrary as A } from "../src/lib/psd-parser/font-resolver";

export {
  P as PSDParser,
  L as Logger,
  C as createWebEncodeBufferToPNG,
  A as addGoogleFontsAssetLibrary,
};
