const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Hello World</title></head>
      <body>
        <h1>Hello, World!</h1>
        <p>Running on host: ${HOST}, port: ${PORT}</p>
        <p>Environment: ${process.env.NODE_ENV || 'development'}</p>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});