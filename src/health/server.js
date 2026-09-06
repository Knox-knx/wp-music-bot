// codes by: @LouisPy
import http from 'node:http';

export function createHealthServer({ config, logger, getStatus }) {
  let server = null;

  function respond(res, statusCode, body) {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  function handle(req, res) {
    const url = req.url ?? '/';
    if (url === '/health') {
      respond(res, 200, {
        status: 'ok',
        whatsapp: getStatus(),
        uptime: Math.floor(process.uptime()),
      });
      return;
    }
    if (url === '/health/ready') {
      const ready = getStatus() === 'ready';
      respond(res, ready ? 200 : 503, {
        status: ready ? 'ready' : 'starting',
        whatsapp: getStatus(),
        uptime: Math.floor(process.uptime()),
      });
      return;
    }
    respond(res, 404, { status: 'not_found' });
  }

  async function start() {
    if (server) return server;
    server = http.createServer(handle);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.health.port, config.health.host, resolve);
    });
    logger.info(
      { host: config.health.host, port: config.health.port },
      'health server listening'
    );
    return server;
  }

  async function stop() {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
    logger.info('health server stopped');
  }

  return { start, stop, handle };
}