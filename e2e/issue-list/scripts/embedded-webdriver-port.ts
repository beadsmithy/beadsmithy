import { createServer } from "node:net";

export const EMBEDDED_WEBDRIVER_PORT = 46_245;

export const assertEmbeddedWebDriverPortAvailable = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `Beadsmith e2e embedded WebDriver port ${EMBEDDED_WEBDRIVER_PORT} is already in use. ` +
              "Stop the process using it before running `pnpm test:e2e:issue-list`."
          )
        );
        return;
      }

      reject(error);
    });

    server.once("listening", () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    server.listen(EMBEDDED_WEBDRIVER_PORT, "127.0.0.1");
  });
