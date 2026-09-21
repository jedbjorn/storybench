// Browser tests must use loopback ports 18800-18899. Several worktrees/lanes may run the suite on one host at the
// same time, so a fixed port collides; take the first free port in the range (preferred port first).
export async function listenInRange(server, { preferred = null, from = 18800, to = 18899 } = {}) {
  const ports = [...new Set([preferred, ...Array.from({ length: to - from + 1 }, (_, index) => from + index)].filter(Number.isInteger))];
  for (const port of ports) {
    const result = await new Promise((resolve, reject) => {
      const onError = (error) => { server.off("listening", onListening); error.code === "EADDRINUSE" ? resolve(null) : reject(error); };
      const onListening = () => { server.off("error", onError); resolve(port); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
    if (result) return result;
  }
  throw new Error(`No free loopback port in ${from}-${to}`);
}
