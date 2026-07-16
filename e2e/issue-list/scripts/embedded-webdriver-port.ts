import { once } from "node:events";
import { createServer } from "node:net";
import { promisify } from "node:util";

export const EMBEDDED_WEBDRIVER_PORT = 46_245;

type PortProbeResult =
  | { status: "listening" }
  | { error: unknown; status: "error" };

const waitForListening = async (
  server: ReturnType<typeof createServer>,
  signal: AbortSignal
): Promise<PortProbeResult> => {
  await once(server, "listening", { signal });
  return { status: "listening" };
};

const waitForServerError = async (
  server: ReturnType<typeof createServer>,
  signal: AbortSignal
): Promise<PortProbeResult> => {
  const [error] = await once(server, "error", { signal });
  return { error, status: "error" };
};

export const assertEmbeddedWebDriverPortAvailable = async (
  port: number = EMBEDDED_WEBDRIVER_PORT
): Promise<void> => {
  const server = createServer();
  const closeServer = promisify(server.close.bind(server));
  const eventController = new AbortController();

  server.listen(port, "127.0.0.1");

  const result = await Promise.race([
    waitForListening(server, eventController.signal),
    waitForServerError(server, eventController.signal),
  ]);

  eventController.abort();

  if (result.status === "error") {
    const errnoError = result.error as NodeJS.ErrnoException;
    if (errnoError.code === "EADDRINUSE") {
      throw new Error(
        `Beadsmith e2e embedded WebDriver port ${port} is already in use. ` +
          "Stop the process using it before running `pnpm test:e2e:issue-list`.",
        { cause: result.error }
      );
    }

    throw result.error;
  }

  await closeServer();
};
