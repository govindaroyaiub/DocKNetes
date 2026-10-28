// Case studies: real-world problems, no step-by-step. Open any time (no module locks).
// Case: { id, ticket, priority, from, title, level, tags, story, symptoms[], setup(S),
//         check(S) -> solved?, fail?(S) -> message if the sandbox is ruined,
//         clues[] (last one is the full fix), fix[] (commands), cause (shown when solved), refs[] }
(function () {
  const run = (S, ...cmds) => { for (const c of cmds) { Sim.exec(S, c); if (S.pending) Sim.exec(S, "y"); } S.history = []; };
  const L = (S) => S.hosts.local;
  const up = (S, name) => L(S).containers.find((c) => c.name === name && c.status === "running");
  const hasPort = (c, host, container) => c && c.ports.some((p) => p.host === host && p.container === container);

  window.CASES = [
    {
      id: "port-clash",
      ticket: "INC-1041", priority: "P1", from: "Release team",
      title: "The new version won't start",
      level: "Easy", tags: ["ports", "ps", "rm"],
      story: "We're releasing the new shop. The image <code>shop/web:2.0</code> must run as <code>shop-web</code> on port <b>8080</b>, but every time we start it, Docker refuses.",
      symptoms: ["<code>docker run -d -p 8080:80 --name shop-web shop/web:2.0</code> fails", "The old site still answers on 8080"],
      setup: (S) => run(S, "docker run -d -p 8080:80 --name old-web shop/web:1.0"),
      check: (S) => { const c = up(S, "shop-web"); return !!c && c.image === "shop/web:2.0" && hasPort(c, 8080, 80); },
      clues: [
        "Try the release command yourself and read the error. Which port does it complain about?",
        "Only one container can own port 8080. <code>docker ps</code> shows who has it.",
        "Remove the old container, then start the new one.",
      ],
      fix: ["docker rm -f old-web", "docker run -d -p 8080:80 --name shop-web shop/web:2.0"],
      cause: "An old container was still holding port 8080. A port on your machine can only point at one container, so the new one couldn't start until the old one was removed.",
      refs: [["Publishing ports", "https://docs.docker.com/engine/network/#published-ports"], ["docker ps", "https://docs.docker.com/reference/cli/docker/container/ls/"]],
    },
    {
      id: "wrong-door",
      ticket: "INC-1042", priority: "P2", from: "Support desk",
      title: "It's running, but nobody can open it",
      level: "Easy", tags: ["ports", "curl", "run"],
      story: "<code>docker ps</code> says our <code>web</code> container (nginx) is Up, but <code>http://localhost:8080</code> doesn't load for anyone.",
      symptoms: ["Container status: Up", "<code>curl http://localhost:8080</code>: connection reset"],
      setup: (S) => run(S, "docker run -d -p 8080:8080 --name web nginx"),
      check: (S) => { const c = up(S, "web"); return !!c && c.kind === "nginx" && hasPort(c, 8080, 80); },
      clues: [
        "Look at the PORTS column in <code>docker ps</code>. The right side is the port <i>inside</i> the box.",
        "nginx listens on port <b>80</b> inside its container, not 8080.",
        "Recreate <code>web</code> with the right mapping: your 8080 → box 80.",
      ],
      fix: ["docker rm -f web", "docker run -d -p 8080:80 --name web nginx"],
      cause: "The port mapping pointed at the wrong door: 8080 → 8080. nginx listens on 80 inside the box, so the right mapping is <code>-p 8080:80</code>. Left side = your machine, right side = the container.",
      refs: [["Publishing ports", "https://docs.docker.com/engine/network/#published-ports"], ["nginx image", "https://hub.docker.com/_/nginx"]],
    },
    {
      id: "db-crash",
      ticket: "INC-1043", priority: "P2", from: "Backend team",
      title: "The database keeps stopping",
      level: "Easy", tags: ["logs", "-e", "mysql"],
      story: "Our dev database <code>db</code> (mysql:8.4, data in volume <code>dbdata</code>) stops a second after we start it. Nobody knows why.",
      symptoms: ["<code>docker ps</code> doesn't show <code>db</code>", "<code>docker ps -a</code>: Exited (1)"],
      setup: (S) => run(S, "docker volume create dbdata", "docker run -d --name db -v dbdata:/var/lib/mysql mysql:8.4"),
      check: (S) => { const c = up(S, "db"); return !!c && c.kind === "mysql"; },
      clues: [
        "A container that exits right away almost always explains itself. Read its logs.",
        "The logs list settings MySQL needs. Settings are passed with <code>-e KEY=VALUE</code>.",
        "Remove <code>db</code> and run it again with <code>MYSQL_ROOT_PASSWORD</code>, keeping the volume.",
      ],
      fix: ["docker logs db", "docker rm db", "docker run -d --name db -e MYSQL_ROOT_PASSWORD=secret -v dbdata:/var/lib/mysql mysql:8.4"],
      cause: "MySQL refuses to start the first time without a root password. The container exited with code 1 and the reason was right there in <code>docker logs</code>.",
      refs: [["docker logs", "https://docs.docker.com/reference/cli/docker/container/logs/"], ["mysql image settings", "https://hub.docker.com/_/mysql"]],
    },
    {
      id: "lost-orders",
      ticket: "INC-1044", priority: "P1", from: "Shop owner",
      title: "Every deploy deletes our orders",
      level: "Medium", tags: ["volumes", "-v", "postgres"],
      story: "Each time we redeploy <code>orders-db</code> (postgres:16), all orders vanish. Make the database keep its data in a volume called <code>orders-data</code>.",
      symptoms: ["Orders disappear after <code>docker rm</code> + <code>docker run</code>", "<code>docker volume ls</code> shows nothing for orders"],
      setup: (S) => run(S, "docker run -d --name orders-db -e POSTGRES_PASSWORD=secret postgres:16"),
      check: (S) => { const c = up(S, "orders-db"); return !!c && c.kind === "postgres" && c.mounts.some((m) => m.type === "volume" && m.source === "orders-data" && m.target === "/var/lib/postgresql/data"); },
      clues: [
        "Data written inside a container dies with the container. Where should it live instead?",
        "Postgres keeps its data in <code>/var/lib/postgresql/data</code>. Plug a named volume in there with <code>-v NAME:PATH</code>.",
        "Recreate <code>orders-db</code> with the same password plus <code>-v orders-data:/var/lib/postgresql/data</code>.",
      ],
      fix: ["docker rm -f orders-db", "docker run -d --name orders-db -e POSTGRES_PASSWORD=secret -v orders-data:/var/lib/postgresql/data postgres:16"],
      cause: "The database stored everything inside the container. Removing the container removed the data. A named volume lives outside the container, so redeploys keep the orders.",
      refs: [["Volumes", "https://docs.docker.com/engine/storage/volumes/"], ["postgres image", "https://hub.docker.com/_/postgres"]],
    },
    {
      id: "api-db",
      ticket: "INC-1045", priority: "P1", from: "On-call engineer",
      title: "The API can't reach the database",
      level: "Medium", tags: ["networks", "logs", "-e"],
      story: "<code>shop-api</code> (image <code>shop/api:1.0</code>, port 3000) crashes on start. The database <code>shop-db</code> is running fine. The API finds its database through the <code>DB_HOST</code> setting.",
      symptoms: ["<code>shop-api</code>: Exited (1)", "<code>curl http://localhost:3000</code> fails"],
      setup: (S) => run(S, "docker run -d --name shop-db -e POSTGRES_PASSWORD=secret postgres:16", "docker run -d --name shop-api -e DB_HOST=localhost -p 3000:3000 shop/api:1.0"),
      check: (S) => { const c = up(S, "shop-api"); return !!c && hasPort(c, 3000, 3000); },
      clues: [
        "Read <code>shop-api</code>'s logs. Which address is it trying to reach?",
        "Inside a container, <code>localhost</code> is the container itself. Containers find each other <b>by name</b>, but only on a network you create.",
        "Create a network, connect <code>shop-db</code> to it, then rerun <code>shop-api</code> on that network with <code>DB_HOST=shop-db</code>.",
      ],
      fix: ["docker network create shopnet", "docker network connect shopnet shop-db", "docker rm shop-api", "docker run -d --name shop-api --network shopnet -e DB_HOST=shop-db -p 3000:3000 shop/api:1.0"],
      cause: "The API looked for the database at <code>localhost</code>, which inside a container means the API's own box. Putting both on a user network and using the database's name (<code>shop-db</code>) fixed it.",
      refs: [["Networking", "https://docs.docker.com/engine/network/"], ["docker network connect", "https://docs.docker.com/reference/cli/docker/network/connect/"]],
    },
    {
      id: "disk-full",
      ticket: "INC-1046", priority: "P2", from: "Monitoring alert",
      title: "Server disk at 97%",
      level: "Easy", tags: ["system df", "prune"],
      story: "The build server is almost out of disk. Clean up Docker's junk, <b>but</b> keep the running <code>prod-db</code> and the <code>prod-backups</code> volume.",
      symptoms: ["Lots of old stopped containers", "Old unnamed images from builds"],
      setup: (S) => {
        run(S, "docker run -d --name prod-db -e POSTGRES_PASSWORD=secret -v prod-data:/var/lib/postgresql/data postgres:16", "docker volume create prod-backups");
        for (let i = 1; i <= 9; i++) run(S, `docker run --name build-job-${i} alpine echo done`);
        const E = L(S);
        for (let i = 0; i < 4; i++) E.images[`<none>:<none>#${i}${Date.now()}`] = { id: Math.random().toString(16).slice(2, 14), created: Date.now() - 864e5 * (i + 2), size: "1.2GB", mb: 1200, kind: "app" };
      },
      check: (S) => {
        const E = L(S);
        return !E.containers.some((c) => c.status !== "running") && !Object.keys(E.images).some((r) => r.startsWith("<none>")) && !!up(S, "prod-db") && !!E.volumes["prod-backups"];
      },
      fail: (S) => (!L(S).volumes["prod-backups"] ? "You deleted the prod-backups volume. That was real data! Reset the case and clean up without touching volumes." : !L(S).containers.some((c) => c.name === "prod-db") ? "prod-db is gone. Reset the case and only remove junk." : null),
      clues: [
        "First measure: <code>docker system df</code> shows what's taking space.",
        "<code>docker system prune</code> removes stopped containers, unused networks and dangling images, and leaves volumes alone.",
        "Run <code>docker system prune</code> and answer <code>y</code>. Don't prune volumes.",
      ],
      fix: ["docker system df", "docker system prune", "y"],
      cause: "Old build containers and unnamed images piled up. <code>docker system prune</code> cleared them safely. Pruning volumes too would have deleted <code>prod-backups</code>.",
      refs: [["docker system prune", "https://docs.docker.com/reference/cli/docker/system/prune/"], ["Prune unused objects", "https://docs.docker.com/engine/manage-resources/pruning/"]],
    },
    {
      id: "bad-deploy",
      ticket: "INC-1047", priority: "P1", from: "On-call engineer",
      title: "Friday deploy broke production",
      level: "Medium", tags: ["kubectl", "describe", "rollout"],
      story: "Someone updated the Kubernetes deployment <code>shop</code> on Friday afternoon. Since then the new pods never start. Get the shop healthy again.",
      symptoms: ["New pods stuck, not Running", "Started right after an image update"],
      setup: (S) => run(S, "kind create cluster --name prod", "kubectl create deployment shop --image=nginx:1.27-alpine --replicas=3", "kubectl expose deployment shop --port=80", "kubectl set image deployment/shop nginx=nginx:1.27-alpne"),
      check: (S) => {
        const K = S.k8s, d = K && K.deployments.shop;
        if (!d || !Sim.CATALOG[Sim.normRef(d.image)]) return false;
        const pods = K.pods.filter((p) => p.deploy === "shop");
        return pods.length === d.replicas && pods.every((p) => p.status === "Running");
      },
      clues: [
        "<code>kubectl get pods</code>: what status do the shop pods have?",
        "<code>kubectl describe pod</code> on one of them. The Events at the bottom name the image it can't pull. Look closely at the spelling.",
        "Fastest fix: roll back to the last working version with <code>kubectl rollout undo</code>.",
      ],
      fix: ["kubectl get pods", "kubectl rollout undo deployment/shop"],
      cause: "The image tag had a typo (<code>1.27-alpne</code>), so Kubernetes couldn't pull it: <code>ImagePullBackOff</code>. Rolling back restored the previous, working image.",
      refs: [["Debug pods", "https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/"], ["Rolling back a deployment", "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-back-a-deployment"]],
    },
    {
      id: "black-friday",
      ticket: "INC-1048", priority: "P1", from: "Product manager",
      title: "Black Friday traffic is coming",
      level: "Easy", tags: ["kubectl", "scale", "expose"],
      story: "Traffic will be 5× tonight. The <code>shop</code> deployment runs a single pod and has no stable address. Run at least <b>5</b> copies behind a Service on port <b>80</b>.",
      symptoms: ["<code>shop</code>: 1/1 ready", "No Service called <code>shop</code>"],
      setup: (S) => run(S, "kind create cluster --name prod", "kubectl create deployment shop --image=nginx:1.27 --replicas=1"),
      check: (S) => { const K = S.k8s; return !!K && !!K.deployments.shop && K.deployments.shop.replicas >= 5 && !!K.services.shop; },
      clues: [
        "Two jobs: more copies, and one address in front of them.",
        "<code>kubectl scale</code> changes the number of copies. <code>kubectl expose</code> creates a Service.",
        "Scale <code>shop</code> to 5 replicas and expose it on port 80.",
      ],
      fix: ["kubectl scale deployment shop --replicas=5", "kubectl expose deployment shop --port=80"],
      cause: "One pod can't take 5× traffic and nothing spread the load. Scaling made 5 copies; the Service gave them one stable address that shares traffic between them.",
      refs: [["Scaling a deployment", "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#scaling-a-deployment"], ["Services", "https://kubernetes.io/docs/concepts/services-networking/service/"]],
    },
  ];
})();
