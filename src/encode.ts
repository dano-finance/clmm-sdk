import { Data, type Exact, type TSchema } from '@lucid-evolution/lucid';

/**
 * Encodes data using the provided schema.
 *
 * @param data - The data to encode
 * @param schema - The schema to use for encoding
 * @param options - Optional encoding options
 * @returns The encoded data as a hex string
 * @throws error when the `data` doesn't match the `schema`
 */
export function encodeData<T extends TSchema>(
  data: Exact<Data.Static<T>>,
  schema?: T,
  options?: {
    canonical?: boolean;
  }
): string {
  return Data.to<Data.Static<T>>(data, schema, options);
}