const net = require('net');
const http = require('http');
const url = require('url');
const express = require('express');
const socketIO = require('socket.io');

const app = express();
const proxyPort = 2560;
const dashboardPort = 3000;
let requestCount = 0;
let logs = [];

// Create the proxy server
const proxyServer = http.createServer((clientReq, clientRes) => {
  const reqUrl = url.parse(clientReq.url);
  logs.push(`[${new Date().toISOString()}] HTTP request for: ${reqUrl.href}`);
  requestCount++;

  const options = {
    hostname: reqUrl.hostname,
    port: reqUrl.port || 80,
    path: reqUrl.path,
    method: clientReq.method,
    headers: clientReq.headers,
  };

  const serverConnection = http.request(options, (res) => {
    clientRes.writeHead(res.statusCode, res.headers);
    res.pipe(clientRes);
  });

  clientReq.pipe(serverConnection);

  serverConnection.on('error', (e) => {
    logs.push(`[${new Date().toISOString()}] Server connection error: ${e}`);
    clientRes.writeHead(502);
    clientRes.end('Bad Gateway');
  });
});

proxyServer.on('connect', (clientReq, clientSocket, head) => {
  const [hostname, port] = clientReq.url.split(':');
  logs.push(`[${new Date().toISOString()}] HTTPS request for: ${clientReq.url}`);
  requestCount++;

  const serverSocket = net.connect({ host: hostname, port: port || 443 }, () => {
    clientSocket.write(
      'HTTP/1.1 200 Connection Established\r\n' +
      'Proxy-agent: Node.js-Proxy\r\n\r\n'
    );
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (e) => {
    logs.push(`[${new Date().toISOString()}] Server socket error: ${e}`);
    clientSocket.end();
  });

  clientSocket.on('error', (e) => {
    logs.push(`[${new Date().toISOString()}] Client socket error: ${e}`);
    serverSocket.end();
  });
});

proxyServer.on('clientError', (err, clientSocket) => {
  logs.push(`[${new Date().toISOString()}] Client error: ${err}`);
  clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

// Start the proxy server
proxyServer.listen(proxyPort, () => {
  console.log(`Proxy server is running on port ${proxyPort}`);
});

// Create the dashboard server
app.use(express.static(__dirname + '/public'));

app.get('/stats', (req, res) => {
  res.json({ requestCount, logs });
});

const dashboardServer = app.listen(dashboardPort, () => {
  console.log(`Dashboard is running on http://localhost:${dashboardPort}`);
});

// Integrate real-time updates with socket.io
const io = socketIO(dashboardServer);

io.on('connection', (socket) => {
  console.log('Client connected to dashboard');
  socket.emit('update', { requestCount, logs });

  setInterval(() => {
    socket.emit('update', { requestCount, logs });
  }, 1000);
});
