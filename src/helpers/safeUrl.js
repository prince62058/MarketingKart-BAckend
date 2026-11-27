// Fetching a URL a customer typed must not reach our own network (cloud metadata, Redis, admin
// ports on localhost). publicFetchOptions() makes axios resolve the host itself and refuse any
// private, loopback or link-local address, and turns off redirects so a public URL cannot bounce
// the request somewhere internal.
const dns = require("dns");
const net = require("net");

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
}

function publicLookup(hostname, options, callback) {
  if (typeof options === "function") { callback = options; options = {}; }
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIPv6(addresses) ? 6 : 4 }];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) return callback(Object.assign(new Error("That address is not allowed"), { code: "EPRIVATE" }));
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

/** Throws a 400 for anything but a plain https URL to a host name or public IP. */
function assertPublicUrl(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch (_) { url = null; }
  if (!url || url.protocol !== "https:" || url.username || url.password) {
    throw Object.assign(new Error("Use a public https:// link."), { status: 400 });
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || (net.isIP(host) && isPrivateAddress(host))) {
    throw Object.assign(new Error("Use a public https:// link."), { status: 400 });
  }
  return url.toString();
}

const publicFetchOptions = () => ({ lookup: publicLookup, maxRedirects: 0 });

module.exports = { assertPublicUrl, publicFetchOptions, isPrivateAddress, publicLookup };
