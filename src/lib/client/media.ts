// getUserMedia cannot be aborted. Stop streams that arrive after timeout or cancellation.
export async function acquireMicrophone(
  getStream: () => Promise<MediaStream>,
  isCurrent: () => boolean,
  timeoutMs = 15000,
): Promise<MediaStream> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const source = getStream().then((stream) => {
    if (expired || !isCurrent()) {
      stream.getTracks().forEach((t) => t.stop());
      throw Error(
        "Microphone request was cancelled. Please retry the microphone.",
      );
    }
    return stream;
  });
  try {
    return await Promise.race([
      source,
      new Promise<MediaStream>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(
            Error(
              "The microphone request is still waiting. You can retry or try another browser.",
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
