// A small fake Docker + kubectl. It keeps state (containers, images, pods...) and answers
// commands with realistic output. Pure data state, so it can be saved to localStorage.
(function () {
  "use strict";

  // ---------------------------------------------------------------- catalog
  const CATALOG = {
    "hello-world:latest": { size: "13.3kB", mb: 0.01, kind: "hello" },
    "nginx:latest": { size: "192MB", mb: 192, kind: "nginx" },
    "nginx:alpine": { size: "52.5MB", mb: 52.5, kind: "nginx" },
    "nginx:1.27": { size: "192MB", mb: 192, kind: "nginx" },
    "nginx:1.27-alpine": { size: "52.4MB", mb: 52.4, kind: "nginx" },
    "redis:latest": { size: "117MB", mb: 117, kind: "redis" },
    "redis:7-alpine": { size: "41.4MB", mb: 41.4, kind: "redis" },
    "mysql:8.4": { size: "797MB", mb: 797, kind: "mysql" },
    "postgres:16": { size: "435MB", mb: 435, kind: "postgres" },
    "node:22-alpine": { size: "160MB", mb: 160, kind: "node" },
    "node:22": { size: "1.12GB", mb: 1120, kind: "node" },
    "python:3.12": { size: "1.02GB", mb: 1020, kind: "shell" },
    "python:3.12-alpine": { size: "57.6MB", mb: 57.6, kind: "shell" },
    "alpine:latest": { size: "8.83MB", mb: 8.83, kind: "shell" },
    "busybox:latest": { size: "4.27MB", mb: 4.27, kind: "shell" },
    "ubuntu:latest": { size: "78.1MB", mb: 78.1, kind: "shell" },
    "ubuntu:24.04": { size: "78.1MB", mb: 78.1, kind: "shell" },
    // images used by case studies
    "shop/web:1.0": { size: "54.1MB", mb: 54.1, kind: "nginx" },
    "shop/web:2.0": { size: "54.3MB", mb: 54.3, kind: "nginx" },
    "shop/api:1.0": { size: "168MB", mb: 168, kind: "api" },
  };

  const FILES = {
    "package.json": `{
  "name": "hello",
  "version": "1.0.0",
  "scripts": { "start": "node server.js" }
}`,
    "server.js": `const http = require("http");
http.createServer((req, res) => res.end("Hello from a container!\\n"))
  .listen(3000, () => console.log("listening on 3000"));`,
    Dockerfile: `FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]`,
    "compose.yaml": `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    depends_on:
      - db

  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - dbdata:/var/lib/postgresql/data

volumes:
  dbdata:`,
  };

  // ---------------------------------------------------------------- helpers
  const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[(Math.random() * 16) | 0]).join("");
  const alnum = (n) => Array.from({ length: n }, () => "bcdfghjklmnpqrstvwxz2456789"[(Math.random() * 27) | 0]).join("");
  const now = () => Date.now();

  function ago(ts) {
    const s = Math.max(1, Math.round((now() - ts) / 1000));
    if (s < 60) return s === 1 ? "1 second" : `${s} seconds`;
    const m = Math.round(s / 60);
    if (m < 60) return m === 1 ? "About a minute" : `${m} minutes`;
    const h = Math.round(m / 60);
    if (h < 24) return h === 1 ? "About an hour" : `${h} hours`;
    const d = Math.round(h / 24);
    return d === 1 ? "1 day" : `${d} days`;
  }
  const agoLower = (ts) => {
    const a = ago(ts);
    return (a.startsWith("About") ? a.replace("About", "about") : a) + " ago";
  };
  const shortAge = (ts) => {
    const s = Math.max(1, Math.round((now() - ts) / 1000));
    if (s < 60) return s + "s";
    if (s < 3600) return Math.round(s / 60) + "m";
    return Math.round(s / 3600) + "h";
  };

  function table(rows, gap = 3) {
    const widths = [];
    rows.forEach((r) => r.forEach((c, i) => (widths[i] = Math.max(widths[i] || 0, String(c).length))));
    return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? String(c) : String(c).padEnd(widths[i] + gap))).join("")).join("\n");
  }

  function normRef(s) {
    let r = s.replace(/^docker\.io\//, "").replace(/^library\//, "");
    const slash = r.lastIndexOf("/");
    if (r.indexOf(":", slash) === -1) r += ":latest";
    return r;
  }
  const repoOf = (ref) => ref.slice(0, ref.lastIndexOf(":"));
  const tagOf = (ref) => ref.slice(ref.lastIndexOf(":") + 1);
  const baseName = (ref) => repoOf(ref).split("/").pop();

  // Shell-like tokenizer: handles quotes.
  function tokenize(line) {
    const out = [];
    let cur = "", q = null, has = false;
    for (const ch of line) {
      if (q) {
        if (ch === q) q = null;
        else cur += ch;
      } else if (ch === '"' || ch === "'") { q = ch; has = true; }
      else if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ""; has = false; }
      else cur += ch;
    }
    if (cur || has) out.push(cur);
    return out;
  }

  // Generic flag parser. spec: { flagName: "bool" | "value" }, aliases map short→long.
  function parseFlags(args, spec, aliases = {}) {
    const flags = {}, pos = [];
    for (let i = 0; i < args.length; i++) {
      let a = args[i];
      if (a === "--") { pos.push(...args.slice(i + 1)); break; }
      if (a.startsWith("--")) {
        let [k, v] = a.slice(2).split(/=(.*)/s);
        k = aliases[k] || k;
        if (spec[k] === "value") {
          if (v === undefined) v = args[++i];
          (flags[k] = flags[k] || []).push(v);
        } else if (spec[k] === "bool") flags[k] = true;
        else return { error: `unknown flag: --${k}` };
      } else if (a.startsWith("-") && a.length > 1) {
        const letters = a.slice(1);
        for (let j = 0; j < letters.length; j++) {
          const k = aliases[letters[j]] || letters[j];
          if (spec[k] === "value") {
            let v = letters.slice(j + 1) || args[++i];
            if (v && v.startsWith("=")) v = v.slice(1);
            (flags[k] = flags[k] || []).push(v);
            break;
          } else if (spec[k] === "bool") flags[k] = true;
          else return { error: `unknown shorthand flag: '${letters[j]}' in ${a}` };
        }
      } else {
        pos.push(a);
        if (spec.__stopAtFirst) { pos.push(...args.slice(i + 1)); break; }
      }
    }
    return { flags, pos };
  }
  const last = (arr) => (arr ? arr[arr.length - 1] : undefined);

  // ---------------------------------------------------------------- state
  function newEngine(installed) {
    return {
      installed,
      images: {},
      containers: [],
      volumes: {},
      networks: { bridge: { id: hex(12), driver: "bridge", builtin: true }, host: { id: hex(12), driver: "host", builtin: true }, none: { id: hex(12), driver: "null", builtin: true } },
    };
  }
  function createState() {
    const S = {
      host: "local",
      hosts: { local: newEngine(true), vps: newEngine(false) },
      files: Object.assign({}, FILES),
      loggedIn: false,
      registry: {},
      pending: null,
      k8s: null,
      history: [],
    };
    linux(S);
    return S;
  }

  const engine = (S) => S.hosts[S.host];
  const findContainer = (E, key) =>
    E.containers.find((c) => c.name === key) || (key && key.length >= 3 ? E.containers.find((c) => c.id.startsWith(key)) : undefined);

  function imageMeta(S, ref) {
    if (CATALOG[ref]) return Object.assign({}, CATALOG[ref]);
    if (S.registry[ref]) return Object.assign({}, S.registry[ref]);
    return null;
  }

  // ---------------------------------------------------------------- output
  function Out() {
    const lines = [];
    const api = {
      lines,
      ok: true,
      say(text, cls) { String(text).split("\n").forEach((t) => lines.push({ t, c: cls || "" })); return api; },
      err(text) { api.ok = false; return api.say(text, "err"); },
      dim(text) { return api.say(text, "dim"); },
      good(text) { return api.say(text, "good"); },
      note(text) { return api.say(text, "note"); },
    };
    return api;
  }

  // ---------------------------------------------------------------- docker: images
  function pullImage(S, E, ref, o, quiet) {
    if (E.images[ref]) {
      if (!quiet) o.say(`${tagOf(ref)}: Pulling from ${repoOf(ref).includes("/") ? repoOf(ref) : "library/" + repoOf(ref)}\nDigest: sha256:${hex(64)}\nStatus: Image is up to date for ${ref}\ndocker.io/${repoOf(ref).includes("/") ? "" : "library/"}${ref}`);
      return true;
    }
    const meta = imageMeta(S, ref);
    if (!meta) {
      const repo = repoOf(ref);
      o.err(`Error response from daemon: pull access denied for ${repo}, repository does not exist or may require 'docker login'`);
      return false;
    }
    const lib = repoOf(ref).includes("/") ? repoOf(ref) : "library/" + repoOf(ref);
    const layers = meta.mb < 1 ? 1 : meta.mb < 60 ? 3 : 6;
    o.say(`${tagOf(ref)}: Pulling from ${lib}`);
    for (let i = 0; i < layers; i++) o.dim(`${hex(12)}: Pull complete`);
    o.say(`Digest: sha256:${hex(64)}\nStatus: Downloaded newer image for ${ref}`);
    E.images[ref] = { id: hex(12), created: now() - 1000 * 60 * 60 * 24 * (3 + ((Math.random() * 20) | 0)), size: meta.size, mb: meta.mb, kind: meta.kind };
    return true;
  }

  function dockerImages(S, E, args, o) {
    const refs = Object.keys(E.images);
    if (!refs.length) return o.say(table([["REPOSITORY", "TAG", "IMAGE ID", "CREATED", "SIZE"]]));
    o.say(table([["REPOSITORY", "TAG", "IMAGE ID", "CREATED", "SIZE"], ...refs.map((r) => [repoOf(r), tagOf(r), E.images[r].id, agoLower(E.images[r].created), E.images[r].size])]));
  }

  function dockerRmi(S, E, args, o) {
    const { flags, pos, error } = parseFlags(args, { force: "bool" }, { f: "force" });
    if (error) return o.err(error);
    if (!pos.length) return o.err(`"docker rmi" requires at least 1 argument.\nUsage:  docker rmi [OPTIONS] IMAGE [IMAGE...]`);
    for (const p of pos) {
      const ref = normRef(p);
      const img = E.images[ref] || Object.entries(E.images).find(([, v]) => v.id.startsWith(p))?.[1];
      const realRef = E.images[ref] ? ref : Object.keys(E.images).find((k) => E.images[k] === img);
      if (!img) { o.err(`Error response from daemon: No such image: ${p}`); continue; }
      const user = E.containers.find((c) => c.image === realRef);
      if (user && !flags.force) {
        o.err(`Error response from daemon: conflict: unable to remove repository reference "${p}" (must force) - container ${user.id} is using its referenced image ${img.id}`);
        continue;
      }
      delete E.images[realRef];
      o.say(`Untagged: ${realRef}\nDeleted: sha256:${img.id}${hex(52)}`);
    }
  }

  function dockerBuild(S, E, args, o) {
    const { flags, pos, error } = parseFlags(args, { tag: "value", file: "value", "no-cache": "bool" }, { t: "tag", f: "file" });
    if (error) return o.err(error);
    if (!pos.length) return o.err(`ERROR: "docker buildx build" requires exactly 1 argument.\nUsage:  docker buildx build [OPTIONS] PATH | URL | -\n\nHint: the build context is usually "." (this folder).`);
    if (S.host !== "local" || !S.files.Dockerfile) return o.err(`ERROR: failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory`);
    const df = S.files.Dockerfile.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    const from = normRef(df[0].split(/\s+/)[1]);
    const tag = flags.tag ? normRef(last(flags.tag)) : null;
    o.dim(`[+] Building ${(2 + Math.random() * 6).toFixed(1)}s (${df.length + 3}/${df.length + 3}) FINISHED`);
    o.dim(` => [internal] load build definition from Dockerfile`);
    o.dim(` => [internal] load metadata for docker.io/library/${from}`);
    o.dim(` => [internal] load .dockerignore`);
    if (!E.images[from]) { const meta = imageMeta(S, from); E.images[from] = { id: hex(12), created: now() - 864e5 * 9, size: meta.size, mb: meta.mb, kind: meta.kind }; }
    df.forEach((l, i) => o.dim(` => [${i + 1}/${df.length}] ${l}`));
    o.dim(` => exporting to image`);
    const id = hex(12);
    o.dim(` => => writing image sha256:${id}${hex(52)}`);
    if (tag) {
      o.dim(` => => naming to docker.io/library/${tag}`);
      E.images[tag] = { id, created: now(), size: "164MB", mb: 164, kind: "app" };
    } else {
      E.images["<none>:<none>#" + id] = { id, created: now(), size: "164MB", mb: 164, kind: "app" };
      o.note(`(no -t given, so your image has no name. Add -t name:tag next time.)`);
    }
  }

  function dockerTag(S, E, args, o) {
    if (args.length !== 2) return o.err(`"docker tag" requires exactly 2 arguments.\nUsage:  docker tag SOURCE_IMAGE[:TAG] TARGET_IMAGE[:TAG]`);
    const src = normRef(args[0]), dst = normRef(args[1]);
    if (!E.images[src]) return o.err(`Error response from daemon: No such image: ${args[0]}`);
    E.images[dst] = Object.assign({}, E.images[src], { created: E.images[src].created });
  }

  function dockerPush(S, E, args, o) {
    if (!args[0]) return o.err(`"docker push" requires exactly 1 argument.\nUsage:  docker push [OPTIONS] NAME[:TAG]`);
    const ref = normRef(args[0]);
    if (!E.images[ref]) return o.err(`An image does not exist locally with the tag: ${repoOf(ref)}`);
    if (!repoOf(ref).includes("/")) return o.say(`The push refers to repository [docker.io/library/${repoOf(ref)}]`).err(`denied: requested access to the resource is denied\n(hint: tag it with your username first, e.g. yourname/${repoOf(ref)}:${tagOf(ref)})`);
    if (!S.loggedIn) return o.say(`The push refers to repository [docker.io/${repoOf(ref)}]`).err(`push access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed\n(hint: run docker login first)`);
    o.say(`The push refers to repository [docker.io/${repoOf(ref)}]`);
    for (let i = 0; i < 4; i++) o.dim(`${hex(12)}: Pushed`);
    o.say(`${tagOf(ref)}: digest: sha256:${hex(64)} size: 1782`);
    S.registry[ref] = { size: E.images[ref].size, mb: E.images[ref].mb, kind: E.images[ref].kind };
  }

  // ---------------------------------------------------------------- docker: containers
  const longRunning = (kind) => ["nginx", "redis", "mysql", "postgres", "app", "node", "api"].includes(kind);
  const LISTEN = { nginx: 80, app: 3000, api: 3000, redis: 6379, mysql: 3306, postgres: 5432 };
  const netsOf = (c) => [c.network, ...(c.extraNets || [])];
  const sharesNet = (a, b) => netsOf(a).some((n) => n !== "bridge" && n !== "host" && n !== "none" && netsOf(b).includes(n));
  const envOf = (c, k) => { const e = (c.env || []).find((x) => x.startsWith(k + "=")); return e ? e.slice(k.length + 1) : null; };

  // Start a long-running container. Some images refuse to start without the right
  // settings, like the real ones do; then the container exits with code 1 and its logs say why.
  function boot(E, c) {
    c.crash = null;
    if (c.kind === "mysql" && !envOf(c, "MYSQL_ROOT_PASSWORD") && !envOf(c, "MYSQL_ALLOW_EMPTY_PASSWORD") && !envOf(c, "MYSQL_RANDOM_ROOT_PASSWORD"))
      c.crash = `2026-10-28 10:00:00+00:00 [Note] [Entrypoint]: Entrypoint script for MySQL Server 8.4.3-1.el9 started.\n2026-10-28 10:00:00+00:00 [ERROR] [Entrypoint]: Database is uninitialized and password option is not specified\n    You need to specify one of the following as an environment variable:\n    - MYSQL_ROOT_PASSWORD\n    - MYSQL_ALLOW_EMPTY_PASSWORD\n    - MYSQL_RANDOM_ROOT_PASSWORD`;
    if (c.kind === "postgres" && !envOf(c, "POSTGRES_PASSWORD") && envOf(c, "POSTGRES_HOST_AUTH_METHOD") !== "trust")
      c.crash = `Error: Database is uninitialized and superuser password is not specified.\n       You must specify POSTGRES_PASSWORD to a non-empty value for the\n       superuser. For example, "-e POSTGRES_PASSWORD=password" on "docker run".`;
    if (c.kind === "api") {
      const host = envOf(c, "DB_HOST");
      const head = `> shop-api@1.0.0 start\n> node index.js\n\n`;
      if (!host) c.crash = head + `Error: DB_HOST is not set`;
      else if (host === "localhost" || host === "127.0.0.1")
        c.crash = head + `Error: connect ECONNREFUSED 127.0.0.1:5432\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1607:16) {\n  errno: -111,\n  code: 'ECONNREFUSED',\n  address: '127.0.0.1',\n  port: 5432\n}`;
      else if (!E.containers.some((x) => x.name === host && x.status === "running" && x.kind === "postgres" && sharesNet(c, x)))
        c.crash = head + `Error: getaddrinfo ENOTFOUND ${host}\n    at GetAddrInfoReqWrap.onlookup [as oncomplete] (node:dns:109:26) {\n  code: 'ENOTFOUND',\n  hostname: '${host}'\n}`;
    }
    if (c.crash) { c.status = "exited"; c.exitCode = 1; c.finished = now(); return false; }
    c.status = "running"; c.exitCode = 0; c.started = now();
    return true;
  }

  function startupLogs(c) {
    if (c.crash) return c.crash;
    switch (c.kind) {
      case "api": return `> shop-api@1.0.0 start\n> node index.js\n\nConnected to postgres at ${envOf(c, "DB_HOST")}:5432\nAPI listening on port 3000`;
      case "nginx": return `/docker-entrypoint.sh: Configuration complete; ready for start up\n2026/10/28 10:00:00 [notice] 1#1: nginx/1.27.2\n2026/10/28 10:00:00 [notice] 1#1: start worker processes`;
      case "redis": return `1:C 28 Oct 2026 10:00:00.000 * oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo\n1:M 28 Oct 2026 10:00:00.001 * Ready to accept connections tcp`;
      case "mysql": return `[System] [MY-010116] [Server] /usr/sbin/mysqld (mysqld 8.4.3) starting as process 1\n[System] [MY-010931] [Server] /usr/sbin/mysqld: ready for connections. Version: '8.4.3'  port: 3306`;
      case "postgres": return `PostgreSQL init process complete; ready for start up.\nLOG:  database system is ready to accept connections`;
      case "app": return `> hello@1.0.0 start\n> node server.js\n\nlistening on 3000`;
      default: return "";
    }
  }
  function accessLogs(c) {
    if (c.kind !== "nginx") return "";
    return `172.17.0.1 - - [28/Oct/2026:10:01:12 +0000] "GET / HTTP/1.1" 200 615 "-" "Mozilla/5.0"\n172.17.0.1 - - [28/Oct/2026:10:01:12 +0000] "GET /favicon.ico HTTP/1.1" 404 153 "-" "Mozilla/5.0"`;
  }
  const HELLO = `
Hello from Docker!
This message shows that your installation appears to be working correctly.

To generate this message, Docker took the following steps:
 1. The Docker client contacted the Docker daemon.
 2. The Docker daemon pulled the "hello-world" image from the Docker Hub.
 3. The Docker daemon created a new container from that image which runs the
    executable that produces the output you are currently reading.
 4. The Docker daemon streamed that output to the Docker client, which sent it
    to your terminal.`;

  const RUN_SPEC = {
    detach: "bool", interactive: "bool", tty: "bool", rm: "bool", name: "value", publish: "value", env: "value",
    volume: "value", network: "value", workdir: "value", restart: "value", __stopAtFirst: true,
  };
  const RUN_ALIASES = { d: "detach", i: "interactive", t: "tty", p: "publish", e: "env", v: "volume", w: "workdir", net: "network" };

  function createContainer(S, E, opts, o) {
    const { image, name, ports = [], env = [], mounts = [], network = "bridge", cmd = [], restart = "no", compose } = opts;
    if (name && E.containers.some((c) => c.name === name)) {
      const other = E.containers.find((c) => c.name === name);
      o.err(`docker: Error response from daemon: Conflict. The container name "/${name}" is already in use by container "${other.id}${hex(52)}". You have to remove (or rename) that container to be able to reuse that name.`);
      return null;
    }
    if (!E.networks[network]) { o.err(`docker: Error response from daemon: network ${network} not found.`); return null; }
    for (const p of ports) {
      const clash = E.containers.find((c) => c.status === "running" && c.ports.some((q) => q.host === p.host));
      if (clash) {
        o.err(`docker: Error response from daemon: driver failed programming external connectivity on endpoint ${name || "container"}: Bind for 0.0.0.0:${p.host} failed: port is already allocated.`);
        return null;
      }
    }
    for (const m of mounts) if (m.type === "volume" && !E.volumes[m.source]) E.volumes[m.source] = { created: now(), project: compose && compose.project };
    const img = E.images[image];
    const c = {
      id: hex(12), name: name || randomName(), image, kind: img.kind, status: "created", exitCode: 0,
      created: now(), started: now(), ports, env, mounts, network, cmd, restart, compose: compose || null,
    };
    E.containers.push(c);
    return c;
  }

  const ADJ = ["brave", "eager", "jolly", "quirky", "sleepy", "zealous", "gifted", "nostalgic", "festive", "vibrant"];
  const NOUN = ["turing", "hopper", "lovelace", "torvalds", "curie", "babbage", "ritchie", "shannon", "noether", "knuth"];
  const randomName = () => ADJ[(Math.random() * ADJ.length) | 0] + "_" + NOUN[(Math.random() * NOUN.length) | 0];

  function parsePorts(list, o) {
    const ports = [];
    for (const p of list || []) {
      const parts = p.split(":");
      const container = parseInt(parts[parts.length - 1], 10);
      const host = parts.length > 1 ? parseInt(parts[parts.length - 2], 10) : null;
      if (!container || (parts.length > 1 && !host)) { o.err(`docker: invalid publish opts format (should be name=value but no = sign found): ${p}\nHint: use -p HOST_PORT:CONTAINER_PORT, e.g. -p 8080:80`); return null; }
      ports.push({ host: host || 32768 + ((Math.random() * 1000) | 0), container });
    }
    return ports;
  }
  function parseMounts(list) {
    return (list || []).map((v) => {
      const [source, target] = v.split(":");
      const bind = source.startsWith("/") || source.startsWith(".") || source.startsWith("$") || source.startsWith("~");
      return { type: bind ? "bind" : "volume", source, target };
    });
  }

  function dockerRun(S, E, args, o) {
    const { flags, pos, error } = parseFlags(args, RUN_SPEC, RUN_ALIASES);
    if (error) return o.err(`${error}\nSee 'docker run --help'.`);
    if (!pos.length) return o.err(`docker: 'docker run' requires at least 1 argument.\n\nUsage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]\n\nSee 'docker run --help'.`);
    const [imgArg, ...cmd] = pos;
    const ref = normRef(imgArg);
    if (!E.images[ref]) {
      o.say(`Unable to find image '${ref}' locally`);
      if (!pullImage(S, E, ref, o, true)) return;
    }
    const ports = parsePorts(flags.publish, o);
    if (!ports) return;
    const name = last(flags.name);
    const c = createContainer(S, E, {
      image: ref, name, ports, env: flags.env || [], mounts: parseMounts(flags.volume), network: last(flags.network) || "bridge",
      cmd, restart: last(flags.restart) || "no",
    }, o);
    if (!c) return;

    // One-off commands
    const kind = E.images[ref].kind;
    if (kind === "hello") {
      o.say(HELLO);
      return finishOneOff(E, c, flags, 0);
    }
    if (kind === "redis" && cmd[0] === "redis-cli") {
      const hIdx = cmd.indexOf("-h");
      const target = hIdx > -1 ? cmd[hIdx + 1] : "127.0.0.1";
      const peer = E.containers.find((x) => x.name === target && x.status === "running" && x.kind === "redis" && sharesNet(c, x));
      if (cmd.includes("ping") && peer) o.good("PONG");
      else if (target === "127.0.0.1" || target === "localhost") o.err(`Could not connect to Redis at 127.0.0.1:6379: Connection refused\n(inside a container, localhost means the container itself)`);
      else o.err(`Could not connect to Redis at ${target}:6379: Name or service not known` + (c.network === "bridge" ? `\n(hint: containers find each other by name only on a user-made network: --network ...)` : ""));
      return finishOneOff(E, c, flags, peer ? 0 : 1);
    }
    if (!longRunning(kind) || cmd.length) {
      if (cmd[0] === "ls") o.say("bin   dev   etc   home  lib   media mnt   opt   proc  root  run   sbin  srv   sys   tmp   usr   var");
      else if (cmd[0] === "echo") o.say(cmd.slice(1).join(" "));
      else if (cmd[0] === "cat" && cmd[1] === "/etc/os-release") o.say(`NAME="Alpine Linux"\nVERSION_ID=3.20.3`);
      else if (flags.interactive && flags.tty && ["sh", "bash", undefined].includes(cmd[0]) && !longRunning(kind)) o.note(`(you'd now be inside a shell in the container. The simulator skips this. Type 'exit' in real Docker to leave.)`);
      else if (!cmd.length) o.dim(""); // e.g. alpine with no command: exits silently
      else if (longRunning(kind)) o.note(`(command ran inside the container)`);
      return finishOneOff(E, c, flags, 0);
    }

    // Long-running service
    const up = boot(E, c);
    if (flags.detach) {
      o.say(c.id + hex(52));
      if (!up && flags.rm) E.containers = E.containers.filter((x) => x !== c);
    } else if (!up) {
      o.say(c.crash);
      if (flags.rm) E.containers = E.containers.filter((x) => x !== c);
    } else {
      o.say(startupLogs(c));
      o.note(`\n(you'd be stuck here watching logs. Pressing Ctrl+C stops the container.\n Use -d to run it in the background instead.)`);
      c.status = "exited";
      c.exitCode = 0;
      c.finished = now();
      if (flags.rm) E.containers = E.containers.filter((x) => x !== c);
    }
  }
  function finishOneOff(E, c, flags, code) {
    c.status = "exited";
    c.exitCode = code;
    c.finished = now();
    if (flags.rm) E.containers.splice(E.containers.indexOf(c), 1);
  }

  function statusText(c) {
    if (c.status === "running") return "Up " + ago(c.started);
    if (c.status === "created") return "Created";
    return `Exited (${c.exitCode}) ${agoLower(c.finished || c.created)}`;
  }
  function portText(c) {
    if (c.status !== "running") return "";
    return c.ports.map((p) => `0.0.0.0:${p.host}->${p.container}/tcp`).join(", ") ||
      ({ redis: "6379/tcp", mysql: "3306/tcp, 33060/tcp", postgres: "5432/tcp", nginx: "80/tcp", app: "3000/tcp" }[c.kind] || "");
  }
  function cmdText(c) {
    const m = { nginx: '"/docker-entrypoint.…"', redis: '"docker-entrypoint.s…"', mysql: '"docker-entrypoint.s…"', postgres: '"docker-entrypoint.s…"', hello: '"/hello"', app: '"docker-entrypoint.s…"', shell: '"/bin/sh"' };
    return c.cmd.length ? `"${c.cmd.join(" ").slice(0, 20)}${c.cmd.join(" ").length > 20 ? "…" : ""}"` : m[c.kind] || '"/bin/sh"';
  }

  function dockerPs(S, E, args, o) {
    const { flags, error } = parseFlags(args, { all: "bool", quiet: "bool", format: "value" }, { a: "all", q: "quiet" });
    if (error) return o.err(error);
    const list = E.containers.filter((c) => flags.all || c.status === "running");
    if (flags.quiet) return list.forEach((c) => o.say(c.id));
    if (flags.format) {
      const f = last(flags.format);
      if (/\{\{\.Names\}\}/.test(f) && f.startsWith("table")) {
        return o.say(table([["NAMES", "IMAGE", "PORTS"], ...list.map((c) => [c.name, c.image.replace(/:latest$/, ""), portText(c)])]));
      }
      return list.forEach((c) => o.say(f.replace(/\{\{\.Names\}\}/g, c.name).replace(/\{\{\.Image\}\}/g, c.image).replace(/\{\{\.Status\}\}/g, statusText(c)).replace(/\{\{\.Ports\}\}/g, portText(c)).replace(/\\t/g, "\t")));
    }
    o.say(table([["CONTAINER ID", "IMAGE", "COMMAND", "CREATED", "STATUS", "PORTS", "NAMES"],
      ...list.map((c) => [c.id, c.image.replace(/:latest$/, ""), cmdText(c), agoLower(c.created), statusText(c), portText(c), c.name])]));
  }

  function needContainers(args, o, cmd) {
    if (!args.length) { o.err(`"docker ${cmd}" requires at least 1 argument.\nUsage:  docker ${cmd} [OPTIONS] CONTAINER [CONTAINER...]`); return false; }
    return true;
  }
  function dockerStop(S, E, args, o) {
    if (!needContainers(args, o, "stop")) return;
    for (const a of args.filter((x) => !x.startsWith("-"))) {
      const c = findContainer(E, a);
      if (!c) { o.err(`Error response from daemon: No such container: ${a}`); continue; }
      if (c.status === "running") { c.status = "exited"; c.exitCode = c.kind === "nginx" ? 0 : 0; c.finished = now(); }
      o.say(a);
    }
  }
  function dockerStart(S, E, args, o) {
    if (!needContainers(args, o, "start")) return;
    for (const a of args.filter((x) => !x.startsWith("-"))) {
      const c = findContainer(E, a);
      if (!c) { o.err(`Error response from daemon: No such container: ${a}\nError: failed to start containers: ${a}`); continue; }
      if (c.status !== "running") {
        const clash = c.ports.find((p) => E.containers.some((x) => x !== c && x.status === "running" && x.ports.some((q) => q.host === p.host)));
        if (clash) { o.err(`Error response from daemon: driver failed programming external connectivity on endpoint ${c.name}: Bind for 0.0.0.0:${clash.host} failed: port is already allocated\nError: failed to start containers: ${a}`); continue; }
        if (longRunning(c.kind) && !c.cmd.length) boot(E, c);
        else { c.status = "exited"; c.finished = now(); }
      }
      o.say(a);
    }
  }
  function dockerRestart(S, E, args, o) {
    if (!needContainers(args, o, "restart")) return;
    for (const a of args) {
      const c = findContainer(E, a);
      if (!c) { o.err(`Error response from daemon: No such container: ${a}`); continue; }
      if (longRunning(c.kind) && !c.cmd.length) boot(E, c);
      o.say(a);
    }
  }
  function dockerRm(S, E, args, o) {
    const { flags, pos, error } = parseFlags(args, { force: "bool", volumes: "bool" }, { f: "force", v: "volumes" });
    if (error) return o.err(error);
    if (!pos.length) return o.err(`"docker rm" requires at least 1 argument.\nUsage:  docker rm [OPTIONS] CONTAINER [CONTAINER...]`);
    for (const a of pos) {
      const c = findContainer(E, a);
      if (!c) { o.err(`Error response from daemon: No such container: ${a}`); continue; }
      if (c.status === "running" && !flags.force) {
        o.err(`Error response from daemon: cannot remove container "/${c.name}": container is running: stop the container before removing or force remove`);
        continue;
      }
      E.containers = E.containers.filter((x) => x !== c);
      o.say(a);
    }
  }
  function dockerLogs(S, E, args, o) {
    const { flags, pos, error } = parseFlags(args, { follow: "bool", tail: "value", timestamps: "bool" }, { f: "follow", n: "tail", t: "timestamps" });
    if (error) return o.err(error);
    if (!pos[0]) return o.err(`"docker logs" requires exactly 1 argument.\nUsage:  docker logs [OPTIONS] CONTAINER`);
    const c = findContainer(E, pos[0]);
    if (!c) return o.err(`Error response from daemon: No such container: ${pos[0]}`);
    if (c.kind === "hello") o.say(HELLO);
    else o.say([startupLogs(c), accessLogs(c)].filter(Boolean).join("\n"));
    if (flags.follow) o.note(`(following new log lines... in real Docker press Ctrl+C to stop)`);
  }
  function dockerExec(S, E, args, o) {
    const { pos, error } = parseFlags(args, { interactive: "bool", tty: "bool", user: "value", workdir: "value", __stopAtFirst: true }, { i: "interactive", t: "tty", u: "user", w: "workdir" });
    if (error) return o.err(error);
    if (pos.length < 2) return o.err(`"docker exec" requires at least 2 arguments.\nUsage:  docker exec [OPTIONS] CONTAINER COMMAND [ARG...]`);
    const c = findContainer(E, pos[0]);
    if (!c) return o.err(`Error response from daemon: No such container: ${pos[0]}`);
    if (c.status !== "running") return o.err(`Error response from daemon: container ${c.id} is not running`);
    execInside(c, pos.slice(1), o);
  }
  function execInside(c, cmd, o) {
    const [bin, ...rest] = cmd;
    if (["sh", "bash", "/bin/sh", "/bin/bash"].includes(bin)) {
      o.say(`/ # `, "dim");
      o.note(`(you are now inside "${c.name}". The simulator stops here; in real Docker you'd type commands, then 'exit'.)`);
    } else if (bin === "ls") o.say("bin   dev   docker-entrypoint.d   etc   home  lib  proc  root  run  sbin  srv  sys  tmp  usr  var");
    else if (bin === "hostname") o.say(c.id);
    else if (bin === "printenv") o.say(rest[0] ? (c.env.find((e) => e.startsWith(rest[0] + "="))?.split("=").slice(1).join("=") ?? "") : c.env.join("\n"));
    else if (bin === "psql") o.say(`psql (16.4 (Debian 16.4-1.pgdg120+2))\nType "help" for help.\n\npostgres=# `).note(`(you are in the database shell. Type \\q to quit in real life.)`);
    else if (bin === "redis-cli") o.good("127.0.0.1:6379> PONG");
    else if (bin === "mysql") o.say(`Welcome to the MySQL monitor.  Commands end with ; or \\g.\nmysql> `);
    else if (bin === "wget" || bin === "curl") o.err(`${bin}: error getting response: connection reset by peer`).note(`(the name resolved, so the network works)`);
    else o.note(`(ran "${cmd.join(" ")}" inside ${c.name})`);
  }

  function dockerInspect(S, E, args, o) {
    const key = args.find((a) => !a.startsWith("-"));
    if (!key) return o.err(`"docker inspect" requires at least 1 argument.`);
    const c = findContainer(E, key);
    if (c) {
      return o.say(JSON.stringify([{
        Id: c.id, Name: "/" + c.name, Image: c.image,
        State: { Status: c.status, Running: c.status === "running", ExitCode: c.exitCode },
        HostConfig: { PortBindings: Object.fromEntries(c.ports.map((p) => [`${p.container}/tcp`, [{ HostPort: String(p.host) }]])), RestartPolicy: { Name: c.restart } },
        Mounts: c.mounts.map((m) => ({ Type: m.type, Source: m.source, Destination: m.target })),
        Config: { Env: c.env }, NetworkSettings: { Networks: Object.fromEntries(netsOf(c).map((n) => [n, {}])) },
      }], null, 2));
    }
    const ref = normRef(key);
    if (E.images[ref]) return o.say(JSON.stringify([{ Id: "sha256:" + E.images[ref].id, RepoTags: [ref], Size: E.images[ref].size }], null, 2));
    o.err(`Error: No such object: ${key}`);
  }

  // ---------------------------------------------------------------- volumes / networks
  function dockerVolume(S, E, [sub, ...args], o) {
    if (sub === "create") {
      const name = args.find((a) => !a.startsWith("-")) || hex(64);
      if (!E.volumes[name]) E.volumes[name] = { created: now() };
      return o.say(name);
    }
    if (sub === "ls" || sub === "list") return o.say(table([["DRIVER", "VOLUME NAME"], ...Object.keys(E.volumes).map((v) => ["local", v])], 4));
    if (sub === "rm" || sub === "remove") {
      if (!args.length) return o.err(`"docker volume rm" requires at least 1 argument.`);
      for (const v of args.filter((a) => !a.startsWith("-"))) {
        if (!E.volumes[v]) { o.err(`Error response from daemon: get ${v}: no such volume`); continue; }
        const user = E.containers.find((c) => c.mounts.some((m) => m.type === "volume" && m.source === v));
        if (user) { o.err(`Error response from daemon: remove ${v}: volume is in use - [${user.id}${hex(52)}]`); continue; }
        delete E.volumes[v];
        o.say(v);
      }
      return;
    }
    if (sub === "inspect") {
      const v = args[0];
      if (!E.volumes[v]) return o.err(`Error response from daemon: get ${v}: no such volume`);
      return o.say(JSON.stringify([{ Driver: "local", Mountpoint: `/var/lib/docker/volumes/${v}/_data`, Name: v, Scope: "local" }], null, 2));
    }
    if (sub === "prune") return pruneVolumes(S, E, args, o);
    o.say(`Usage:  docker volume COMMAND\n\nCommands:\n  create   Create a volume\n  inspect  Display detailed information on one or more volumes\n  ls       List volumes\n  prune    Remove unused local volumes\n  rm       Remove one or more volumes`);
  }
  function pruneVolumes(S, E, args, o) {
    const unused = Object.keys(E.volumes).filter((v) => !E.containers.some((c) => c.mounts.some((m) => m.source === v)));
    if (!args.includes("-f") && !args.includes("--force")) {
      S.pending = { kind: "volume-prune" };
      return o.say(`WARNING! This will remove anonymous local volumes not used by at least one container.\nAre you sure you want to continue? [y/N]`, "warn");
    }
    unused.forEach((v) => delete E.volumes[v]);
    o.say(unused.length ? `Deleted Volumes:\n${unused.join("\n")}\n\nTotal reclaimed space: 0B` : `Total reclaimed space: 0B`);
  }
  function dockerNetwork(S, E, [sub, ...args], o) {
    if (sub === "create") {
      const name = args.find((a) => !a.startsWith("-"));
      if (!name) return o.err(`"docker network create" requires exactly 1 argument.`);
      if (E.networks[name]) return o.err(`Error response from daemon: network with name ${name} already exists`);
      E.networks[name] = { id: hex(12), driver: "bridge" };
      return o.say(E.networks[name].id + hex(52));
    }
    if (sub === "ls" || sub === "list") return o.say(table([["NETWORK ID", "NAME", "DRIVER", "SCOPE"], ...Object.entries(E.networks).map(([n, v]) => [v.id, n, v.driver, "local"])]));
    if (sub === "rm" || sub === "remove") {
      for (const n of args) {
        if (!E.networks[n]) { o.err(`Error response from daemon: network ${n} not found`); continue; }
        if (E.networks[n].builtin) { o.err(`Error response from daemon: ${n} is a pre-defined network and cannot be removed`); continue; }
        if (E.containers.some((c) => netsOf(c).includes(n) && c.status === "running")) { o.err(`Error response from daemon: error while removing network: network ${n} id ${E.networks[n].id} has active endpoints`); continue; }
        delete E.networks[n];
        o.say(n);
      }
      return;
    }
    if (sub === "inspect") {
      const n = args[0];
      if (!E.networks[n]) return o.err(`Error response from daemon: network ${n} not found`);
      return o.say(JSON.stringify([{ Name: n, Driver: E.networks[n].driver, Containers: Object.fromEntries(E.containers.filter((c) => netsOf(c).includes(n) && c.status === "running").map((c) => [c.id, { Name: c.name }])) }], null, 2));
    }
    if (sub === "connect" || sub === "disconnect") {
      const [n, key] = args.filter((a) => !a.startsWith("-"));
      if (!n || !key) return o.err(`"docker network ${sub}" requires exactly 2 arguments.\nUsage:  docker network ${sub} [OPTIONS] NETWORK CONTAINER`);
      if (!E.networks[n]) return o.err(`Error response from daemon: network ${n} not found`);
      const c = findContainer(E, key);
      if (!c) return o.err(`Error response from daemon: No such container: ${key}`);
      c.extraNets = c.extraNets || [];
      if (sub === "connect") {
        if (netsOf(c).includes(n)) return o.err(`Error response from daemon: endpoint with name ${c.name} already exists in network ${n}`);
        c.extraNets.push(n);
      } else {
        if (!netsOf(c).includes(n)) return o.err(`Error response from daemon: container ${c.id} is not connected to network ${n}`);
        if (c.network === n) c.network = c.extraNets.shift() || "none";
        else c.extraNets = c.extraNets.filter((x) => x !== n);
      }
      return;
    }
    o.say(`Usage:  docker network COMMAND\n\nCommands:\n  connect     Connect a container to a network\n  create      Create a network\n  disconnect  Disconnect a container from a network\n  inspect     Display detailed information on one or more networks\n  ls          List networks\n  rm          Remove one or more networks`);
  }

  // ---------------------------------------------------------------- system / prune
  function dockerSystem(S, E, [sub, ...args], o) {
    if (sub === "df") {
      const imgs = Object.values(E.images);
      const usedImgs = new Set(E.containers.map((c) => c.image));
      const totalMb = imgs.reduce((a, b) => a + b.mb, 0);
      const reclaimMb = Object.entries(E.images).filter(([r]) => !usedImgs.has(r)).reduce((a, [, b]) => a + b.mb, 0);
      const fmt = (mb) => (mb >= 1000 ? (mb / 1000).toFixed(2) + "GB" : mb.toFixed(1) + "MB");
      const stopped = E.containers.filter((c) => c.status !== "running").length;
      return o.say(table([
        ["TYPE", "TOTAL", "ACTIVE", "SIZE", "RECLAIMABLE"],
        ["Images", imgs.length, usedImgs.size, fmt(totalMb), `${fmt(reclaimMb)} (${totalMb ? Math.round((reclaimMb / totalMb) * 100) : 0}%)`],
        ["Containers", E.containers.length, E.containers.length - stopped, `${(E.containers.length * 1.1).toFixed(1)}kB`, `${(stopped * 1.1).toFixed(1)}kB (${E.containers.length ? Math.round((stopped / E.containers.length) * 100) : 0}%)`],
        ["Local Volumes", Object.keys(E.volumes).length, new Set(E.containers.flatMap((c) => c.mounts.map((m) => m.source))).size, `${Object.keys(E.volumes).length * 48}MB`, "0B (0%)"],
        ["Build Cache", 6, 0, "12.4MB", "12.4MB"],
      ]));
    }
    if (sub === "prune") {
      if (!args.includes("-f") && !args.includes("--force")) {
        S.pending = { kind: "system-prune" };
        return o.say(`WARNING! This will remove:\n  - all stopped containers\n  - all networks not used by at least one container\n  - all dangling images\n  - unused build cache\n\nAre you sure you want to continue? [y/N]`, "warn");
      }
      return doSystemPrune(E, o);
    }
    if (sub === "info") return dockerInfo(S, E, o);
    o.say(`Usage:  docker system COMMAND\n\nCommands:\n  df      Show docker disk usage\n  info    Display system-wide information\n  prune   Remove unused data`);
  }
  function doSystemPrune(E, o) {
    const stopped = E.containers.filter((c) => c.status !== "running");
    E.containers = E.containers.filter((c) => c.status === "running");
    const nets = Object.keys(E.networks).filter((n) => !E.networks[n].builtin && !E.containers.some((c) => netsOf(c).includes(n)));
    nets.forEach((n) => delete E.networks[n]);
    const dangling = Object.keys(E.images).filter((r) => r.startsWith("<none>"));
    dangling.forEach((r) => delete E.images[r]);
    if (stopped.length) o.say(`Deleted Containers:\n${stopped.map((c) => c.id + hex(52)).join("\n")}\n`);
    if (nets.length) o.say(`Deleted Networks:\n${nets.join("\n")}\n`);
    o.say(`Deleted build cache objects:\n${hex(25)}\n${hex(25)}\n\nTotal reclaimed space: ${(12.4 + stopped.length * 0.01).toFixed(1)}MB`);
  }
  function dockerContainerPrune(S, E, args, o) {
    if (!args.includes("-f") && !args.includes("--force")) {
      S.pending = { kind: "container-prune" };
      return o.say(`WARNING! This will remove all stopped containers.\nAre you sure you want to continue? [y/N]`, "warn");
    }
    const stopped = E.containers.filter((c) => c.status !== "running");
    E.containers = E.containers.filter((c) => c.status === "running");
    o.say((stopped.length ? `Deleted Containers:\n${stopped.map((c) => c.id + hex(52)).join("\n")}\n\n` : "") + `Total reclaimed space: ${stopped.length ? "4.1kB" : "0B"}`);
  }
  function dockerImagePrune(S, E, args, o) {
    const all = args.includes("-a") || args.includes("--all");
    if (!args.includes("-f") && !args.includes("--force")) {
      S.pending = { kind: all ? "image-prune-all" : "image-prune" };
      return o.say(all ? `WARNING! This will remove all images without at least one container associated to them.\nAre you sure you want to continue? [y/N]` : `WARNING! This will remove all dangling images.\nAre you sure you want to continue? [y/N]`, "warn");
    }
    doImagePrune(E, all, o);
  }
  function doImagePrune(E, all, o) {
    const used = new Set(E.containers.map((c) => c.image));
    const victims = Object.keys(E.images).filter((r) => (all ? !used.has(r) : r.startsWith("<none>")));
    const mb = victims.reduce((a, r) => a + E.images[r].mb, 0);
    victims.forEach((r) => delete E.images[r]);
    o.say((victims.length ? `Deleted Images:\n${victims.map((r) => "untagged: " + r.replace(/#.*/, "")).join("\n")}\n\n` : "") + `Total reclaimed space: ${mb >= 1000 ? (mb / 1000).toFixed(2) + "GB" : mb.toFixed(1) + "MB"}`);
  }

  function dockerInfo(S, E, o) {
    o.say(`Client:\n Version:    27.3.1\n Context:    default\n\nServer:\n Containers: ${E.containers.length}\n  Running: ${E.containers.filter((c) => c.status === "running").length}\n  Stopped: ${E.containers.filter((c) => c.status !== "running").length}\n Images: ${Object.keys(E.images).length}\n Server Version: 27.3.1\n Storage Driver: overlayfs\n Operating System: ${S.host === "vps" ? "Ubuntu 24.04.1 LTS" : "Docker Desktop"}\n CPUs: 8\n Total Memory: 15.5GiB`);
  }

  // ---------------------------------------------------------------- compose
  const COMPOSE_PROJECT = "app";
  function composeServices() {
    return [
      { svc: "web", image: "nginx:alpine", ports: [{ host: 8080, container: 80 }], mounts: [], env: [] },
      { svc: "db", image: "postgres:16", ports: [], mounts: [{ type: "volume", source: COMPOSE_PROJECT + "_dbdata", target: "/var/lib/postgresql/data" }], env: ["POSTGRES_PASSWORD=secret"] },
    ];
  }
  function dockerCompose(S, E, args, o) {
    const { flags: gflags, pos, error } = parseFlags(args, { file: "value", "project-name": "value", __stopAtFirst: true }, { f: "file", p: "project-name" });
    if (error) return o.err(error);
    const [sub, ...rest] = pos;
    if (!sub) return o.say(`Usage:  docker compose [OPTIONS] COMMAND\n\nCommands:\n  build  config  down  exec  logs  ps  restart  start  stop  up`);
    if (S.host !== "local" || !S.files["compose.yaml"]) return o.err(`no configuration file provided: not found`);
    const project = gflags["project-name"] ? last(gflags["project-name"]) : COMPOSE_PROJECT;
    const mine = () => E.containers.filter((c) => c.compose && c.compose.project === project);
    const net = project + "_default";

    switch (sub) {
      case "config": return o.say(S.files["compose.yaml"].replace(/^/, `name: ${project}\n`));
      case "up": {
        const f = parseFlags(rest, { detach: "bool", build: "bool", "force-recreate": "bool" }, { d: "detach" });
        if (f.error) return o.err(f.error);
        const steps = [];
        for (const s of composeServices()) if (!E.images[s.image]) { o.say(`[+] Pulling ${s.svc}`); pullImage(S, E, s.image, Out(), true); o.dim(` ✔ ${s.svc} Pulled`); }
        if (!E.networks[net]) { E.networks[net] = { id: hex(12), driver: "bridge" }; steps.push(` ✔ Network ${net}       Created`); }
        const vol = project + "_dbdata";
        if (!E.volumes[vol]) { E.volumes[vol] = { created: now(), project }; steps.push(` ✔ Volume "${vol}"     Created`); }
        for (const s of composeServices()) {
          const cname = `${project}-${s.svc}-1`;
          let c = E.containers.find((x) => x.name === cname);
          if (!c) {
            const clash = s.ports.find((p) => E.containers.some((x) => x.status === "running" && x.ports.some((q) => q.host === p.host)));
            if (clash) return o.err(`Error response from daemon: driver failed programming external connectivity on endpoint ${cname}: Bind for 0.0.0.0:${clash.host} failed: port is already allocated`);
            c = createContainer(S, E, { image: s.image, name: cname, ports: s.ports, env: s.env, mounts: s.mounts, network: net, compose: { project, service: s.svc } }, o);
            steps.push(` ✔ Container ${cname}  Started`);
          } else steps.push(` ✔ Container ${cname}  Running`);
          c.status = "running";
          c.started = c.started && c.status === "running" ? c.started : now();
        }
        o.say(`[+] Running ${steps.length}/${steps.length}`);
        steps.forEach((s) => o.good(s));
        if (!f.flags.detach) o.note(`\n(without -d you'd now be watching all logs; Ctrl+C would stop everything. Use -d.)`);
        return;
      }
      case "ps": {
        const f = parseFlags(rest, { all: "bool", quiet: "bool", services: "bool" }, { a: "all", q: "quiet" });
        const list = mine().filter((c) => f.flags && f.flags.all ? true : c.status === "running");
        return o.say(table([["NAME", "IMAGE", "COMMAND", "SERVICE", "CREATED", "STATUS", "PORTS"],
          ...list.map((c) => [c.name, c.image, cmdText(c), c.compose.service, agoLower(c.created), statusText(c), portText(c)])]));
      }
      case "logs": {
        const f = parseFlags(rest, { follow: "bool", tail: "value" }, { f: "follow", n: "tail" });
        const svcs = f.pos.length ? f.pos : composeServices().map((s) => s.svc);
        const list = mine().filter((c) => svcs.includes(c.compose.service));
        if (!list.length) return mine().length ? o.err(`no such service: ${f.pos[0]}`) : o.dim("(no containers. Run docker compose up -d first.)");
        list.forEach((c) => [startupLogs(c), accessLogs(c)].filter(Boolean).join("\n").split("\n").forEach((l) => o.say(`${c.name.padEnd(10)}| ${l}`)));
        if (f.flags.follow) o.note(`(following... Ctrl+C to stop in real life)`);
        return;
      }
      case "exec": {
        const f = parseFlags(rest, { interactive: "bool", tty: "bool", user: "value", T: "bool", __stopAtFirst: true }, { i: "interactive", t: "tty", u: "user" });
        if (f.error) return o.err(f.error);
        const [svc, ...cmd] = f.pos;
        if (!svc || !cmd.length) return o.err(`'docker compose exec' requires at least 2 arguments`);
        const c = mine().find((x) => x.compose.service === svc);
        if (!c) return o.err(`service "${svc}" is not running`);
        if (c.status !== "running") return o.err(`service "${svc}" is not running`);
        return execInside(c, cmd, o);
      }
      case "stop": case "start": case "restart": {
        const svcs = rest.filter((a) => !a.startsWith("-"));
        const list = mine().filter((c) => !svcs.length || svcs.includes(c.compose.service));
        if (!list.length) return o.err(svcs.length ? `no such service: ${svcs[0]}` : `no containers to ${sub}`);
        o.say(`[+] ${sub === "stop" ? "Stopping" : sub === "start" ? "Starting" : "Restarting"} ${list.length}/${list.length}`);
        list.forEach((c) => {
          if (sub === "stop") { c.status = "exited"; c.finished = now(); } else { c.status = "running"; c.started = now(); }
          o.good(` ✔ Container ${c.name}  ${sub === "stop" ? "Stopped" : "Started"}`);
        });
        return;
      }
      case "down": {
        const f = parseFlags(rest, { volumes: "bool", "remove-orphans": "bool" }, { v: "volumes" });
        const list = mine();
        if (!list.length && !E.networks[net]) return o.dim("(nothing to stop)");
        const n = list.length * 2 + (E.networks[net] ? 1 : 0) + (f.flags.volumes && E.volumes[project + "_dbdata"] ? 1 : 0);
        o.say(`[+] Running ${n}/${n}`);
        list.forEach((c) => o.good(` ✔ Container ${c.name}  Removed`));
        E.containers = E.containers.filter((c) => !list.includes(c));
        if (E.networks[net]) { delete E.networks[net]; o.good(` ✔ Network ${net}  Removed`); }
        if (f.flags.volumes && E.volumes[project + "_dbdata"]) { delete E.volumes[project + "_dbdata"]; o.good(` ✔ Volume ${project}_dbdata  Removed`); }
        return;
      }
      case "build": return o.say(`(nothing to build: every service uses a ready-made image)`, "dim");
      case "pull": composeServices().forEach((s) => { pullImage(S, E, s.image, Out(), true); o.good(` ✔ ${s.svc} Pulled`); }); return;
      default: return o.err(`unknown docker command: "compose ${sub}"`);
    }
  }

  // ---------------------------------------------------------------- docker dispatch
  function docker(S, args, o) {
    const E = engine(S);
    if (!E.installed) return o.err(`Command 'docker' not found, but can be installed with:\nsudo snap install docker  # or the official script: curl -fsSL https://get.docker.com | sh`);
    const [cmd, ...rest] = args;
    switch (cmd) {
      case undefined: case "help": case "--help":
        return o.say(`Usage:  docker [OPTIONS] COMMAND\n\nCommon Commands:\n  run         Create and run a new container from an image\n  exec        Execute a command in a running container\n  ps          List containers\n  build       Build an image from a Dockerfile\n  pull        Download an image from a registry\n  push        Upload an image to a registry\n  images      List images\n  login       Log in to a registry\n  version     Show the Docker version information\n  info        Display system-wide information\n\nManagement Commands:\n  compose     Docker Compose\n  container   Manage containers\n  image       Manage images\n  network     Manage networks\n  system      Manage Docker\n  volume      Manage volumes`);
      case "--version": case "-v": return o.say(`Docker version 27.3.1, build ce12230`);
      case "version": return o.say(`Client:\n Version:           27.3.1\n API version:       1.47\n Go version:        go1.22.7\n OS/Arch:           linux/amd64\n\nServer: Docker Engine - Community\n Engine:\n  Version:          27.3.1\n  API version:      1.47 (minimum version 1.24)`);
      case "info": return dockerInfo(S, E, o);
      case "run": return dockerRun(S, E, rest, o);
      case "ps": return dockerPs(S, E, rest, o);
      case "stop": return dockerStop(S, E, rest, o);
      case "start": return dockerStart(S, E, rest, o);
      case "restart": return dockerRestart(S, E, rest, o);
      case "rm": return dockerRm(S, E, rest, o);
      case "logs": return dockerLogs(S, E, rest, o);
      case "exec": return dockerExec(S, E, rest, o);
      case "inspect": return dockerInspect(S, E, rest, o);
      case "images": return dockerImages(S, E, rest, o);
      case "pull": return rest[0] ? pullImage(S, E, normRef(rest.find((a) => !a.startsWith("-"))), o) : o.err(`"docker pull" requires exactly 1 argument.\nUsage:  docker pull [OPTIONS] NAME[:TAG|@DIGEST]`);
      case "rmi": return dockerRmi(S, E, rest, o);
      case "build": return dockerBuild(S, E, rest, o);
      case "tag": return dockerTag(S, E, rest, o);
      case "push": return dockerPush(S, E, rest, o);
      case "login": S.loggedIn = true; return o.say(`Authenticating with existing credentials... [Username: yourname]\n\ni Info → To login with a different account, run 'docker logout' followed by 'docker login'\n`).good(`Login Succeeded`);
      case "logout": S.loggedIn = false; return o.say(`Removing login credentials for https://index.docker.io/v1/`);
      case "volume": return dockerVolume(S, E, rest, o);
      case "network": return dockerNetwork(S, E, rest, o);
      case "system": return dockerSystem(S, E, rest, o);
      case "compose": return dockerCompose(S, E, rest, o);
      case "container": {
        const [sub, ...r] = rest;
        const map = { ls: dockerPs, list: dockerPs, run: dockerRun, stop: dockerStop, start: dockerStart, restart: dockerRestart, rm: dockerRm, logs: dockerLogs, exec: dockerExec, inspect: dockerInspect, prune: dockerContainerPrune };
        return map[sub] ? map[sub](S, E, r, o) : o.err(`docker: unknown command: docker container ${sub || ""}`);
      }
      case "image": {
        const [sub, ...r] = rest;
        if (sub === "ls" || sub === "list") return dockerImages(S, E, r, o);
        if (sub === "rm") return dockerRmi(S, E, r, o);
        if (sub === "pull") return pullImage(S, E, normRef(r[0] || ""), o);
        if (sub === "build") return dockerBuild(S, E, r, o);
        if (sub === "prune") return dockerImagePrune(S, E, r, o);
        if (sub === "inspect") return dockerInspect(S, E, r, o);
        if (sub === "tag") return dockerTag(S, E, r, o);
        if (sub === "push") return dockerPush(S, E, r, o);
        return o.err(`docker: unknown command: docker image ${sub || ""}`);
      }
      case "buildx": return rest[0] === "build" ? dockerBuild(S, E, rest.slice(1), o) : o.err(`docker buildx ${rest[0] || ""}: not in this simulator`);
      default:
        return o.err(`docker: unknown command: docker ${cmd}\n\nRun 'docker --help' for more information`);
    }
  }

  // ---------------------------------------------------------------- kubernetes
  const NOT_CONNECTED = `E1028 10:00:00.000000   12345 memcache.go:265] couldn't get current server API group list: Get "http://localhost:8080/api?timeout=32s": dial tcp 127.0.0.1:8080: connect: connection refused\nThe connection to the server localhost:8080 was refused - did you specify the right host or port?`;

  function kind(S, args, o) {
    const [sub, what, ...rest] = args;
    if (sub === "create" && what === "cluster") {
      if (!S.hosts.local.installed) return o.err("ERROR: failed to create cluster: docker not found");
      if (S.k8s) return o.err(`ERROR: failed to create cluster: node(s) already exist for a cluster with the name "${S.k8s.name}"`);
      const f = parseFlags(rest, { name: "value" });
      const name = f.flags.name ? last(f.flags.name) : "kind";
      S.k8s = { name, created: now(), deployments: {}, pods: [], services: { kubernetes: { type: "ClusterIP", ip: "10.96.0.1", ports: "443/TCP", created: now() } } };
      return o.say(`Creating cluster "${name}" ...`).good(` ✓ Ensuring node image (kindest/node:v1.31.0) 🖼\n ✓ Preparing nodes 📦\n ✓ Writing configuration 📜\n ✓ Starting control-plane 🕹️\n ✓ Installing CNI 🔌\n ✓ Installing StorageClass 💾`).say(`Set kubectl context to "kind-${name}"\nYou can now use your cluster with:\n\nkubectl cluster-info --context kind-${name}\n\nHave a nice day! 👋`);
    }
    if (sub === "delete" && what === "cluster") {
      if (!S.k8s) return o.say(`Deleting cluster "kind" ...`);
      const n = S.k8s.name; S.k8s = null;
      return o.say(`Deleting cluster "${n}" ...\nDeleted nodes: ["${n}-control-plane"]`);
    }
    if (sub === "get" && what === "clusters") return o.say(S.k8s ? S.k8s.name : "No kind clusters found.");
    if (sub === "version" || sub === "--version") return o.say("kind v0.24.0 go1.22.6 linux/amd64");
    o.say(`kind creates and manages local Kubernetes clusters using Docker container 'nodes'\n\nUsage:\n  kind create cluster --name NAME\n  kind delete cluster --name NAME\n  kind get clusters`);
  }

  const badImage = (img) => /doesnotexist|:nope|typo/.test(img) || !(CATALOG[normRef(img)] || /^[a-z0-9-]+\/[a-z0-9-]+/.test(img));
  const containerNameFor = (img) => baseName(normRef(img));

  function reconcile(K, dep) {
    const mine = K.pods.filter((p) => p.deploy === dep.name && p.rs === dep.rs);
    K.pods = K.pods.filter((p) => p.deploy !== dep.name || p.rs === dep.rs);
    while (mine.length < dep.replicas) {
      const p = { name: `${dep.name}-${dep.rs}-${alnum(5)}`, deploy: dep.name, rs: dep.rs, image: dep.image, created: now(), restarts: 0, status: badImage(dep.image) ? "ImagePullBackOff" : "Running", ip: `10.244.0.${5 + ((Math.random() * 200) | 0)}` };
      K.pods.push(p);
      mine.push(p);
    }
    while (mine.length > dep.replicas) {
      const p = mine.pop();
      K.pods.splice(K.pods.indexOf(p), 1);
    }
  }

  function kubectl(S, args, o) {
    const [verb, ...rest] = args;
    if (verb === "version" && rest.includes("--client")) return o.say(`Client Version: v1.31.1\nKustomize Version: v5.4.2`);
    if (!verb || verb === "help" || verb === "--help") return o.say(`kubectl controls the Kubernetes cluster manager.\n\nBasic Commands:\n  create   expose   run   set   get   delete   apply   scale\n\nTroubleshooting:\n  describe   logs   exec   port-forward\n\nDeploy Commands:\n  rollout   scale`);
    if (verb === "config" && rest[0] === "get-contexts") return o.say(table([["CURRENT", "NAME", "CLUSTER", "AUTHINFO", "NAMESPACE"], ...(S.k8s ? [["*", "kind-" + S.k8s.name, "kind-" + S.k8s.name, "kind-" + S.k8s.name, ""]] : [])]));
    if (verb === "config" && rest[0] === "current-context") return S.k8s ? o.say("kind-" + S.k8s.name) : o.err("error: current-context is not set");
    const K = S.k8s;
    if (!K) return o.err(NOT_CONNECTED + "\n(hint: create a cluster first)");

    const typeOf = (t) => ({ po: "pods", pod: "pods", pods: "pods", deploy: "deployments", deployment: "deployments", deployments: "deployments", svc: "services", service: "services", services: "services", no: "nodes", node: "nodes", nodes: "nodes", all: "all", rs: "replicasets", replicaset: "replicasets", replicasets: "replicasets", ns: "namespaces", namespace: "namespaces", namespaces: "namespaces" }[t]);
    const splitRef = (pos) => {
      if (pos[0] && pos[0].includes("/")) { const [t, n] = pos[0].split("/"); return [typeOf(t), n, pos.slice(1)]; }
      return [typeOf(pos[0]), pos[1], pos.slice(2)];
    };

    switch (verb) {
      case "cluster-info": return o.say(`Kubernetes control plane is running at https://127.0.0.1:41093\nCoreDNS is running at https://127.0.0.1:41093/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy`);
      case "get": {
        const f = parseFlags(rest, { watch: "bool", "all-namespaces": "bool", output: "value", selector: "value", namespace: "value" }, { w: "watch", A: "all-namespaces", o: "output", l: "selector", n: "namespace" });
        if (f.error) return o.err(f.error);
        const types = (f.pos[0] || "").split(",").map(typeOf);
        if (!f.pos[0]) return o.err(`You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.`);
        if (types.includes(undefined)) return o.err(`error: the server doesn't have a resource type "${f.pos[0]}"`);
        const sel = f.flags.selector ? last(f.flags.selector).split("=")[1] : null;
        const want = types.includes("all") ? ["pods", "services", "deployments"] : types;
        let printed = false;
        for (const t of want) {
          if (printed) o.say("");
          if (t === "nodes") {
            o.say(table([["NAME", "STATUS", "ROLES", "AGE", "VERSION"], [K.name + "-control-plane", "Ready", "control-plane", shortAge(K.created), "v1.31.0"]]));
          } else if (t === "namespaces") {
            o.say(table([["NAME", "STATUS", "AGE"], ...["default", "kube-node-lease", "kube-public", "kube-system", "local-path-storage"].map((n) => [n, "Active", shortAge(K.created)])]));
          } else if (t === "pods") {
            let pods = K.pods.filter((p) => !sel || p.deploy === sel);
            let rows = pods.map((p) => [(types.includes("all") ? "pod/" : "") + p.name, p.status === "Running" ? "1/1" : "0/1", p.status, String(p.restarts), shortAge(p.created)]);
            if (f.flags["all-namespaces"]) {
              rows = [["kube-system", "coredns-7c65d6cfc9-4xkqp", "1/1", "Running", "0", shortAge(K.created)], ["kube-system", "coredns-7c65d6cfc9-mz8wn", "1/1", "Running", "0", shortAge(K.created)], ["kube-system", "etcd-" + K.name + "-control-plane", "1/1", "Running", "0", shortAge(K.created)], ["kube-system", "kube-apiserver-" + K.name + "-control-plane", "1/1", "Running", "0", shortAge(K.created)], ["kube-system", "kube-proxy-9bdtr", "1/1", "Running", "0", shortAge(K.created)], ...rows.map((r) => ["default", ...r])];
              o.say(table([["NAMESPACE", "NAME", "READY", "STATUS", "RESTARTS", "AGE"], ...rows]));
            } else if (!rows.length) o.say("No resources found in default namespace.");
            else o.say(table([["NAME", "READY", "STATUS", "RESTARTS", "AGE"], ...rows]));
          } else if (t === "deployments") {
            const deps = Object.values(K.deployments).filter((d) => !sel || d.name === sel);
            if (!deps.length) { if (!types.includes("all")) o.say("No resources found in default namespace."); continue; }
            o.say(table([["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"], ...deps.map((d) => {
              const ready = K.pods.filter((p) => p.deploy === d.name && p.status === "Running").length;
              return [(types.includes("all") ? "deployment.apps/" : "") + d.name, `${ready}/${d.replicas}`, String(d.replicas), String(ready), shortAge(d.created)];
            })]));
          } else if (t === "services") {
            o.say(table([["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"], ...Object.entries(K.services).filter(([n]) => !sel || n === sel).map(([n, s]) => [(types.includes("all") ? "service/" : "") + n, s.type, s.ip, "<none>", s.ports, shortAge(s.created)])]));
          } else if (t === "replicasets") {
            o.say(table([["NAME", "DESIRED", "CURRENT", "READY", "AGE"], ...Object.values(K.deployments).map((d) => [`${d.name}-${d.rs}`, d.replicas, d.replicas, K.pods.filter((p) => p.deploy === d.name && p.status === "Running").length, shortAge(d.created)])]));
          }
          printed = true;
        }
        if (f.flags.watch) o.note(`(watching for changes... in real life press Ctrl+C to stop)`);
        return;
      }
      case "create": {
        if (rest[0] !== "deployment" && rest[0] !== "deploy") return o.err(`error: Unexpected args: [${rest.join(" ")}]\n(this simulator supports: kubectl create deployment NAME --image=IMAGE)`);
        const f = parseFlags(rest.slice(1), { image: "value", replicas: "value", port: "value" }, { r: "replicas" });
        if (f.error) return o.err(f.error);
        const name = f.pos[0];
        if (!name) return o.err(`error: exactly one NAME is required, got 0`);
        if (!f.flags.image) return o.err(`error: required flag(s) "image" not set`);
        if (K.deployments[name]) return o.err(`error: failed to create deployment: deployments.apps "${name}" already exists`);
        const image = last(f.flags.image);
        const dep = { name, image, container: containerNameFor(image), replicas: parseInt(f.flags.replicas ? last(f.flags.replicas) : "1", 10), created: now(), rs: alnum(10), revision: 1, history: [image] };
        K.deployments[name] = dep;
        reconcile(K, dep);
        return o.say(`deployment.apps/${name} created`);
      }
      case "expose": {
        const [t, name] = splitRef(rest.filter((a) => !a.startsWith("-")));
        const f = parseFlags(rest, { port: "value", type: "value", "target-port": "value", name: "value" });
        if (t !== "deployments") return o.err(`error: cannot expose a ${rest[0] || "nothing"}\n(try: kubectl expose deployment NAME --port=80)`);
        if (!K.deployments[name]) return o.err(`Error from server (NotFound): deployments.apps "${name}" not found`);
        if (!f.flags.port) return o.err(`error: couldn't find port via --port flag or introspection\nSee 'kubectl expose -h' for help and examples`);
        const svcName = f.flags.name ? last(f.flags.name) : name;
        if (K.services[svcName]) return o.err(`Error from server (AlreadyExists): services "${svcName}" already exists`);
        const type = f.flags.type ? last(f.flags.type) : "ClusterIP";
        const port = last(f.flags.port);
        K.services[svcName] = { type, ip: `10.96.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`, ports: type === "NodePort" ? `${port}:3${(Math.random() * 2767 + 1000) | 0}/TCP` : `${port}/TCP`, created: now(), deploy: name };
        return o.say(`service/${svcName} exposed`);
      }
      case "scale": {
        const f = parseFlags(rest, { replicas: "value" });
        const [t, name] = splitRef(f.pos);
        if (!f.flags.replicas) return o.err(`error: required flag(s) "replicas" not set`);
        if (t !== "deployments") return o.err(`error: the server doesn't have a resource type "${f.pos[0]}"`);
        const dep = K.deployments[name];
        if (!dep) return o.err(`Error from server (NotFound): deployments.apps "${name}" not found`);
        dep.replicas = parseInt(last(f.flags.replicas), 10);
        reconcile(K, dep);
        return o.say(`deployment.apps/${name} scaled`);
      }
      case "delete": {
        const f = parseFlags(rest, { selector: "value", filename: "value", wait: "value", force: "bool", "grace-period": "value" }, { l: "selector", f: "filename" });
        if (f.error) return o.err(f.error);
        if (f.flags.filename) return o.err(`error: the path "${last(f.flags.filename)}" does not exist`);
        const [t, ...names] = f.pos[0] && f.pos[0].includes("/") ? [typeOf(f.pos[0].split("/")[0]), f.pos[0].split("/")[1]] : [typeOf(f.pos[0]), ...f.pos.slice(1)];
        if (!t) return o.err(`error: the server doesn't have a resource type "${f.pos[0] || ""}"`);
        if (t === "pods") {
          let targets = f.flags.selector ? K.pods.filter((p) => p.deploy === last(f.flags.selector).split("=")[1]) : names.map((n) => K.pods.find((p) => p.name === n) || n);
          if (!targets.length) return o.say("No resources found");
          for (const p of targets) {
            if (typeof p === "string") { o.err(`Error from server (NotFound): pods "${p}" not found`); continue; }
            K.pods.splice(K.pods.indexOf(p), 1);
            o.say(`pod "${p.name}" deleted`);
            K.lastDeletedPod = { deploy: p.deploy, at: now() };
          }
          Object.values(K.deployments).forEach((d) => reconcile(K, d));
          return;
        }
        if (t === "deployments") {
          for (const n of names) {
            if (!K.deployments[n]) { o.err(`Error from server (NotFound): deployments.apps "${n}" not found`); continue; }
            delete K.deployments[n];
            K.pods = K.pods.filter((p) => p.deploy !== n);
            o.say(`deployment.apps "${n}" deleted`);
          }
          return;
        }
        if (t === "services") {
          for (const n of names) {
            if (!K.services[n] || n === "kubernetes") { o.err(`Error from server (NotFound): services "${n}" not found`); continue; }
            delete K.services[n];
            o.say(`service "${n}" deleted`);
          }
          return;
        }
        return o.err(`error: deleting ${t} is not in this simulator`);
      }
      case "describe": {
        const [t, name] = splitRef(rest.filter((a) => !a.startsWith("-")));
        if (t === "pods") {
          const p = K.pods.find((x) => x.name === name) || (name ? K.pods.find((x) => x.name.startsWith(name)) : null);
          if (!p) return o.err(`Error from server (NotFound): pods "${name || ""}" not found`);
          const bad = p.status !== "Running";
          o.say(`Name:             ${p.name}\nNamespace:        default\nNode:             ${K.name}-control-plane/172.18.0.2\nLabels:           app=${p.deploy}\nStatus:           ${bad ? "Pending" : "Running"}\nIP:               ${p.ip}\nContainers:\n  ${containerNameFor(p.image)}:\n    Image:          ${p.image}\n    State:          ${bad ? "Waiting\n      Reason:       ImagePullBackOff" : "Running"}\n    Ready:          ${bad ? "False" : "True"}\nEvents:\n  Type     Reason     Age   From               Message\n  ----     ------     ----  ----               -------\n  Normal   Scheduled  ${shortAge(p.created)}   default-scheduler  Successfully assigned default/${p.name} to ${K.name}-control-plane`);
          if (bad) o.say(`  Normal   Pulling    ${shortAge(p.created)}   kubelet            Pulling image "${p.image}"`).err(`  Warning  Failed     ${shortAge(p.created)}   kubelet            Failed to pull image "${p.image}": rpc error: code = NotFound desc = failed to pull and unpack image "docker.io/library/${normRef(p.image)}": not found\n  Warning  Failed     ${shortAge(p.created)}   kubelet            Error: ErrImagePull\n  Normal   BackOff    ${shortAge(p.created)}   kubelet            Back-off pulling image "${p.image}"`).ok = true;
          else o.say(`  Normal   Pulled     ${shortAge(p.created)}   kubelet            Container image "${p.image}" already present on machine\n  Normal   Created    ${shortAge(p.created)}   kubelet            Created container ${containerNameFor(p.image)}\n  Normal   Started    ${shortAge(p.created)}   kubelet            Started container ${containerNameFor(p.image)}`);
          return;
        }
        if (t === "deployments") {
          const d = K.deployments[name];
          if (!d) return o.err(`Error from server (NotFound): deployments.apps "${name}" not found`);
          return o.say(`Name:                   ${d.name}\nNamespace:              default\nSelector:               app=${d.name}\nReplicas:               ${d.replicas} desired | ${d.replicas} updated | ${d.replicas} total\nStrategyType:           RollingUpdate\nPod Template:\n  Containers:\n   ${d.container}:\n    Image:        ${d.image}\nEvents:\n  Normal  ScalingReplicaSet  ${shortAge(d.created)}  deployment-controller  Scaled up replica set ${d.name}-${d.rs} to ${d.replicas}`);
        }
        return o.err(`error: the server doesn't have a resource type "${rest[0] || ""}"`);
      }
      case "logs": {
        const f = parseFlags(rest, { follow: "bool", previous: "bool", tail: "value" }, { f: "follow", p: "previous" });
        const name = f.pos[0];
        if (!name) return o.err(`error: expected 'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]'.`);
        let p = K.pods.find((x) => x.name === name);
        if (!p && name.startsWith("deployment/")) p = K.pods.find((x) => x.deploy === name.split("/")[1]);
        if (!p) return o.err(`Error from server (NotFound): pods "${name}" not found`);
        if (p.status !== "Running") return o.err(`Error from server (BadRequest): container "${containerNameFor(p.image)}" in pod "${p.name}" is waiting to start: trying and failing to pull image`);
        o.say(startupLogs({ kind: "nginx" }) + "\n" + accessLogs({ kind: "nginx" }));
        if (f.flags.follow) o.note(`(following... Ctrl+C to stop in real life)`);
        return;
      }
      case "exec": {
        const dash = rest.indexOf("--");
        const pos = rest.slice(0, dash === -1 ? rest.length : dash).filter((a) => !a.startsWith("-"));
        const p = K.pods.find((x) => x.name === pos[0]);
        if (!p) return o.err(`Error from server (NotFound): pods "${pos[0] || ""}" not found`);
        if (dash === -1) return o.err(`error: you must specify at least one command for the container`);
        return execInside({ name: p.name, env: [], kind: "nginx" }, rest.slice(dash + 1), o);
      }
      case "port-forward": {
        const [ref, ports] = rest.filter((a) => !a.startsWith("-"));
        const [t, name] = splitRef([ref || ""]);
        if (!ports) return o.err(`error: TYPE/NAME and list of ports are required for port-forward`);
        if (t === "services" && !K.services[name]) return o.err(`Error from server (NotFound): services "${name}" not found`);
        if (t === "pods" && !K.pods.find((p) => p.name === name)) return o.err(`Error from server (NotFound): pods "${name}" not found`);
        if (t === "deployments" && !K.deployments[name]) return o.err(`Error from server (NotFound): deployments.apps "${name}" not found`);
        const [l, r] = ports.split(":");
        return o.say(`Forwarding from 127.0.0.1:${l} -> ${r || l}\nForwarding from [::1]:${l} -> ${r || l}`).note(`(in real life this keeps running. Open http://localhost:${l}, then Ctrl+C to stop)`);
      }
      case "set": {
        if (rest[0] !== "image") return o.err(`error: this simulator supports: kubectl set image deployment/NAME CONTAINER=IMAGE`);
        const pos = rest.slice(1).filter((a) => !a.startsWith("-"));
        const [t, name, assigns] = splitRef(pos);
        if (t !== "deployments") return o.err(`error: the server doesn't have a resource type "${pos[0] || ""}"`);
        const d = K.deployments[name];
        if (!d) return o.err(`Error from server (NotFound): deployments.apps "${name}" not found`);
        const a = assigns[0];
        if (!a || !a.includes("=")) return o.err(`error: you must specify an update to containers (in the form of "NAME=IMAGE")`);
        const [cname, img] = a.split("=");
        if (cname !== d.container && cname !== "*") return o.err(`error: unable to find container named "${cname}"\n(hint: the container is called "${d.container}")`);
        d.image = img; d.rs = alnum(10); d.revision += 1; d.history.push(img);
        reconcile(K, d);
        return o.say(`deployment.apps/${name} image updated`);
      }
      case "rollout": {
        const [sub, ...r] = rest;
        const [t, name] = splitRef(r.filter((a) => !a.startsWith("-")));
        if (t !== "deployments") return o.err(`error: you must provide one or more resources by argument or filename\n(try: kubectl rollout ${sub || "status"} deployment/NAME)`);
        const d = K.deployments[name];
        if (!d) return o.err(`Error from server (NotFound): deployments.apps "${name}" not found`);
        if (sub === "status") {
          if (badImage(d.image)) return o.say(`Waiting for deployment "${name}" rollout to finish: 0 of ${d.replicas} updated replicas are available...`).note(`(stuck: the new pods can't pull their image)`);
          for (let i = 1; i < Math.min(d.replicas, 4); i++) o.dim(`Waiting for deployment "${name}" rollout to finish: ${i} of ${d.replicas} updated replicas are available...`);
          return o.good(`deployment "${name}" successfully rolled out`);
        }
        if (sub === "undo") {
          if (d.history.length < 2) return o.err(`error: no rollout history found for deployment "${name}"`);
          d.history.pop();
          d.image = d.history[d.history.length - 1]; d.rs = alnum(10); d.revision += 1;
          reconcile(K, d);
          return o.say(`deployment.apps/${name} rolled back`);
        }
        if (sub === "history") return o.say(`deployment.apps/${name}\nREVISION  CHANGE-CAUSE\n${d.history.map((h, i) => `${i + 1}         <none>`).join("\n")}`);
        if (sub === "restart") { d.rs = alnum(10); reconcile(K, d); return o.say(`deployment.apps/${name} restarted`); }
        return o.err(`error: unknown command "${sub}" for "kubectl rollout"`);
      }
      case "apply": return o.err(`error: the path "${rest[rest.indexOf("-f") + 1] || ""}" does not exist\n(the simulator uses kubectl create/expose/scale instead of YAML files)`);
      default:
        return o.err(`error: unknown command "${verb}" for "kubectl"\n\nDid you mean this?\n\tget\n\tcreate\n\tdescribe`);
    }
  }

  // ---------------------------------------------------------------- linux (laptop only)
  // A small filesystem, processes, environment and packages. Files directly in ~/app live in
  // S.files so docker build / compose see them; everything else lives in S.linux.
  const HOME = "/home/you", APP = HOME + "/app";
  const APP_EXTRA = {
    ".env": "PORT=3000\nNODE_ENV=development\nDATABASE_URL=postgres://db:5432/app",
    "deploy.sh": `#!/bin/sh\necho "Building image..."\necho "Pushing to the registry..."\necho "Deployed! 🚀"`,
  };
  const PKGS = { tree: "2.1.1-2", htop: "3.3.0-4", git: "1:2.43.0-1", jq: "1.7.1-3", curl: "8.5.0-2", vim: "2:9.1.0016-1", nano: "7.2-2", python3: "3.12.3-0", nodejs: "18.19.1+dfsg-6" };
  const BUILTIN_CMDS = ["ls", "cd", "pwd", "cat", "echo", "mkdir", "touch", "rm", "cp", "mv", "chmod", "whoami", "id", "ps", "kill", "ss", "lsof", "env", "printenv", "export", "unset", "apt", "sudo", "head", "tail", "hostname", "uname", "which", "curl", "ssh", "docker", "kubectl", "kind"];

  function linux(S) {
    if (S.linux) return S.linux;
    for (const [n, c] of Object.entries(APP_EXTRA)) if (S.files[n] === undefined) S.files[n] = c;
    S.linux = {
      cwd: APP, prev: APP,
      dirs: ["/", "/home", HOME, APP, "/etc", "/tmp", "/usr", "/usr/bin", "/var", "/var/log"],
      files: {
        "/etc/os-release": 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu',
        "/etc/hostname": "laptop",
        "/etc/shadow": "root:*:19800:0:99999:7:::\nyou:$y$j9T$Qm1x0Vz8$kq3V0w7m1M3n2qXxYkq9P0:19800:0:99999:7:::",
        "/var/log/app.log": "10:00:01 app starting\n10:00:02 connected to database\n10:00:02 listening on port 3000\n10:04:51 GET / 200\n10:04:53 GET /favicon.ico 404",
        [HOME + "/todo.txt"]: "- learn the terminal\n- learn docker\n- ship it",
      },
      modes: { "/etc/shadow": "rw-r-----", [APP + "/deploy.sh"]: "rw-r--r--" },
      owners: {},
      env: { HOME, USER: "you", SHELL: "/bin/bash", PWD: APP, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "en_US.UTF-8" },
      procs: [
        { pid: 1, user: "root", cmd: "/sbin/init splash", name: "systemd" },
        { pid: 412, user: "root", cmd: "sshd: /usr/sbin/sshd -D", name: "sshd", port: 22 },
        { pid: 688, user: "root", cmd: "/usr/bin/dockerd -H fd://", name: "dockerd" },
        { pid: 2207, user: "you", cmd: "-bash", name: "bash" },
      ],
      pkgs: [],
    };
    return S.linux;
  }
  const parentOf = (p) => p.slice(0, p.lastIndexOf("/")) || "/";
  const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);
  function resolvePath(L, p) {
    if (!p || p === "~") return HOME;
    if (p.startsWith("~/")) p = HOME + p.slice(1);
    else if (!p.startsWith("/")) p = L.cwd + "/" + p;
    const out = [];
    for (const seg of p.split("/")) { if (!seg || seg === ".") continue; if (seg === "..") out.pop(); else out.push(seg); }
    return "/" + out.join("/");
  }
  const fileGet = (S, p) => (parentOf(p) === APP ? S.files[baseOf(p)] : linux(S).files[p]);
  function fileSet(S, p, content) { if (parentOf(p) === APP) S.files[baseOf(p)] = content; else linux(S).files[p] = content; }
  function fileDel(S, p) { if (parentOf(p) === APP) delete S.files[baseOf(p)]; else delete linux(S).files[p]; delete linux(S).modes[p]; }
  const isDir = (S, p) => linux(S).dirs.includes(p);
  const exists = (S, p) => isDir(S, p) || fileGet(S, p) !== undefined;
  const ownerOf = (S, p) => (linux(S).owners || {})[p] || (p === HOME || p.startsWith(HOME + "/") ? "you" : "root");
  const modeOf = (S, p) => linux(S).modes[p] || (isDir(S, p) ? (p === "/tmp" ? "rwxrwxrwt" : "rwxr-xr-x") : "rw-r--r--");
  const writable = (S, p) => asRoot || p === "/tmp" || p.startsWith("/tmp/") || ownerOf(S, p) === "you";
  function children(S, dir) {
    const L = linux(S);
    const names = L.dirs.filter((d) => d !== dir && parentOf(d) === dir).map(baseOf);
    if (dir === APP) names.push(...Object.keys(S.files));
    names.push(...Object.keys(L.files).filter((f) => parentOf(f) === dir).map(baseOf));
    return [...new Set(names)].sort((a, b) => a.replace(/^\./, "").localeCompare(b.replace(/^\./, "")));
  }
  const tilde = (p) => (p === HOME ? "~" : p.startsWith(HOME + "/") ? "~" + p.slice(HOME.length) : p);

  let asRoot = false; // true while a "sudo ..." command runs

  function lsCmd(S, args, o) {
    const L = linux(S);
    const flags = args.filter((a) => a.startsWith("-")).join("");
    const long = flags.includes("l"), all = flags.includes("a");
    const targets = args.filter((a) => !a.startsWith("-"));
    const one = (p, shown) => {
      const dir = isDir(S, p), body = dir ? "" : fileGet(S, p) || "";
      return `${dir ? "d" : "-"}${modeOf(S, p)} ${dir ? 2 : 1} ${ownerOf(S, p)} ${ownerOf(S, p)} ${String(dir ? 4096 : body.length).padStart(5)} Oct 28 10:00 ${shown}`;
    };
    for (const t of targets.length ? targets : ["."]) {
      const p = resolvePath(L, t);
      if (!exists(S, p)) { o.err(`ls: cannot access '${t}': No such file or directory`); continue; }
      if (!isDir(S, p)) { o.say(long ? one(p, t) : t); continue; }
      let names = children(S, p).filter((n) => all || !n.startsWith("."));
      if (all) names = [".", "..", ...names];
      if (!names.length) continue;
      if (!long) { o.say(names.join("   ")); continue; }
      o.say(`total ${names.length * 4}`);
      for (const n of names) o.say(one(n === "." ? p : n === ".." ? parentOf(p) : p === "/" ? "/" + n : p + "/" + n, n));
    }
  }
  function catCmd(S, args, o, max) {
    const L = linux(S);
    const files = args.filter((a) => !a.startsWith("-"));
    if (!files.length) return o.err(`${max ? max.cmd : "cat"}: missing file operand`);
    for (const f of files) {
      const p = resolvePath(L, f);
      if (isDir(S, p)) { o.err(`${max ? max.cmd : "cat"}: ${f}: Is a directory`); continue; }
      const body = fileGet(S, p);
      if (body === undefined) { o.err(`${max ? max.cmd : "cat"}: ${f}: No such file or directory`); continue; }
      if (!asRoot && !modeOf(S, p).slice(6).includes("r") && ownerOf(S, p) !== "you") { o.err(`${max ? max.cmd : "cat"}: ${f}: Permission denied`); continue; }
      const lines = body.split("\n");
      o.say(!max ? body : (max.cmd === "head" ? lines.slice(0, max.n) : lines.slice(-max.n)).join("\n"));
    }
  }
  function chmodCmd(S, args, o) {
    const L = linux(S);
    const [mode, ...files] = args;
    if (!mode || !files.length) return o.err(`chmod: missing operand\nTry: chmod +x FILE`);
    for (const f of files) {
      const p = resolvePath(L, f);
      if (!exists(S, p)) { o.err(`chmod: cannot access '${f}': No such file or directory`); continue; }
      if (!asRoot && ownerOf(S, p) !== "you") { o.err(`chmod: changing permissions of '${f}': Operation not permitted`); continue; }
      let bits = modeOf(S, p).split("");
      if (/^[0-7]{3}$/.test(mode)) {
        bits = mode.split("").flatMap((d) => [(d & 4 ? "r" : "-"), (d & 2 ? "w" : "-"), (d & 1 ? "x" : "-")]);
      } else {
        const m = mode.match(/^([ugoa]*)([+-=])([rwx]+)$/);
        if (!m) { o.err(`chmod: invalid mode: '${mode}'`); return; }
        const who = (m[1] || "a").replace("a", "ugo");
        for (const w of who) {
          const base = { u: 0, g: 3, o: 6 }[w];
          ["r", "w", "x"].forEach((perm, k) => {
            if (m[2] === "=") bits[base + k] = m[3].includes(perm) ? perm : "-";
            else if (m[3].includes(perm)) bits[base + k] = m[2] === "+" ? perm : "-";
          });
        }
      }
      L.modes[p] = bits.join("");
    }
  }
  function runScript(S, path, viaShell, o) {
    const L = linux(S);
    const p = resolvePath(L, path);
    const body = fileGet(S, p);
    if (body === undefined) return o.err(`bash: ${path}: No such file or directory`);
    if (!viaShell && !modeOf(S, p)[2].includes("x")) return o.err(`bash: ${path}: Permission denied`).note(`(the file has no x (execute) permission. Check with ls -l)`);
    body.split("\n").some((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return false;
      const m = t.match(/^echo\s+["']?(.*?)["']?$/);
      if (m) { o.say(m[1]); return false; }
      const inner = Out();
      shell(S, t, inner);
      inner.lines.forEach((l) => o.lines.push(l.c === "err" ? { t: `${path}: line ${i + 1}: ${l.t.replace(/^bash: /, "")}`, c: "err" } : l));
      if (!inner.ok) o.ok = false;
      return !inner.ok;
    });
  }
  function procTable(S) {
    const L = linux(S);
    const docker = S.hosts.local.containers.filter((c) => c.status === "running").flatMap((c) => c.ports.map((p, i) => ({ pid: 9100 + i + c.id.charCodeAt(0), user: "root", cmd: `/usr/bin/docker-proxy -host-port ${p.host} -container-port ${p.container}`, name: "docker-proxy", port: p.host })));
    return [...L.procs, ...docker];
  }
  function psCmd(S, o) {
    const rows = procTable(S).map((p) => [p.user, String(p.pid), (p.name === "node" ? "2.1" : "0.0"), (p.name === "dockerd" ? "1.4" : "0.3"), p.cmd]);
    o.say(table([["USER", "PID", "%CPU", "%MEM", "COMMAND"], ...rows], 4));
  }
  function ssCmd(S, o) {
    const rows = procTable(S).filter((p) => p.port).map((p) => ["LISTEN", "0", "4096", `0.0.0.0:${p.port}`, "0.0.0.0:*", asRoot || p.user === "you" ? `users:(("${p.name}",pid=${p.pid},fd=18))` : ""]);
    o.say(table([["State", "Recv-Q", "Send-Q", "Local Address:Port", "Peer Address:Port", "Process"], ...rows], 2));
    if (!asRoot && rows.some((r) => !r[5])) o.note("(processes owned by root are hidden. Use sudo to see them)");
  }
  function lsofCmd(S, args, o) {
    const m = args.join(" ").match(/:(\d+)/);
    const list = procTable(S).filter((p) => p.port && (!m || p.port === +m[1]) && (asRoot || p.user === "you"));
    if (!list.length) { o.ok = false; return; } // real lsof: prints nothing, exit 1
    o.say(table([["COMMAND", "PID", "USER", "FD", "TYPE", "NODE", "NAME"], ...list.map((p) => [p.name, String(p.pid), p.user, "18u", "IPv4", "TCP", `*:${p.port} (LISTEN)`])], 2));
  }
  function killCmd(S, args, o) {
    const L = linux(S);
    const pids = args.filter((a) => /^\d+$/.test(a));
    if (!pids.length) return o.err("kill: usage: kill [-s sigspec | -n signum | -sigspec] pid");
    for (const id of pids) {
      const p = L.procs.find((x) => x.pid === +id);
      if (!p) { o.err(`bash: kill: (${id}) - No such process`); continue; }
      if (p.user !== "you" && !asRoot) { o.err(`bash: kill: (${id}) - Operation not permitted`); continue; }
      if (p.pid === 1 || p.name === "bash") { o.note(`(the simulator won't let you kill ${p.name}: that would end your session)`); continue; }
      L.procs = L.procs.filter((x) => x !== p);
    }
  }
  function aptCmd(S, args, o) {
    const L = linux(S);
    const [sub, ...rest] = args.filter((a) => a !== "-y");
    if (sub === "update") {
      if (!asRoot) return o.say("Reading package lists... Done").err("E: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\nE: Unable to lock directory /var/lib/apt/lists/");
      return o.say("Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease\nGet:2 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]\nFetched 126 kB in 1s (148 kB/s)\nReading package lists... Done\nAll packages are up to date.");
    }
    if (sub === "install") {
      if (!rest.length) return o.err("E: No packages given. Try: sudo apt install tree");
      if (!asRoot) return o.err("E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?");
      const bad = rest.find((n) => !PKGS[n]);
      if (bad) return o.say("Reading package lists... Done\nBuilding dependency tree... Done").err(`E: Unable to locate package ${bad}`);
      const fresh = rest.filter((n) => !L.pkgs.includes(n));
      o.say("Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done");
      rest.filter((n) => L.pkgs.includes(n)).forEach((n) => o.say(`${n} is already the newest version (${PKGS[n]}).`));
      if (fresh.length) {
        o.say(`The following NEW packages will be installed:\n  ${fresh.join(" ")}\n0 upgraded, ${fresh.length} newly installed, 0 to remove and 0 not upgraded.`);
        fresh.forEach((n) => o.dim(`Get:1 http://archive.ubuntu.com/ubuntu noble/universe amd64 ${n} amd64 ${PKGS[n]} [47.9 kB]`));
        fresh.forEach((n) => o.dim(`Setting up ${n} (${PKGS[n]}) ...`));
        L.pkgs.push(...fresh);
      }
      return;
    }
    if (sub === "remove") {
      if (!asRoot) return o.err("E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?");
      rest.forEach((n) => { L.pkgs = L.pkgs.filter((x) => x !== n); o.say(`Removing ${n} ...`); });
      return;
    }
    if (sub === "list") return o.say(L.pkgs.map((n) => `${n}/noble,now ${PKGS[n]} amd64 [installed]`).join("\n") || "Listing... Done");
    o.say("apt 2.7.14 (amd64)\nUsage: apt [options] command\n\nMost used commands:\n  update   - refresh the list of available packages\n  install  - install packages\n  remove   - remove packages\n  list     - list packages");
  }
  function treeCmd(S, args, o) {
    const L = linux(S);
    const root = resolvePath(L, args.find((a) => !a.startsWith("-")) || ".");
    if (!isDir(S, root)) return o.err(`${args[0]} [error opening dir]`);
    const out = [args.find((a) => !a.startsWith("-")) || "."];
    let dirs = 0, files = 0;
    const walk = (p, pre, depth) => {
      const kids = children(S, p).filter((n) => !n.startsWith("."));
      kids.forEach((n, i) => {
        const last = i === kids.length - 1, full = p === "/" ? "/" + n : p + "/" + n;
        out.push(`${pre}${last ? "└── " : "├── "}${n}`);
        if (isDir(S, full)) { dirs++; if (depth < 2) walk(full, pre + (last ? "    " : "│   "), depth + 1); } else files++;
      });
    };
    walk(root, "", 1);
    o.say(out.join("\n") + `\n\n${dirs} director${dirs === 1 ? "y" : "ies"}, ${files} file${files === 1 ? "" : "s"}`);
  }

  // ---------------------------------------------------------------- shell
  function shell(S, line, o) {
    if (S.host === "local") {
      const env = linux(S).env;
      line = line.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, k) => env[k] ?? "");
    }
    const argv = tokenize(line);
    const [cmd, ...args] = argv;
    const local = S.host === "local";
    const L = local ? linux(S) : null;
    if (local && cmd && /^(\.{0,2}\/|~\/)/.test(cmd) && !["cd"].includes(cmd)) return runScript(S, cmd, false, o);
    switch (cmd) {
      case "docker": return docker(S, args, o);
      case "kubectl": case "k": return kubectl(S, args, o);
      case "kind": return local ? kind(S, args, o) : o.err("kind: command not found");
      case "ls": return local ? lsCmd(S, args, o) : undefined;
      case "cat": return local ? catCmd(S, args, o) : o.err(`cat: ${args[0] || ""}: No such file or directory`);
      case "head": case "tail": {
        if (!local) return o.err(`${cmd}: cannot open '${args[0] || ""}' for reading: No such file or directory`);
        const n = args.includes("-n") ? parseInt(args[args.indexOf("-n") + 1], 10) || 10 : (args.find((a) => /^-\d+$/.test(a)) ? +args.find((a) => /^-\d+$/.test(a)).slice(1) : 10);
        catCmd(S, args.filter((a, i) => a !== "-n" && args[i - 1] !== "-n" && !/^-/.test(a)), o, { cmd, n });
        if (cmd === "tail" && args.includes("-f")) o.note("(following new lines... in real life press Ctrl+C to stop)");
        return;
      }
      case "pwd": return o.say(local ? L.cwd : "/home/deploy");
      case "whoami": return o.say(asRoot ? "root" : local ? "you" : "deploy");
      case "id": return o.say(asRoot ? "uid=0(root) gid=0(root) groups=0(root)" : local ? "uid=1000(you) gid=1000(you) groups=1000(you),27(sudo),984(docker)" : "uid=1001(deploy) gid=1001(deploy) groups=1001(deploy),27(sudo)");
      case "hostname": return o.say(local ? "laptop" : "my-vps");
      case "uname": return o.say(args.includes("-a") ? `Linux ${local ? "laptop" : "my-vps"} 6.8.0-45-generic #45-Ubuntu SMP x86_64 GNU/Linux` : "Linux");
      case "echo": {
        const r = args.findIndex((a) => a === ">" || a === ">>");
        if (r === -1 || !local) return o.say(args.join(" "));
        const text = args.slice(0, r).join(" "), target = args[r + 1];
        if (!target) return o.err("bash: syntax error near unexpected token `newline'");
        const p = resolvePath(L, target);
        if (isDir(S, p)) return o.err(`bash: ${target}: Is a directory`);
        if (!isDir(S, parentOf(p))) return o.err(`bash: ${target}: No such file or directory`);
        if (!writable(S, exists(S, p) ? p : parentOf(p))) return o.err(`bash: ${target}: Permission denied`);
        const old = fileGet(S, p);
        return fileSet(S, p, args[r] === ">>" && old ? old + "\n" + text : text);
      }
      case "cd": {
        if (!local) return args[0] && !["~", ".", ".."].includes(args[0]) ? o.err(`cd: ${args[0]}: No such file or directory`) : undefined;
        const target = args[0] === "-" ? L.prev : resolvePath(L, args[0]);
        if (!exists(S, target)) return o.err(`bash: cd: ${args[0]}: No such file or directory`);
        if (!isDir(S, target)) return o.err(`bash: cd: ${args[0]}: Not a directory`);
        if (args[0] === "-") o.say(target);
        L.prev = L.cwd; L.cwd = target; L.env.PWD = target;
        return;
      }
      case "mkdir": {
        if (!local) return;
        const parents = args.includes("-p");
        const names = args.filter((a) => !a.startsWith("-"));
        if (!names.length) return o.err("mkdir: missing operand");
        for (const n of names) {
          const p = resolvePath(L, n);
          if (exists(S, p)) { if (!parents) o.err(`mkdir: cannot create directory '${n}': File exists`); continue; }
          const chain = [];
          for (let q = p; !exists(S, q); q = parentOf(q)) chain.unshift(q);
          if (chain.length > 1 && !parents) { o.err(`mkdir: cannot create directory '${n}': No such file or directory`); continue; }
          if (!writable(S, parentOf(chain[0]))) { o.err(`mkdir: cannot create directory '${n}': Permission denied`); continue; }
          L.dirs.push(...chain);
        }
        return;
      }
      case "touch": {
        if (!local) return;
        for (const n of args.filter((a) => !a.startsWith("-"))) {
          const p = resolvePath(L, n);
          if (exists(S, p)) continue;
          if (!isDir(S, parentOf(p))) { o.err(`touch: cannot touch '${n}': No such file or directory`); continue; }
          if (!writable(S, parentOf(p))) { o.err(`touch: cannot touch '${n}': Permission denied`); continue; }
          fileSet(S, p, "");
        }
        return;
      }
      case "rm": {
        if (!local) return;
        const flags = args.filter((a) => a.startsWith("-")).join("");
        const rec = /r|R/.test(flags), force = flags.includes("f");
        const names = args.filter((a) => !a.startsWith("-"));
        if (!names.length) return o.err("rm: missing operand");
        for (const n of names) {
          const p = resolvePath(L, n);
          if (p === "/" || p === HOME) { o.err(`rm: it is dangerous to operate recursively on '${n}'\nrm: use --no-preserve-root to override this failsafe`).note("(the simulator is not letting you do that one 😅)"); continue; }
          if (!exists(S, p)) { if (!force) o.err(`rm: cannot remove '${n}': No such file or directory`); continue; }
          if (!writable(S, parentOf(p))) { o.err(`rm: cannot remove '${n}': Permission denied`); continue; }
          if (isDir(S, p)) {
            if (!rec) { o.err(`rm: cannot remove '${n}': Is a directory`); continue; }
            if (p === APP) { o.err(`rm: refusing to remove '${n}': the course needs this folder`).note("(in real life this would be gone for good)"); continue; }
            L.dirs = L.dirs.filter((d) => d !== p && !d.startsWith(p + "/"));
            Object.keys(L.files).filter((f) => f.startsWith(p + "/")).forEach((f) => delete L.files[f]);
          } else fileDel(S, p);
        }
        return;
      }
      case "cp": case "mv": {
        if (!local) return;
        const [a, b] = args.filter((x) => !x.startsWith("-"));
        if (!a || !b) return o.err(`${cmd}: missing file operand`);
        const src = resolvePath(L, a);
        let dst = resolvePath(L, b);
        if (!exists(S, src)) return o.err(`${cmd}: cannot stat '${a}': No such file or directory`);
        if (isDir(S, src)) return o.err(`${cmd}: -r not specified; omitting directory '${a}'`).note("(the simulator copies and moves files only)");
        if (isDir(S, dst)) dst = dst + "/" + baseOf(src);
        if (!isDir(S, parentOf(dst))) return o.err(`${cmd}: cannot create regular file '${b}': No such file or directory`);
        if (!writable(S, parentOf(dst))) return o.err(`${cmd}: cannot create regular file '${b}': Permission denied`);
        fileSet(S, dst, fileGet(S, src));
        if (L.modes[src]) L.modes[dst] = L.modes[src];
        if (cmd === "mv") fileDel(S, src);
        return;
      }
      case "chmod": return local ? chmodCmd(S, args, o) : undefined;
      case "sh": case "bash": return local && args[0] ? runScript(S, args[0], true, o) : o.note("(you are already in a shell)");
      case "ps": return local ? psCmd(S, o) : o.say("    PID TTY          TIME CMD\n   1201 pts/0    00:00:00 bash");
      case "kill": return local ? killCmd(S, args, o) : o.err("bash: kill: no such process");
      case "ss": case "netstat": return local ? ssCmd(S, o) : undefined;
      case "lsof": return local ? lsofCmd(S, args, o) : undefined;
      case "env": case "printenv": {
        if (!local) return o.say("USER=deploy\nHOME=/home/deploy\nSHELL=/bin/bash");
        if (args[0]) return L.env[args[0]] !== undefined ? o.say(L.env[args[0]]) : (o.ok = false);
        return o.say(Object.entries(L.env).map(([k, v]) => `${k}=${v}`).join("\n"));
      }
      case "export": {
        if (!local) return;
        if (!args.length) return o.say(Object.entries(L.env).map(([k, v]) => `declare -x ${k}="${v}"`).join("\n"));
        for (const a of args) {
          const m = a.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/);
          if (!m) { o.err(`bash: export: \`${a}': not a valid identifier`); continue; }
          if (m[2] !== undefined) L.env[m[1]] = m[2];
          else if (L.env[m[1]] === undefined) L.env[m[1]] = "";
        }
        return;
      }
      case "unset": if (local) args.forEach((k) => delete L.env[k]); return;
      case "apt": case "apt-get": return local ? aptCmd(S, args, o) : o.err("E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)");
      case "apk": return o.err("bash: apk: command not found").note("(apk is the package manager of Alpine Linux, which many Docker images use. This machine is Ubuntu: use apt)");
      case "tree": return local && L.pkgs.includes("tree") ? treeCmd(S, args, o) : o.err(`Command 'tree' not found, but can be installed with:\nsudo apt install tree`);
      case "jq": {
        if (!(local && L.pkgs.includes("jq"))) return o.err("bash: jq: command not found");
        const file = args.filter((a) => !a.startsWith("-")).pop(), key = (args.find((a) => /^\.\w+/.test(a)) || "").slice(1);
        const body = file && fileGet(S, resolvePath(L, file));
        if (body === undefined) return o.err(`jq: error: Could not open ${file}: No such file or directory`);
        try { const v = JSON.parse(body)[key]; return o.say(v === undefined ? "null" : String(v)); } catch { return o.err("jq: error: input is not valid JSON"); }
      }
      case "htop": case "git": case "vim": case "nano": case "python3": case "node":
        return local && L.pkgs.includes(cmd === "node" ? "nodejs" : cmd) ? o.note(`(${cmd} would run here in real life)`) : o.err(`Command '${cmd}' not found, but can be installed with:\nsudo apt install ${cmd === "node" ? "nodejs" : cmd}`);
      case "which": {
        for (const a of args) {
          if (BUILTIN_CMDS.includes(a) || (local && L.pkgs.includes(a === "node" ? "nodejs" : a))) o.say(`/usr/bin/${a}`);
          else o.ok = false;
        }
        return;
      }
      case "history": return o.say(S.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join("\n"));
      case "ssh": {
        const target = args.find((a) => !a.startsWith("-"));
        if (!target) return o.err("usage: ssh [-p port] [user@]hostname");
        if (S.host === "vps") return o.err("(you are already on the server)");
        if (!/my-vps/.test(target)) return o.err(`ssh: Could not resolve hostname ${target.split("@").pop()}: Name or service not known\n(hint: the practice server is called my-vps)`);
        S.host = "vps";
        return o.say(`Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)\n\n  System load:  0.08    Memory usage: 12%    Disk: 9% of 48GB\n\nLast login: Tue Oct 27 18:22:10 2026 from 203.0.113.7`);
      }
      case "exit": case "logout":
        if (S.host === "vps") { S.host = "local"; return o.say("logout\nConnection to my-vps closed."); }
        return o.note("(this is your own laptop, there is nothing to exit from)");
      case "curl": {
        if (line.includes("get.docker.com") && /\|\s*(sudo\s+)?sh\b/.test(line)) {
          const E = engine(S);
          if (E.installed) return o.say("# Warning: the \"docker\" command appears to already exist on this system.");
          E.installed = true;
          return o.say(`# Executing docker install script, commit: 6d51e2c\n+ sh -c apt-get -qq update >/dev/null\n+ sh -c DEBIAN_FRONTEND=noninteractive apt-get -y -qq install ca-certificates curl >/dev/null\n+ sh -c install -m 0755 -d /etc/apt/keyrings\n+ sh -c apt-get -qq update >/dev/null\n+ sh -c DEBIAN_FRONTEND=noninteractive apt-get -y -qq install docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin >/dev/null\n+ sh -c docker version`).good(`\nDocker Engine 27.3.1 installed.`);
        }
        const url = args.find((a) => /^https?:\/\//.test(a) || /localhost/.test(a));
        if (url && /localhost:(\d+)/.test(url)) {
          const port = parseInt(url.match(/localhost:(\d+)/)[1], 10);
          const c = engine(S).containers.find((x) => x.status === "running" && x.ports.some((p) => p.host === port));
          if (!c) {
            const proc = S.host === "local" && linux(S).procs.find((x) => x.port === port);
            if (proc) return o.say(`Hello from ${proc.cmd} (pid ${proc.pid}) on port ${port}`);
            return o.err(`curl: (7) Failed to connect to localhost port ${port} after 0 ms: Couldn't connect to server`);
          }
          const mapped = c.ports.find((p) => p.host === port);
          if (LISTEN[c.kind] && mapped.container !== LISTEN[c.kind]) return o.err(`curl: (56) Recv failure: Connection reset by peer`);
          if (c.kind === "api") return o.say(`{"status":"ok","orders":1284}`);
          if (c.kind === "nginx") return o.say(`<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n...`);
          if (c.kind === "app") return o.say("Hello from a container!");
          return o.say("(connected)");
        }
        return o.err("curl: (6) Could not resolve host (the simulator only reaches localhost and get.docker.com)");
      }
      case "sudo": {
        if (!args.length) return o.err("usage: sudo COMMAND");
        if (asRoot) return shell(S, line.replace(/^\s*sudo\s+/, ""), o);
        asRoot = true;
        try { return shell(S, line.replace(/^\s*sudo\s+/, ""), o); } finally { asRoot = false; }
      }
      default:
        return o.err(`${cmd}: command not found`);
    }
  }

  // ---------------------------------------------------------------- entry
  function exec(S, rawLine) {
    const line = rawLine.trim();
    const o = Out();
    const result = { line, lines: o.lines, ok: true, clear: false, argv: tokenize(line) };
    if (!line) return result;
    S.history.push(line);
    if (S.history.length > 200) S.history.shift();

    if (S.pending) {
      const p = S.pending;
      S.pending = null;
      if (/^y(es)?$/i.test(line)) {
        const E = engine(S);
        if (p.kind === "system-prune") doSystemPrune(E, o);
        else if (p.kind === "container-prune") dockerContainerPrune(S, E, ["-f"], o);
        else if (p.kind === "image-prune") doImagePrune(E, false, o);
        else if (p.kind === "image-prune-all") doImagePrune(E, true, o);
        else if (p.kind === "volume-prune") pruneVolumes(S, E, ["-f"], o);
        result.confirmed = p.kind;
      } else o.dim("(cancelled)");
      result.ok = o.ok;
      return result;
    }

    if (line === "clear" || line === "cls") { result.clear = true; return result; }
    if (line === "help") {
      o.say(`This is a practice terminal. It understands:\n  docker ...        containers, images, volumes, networks, compose\n  kubectl ...       pods, deployments, services, rollouts\n  kind ...          create a local Kubernetes cluster\n  ssh my-vps        log in to a practice server (exit to leave)\n  linux basics      ls cd pwd cat mkdir touch rm cp mv chmod\n                    ps kill ss lsof env export sudo apt\n  clear, history`);
      return result;
    }
    const grep = line.match(/^(.+?)\|\s*grep\s+(-i\s+)?["']?([^"'|]+?)["']?\s*$/);
    if (grep && !line.includes("get.docker.com")) {
      const inner = Out();
      shell(S, grep[1].trim(), inner);
      const needle = grep[2] ? grep[3].toLowerCase() : grep[3];
      inner.lines.filter((l) => (grep[2] ? l.t.toLowerCase() : l.t).includes(needle)).forEach((l) => o.lines.push(l));
      result.ok = inner.ok;
      result.argv = tokenize(grep[1]);
      return result;
    }
    if (line.includes("|") && !line.includes("get.docker.com")) {
      o.err("(pipes | are not supported in this practice terminal)");
      result.ok = false;
      return result;
    }
    const parts = line.includes("get.docker.com") ? [line] : line.split("&&").map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      shell(S, part, o);
      if (!o.ok) break;
    }
    result.ok = o.ok;
    result.argv = tokenize(parts[parts.length - 1] || "");
    return result;
  }

  window.Sim = {
    createState, exec, tokenize, normRef, engine,
    findContainer, CATALOG, netsOf,
    prompt(S) { return S.host === "local" ? { user: "you@laptop", path: tilde(linux(S).cwd) } : { user: "deploy@my-vps", path: "~" }; },
    linux,
    // Course lessons start in ~/app on the laptop.
    cdApp(S) { const L = linux(S); S.host = "local"; L.prev = L.cwd; L.cwd = APP; L.env.PWD = APP; },
    spawn(S, proc) { const L = linux(S); if (!L.procs.some((p) => p.pid === proc.pid)) L.procs.push(proc); },
    ensureImage(S, ref, host = "local") {
      const E = S.hosts[host];
      ref = normRef(ref);
      if (!E.images[ref]) {
        const meta = CATALOG[ref] || S.registry[ref] || { size: "164MB", mb: 164, kind: "app" };
        E.images[ref] = { id: hex(12), created: now() - 6e5, size: meta.size, mb: meta.mb, kind: meta.kind };
      }
    },
    reconcileAll(S) { if (S.k8s) Object.values(S.k8s.deployments).forEach((d) => reconcile(S.k8s, d)); },
  };
})();
