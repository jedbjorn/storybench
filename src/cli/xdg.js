// XDG base directories with the standard defaults when variables are unset. Per the XDG spec a relative value is
// invalid and ignored. $XDG_RUNTIME_DIR has no default; the lock falls back to the state directory.
import os from "node:os";
import path from "node:path";

const absoluteOr = (value, fallback) => (typeof value === "string" && path.isAbsolute(value) ? path.resolve(value) : fallback);

export function resolveXdg({ env = process.env, home = env.HOME || os.homedir() } = {}) {
  if (!home || !path.isAbsolute(home)) throw new Error("A home directory is required to locate Storybench's configuration");
  const configHome = absoluteOr(env.XDG_CONFIG_HOME, path.join(home, ".config"));
  const dataHome = absoluteOr(env.XDG_DATA_HOME, path.join(home, ".local", "share"));
  const stateHome = absoluteOr(env.XDG_STATE_HOME, path.join(home, ".local", "state"));
  const runtimeDir = absoluteOr(env.XDG_RUNTIME_DIR, null);
  const state = path.join(stateHome, "storybench");
  return {
    home,
    bin: path.join(home, ".local", "bin"),
    executable: path.join(home, ".local", "bin", "storybench"),
    config: path.join(configHome, "storybench"),
    configFile: path.join(configHome, "storybench", "config.json"),
    share: path.join(dataHome, "storybench"),
    mirror: path.join(dataHome, "storybench", "source.git"),
    releases: path.join(dataHome, "storybench", "releases"),
    current: path.join(dataHome, "storybench", "current"),
    state,
    lockDir: runtimeDir ? path.join(runtimeDir, "storybench") : path.join(state, "run"),
    lockFallback: !runtimeDir,
  };
}
