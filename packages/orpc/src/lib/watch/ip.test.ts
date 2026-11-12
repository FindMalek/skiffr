import { expect, test } from "bun:test"
import { FetchError } from "./errors"
import { checkUrl, isPublicIp } from "./ip"

test("only public unicast addresses pass, in every spelling the stack could hand us", () => {
  const refused = [
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.9",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:93.184.216.34",
    "0:0:0:0:0:ffff:a00:1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "fd00::1",
    "fd00:ec2::254",
    "fc00::1",
    "fe80::1",
    "fe80::1%eth0",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "2001::1",
    "2002:7f00:1::1",
    "100::1",
    "3fff::1",
    "not an ip",
    "010.0.0.1",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "",
  ]
  const allowed = [
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "169.253.1.1",
    "198.17.255.255",
    "198.20.0.1",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
    "2001:4860:4860::8888",
  ]
  expect(refused.filter(isPublicIp)).toEqual([])
  expect(allowed.filter((ip) => !isPublicIp(ip))).toEqual([])
})

test("a url is refused for its scheme, credentials, port or host before any dns", () => {
  const refused = [
    "ftp://example.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "gopher://example.com/",
    "http://user:pw@example.com/",
    "http://user@example.com/",
    "https://example.com:8443/",
    "http://example.com:22/",
    "http://example.com:8080/",
    "http://localhost/",
    "http://localhost./",
    "http://LOCALHOST/",
    "http://api.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/",
    "http://intranet/",
    "http://nas.home.arpa/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://127.0.0.1.:80/",
    "http://0/",
    "http://0.0.0.0/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0x7f.0x0.0x0.0x1/",
    "http://0177.0.0.1/",
    "http://017700000001/",
    "http://169.254.169.254/latest/meta-data/",
    "http://2852039166/",
    "http://0xa9fea9fe/",
    "http://10.1.2.3/",
    "http://100.64.0.1/",
    "http://192.168.0.1/",
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[0:0:0:0:0:ffff:a9fe:a9fe]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://[fd00:ec2::254]/",
    "http://[64:ff9b::a00:1]/",
    `http://example.com/${"a".repeat(2_100)}`,
    "not a url",
    "",
  ]
  expect(
    refused.filter((url) => {
      try {
        checkUrl(url)
        return true
      } catch (error) {
        expect(error).toBeInstanceOf(FetchError)
        expect((error as FetchError).kind).toBe("blocked")
        return false
      }
    }),
  ).toEqual([])
  for (const ok of [
    "http://example.com/",
    "https://example.com/careers?team=eng",
    "https://example.com:443/jobs",
    "http://example.com:80/",
    "https://93.184.216.34/",
    "https://[2606:4700:4700::1111]/",
    "https://boards.greenhouse.io/acme",
  ]) {
    expect(() => checkUrl(ok)).not.toThrow()
  }
})
