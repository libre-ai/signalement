import Ajv2020 from "ajv/dist/2020";
import standaloneCode from "ajv/dist/standalone";
import addFormats from "ajv-formats";
import schema from "../../vendor/contracts/contracts/schemas/signalement-local-export.v1.schema.json";

export function generatedValidator(): string {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: false,
    messages: false,
    code: { source: true, esm: true },
  });
  addFormats(ajv);
  return standaloneCode(ajv, ajv.compile(schema));
}
export async function writeValidator(destination: URL): Promise<void> {
  await Bun.write(destination, generatedValidator());
}
if (import.meta.main)
  await writeValidator(new URL("../../packages/domain/schema-validator.js", import.meta.url));
