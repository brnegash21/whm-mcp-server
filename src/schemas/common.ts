import { z } from "zod";
import { ResponseFormat } from "../constants.js";

export const FormatSchema = {
  response_format: z
    .nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' for human-readable, 'json' for full data"),
};
