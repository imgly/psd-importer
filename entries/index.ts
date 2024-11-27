/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { PSDParser as P } from "../src/lib/psd-parser/index";
import { Logger as L } from "../src/lib/psd-parser/logger";
import { createWebEncodeBufferToPNG as C } from "../src/lib/psd-parser/image-encoder-browser";
import { createPNGJSEncodeBufferToPNG as D } from "../src/lib/psd-parser/image-encoder-node";
import { addGoogleFontsAssetLibrary as A } from "../src/lib/psd-parser/font-resolver";

export {
  P as PSDParser,
  L as Logger,
  A as addGoogleFontsAssetLibrary,
  C as createWebEncodeBufferToPNG,
  D as createPNGJSEncodeBufferToPNG,
};
