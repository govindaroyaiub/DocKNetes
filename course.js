// The course. Modules unlock in order; lessons and missions too.
// Mission: { goal, hint, answer, check(r, S) } where r = result of the last command
// ({ line, argv, ok }) and S = simulator state. Checks look at the RESULT, so any
// correct way of writing the command passes.
(function () {
  const E = (S) => S.hosts[S.host];
  const local = (S) => S.hosts.local;
  const cmdIs = (r, ...words) => r.ok && words.every((w, i) => r.argv[i] === w);
  const has = (r, flag) => r.argv.includes(flag);
  const running = (S, name, host = "local") => S.hosts[host].containers.find((c) => c.name === name && c.status === "running");
  const exists = (S, name, host = "local") => S.hosts[host].containers.find((c) => c.name === name);
  const L = (S) => Sim.linux(S);
  const flagsOf = (r) => r.argv.slice(1).filter((a) => a.startsWith("-")).join("");
  const said = (r, text) => r.lines.some((l) => l.t.trim() === text);
  const STRAY = { pid: 4821, user: "you", cmd: "node server.js", name: "node", port: 3000 };

  window.COURSE = [
    // ================================================================ 0 · optional warm-up, always open
    {
      id: "linux",
      title: "Linux Survival Kit",
      tag: "Linux",
      color: "purple",
      optional: true,
      blurb: "Just enough terminal to feel at home. Optional, open any time.",
      lessons: [
        {
          id: "navigate",
          title: "Find your way",
          read: "Everything lives in <b>folders</b> (directories). You are always <i>in</i> one of them. <code>~</code> is your home folder, <code>..</code> is one folder up, and files starting with a dot are <b>hidden</b>.",
          terms: [["pwd", "where am I?"], ["ls -la", "everything here"], ["cd", "move"]],
          docs: [["The Linux command line for beginners", "https://ubuntu.com/tutorials/command-line-for-beginners"]],
          setup: (S) => Sim.cdApp(S),
          missions: [
            { goal: "Where are you? Print the current folder.", hint: "print working directory", answer: "pwd",
              check: (r) => cmdIs(r, "pwd") },
            { goal: "List <b>everything</b> here, hidden files too, with details.", hint: "ls with two flags: l for long, a for all", answer: "ls -la",
              check: (r) => r.ok && r.argv[0] === "ls" && /l/.test(flagsOf(r)) && /a/.test(flagsOf(r)) },
            { goal: "Read the hidden settings file <code>.env</code>.", hint: "cat FILE", answer: "cat .env",
              check: (r) => r.ok && r.argv[0] === "cat" && r.argv.some((a) => /(^|\/)\.env$/.test(a)) },
            { goal: "Go up one folder, to your home.", hint: "cd and two dots", answer: "cd ..",
              check: (r, S) => r.ok && L(S).cwd === "/home/you" },
            { goal: "Make a folder called <code>notes</code> in your home.", hint: "make directory", answer: "mkdir notes",
              check: (r, S) => L(S).dirs.includes("/home/you/notes") },
          ],
        },
        {
          id: "permissions",
          title: "Who can do what",
          read: "Every file has an owner and three sets of rights: <b>owner</b>, <b>group</b>, <b>everyone</b>. <code>r</code> read, <code>w</code> write, <code>x</code> run. <code>sudo</code> runs one command as the admin, <b>root</b>.",
          terms: [["-rwxr-xr-x", "owner · group · everyone"], ["chmod +x", "make it runnable"], ["sudo", "do it as admin"]],
          docs: [["chmod explained", "https://man7.org/linux/man-pages/man1/chmod.1.html"], ["sudo", "https://ubuntu.com/server/docs/user-management"]],
          setup: (S) => Sim.cdApp(S),
          missions: [
            { goal: "Who are you logged in as?", hint: "who am i, as one word", answer: "whoami",
              check: (r) => cmdIs(r, "whoami") },
            { goal: "Look at the rights on <code>deploy.sh</code>.", hint: "ls -l FILE", answer: "ls -l deploy.sh",
              check: (r) => r.ok && r.argv[0] === "ls" && /l/.test(flagsOf(r)) && r.argv.some((a) => a.endsWith("deploy.sh")) },
            { goal: "Run it: <code>./deploy.sh</code>. It will refuse. Read why.", hint: "./ means \"the file here\"", answer: "./deploy.sh",
              check: (r) => /(^|\/)deploy\.sh$/.test(r.argv[0] || "") },
            { goal: "Give it permission to run.", hint: "chmod +x FILE", answer: "chmod +x deploy.sh",
              check: (r, S) => /x/.test((L(S).modes["/home/you/app/deploy.sh"] || "")[2]) },
            { goal: "Run it again.", hint: "same as before", answer: "./deploy.sh",
              check: (r) => r.ok && said(r, "Deployed! 🚀") },
            { goal: "Read <code>/etc/shadow</code> (the password file). Only root may, so ask for admin rights.", hint: "put sudo in front of the command", answer: "sudo cat /etc/shadow",
              check: (r) => r.ok && r.argv[0] === "sudo" && r.argv.includes("/etc/shadow") },
          ],
        },
        {
          id: "processes",
          title: "Processes and ports",
          read: "Every running program is a <b>process</b> with a number, its <b>PID</b>. A server <b>listens</b> on a port, and two can't share one: that is the classic <i>\"port already in use\"</i>.",
          terms: [["ps aux", "all processes"], ["ss -tlnp", "who listens where"], ["kill PID", "stop one"]],
          docs: [["ps", "https://man7.org/linux/man-pages/man1/ps.1.html"], ["ss", "https://man7.org/linux/man-pages/man8/ss.8.html"]],
          setup: (S) => { Sim.cdApp(S); Sim.spawn(S, Object.assign({}, STRAY)); },
          missions: [
            { goal: "List every running process and pick out <code>node</code>.", hint: "ps aux, then | grep WORD keeps matching lines", answer: "ps aux | grep node",
              check: (r) => r.ok && r.argv[0] === "ps" },
            { goal: "Your app won't start: port <b>3000</b> is taken. Find who is listening on it.", hint: "ss -tlnp (or lsof -i :3000)", answer: "ss -tlnp",
              check: (r) => r.ok && ["ss", "netstat", "lsof"].includes(r.argv[0]) },
            { goal: "Stop that process with <code>kill</code> and its PID.", hint: "kill PID (the number from the last command)", answer: "kill 4821",
              check: (r, S) => !L(S).procs.some((p) => p.port === 3000) },
            { goal: "Check that port 3000 is free now.", hint: "curl http://localhost:PORT should fail to connect", answer: "curl http://localhost:3000",
              check: (r, S) => r.argv[0] === "curl" && /3000/.test(r.line) && !L(S).procs.some((p) => p.port === 3000) },
          ],
        },
        {
          id: "settings",
          title: "Settings and packages",
          read: "<b>Environment variables</b> are settings handed to programs: <code>PORT</code>, <code>DATABASE_URL</code>, <code>NODE_ENV</code>... Containers get theirs with <code>-e</code>. New tools come from a <b>package manager</b>: <code>apt</code> on Ubuntu and Debian, <code>apk</code> on Alpine (common in Docker images).",
          terms: [["export K=V", "set a variable"], ["$K", "use it"], ["apt install", "add a tool"]],
          docs: [["Environment variables", "https://help.ubuntu.com/community/EnvironmentVariables"], ["Package management", "https://ubuntu.com/server/docs/package-management"]],
          setup: (S) => Sim.cdApp(S),
          missions: [
            { goal: "Set <code>PORT</code> to <b>8080</b> for this terminal.", hint: "export NAME=VALUE (no spaces around =)", answer: "export PORT=8080",
              check: (r, S) => L(S).env.PORT === "8080" },
            { goal: "Print it.", hint: "echo $NAME", answer: "echo $PORT",
              check: (r) => r.ok && r.argv[0] === "echo" && said(r, "8080") },
            { goal: "List all variables. Spot <code>PORT</code> among them.", hint: "env", answer: "env",
              check: (r) => r.ok && ["env", "printenv", "export"].includes(r.argv[0]) && r.argv.length === 1 },
            { goal: "Try the <code>tree</code> command. It isn't installed yet.", hint: "just type tree", answer: "tree",
              check: (r) => r.argv[0] === "tree" },
            { goal: "Install it. Installing needs admin rights.", hint: "sudo apt install NAME", answer: "sudo apt install tree",
              check: (r, S) => L(S).pkgs.includes("tree") },
            { goal: "Run <code>tree</code> again.", hint: "tree", answer: "tree",
              check: (r, S) => r.ok && r.argv[0] === "tree" && L(S).pkgs.includes("tree") },
          ],
        },
      ],
    },
    // ================================================================ 1
    {
      id: "basics",
      title: "First Containers",
      tag: "Docker",
      color: "orange",
      blurb: "Run, watch, stop and delete containers.",
      lessons: [
        {
          id: "hello",
          title: "Hello, Docker",
          read: "Docker runs apps inside <b>containers</b>: sealed boxes with everything the app needs. A box is made from an <b>image</b> (the recipe).",
          terms: [["image", "the recipe"], ["container", "a running box"]],
          docs: [["What is Docker?", "https://docs.docker.com/get-started/docker-overview/"]],
          missions: [
            { goal: "Check that Docker is installed.", hint: "Ask docker for its version.", answer: "docker --version",
              check: (r) => r.ok && r.argv[0] === "docker" && (r.argv[1] === "--version" || r.argv[1] === "-v" || r.argv[1] === "version") },
            { goal: "Run your first container from the <code>hello-world</code> image.", hint: "docker run IMAGE", answer: "docker run hello-world",
              check: (r, S) => cmdIs(r, "docker", "run") && local(S).containers.some((c) => c.image === "hello-world:latest") },
            { goal: "It printed a message and stopped. List <b>all</b> containers, including stopped ones.", hint: "docker ps shows running ones only. Add a flag for all.", answer: "docker ps -a",
              check: (r) => cmdIs(r, "docker", "ps") && (has(r, "-a") || has(r, "--all")) || (cmdIs(r, "docker", "container", "ls") && (has(r, "-a") || has(r, "--all"))) },
          ],
        },
        {
          id: "webserver",
          title: "Run a web server",
          read: "<code>-d</code> runs in the background. <code>-p 8080:80</code> connects port 8080 on your computer to port 80 in the box. <code>--name</code> gives it a name you can type.",
          terms: [["-d", "background"], ["-p HOST:BOX", "open a door"], ["--name", "nickname"]],
          docs: [["docker run", "https://docs.docker.com/reference/cli/docker/container/run/"]],
          missions: [
            { goal: "Start <code>nginx</code> in the background, on port <b>8080</b>, named <code>web</code>.", hint: "docker run -d -p HOST:CONTAINER --name NAME nginx", answer: "docker run -d -p 8080:80 --name web nginx",
              check: (r, S) => { const c = running(S, "web"); return c && c.image.startsWith("nginx") && c.ports.some((p) => p.host === 8080 && p.container === 80); } },
            { goal: "Check it is running.", hint: "List running containers.", answer: "docker ps",
              check: (r) => cmdIs(r, "docker", "ps") || cmdIs(r, "docker", "container", "ls") },
            { goal: "Visit it from the terminal on port 8080.", hint: "curl http://localhost:PORT", answer: "curl http://localhost:8080",
              check: (r) => r.ok && r.argv[0] === "curl" && /localhost:8080/.test(r.line) },
            { goal: "Read the logs of <code>web</code>.", hint: "docker logs NAME", answer: "docker logs web",
              check: (r) => cmdIs(r, "docker", "logs") && r.argv.includes("web") },
          ],
        },
        {
          id: "lifecycle",
          title: "Stop, start, delete",
          read: "Stopping keeps the box around. Starting brings the same box back. Removing throws it away for good.",
          terms: [["stop", "pause it"], ["start", "wake it"], ["rm -f", "throw away"]],
          docs: [["docker stop", "https://docs.docker.com/reference/cli/docker/container/stop/"], ["docker rm", "https://docs.docker.com/reference/cli/docker/container/rm/"]],
          setup: (S) => {
            const L = local(S);
            if (!exists(S, "web")) { Sim.ensureImage(S, "nginx"); Sim.exec(S, "docker run -d -p 8080:80 --name web nginx"); S.history.pop(); }
            else if (!running(S, "web")) { Sim.exec(S, "docker start web"); S.history.pop(); }
            return L;
          },
          missions: [
            { goal: "Stop <code>web</code>.", hint: "docker stop NAME", answer: "docker stop web",
              check: (r, S) => exists(S, "web") && !running(S, "web") },
            { goal: "Start the same container again.", hint: "docker start NAME", answer: "docker start web",
              check: (r, S) => !!running(S, "web") },
            { goal: "Try to delete it with plain <code>docker rm web</code>. Read the error.", hint: "Just type it. It's supposed to fail.", answer: "docker rm web",
              check: (r) => r.argv[0] === "docker" && r.argv[1] === "rm" && r.argv.includes("web") && !r.ok },
            { goal: "Force-delete <code>web</code> (stop + remove in one go).", hint: "docker rm has a force flag.", answer: "docker rm -f web",
              check: (r, S) => !exists(S, "web") },
          ],
        },
      ],
    },

    // ================================================================ 2
    {
      id: "images",
      title: "Images & Dockerfile",
      tag: "Docker",
      color: "blue",
      blurb: "Download images and build your own.",
      lessons: [
        {
          id: "pull",
          title: "Images and tags",
          read: "Images are named <code>name:tag</code>. The tag is the version. <code>alpine</code> tags are tiny versions. No tag means <code>:latest</code>.",
          terms: [["redis:7-alpine", "name : tag"], ["pull", "download"], ["rmi", "delete image"]],
          docs: [["docker pull", "https://docs.docker.com/reference/cli/docker/image/pull/"], ["Docker Hub", "https://hub.docker.com"]],
          missions: [
            { goal: "Download <code>redis:7-alpine</code> without running it.", hint: "docker pull NAME:TAG", answer: "docker pull redis:7-alpine",
              check: (r, S) => !!local(S).images["redis:7-alpine"] && cmdIs(r, "docker") && /pull/.test(r.line) },
            { goal: "List your images. Check the sizes.", hint: "docker images", answer: "docker images",
              check: (r) => cmdIs(r, "docker", "images") || cmdIs(r, "docker", "image", "ls") },
            { goal: "Delete the <code>redis:7-alpine</code> image.", hint: "docker rmi NAME:TAG", answer: "docker rmi redis:7-alpine",
              check: (r, S) => !local(S).images["redis:7-alpine"] && /rmi|image rm/.test(r.line) },
          ],
        },
        {
          id: "build",
          title: "Build your own image",
          read: "A <b>Dockerfile</b> is your own recipe. <code>FROM</code> picks a base, <code>COPY</code> adds your code, <code>RUN</code> installs, <code>CMD</code> is what starts.",
          terms: [["Dockerfile", "your recipe"], ["build -t", "cook + name it"], [".", "this folder"]],
          docs: [["Dockerfile reference", "https://docs.docker.com/reference/dockerfile/"], ["docker build", "https://docs.docker.com/reference/cli/docker/buildx/build/"]],
          missions: [
            { goal: "See the files in this project.", hint: "List the folder.", answer: "ls",
              check: (r) => r.ok && r.argv[0] === "ls" },
            { goal: "Read the <code>Dockerfile</code>.", hint: "cat FILE", answer: "cat Dockerfile",
              check: (r) => r.ok && r.argv[0] === "cat" && r.argv[1] === "Dockerfile" },
            { goal: "Build an image named <code>hello:1.0</code> from this folder.", hint: "docker build -t NAME:TAG .", answer: "docker build -t hello:1.0 .",
              check: (r, S) => !!local(S).images["hello:1.0"] },
            { goal: "Run it in the background on port <b>3000</b>, named <code>hello</code>.", hint: "The app listens on 3000 inside.", answer: "docker run -d -p 3000:3000 --name hello hello:1.0",
              check: (r, S) => { const c = running(S, "hello"); return c && c.image === "hello:1.0" && c.ports.some((p) => p.host === 3000 && p.container === 3000); } },
            { goal: "Call your app.", hint: "curl it on port 3000.", answer: "curl http://localhost:3000",
              check: (r) => r.ok && r.argv[0] === "curl" && /localhost:3000/.test(r.line) },
          ],
        },
      ],
    },

    // ================================================================ 3
    {
      id: "data",
      title: "Volumes & Networks",
      tag: "Docker",
      color: "green",
      blurb: "Keep data safe. Let boxes talk.",
      lessons: [
        {
          id: "volumes",
          title: "Volumes keep data alive",
          read: "Delete a container and its data is gone. A <b>volume</b> is storage that survives. Databases always use one.",
          terms: [["volume", "safe storage"], ["-v name:/path", "plug it in"], ["-e KEY=VALUE", "a setting"]],
          docs: [["Volumes", "https://docs.docker.com/engine/storage/volumes/"]],
          missions: [
            { goal: "Create a volume called <code>dbdata</code>.", hint: "docker volume create NAME", answer: "docker volume create dbdata",
              check: (r, S) => !!local(S).volumes.dbdata },
            { goal: "Run <code>mysql:8.4</code> named <code>db</code> in the background, with <code>MYSQL_ROOT_PASSWORD=secret</code>, storing data in <code>dbdata</code> at <code>/var/lib/mysql</code>.", hint: "docker run -d --name db -e KEY=VALUE -v VOLUME:/var/lib/mysql mysql:8.4", answer: "docker run -d --name db -e MYSQL_ROOT_PASSWORD=secret -v dbdata:/var/lib/mysql mysql:8.4",
              check: (r, S) => { const c = running(S, "db"); return c && c.image === "mysql:8.4" && c.mounts.some((m) => m.source === "dbdata" && m.target === "/var/lib/mysql") && c.env.some((e) => e.startsWith("MYSQL_ROOT_PASSWORD=")); } },
            { goal: "Delete the <code>db</code> container (force).", hint: "docker rm -f NAME", answer: "docker rm -f db",
              check: (r, S) => !exists(S, "db") },
            { goal: "List volumes. Your data is still there.", hint: "docker volume ls", answer: "docker volume ls",
              check: (r, S) => cmdIs(r, "docker", "volume") && /ls|list/.test(r.argv[2] || "") && !!local(S).volumes.dbdata },
          ],
        },
        {
          id: "networks",
          title: "Boxes talking by name",
          read: "On a network you create, containers find each other <b>by name</b>. Inside a box, <code>localhost</code> means that box itself.",
          terms: [["network create", "make a lane"], ["--network", "join it"], ["--rm", "auto-delete after"]],
          docs: [["Networking", "https://docs.docker.com/engine/network/"]],
          missions: [
            { goal: "Create a network called <code>appnet</code>.", hint: "docker network create NAME", answer: "docker network create appnet",
              check: (r, S) => !!local(S).networks.appnet },
            { goal: "Run <code>redis:7-alpine</code> in the background, named <code>cache</code>, on <code>appnet</code>.", hint: "--network NAME", answer: "docker run -d --name cache --network appnet redis:7-alpine",
              check: (r, S) => { const c = running(S, "cache"); return c && c.kind === "redis" && c.network === "appnet"; } },
            { goal: "From a throwaway container on <code>appnet</code>, ping redis at host <code>cache</code>. Expect <b>PONG</b>.", hint: "docker run --rm --network appnet redis:7-alpine redis-cli -h cache ping", answer: "docker run --rm --network appnet redis:7-alpine redis-cli -h cache ping",
              check: (r) => r.ok && /redis-cli/.test(r.line) && /ping/.test(r.line) },
          ],
        },
        {
          id: "cleanup",
          title: "Clean up",
          read: "Old images and stopped boxes eat disk. Check first, then prune. Never prune volumes unless you mean it.",
          terms: [["system df", "disk usage"], ["prune", "sweep up"]],
          docs: [["docker system prune", "https://docs.docker.com/reference/cli/docker/system/prune/"]],
          missions: [
            { goal: "See how much disk Docker uses.", hint: "docker system ...", answer: "docker system df",
              check: (r) => cmdIs(r, "docker", "system", "df") },
            { goal: "Sweep up stopped containers and unused stuff. Answer <code>y</code> when asked.", hint: "docker system prune, then y", answer: "docker system prune",
              check: (r) => r.confirmed === "system-prune" || (cmdIs(r, "docker", "system", "prune") && (has(r, "-f") || has(r, "--force"))) },
          ],
        },
      ],
    },

    // ================================================================ 4
    {
      id: "compose",
      title: "Docker Compose",
      tag: "Compose",
      color: "yellow",
      blurb: "A whole app from one file.",
      lessons: [
        {
          id: "compose-up",
          title: "Many boxes, one command",
          read: "<code>compose.yaml</code> lists every service of your app. One command starts them all, on their own network.",
          terms: [["services", "the boxes"], ["up -d", "start all"], ["down", "remove all"]],
          docs: [["Compose overview", "https://docs.docker.com/compose/"], ["Compose file", "https://docs.docker.com/reference/compose-file/"]],
          missions: [
            { goal: "Read <code>compose.yaml</code>.", hint: "cat FILE", answer: "cat compose.yaml",
              check: (r) => r.ok && r.argv[0] === "cat" && r.argv[1] === "compose.yaml" },
            { goal: "Start the whole app in the background.", hint: "docker compose up ...", answer: "docker compose up -d",
              check: (r, S) => !!running(S, "app-web-1") && !!running(S, "app-db-1") },
            { goal: "See the app's services.", hint: "docker compose ps", answer: "docker compose ps",
              check: (r) => cmdIs(r, "docker", "compose", "ps") },
            { goal: "Read only the <code>web</code> service's logs.", hint: "docker compose logs SERVICE", answer: "docker compose logs web",
              check: (r) => cmdIs(r, "docker", "compose", "logs") && r.argv.includes("web") },
          ],
        },
        {
          id: "compose-work",
          title: "Work inside services",
          read: "<code>docker compose exec SERVICE COMMAND</code> runs a command inside a running service. Same pattern for any tool: artisan, npm, psql.",
          terms: [["exec", "run inside"], ["restart", "reboot one"], ["down -v", "⚠ deletes data"]],
          docs: [["docker compose exec", "https://docs.docker.com/reference/cli/docker/compose/exec/"]],
          setup: (S) => { if (!running(S, "app-web-1")) { Sim.exec(S, "docker compose up -d"); S.history.pop(); } },
          missions: [
            { goal: "Open the Postgres shell inside the <code>db</code> service as user <code>postgres</code>.", hint: "docker compose exec db psql -U postgres", answer: "docker compose exec db psql -U postgres",
              check: (r) => cmdIs(r, "docker", "compose", "exec") && r.argv.includes("db") && r.argv.includes("psql") },
            { goal: "Restart just the <code>web</code> service.", hint: "docker compose restart SERVICE", answer: "docker compose restart web",
              check: (r) => cmdIs(r, "docker", "compose", "restart") && r.argv.includes("web") },
            { goal: "Stop and remove the app, but <b>keep</b> the database data.", hint: "down without -v", answer: "docker compose down",
              check: (r, S) => cmdIs(r, "docker", "compose", "down") && !has(r, "-v") && !has(r, "--volumes") && !exists(S, "app-web-1") },
          ],
        },
      ],
    },

    // ================================================================ 5
    {
      id: "ship",
      title: "Ship to a Server",
      tag: "Deploy",
      color: "red",
      blurb: "Push your image, run it on a VPS.",
      lessons: [
        {
          id: "registry",
          title: "Push to a registry",
          read: "A <b>registry</b> is a shelf for images (Docker Hub). Build on your laptop, push, and the server pulls the finished box.",
          terms: [["login", "sign in"], ["tag", "rename for shelf"], ["push", "upload"]],
          docs: [["docker push", "https://docs.docker.com/reference/cli/docker/image/push/"]],
          setup: (S) => Sim.ensureImage(S, "hello:1.0"),
          missions: [
            { goal: "Log in to Docker Hub.", hint: "docker login", answer: "docker login",
              check: (r, S) => S.loggedIn },
            { goal: "Tag <code>hello:1.0</code> as <code>yourname/hello:1.0</code>.", hint: "docker tag SOURCE TARGET", answer: "docker tag hello:1.0 yourname/hello:1.0",
              check: (r, S) => !!local(S).images["yourname/hello:1.0"] },
            { goal: "Push <code>yourname/hello:1.0</code>.", hint: "docker push NAME:TAG", answer: "docker push yourname/hello:1.0",
              check: (r, S) => !!S.registry["yourname/hello:1.0"] },
          ],
        },
        {
          id: "vps",
          title: "Run it on a VPS",
          read: "A VPS is a Linux computer in a data centre. You log in with <code>ssh</code>, install Docker once, then pull and run your image.",
          terms: [["ssh", "log in remotely"], ["--restart unless-stopped", "survive reboots"], ["exit", "log out"]],
          docs: [["Install Docker Engine", "https://docs.docker.com/engine/install/ubuntu/"], ["Restart policies", "https://docs.docker.com/engine/containers/start-containers-automatically/"]],
          setup: (S) => { if (!S.registry["yourname/hello:1.0"]) S.registry["yourname/hello:1.0"] = { size: "164MB", mb: 164, kind: "app" }; },
          missions: [
            { goal: "Log in to the server <code>my-vps</code> as user <code>deploy</code>.", hint: "ssh USER@HOST", answer: "ssh deploy@my-vps",
              check: (r, S) => S.host === "vps" },
            { goal: "Try <code>docker --version</code> on the server.", hint: "It isn't installed yet. Just look.", answer: "docker --version",
              check: (r, S) => S.host === "vps" && r.argv[0] === "docker" },
            { goal: "Install Docker with the official script.", hint: "curl -fsSL https://get.docker.com | sh", answer: "curl -fsSL https://get.docker.com | sh",
              check: (r, S) => S.hosts.vps.installed },
            { goal: "Run <code>yourname/hello:1.0</code> named <code>hello</code>, in the background, port <b>80</b> → 3000, restarting <code>unless-stopped</code>.", hint: "docker run -d --restart unless-stopped -p 80:3000 --name hello yourname/hello:1.0", answer: "docker run -d --restart unless-stopped -p 80:3000 --name hello yourname/hello:1.0",
              check: (r, S) => { const c = running(S, "hello", "vps"); return c && c.restart === "unless-stopped" && c.ports.some((p) => p.host === 80 && p.container === 3000); } },
            { goal: "Log out of the server.", hint: "exit", answer: "exit",
              check: (r, S) => S.host === "local" },
          ],
        },
      ],
    },

    // ================================================================ 6
    {
      id: "k8s",
      title: "Kubernetes",
      tag: "K8s",
      color: "teal",
      blurb: "Boxes on many machines, self-healing.",
      lessons: [
        {
          id: "cluster",
          title: "Your own cluster",
          read: "Kubernetes runs boxes across many machines (<b>nodes</b>). <code>kind</code> makes a tiny practice cluster inside Docker. You talk to it with <code>kubectl</code>.",
          terms: [["cluster", "all machines"], ["node", "one machine"], ["kubectl", "the remote"]],
          docs: [["kind quick start", "https://kind.sigs.k8s.io/docs/user/quick-start/"], ["kubectl cheat sheet", "https://kubernetes.io/docs/reference/kubectl/quick-reference/"]],
          setup: (S) => { if (S.host !== "local") S.host = "local"; },
          missions: [
            { goal: "Try <code>kubectl get nodes</code> before a cluster exists.", hint: "Just type it. It will fail.", answer: "kubectl get nodes",
              check: (r, S) => r.argv[0] === "kubectl" && !S.k8s },
            { goal: "Create a cluster named <code>learn</code> with kind.", hint: "kind create cluster --name NAME", answer: "kind create cluster --name learn",
              check: (r, S) => !!S.k8s },
            { goal: "Now list the nodes.", hint: "kubectl get nodes", answer: "kubectl get nodes",
              check: (r) => r.ok && r.argv[0] === "kubectl" && r.argv[1] === "get" && /^no(des?)?$/.test(r.argv[2] || "") },
          ],
        },
        {
          id: "deploy",
          title: "Deploy and scale",
          read: "A <b>Deployment</b> says \"keep N copies running\". Each copy is a <b>pod</b>. A <b>Service</b> gives them one stable address.",
          terms: [["deployment", "keep N running"], ["pod", "one copy"], ["service", "one address"]],
          docs: [["Deployments", "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/"], ["Services", "https://kubernetes.io/docs/concepts/services-networking/service/"]],
          setup: (S) => { if (!S.k8s) { Sim.exec(S, "kind create cluster --name learn"); S.history.pop(); } },
          missions: [
            { goal: "Create a deployment <code>web</code> with image <code>nginx:1.27</code> and <b>2</b> replicas.", hint: "kubectl create deployment NAME --image=IMAGE --replicas=N", answer: "kubectl create deployment web --image=nginx:1.27 --replicas=2",
              check: (r, S) => S.k8s && S.k8s.deployments.web && S.k8s.deployments.web.replicas >= 2 },
            { goal: "List the pods.", hint: "kubectl get pods", answer: "kubectl get pods",
              check: (r) => r.ok && r.argv[0] === "kubectl" && r.argv[1] === "get" && /^po(ds?)?$/.test(r.argv[2] || "") },
            { goal: "Give <code>web</code> a Service on port 80.", hint: "kubectl expose deployment NAME --port=80", answer: "kubectl expose deployment web --port=80",
              check: (r, S) => S.k8s && !!S.k8s.services.web },
            { goal: "Scale <code>web</code> to <b>5</b> replicas.", hint: "kubectl scale deployment NAME --replicas=N", answer: "kubectl scale deployment web --replicas=5",
              check: (r, S) => S.k8s && S.k8s.deployments.web && S.k8s.deployments.web.replicas === 5 },
            { goal: "Kill all <code>web</code> pods at once. Then list pods: they come back.", hint: "kubectl delete pod -l app=web", answer: "kubectl delete pod -l app=web",
              check: (r, S) => S.k8s && S.k8s.lastDeletedPod && S.k8s.lastDeletedPod.deploy === "web" },
          ],
        },
        {
          id: "rollout",
          title: "Update and roll back",
          read: "Change the image and Kubernetes swaps pods one by one: no downtime. Didn't like it? Undo.",
          terms: [["set image", "new version"], ["rollout status", "watch it"], ["rollout undo", "go back"]],
          docs: [["Rolling updates", "https://kubernetes.io/docs/tutorials/kubernetes-basics/update/update-intro/"]],
          setup: (S) => {
            if (!S.k8s) { Sim.exec(S, "kind create cluster --name learn"); S.history.pop(); }
            if (!S.k8s.deployments.web) { Sim.exec(S, "kubectl create deployment web --image=nginx:1.27 --replicas=5"); S.history.pop(); }
          },
          missions: [
            { goal: "Update container <code>nginx</code> in <code>deployment/web</code> to <code>nginx:1.27-alpine</code>.", hint: "kubectl set image deployment/NAME CONTAINER=IMAGE", answer: "kubectl set image deployment/web nginx=nginx:1.27-alpine",
              check: (r, S) => S.k8s && S.k8s.deployments.web && S.k8s.deployments.web.image === "nginx:1.27-alpine" },
            { goal: "Watch the rollout finish.", hint: "kubectl rollout status deployment/NAME", answer: "kubectl rollout status deployment/web",
              check: (r) => r.ok && r.argv[0] === "kubectl" && r.argv[1] === "rollout" && r.argv[2] === "status" },
            { goal: "Roll back to the previous version.", hint: "kubectl rollout undo deployment/NAME", answer: "kubectl rollout undo deployment/web",
              check: (r, S) => r.ok && r.argv[1] === "rollout" && r.argv[2] === "undo" },
          ],
        },
        {
          id: "debug",
          title: "Fix a broken pod",
          read: "<code>ImagePullBackOff</code> = bad image name. <code>CrashLoopBackOff</code> = app keeps crashing. <code>describe</code> shows the reason at the bottom.",
          terms: [["describe", "why?"], ["logs", "what it said"], ["Events", "the clues"]],
          docs: [["Debug pods", "https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/"]],
          setup: (S) => { if (!S.k8s) { Sim.exec(S, "kind create cluster --name learn"); S.history.pop(); } },
          missions: [
            { goal: "Break it on purpose: create deployment <code>oops</code> with image <code>nginx:doesnotexist</code>.", hint: "kubectl create deployment oops --image=...", answer: "kubectl create deployment oops --image=nginx:doesnotexist",
              check: (r, S) => S.k8s && !!S.k8s.deployments.oops },
            { goal: "List pods. Spot the bad status.", hint: "kubectl get pods", answer: "kubectl get pods",
              check: (r) => r.ok && r.argv[0] === "kubectl" && r.argv[1] === "get" && /^po(ds?)?$/.test(r.argv[2] || "") },
            { goal: "Describe the <code>oops</code> pod and read its Events. (Copy its name from the list.)", hint: "kubectl describe pod POD_NAME", answer: "kubectl describe pod oops-",
              check: (r) => r.ok && r.argv[0] === "kubectl" && r.argv[1] === "describe" && /oops/.test(r.line) },
            { goal: "Delete the <code>oops</code> deployment.", hint: "kubectl delete deployment NAME", answer: "kubectl delete deployment oops",
              check: (r, S) => S.k8s && !S.k8s.deployments.oops },
          ],
        },
      ],
    },
  ];
})();
