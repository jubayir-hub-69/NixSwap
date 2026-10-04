const HTTPS = "https://";
const IPFS = "ipfs://";

/** Same rule as NixLaunchpad: blank, or a short https/ipfs link with no spaces. */
export function isLogoURI(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > 200) return false;
  if (trimmed.startsWith(HTTPS) && trimmed.length > HTTPS.length) return visibleAscii(trimmed);
  if (trimmed.startsWith(IPFS) && trimmed.length > IPFS.length) return visibleAscii(trimmed);
  return false;
}

function visibleAscii(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code >= 127) return false;
  }
  return true;
}

/** Browser image URL for an on-chain logo. Anything else stays on the letter mark. */
export function displayLogo(value: string | undefined) {
  if (!value || !isLogoURI(value)) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith(IPFS)) {
    const rest = trimmed.slice(IPFS.length).replace(/^ipfs\//, "");
    if (!/^[A-Za-z0-9]+(?:\/[A-Za-z0-9._~%-]+)*$/.test(rest)) return undefined;
    return `https://ipfs.io/ipfs/${rest}`;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
