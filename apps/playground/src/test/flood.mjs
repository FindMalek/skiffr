// Sends a chunked multipart body of up to 400 MB and reports how much was accepted before the server dropped it.
import { connect } from "node:net"

const port = Number(process.argv[2])
const LIMIT = 400 * 1024 * 1024
const piece = Buffer.alloc(64 * 1024, 97)
const socket = connect(port, "127.0.0.1")
let sent = 0
let closed = false
let answer = ""
socket.on("data", (chunk) => {
  answer += chunk
})
socket.on("error", () => undefined)
socket.on("close", () => {
  closed = true
})
socket.write(
  "POST /api/submissions?site=lever HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\nContent-Type: multipart/form-data; boundary=xx\r\n\r\n",
)
while (!closed && sent < LIMIT) {
  const head = socket.write(`${piece.length.toString(16)}\r\n`)
  const body = socket.write(piece)
  const tail = socket.write("\r\n")
  sent += piece.length
  if (!(head && body && tail)) await new Promise((resolve) => socket.once("drain", resolve).once("close", resolve))
}
await new Promise((resolve) => (closed ? resolve() : socket.once("close", resolve)))
console.log(JSON.stringify({ sentMb: sent / 1048576, closed, status: answer.split("\r\n")[0] }))
