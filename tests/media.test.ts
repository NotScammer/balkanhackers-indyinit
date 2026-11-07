import assert from "node:assert/strict";
import { test } from "node:test";
import { acquireMicrophone } from "../src/lib/client/media";
test("permission denial remains a recoverable failure", async () => {
  await assert.rejects(
    () =>
      acquireMicrophone(
        async () => {
          throw new DOMException("Declined", "NotAllowedError");
        },
        () => true,
      ),
    { name: "NotAllowedError" },
  );
});
test("unanswered microphone request times out and stops a late stream", async () => {
  let stopped = 0;
  let resolve!: (s: MediaStream) => void;
  const stream = {
    getTracks: () => [{ stop: () => stopped++ }],
  } as unknown as MediaStream;
  const source = new Promise<MediaStream>((r) => {
    resolve = r;
  });
  await assert.rejects(
    () =>
      acquireMicrophone(
        () => source,
        () => true,
        5,
      ),
    /still waiting/,
  );
  resolve(stream);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stopped, 1);
});
test("cancelled microphone requests stop late streams", async () => {
  let stopped = 0;
  const stream = {
    getTracks: () => [{ stop: () => stopped++ }],
  } as unknown as MediaStream;
  await assert.rejects(
    () =>
      acquireMicrophone(
        async () => stream,
        () => false,
        20,
      ),
    /cancelled/,
  );
  assert.equal(stopped, 1);
});
