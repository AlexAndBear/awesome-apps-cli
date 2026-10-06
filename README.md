# awesome-apps-cli

Downloads the OpenCloud web apps listed in the
[awesome-apps](https://github.com/opencloud-eu/awesome-apps) `apps.json` and unpacks them into a folder,
e.g. the apps folder of an [opencloud-compose](https://github.com/opencloud-eu/opencloud-compose) setup.

## Usage

```sh
pnpm install
pnpm awesome-apps /root/opencloud-compose-apps --official --clean --owner 1000:1000
```

or without pnpm: `node bin/awesome-apps.js <dest> [options]`

| Option | Description |
| --- | --- |
| `-c, --clean` | Delete the contents of `<dest>` before unpacking |
| `-o, --opencloud-version <ver>` | Pick the newest app version compatible with this OpenCloud version (default: newest version of every app) |
| `--official` | Only install apps marked as `official` in `apps.json` |
| `-u, --owner <uid[:gid]>` | chown the unpacked apps, e.g. `1000:1000` (gid defaults to uid, needs root) |
| `-i, --include <id>` | Only install this app id (repeatable) |
| `-e, --exclude <id>` | Skip this app id (repeatable, default: `com.github.opencloud-eu.web-app-skeleton`) |
| `-s, --source <url\|file>` | `apps.json` location (default: awesome-apps `main`) |
| `-h, --help` | Show the help |

Apps whose zip has no top-level folder are unpacked into `<dest>/<zip name>/`.

Some apps need additional CSP entries in OpenCloud's `csp.yaml`, see the README of each app.

Requires Node.js 18.3 or newer.
