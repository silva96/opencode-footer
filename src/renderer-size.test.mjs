import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { observeRendererSize } from "./renderer-size.mjs"

function renderer() {
  return Object.assign(new EventEmitter(), { width: 150, height: 42 })
}

test("dialog dimensions use the supplied host renderer without an OpenTUI context", () => {
  const host = renderer()
  const sizes = []
  const cleanup = observeRendererSize(host, (size) => sizes.push(size))
  assert.deepEqual(sizes, [{ width: 150, height: 42 }])
  host.emit("resize", 80, 24)
  assert.deepEqual(sizes[1], { width: 80, height: 24 })
  cleanup()
})

test("closing a dialog removes its resize subscription", () => {
  const host = renderer()
  const sizes = []
  const cleanup = observeRendererSize(host, (size) => sizes.push(size))
  assert.equal(host.listenerCount("resize"), 1)
  cleanup()
  cleanup()
  assert.equal(host.listenerCount("resize"), 0)
  host.emit("resize", 80, 24)
  assert.equal(sizes.length, 1)
})

test("closing one dialog does not remove another renderer listener", () => {
  const host = renderer()
  const first = []
  const second = []
  const closeFirst = observeRendererSize(host, (size) => first.push(size))
  const closeSecond = observeRendererSize(host, (size) => second.push(size))
  closeFirst()
  host.emit("resize", 100, 30)
  assert.equal(first.length, 1)
  assert.deepEqual(second[1], { width: 100, height: 30 })
  closeSecond()
  assert.equal(host.listenerCount("resize"), 0)
})
