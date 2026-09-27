/** A non-zero bytes32 ciphertext handle returned by a contract read. */
export function asHandle(value: unknown): `0x${string}` | undefined {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) return undefined;
  if (/^0x0+$/i.test(value)) return undefined;
  return value as `0x${string}`;
}
